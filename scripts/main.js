/* scripts/main.js
   Robust loader: will try fetching data/projects.json (works on server).
   If fetch fails or not available (file://), falls back to parsing <script id="projects-data"> JSON embedded in HTML.
   Also handles:
   - rendering project cards,
   - simple tag filter (on projects.html),
   - action-button hover swap (hovered becomes primary) — idempotent,
   - improved active-nav detection (works for /projects/subpage.html),
   - reveal-on-scroll for project cards,
   - optional MutationObserver to auto-init when content is injected.
*/

/* ----------------- Module-level state (safe re-init) ------------------ */
// Keep references so repeated calls don't leak observers or duplicate handlers
let revealObserver = null;
let autoInitObserver = null;
let initDebounceTimeout = null;

/* ----------------- DOMContentLoaded startup ------------------ */
document.addEventListener('DOMContentLoaded', () => {
  // Set year(s) wherever you have #year, #year-2, #year-3
  document.querySelectorAll('#year, #year-2, #year-3').forEach(el => el.textContent = new Date().getFullYear());

  // Load project data and render (fetch -> fallback to embedded script tag)
  loadProjects()
    .then(projects => {
      renderProjectsGrid(projects);
      populateTagFilter(projects);
      startRevealObserver(); // observe reveal elements
    })
    .catch(err => {
      console.error('Could not load projects:', err);
      const grid = document.getElementById('projects-grid');
      if (grid) grid.innerHTML = '<p style="color:var(--muted)">No projects to display — check data/projects.json or embedded projects-data.</p>';
    });

  // Initialize UI behaviours (safe/idempotent)
  setupActionButtonHoverSwap(); // attach hover/focus handlers to .action-btn (no duplicates)
  setActiveNav();               // compute and mark "active" link(s)
  startRevealObserver();        // start or refresh the reveal observer

  // Start a MutationObserver so if nav/buttons/cards are injected later we re-run initializers.
  startAutoInitObserver();
});

/* ----------------- Data loader: fetch with fallback ------------------ */
async function loadProjects() {
  // try server fetch first (preferred)
  try {
    const res = await fetch('data/projects.json', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json) && json.length) return json;
    }
  } catch (e) {
    // ignore — we'll try embedded JSON below
  }

  // fallback: parse embedded JSON found in <script id="projects-data">...</script>
  const embedded = document.getElementById('projects-data');
  if (embedded) {
    try {
      const parsed = JSON.parse(embedded.textContent);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      console.error('Embedded projects JSON invalid', e);
    }
  }

  throw new Error('No projects JSON available.');
}

/* ----------------- Project card creation & rendering ------------------ */
function createProjectCard(proj) {
  const a = document.createElement('a');
  a.href = proj.page ? proj.page : (proj.link || '#');
  a.className = 'project-card reveal';
  a.setAttribute('aria-label', `${proj.title} — ${proj.summary}`);
  if (proj.external) { a.target = '_blank'; a.rel = 'noopener'; }

  const thumb = document.createElement('div');
  thumb.className = 'project-thumb';
  const img = document.createElement('img');
  img.src = proj.thumbnail || 'assets/thumb-1.jpg';
  img.alt = proj.alt || proj.title + ' thumbnail';
  img.loading = 'lazy';
  thumb.appendChild(img);
  a.appendChild(thumb);

  const body = document.createElement('div');
  body.className = 'card-body';
  const h3 = document.createElement('h3'); h3.textContent = proj.title;
  const p = document.createElement('p'); p.className = 'meta'; p.textContent = proj.summary;
  const tagsDiv = document.createElement('div'); tagsDiv.className = 'tags';
  (proj.tags || []).forEach(t => {
    const span = document.createElement('span');
    span.className = 'tag';
    span.textContent = t;
    span.style.marginRight = '8px';
    span.style.fontSize = '0.8rem';
    span.style.color = 'var(--muted)';
    tagsDiv.appendChild(span);
  });

  body.appendChild(h3);
  body.appendChild(p);
  body.appendChild(tagsDiv);
  a.appendChild(body);

  return a;
}

