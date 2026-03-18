// Core UI logic for Savr price comparison, fully driven by provider data

// Platform config used both for display badges and deep links
// ── ROUTER ────────────────────────────────────────────────────────────────────
const PAGES = ['home','how','platforms','about','search'];
 
function showPage(id) {
  if (!PAGES.includes(id)) id = 'home';
  PAGES.forEach(p => {
    const el = document.getElementById('page-' + p);
    if (el) el.classList.remove('active');
  });
  const target = document.getElementById('page-' + id);
  if (target) { target.classList.add('active'); window.scrollTo(0, 0); }
 
  // Nav highlights
  ['how','platforms','about'].forEach(k => {
    const btn = document.getElementById('nav-' + k);
    if (btn) btn.classList.toggle('active', k === id);
  });
  const searchCta = document.getElementById('nav-search');
  if (searchCta) searchCta.classList.toggle('dimmed', id === 'search');
 
  history.pushState({ page: id }, '', '#' + id);
 
  // Init search page once on first visit
  if (id === 'search' && !window._searchReady) {
    window._searchReady = true;
    initSearch();
  }
}
 
window.addEventListener('popstate', e => {
  const id = (e.state && e.state.page) || location.hash.replace('#', '') || 'home';
  showPage(id);
});
 
// ── PLATFORM META ─────────────────────────────────────────────────────────────
const PLATFORMS = [
  { id:'blinkit',   name:'Blinkit',   color:'#F7C75A', url:'https://blinkit.com/s/?q=' },
  { id:'zepto',     name:'Zepto',     color:'#9D5CF5', url:'https://www.zepto.com/search?query=' },
  { id:'instamart', name:'Instamart', color:'#FC8019', url:'https://www.swiggy.com/instamart/search?query=' },
  { id:'bigbasket', name:'BigBasket', color:'#80B500', url:'https://www.bigbasket.com/ps/?q=' },
  { id:'jiomart',   name:'JioMart',   color:'#0067B1', url:'https://www.jiomart.com/search/' }
];
 
const QUICK_PILLS = [
  { label:'🥛 Milk',  term:'milk'   },
  { label:'🍟 Chips', term:'chips'  },
  { label:'🌾 Atta',  term:'atta'   },
  { label:'☕ Coffee',term:'coffee' },
  { label:'🧼 Soap',  term:'soap'   },
  { label:'🥚 Eggs',  term:'eggs'   },
  { label:'🍞 Bread', term:'bread'  },
  { label:'🍚 Rice',  term:'rice'   }
];
 
// ── SEARCH STATE ──────────────────────────────────────────────────────────────
let allProducts   = [];
let currentSort   = 'default';
let currentFilter = 'all';
 
// ── INIT SEARCH PAGE ──────────────────────────────────────────────────────────
function initSearch() {
 
  // Quick pills
  const pillWrap = document.getElementById('quickPills');
  pillWrap.innerHTML = QUICK_PILLS
    .map(p => `<button class="pill" data-term="${p.term}">${p.label}</button>`)
    .join('');
  pillWrap.addEventListener('click', e => {
    const btn = e.target.closest('[data-term]');
    if (btn) quickSearch(btn.dataset.term);
  });
 
  // Provider filter chips
  const filterRow = document.getElementById('filtersRow');
  const filters = [
    { id:'all',       label:'All'           },
    { id:'blinkit',   label:'🟡 Blinkit'   },
    { id:'zepto',     label:'🟣 Zepto'     },
    { id:'instamart', label:'🟠 Instamart' },
    { id:'bigbasket', label:'🟢 BigBasket' },
    { id:'jiomart',   label:'🔵 JioMart'  },
  ];
  filterRow.innerHTML = '<span class="filter-label">Filter</span>' +
    filters.map(f =>
      `<button class="filter-chip${f.id === 'all' ? ' active' : ''}" data-filter="${f.id}">${f.label}</button>`
    ).join('');
  filterRow.addEventListener('click', e => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    filterRow.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    applyAll();
  });
 
  // Sort dropdown
  document.getElementById('sortSelect').addEventListener('change', e => {
    currentSort = e.target.value;
    applyAll();
  });
 
  // Search input + button
  document.getElementById('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });
  document.getElementById('searchBtn').addEventListener('click', doSearch);
}
 