function renderProjectsGrid(projects) {
  const grid = document.getElementById('projects-grid');
  const gridFull = document.getElementById('projects-grid-full');

  // Clear existing content (defensive)
  if (grid) grid.innerHTML = '';
  if (gridFull) gridFull.innerHTML = '';

  projects.forEach((proj, idx) => {
    const node = createProjectCard(proj);
    if (gridFull) gridFull.appendChild(node);
    if (grid && idx < 3) {
      // clone so both grids contain separate nodes
      grid.appendChild(node.cloneNode(true));
    }
  });
}

/* ----------------- Tag filter for projects page ------------------ */
function populateTagFilter(projects) {
  const select = document.getElementById('tag-filter');
  if (!select) return;

  // gather unique tags and sort
  const tags = Array.from(new Set(projects.flatMap(p => p.tags || []))).sort();

  // insert "all" option first if not already present in DOM
  const allOpt = document.createElement('option'); allOpt.value = 'all'; allOpt.textContent = 'All';
  select.appendChild(allOpt);

  tags.forEach(t => {
    const opt = document.createElement('option'); opt.value = t; opt.textContent = t;
    select.appendChild(opt);
  });

  // filter on change — re-render gridFull matching tag
  select.addEventListener('change', () => {
    const chosen = select.value;
    const grid = document.getElementById('projects-grid-full');
    if (!grid) return;
    grid.innerHTML = '';
    const filtered = chosen === 'all' ? projects : projects.filter(p => (p.tags || []).includes(chosen));
    filtered.forEach(p => grid.appendChild(createProjectCard(p)));
    // restart reveal observer to observe newly-added nodes
    startRevealObserver();
  });
}

/* ----------------- Hover swap for action buttons (idempotent) ------------------ */
/* Behaviour:
   - Hover/focus a .action-btn -> becomes visual .primary
   - On leave/blur restore the original primary (the element that had .primary at init)
   - Idempotent: re-calling this function won't double-bind handlers (uses dataset flag)
*/
function setupActionButtonHoverSwap() {
  const buttons = Array.from(document.querySelectorAll('.action-btn'));
  if (!buttons.length) return;

  // Remember whichever element is primary at initialization
  const original = document.querySelector('.action-btn.primary');
  if (original) original.dataset.original = 'true';

  // helper to clear and set primary class
  function setPrimary(el) {
    buttons.forEach(b => b.classList.remove('primary'));
    if (el) el.classList.add('primary');
  }

  function restoreOriginal() {
    // prefer element that still has the original data attribute
    const marked = document.querySelector('.action-btn[data-original="true"]');
    if (marked) {
      setPrimary(marked);
    } else if (original) {
      setPrimary(original);
    } else {
      // no original — clear all primary classes
      buttons.forEach(b => b.classList.remove('primary'));
    }
  }

  // Attach handlers only once per button
  buttons.forEach(btn => {
    if (btn.dataset.hoverInit === '1') return; // already initialized

    btn.addEventListener('pointerenter', () => setPrimary(btn));
    btn.addEventListener('pointerleave', restoreOriginal);
    btn.addEventListener('focus', () => setPrimary(btn));
    btn.addEventListener('blur', restoreOriginal);
    // small touch support: highlight on touchstart (passive so we don't block)
    btn.addEventListener('touchstart', () => setPrimary(btn), { passive: true });

    // mark as initialized so subsequent calls don't rebind
    btn.dataset.hoverInit = '1';
  });
}

/* ----------------- Improved active-nav detection ------------------ */
/* - Normalizes pathnames (removes trailing slash)
   - Resolves relative hrefs via URL() (handles ../)
   - Treats any page under /projects/ as the Projects link (special-case)
   - Marks matching <a> with aria-current="page" and .active
*/
function setActiveNav() {
  const navLinks = document.querySelectorAll('.site-nav-center a, .site-nav-left a, .site-nav a');
  if (!navLinks || !navLinks.length) return;

  // current pathname normalized (no trailing slash), default to '/'
  const currentPath = (window.location.pathname || '/').replace(/\/+$/, '') || '/';

  navLinks.forEach(a => {
    const href = a.getAttribute('href') || '';
    let linkPath;
    try {
      // resolve relative hrefs properly
      linkPath = new URL(href, window.location.href).pathname.replace(/\/+$/, '') || '/';
    } catch (e) {
      // fallback: construct from raw href segments
      linkPath = '/' + href.split('/').filter(Boolean).join('/').replace(/\/+$/, '');
      if (!linkPath) linkPath = '/';
    }

    let isActive = false;

    // 1) Exact match (same file/path)
    if (linkPath === currentPath) isActive = true;

    // 2) Handle directory vs index.html equivalence:
    //    treat "/repo" and "/repo/index.html" as the same page.
    //    this covers your GitHub Pages project root (e.g. "/elharrar-elmehdi" <-> "/elharrar-elmehdi/index.html").
    if (!isActive) {
      if (linkPath === currentPath + '/index.html' || currentPath === linkPath + '/index.html') {
        isActive = true;
      }
    }

    // 3) Special: treat pages under /projects/* as matching Projects root link
    if (!isActive) {
      const linkIsProjectsRoot =
        linkPath === '/projects' || linkPath.endsWith('/projects') || linkPath.endsWith('/projects.html');
      const currentIsInProjects =
        currentPath.includes('/projects/') || currentPath.endsWith('/projects') || currentPath.endsWith('/projects.html');
      if (linkIsProjectsRoot && currentIsInProjects) isActive = true;
    }

    // 4) Home fallback: match root or index.html equivalently (covers generic root "/")
    if (!isActive) {
      const linkIsHome = linkPath === '/' || linkPath.endsWith('/index.html');
      const currentIsHome = currentPath === '/' || currentPath.endsWith('/index.html');
      if (linkIsHome && currentIsHome) isActive = true;
    }

    // apply classes/attributes
    if (isActive) {
      a.setAttribute('aria-current', 'page');
      a.classList.add('active');
    } else {
      a.removeAttribute('aria-current');
      a.classList.remove('active');
    }
  });
}


/* ----------------- Reveal-on-scroll (safe to call multiple times) ------------------ */
/* Uses IntersectionObserver when available. Re-creates observer when re-called
   so that if new elements are added we observe them.
*/
function startRevealObserver() {
  const reveals = document.querySelectorAll('.reveal');
  if (!reveals || !reveals.length) return;

  // disconnect previous observer to avoid duplicates / leaks
  if (revealObserver) {
    try { revealObserver.disconnect(); } catch (e) { /* ignore */ }
    revealObserver = null;
  }

  // If IntersectionObserver not supported, just mark revealed
  if (!('IntersectionObserver' in window)) {
    reveals.forEach(el => el.classList.add('revealed'));
    return;
  }

  revealObserver = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  reveals.forEach(el => {
    // skip if already revealed
    if (!el.classList.contains('revealed')) revealObserver.observe(el);
  });
}

/* ----------------- Auto-init MutationObserver (optional but helpful) ------------------ */
/* Observes DOM insertions and re-runs initializers (debounced) so that if nav,
   action buttons, or project cards are injected via JS later we pick them up.
*/
function startAutoInitObserver() {
  // avoid creating multiple observers
  if (autoInitObserver) return;

  // Debounced handler to avoid rapid repeated work
  function scheduleReinit() {
    if (initDebounceTimeout) clearTimeout(initDebounceTimeout);
    initDebounceTimeout = setTimeout(() => {
      // re-run idempotent initializers
      setupActionButtonHoverSwap();
      setActiveNav();
      startRevealObserver();
      initDebounceTimeout = null;
    }, 80); // small delay to batch multiple mutations
  }

  autoInitObserver = new MutationObserver((mutations) => {
    // Quick scan: only schedule reinit if added nodes might affect nav/buttons/reveals
    let relevant = false;
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length) {
        for (const n of m.addedNodes) {
          if (!(n instanceof Element)) continue;
          if (n.matches && (n.matches('.action-btn') || n.matches('.site-nav') || n.matches('.reveal') || n.querySelector && (n.querySelector('.action-btn') || n.querySelector('.site-nav') || n.querySelector('.reveal')))) {
            relevant = true;
            break;
          }
        }
      }
      if (relevant) break;
    }
    if (relevant) scheduleReinit();
  });

  // Observe the whole document for additions (subtree). This is conservative but useful for templated injections.
  autoInitObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });
}

/* ----------------- End of file ------------------ */