// ── FILTER + SORT ─────────────────────────────────────────────────────────────
function applyAll() {
  let res = [...allProducts];
  if (currentFilter && currentFilter !== 'all') {
    res = res.filter(p => p.provider === currentFilter);
  }
  if (currentSort === 'cheapest')  res.sort((a, b) => a.price - b.price);
  if (currentSort === 'expensive') res.sort((a, b) => b.price - a.price);
  renderResults(res);
}
 
// ── RENDER RESULTS ────────────────────────────────────────────────────────────
function renderResults(products) {
  const container = document.getElementById('resultsContainer');
  const countEl   = document.getElementById('resultCount');
  countEl.textContent = `${products.length} result${products.length !== 1 ? 's' : ''}`;
 
  if (!products.length) {
    container.className = '';
    container.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">🔍</div>
        <h3>No results found</h3>
        <p>Try a different product name or change the filter.</p>
      </div>`;
    return;
  }
 
  container.className = 'results-grid';
  container.innerHTML = products.map((p, i) => {
    const plat  = PLATFORMS.find(pl => pl.id === p.provider);
    const pname = plat ? plat.name : (p.provider || 'Unknown');
    const color = plat ? plat.color : '#888';
    const link  = p.link || (plat ? plat.url + encodeURIComponent(p.name) : '#');
    const price = typeof p.price === 'number' ? p.price : 0;
    return `
      <div class="product-card" style="animation-delay:${i * 0.025}s">
        <div class="pc-top">
          <div>
            <div class="pc-name">${p.name || 'Unnamed product'}</div>
            ${p.qty ? `<div class="pc-qty">${p.qty}</div>` : ''}
          </div>
          <div class="pc-price-block">
            <div class="pc-price">₹${price}</div>
            ${p.mrp && p.mrp > price ? `<div class="pc-mrp">₹${p.mrp}</div>` : ''}
          </div>
        </div>
        ${p.discount ? `<span class="pc-discount">${p.discount}</span>` : ''}
        <div class="pc-provider">
          <span class="pc-dot" style="background:${color}"></span>
          <span class="pc-pname">${pname}</span>
          <span class="pc-delivery">${p.delivery || ''}</span>
        </div>
        <a class="pc-link" href="${link}" target="_blank" rel="noopener">Open on ${pname} →</a>
      </div>`;
  }).join('');
}
 
// ── DO SEARCH ─────────────────────────────────────────────────────────────────
async function doSearch() {
  const input      = document.getElementById('searchInput');
  const container  = document.getElementById('resultsContainer');
  const countEl    = document.getElementById('resultCount');
  const controls   = document.getElementById('searchControls');
  const resultsTop = document.getElementById('resultsTop');
  const q = input.value.trim();
  if (!q) return;
 
  controls.style.display   = 'flex';
  resultsTop.style.display = 'flex';
  countEl.textContent = `Searching "${q}"…`;
  container.className = '';
  container.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Fetching live prices from Blinkit, Zepto, Instamart, BigBasket &amp; JioMart…</p>
    </div>`;
 
  // Reset provider filter to "all"
  currentFilter = 'all';
  document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
  const allChip = document.querySelector('.filter-chip[data-filter="all"]');
  if (allChip) allChip.classList.add('active');
 
  try {
    const results = await fetchProductsFromProvider(q);
    allProducts = results;
    applyAll();
    countEl.textContent = results.length
      ? `${results.length} result${results.length !== 1 ? 's' : ''} for "${q}"`
      : `No results for "${q}"`;
  } catch (err) {
    console.error(err);
    countEl.textContent = `Error searching for "${q}"`;
    container.className = '';
    container.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">⚠️</div>
        <h3>Something went wrong</h3>
        <p>Could not reach the price server. Please try again.</p>
      </div>`;
  }
}
 
function quickSearch(term) {
  document.getElementById('searchInput').value = term;
  doSearch();
}
 
// ── BOOT ──────────────────────────────────────────────────────────────────────
(function boot() {
  const hash = location.hash.replace('#', '');
  showPage(PAGES.includes(hash) ? hash : 'home');
})();