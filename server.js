// Simple Node.js backend that crawls grocery providers
// and exposes a search API for the frontend.

const express = require('express');
const path = require('path');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// ─── Shared config ──────────────────────────────────────────────────────────────
const LAUNCH_OPTS = {
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
};

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/123.0.0.0 Safari/537.36';

// ─── Helpers ────────────────────────────────────────────────────────────────────
function parseMoney(str) {
  if (!str) return null;
  const n = parseFloat(str.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function blockAssets(page) {
  page.setRequestInterception(true);
  page.on('request', (req) => {
    if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
    else req.continue();
  });
}

// ─── BigBasket scraper ──────────────────────────────────────────────────────────
async function scrapeBigBasket(query) {
  const browser = await puppeteer.launch(LAUNCH_OPTS);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(CHROME_UA);
    blockAssets(page);

    const url = `https://www.bigbasket.com/ps/?q=${encodeURIComponent(query)}&nc=as`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('section section ul li', { timeout: 15000 })
      .catch(() => console.warn('[BigBasket] Selector timed out'));

    const rawItems = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll('section section ul li').forEach((li) => {
        const brand = li.querySelector('[class*="BrandName"]')?.textContent.trim() ?? '';
        const name  = li.querySelector('h3')?.textContent.trim() ?? '';
        if (!name) return;

        let qty = '';
        const packEl = li.querySelector('[class*="PackSelector"] span');
        if (packEl) qty = packEl.textContent.trim();
        else {
          const dropEl = li.querySelector('[aria-haspopup="listbox"] span');
          if (dropEl) qty = dropEl.textContent.trim();
        }

        let priceText = '', discount = null;
        li.querySelectorAll('span').forEach((s) => {
          const t = s.textContent.trim();
          if (t.includes('₹') && !t.includes('OFF') && !priceText) priceText = t;
          if (t.includes('OFF') && !discount) discount = t;
        });

        const anchor = li.querySelector('a[href]');
        const link = anchor
          ? 'https://www.bigbasket.com' + anchor.getAttribute('href').split('?')[0]
          : '';

        const numeric = parseFloat(priceText.replace(/[^0-9.]/g, ''));
        if (!Number.isFinite(numeric)) return;
        items.push({ brand, name, qty, numeric, discount, link });
      });
      return items;
    });

    console.log(`[BigBasket] ${rawItems.length} products for "${query}"`);
    return rawItems.map((p, i) => ({
      id: p.link || `bigbasket-${i}`,
      name: p.brand ? `${p.brand} ${p.name}` : p.name,
      qty: p.qty || '1 unit',
      category: 'grocery',
      provider: 'bigbasket',
      price: p.numeric,
      mrp: null,
      discount: p.discount,
      delivery: '2 hrs',
      rating: null,
      link: p.link,
    }));
  } finally {
    await browser.close();
  }
}

// ─── Zepto scraper ──────────────────────────────────────────────────────────────
async function scrapeZepto(query) {
  const browser = await puppeteer.launch(LAUNCH_OPTS);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(CHROME_UA);
    blockAssets(page);

    console.log('[Zepto] Loading homepage...');
    await page.goto('https://www.zepto.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 3000));

    const locationSelectors = [
      'button[aria-label="Select Location"]',
      'button[aria-label*="location" i]',
      '[data-testid="user-address"]',
    ];
    let locationBtn = null;
    for (const sel of locationSelectors) {
      locationBtn = await page.$(sel).catch(() => null);
      if (locationBtn) { console.log(`[Zepto] Location btn: ${sel}`); break; }
    }

    if (locationBtn) {
      await locationBtn.click();
      await new Promise((r) => setTimeout(r, 3000));

      const inputSelectors = [
        "input[placeholder='Search a new address']",
        "input[placeholder*='address' i]",
        "input[placeholder*='pincode' i]",
        "input[type='text'][aria-autocomplete]",
        "input[role='combobox']",
      ];
      let addressInput = null;
      for (const sel of inputSelectors) {
        addressInput = await page.waitForSelector(sel, { timeout: 5000 }).catch(() => null);
        if (addressInput) { console.log(`[Zepto] Address input: ${sel}`); break; }
      }

      if (addressInput) {
        const pin = process.env.ZEPTO_PIN || '560001';
        await addressInput.click({ clickCount: 3 });
        await addressInput.type(pin, { delay: 100 });
        await new Promise((r) => setTimeout(r, 4000));

        const suggestionSelectors = [
          "div[data-testid='address-search-item']",
          '[data-testid*="address" i]',
          '[role="option"]',
          '[role="listbox"] > *',
        ];
        let suggestion = null;
        for (const sel of suggestionSelectors) {
          suggestion = await page.$(sel).catch(() => null);
          if (suggestion) { console.log(`[Zepto] Suggestion: ${sel}`); break; }
        }

        if (suggestion) {
          await suggestion.click();
          await new Promise((r) => setTimeout(r, 3000));
          const confirmBtn = await page.$('button[aria-label*="Confirm" i]').catch(() => null);
          if (confirmBtn) { await confirmBtn.click(); await new Promise((r) => setTimeout(r, 3000)); }
        }
      }
    }

    const searchUrl = `https://www.zepto.com/search?query=${encodeURIComponent(query)}`;
    console.log(`[Zepto] Navigating to: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 4000));

    const gate = await page.$('button[aria-label="Select Location"]').catch(() => null);
    if (gate) { await page.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 2000)); }

    const cardSelectors = ['[data-variant="edlp"]', '[data-slot-id="ProductName"]', 'a[href^="/pn/"]'];
    let cardsFound = false;
    for (const sel of cardSelectors) {
      const found = await page.waitForSelector(sel, { timeout: 15000 }).catch(() => null);
      if (found) { console.log(`[Zepto] Cards via: ${sel}`); cardsFound = true; break; }
    }
    if (!cardsFound) { console.error('[Zepto] No cards found'); return []; }

    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await new Promise((r) => setTimeout(r, 1000));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 800));

    const rawItems = await page.evaluate(() => {
      function shallowText(el) {
        let t = '';
        for (const n of el.childNodes)
          if (n.nodeType === Node.TEXT_NODE) t += n.textContent;
        return t.trim();
      }
      function parseMoney(str) {
        if (!str) return null;
        const n = parseFloat(str.replace(/[^0-9.]/g, ''));
        return Number.isFinite(n) ? n : null;
      }
      const items = [];
      document.querySelectorAll('a[href^="/pn/"]').forEach((card) => {
        try {
          const inner = card.querySelector('[data-is-out-of-stock]');
          if (inner?.dataset.isOutOfStock === 'true') return;

          const name = card.querySelector('[data-slot-id="ProductName"]')?.textContent.trim();
          if (!name) return;
          const qty   = card.querySelector('[data-slot-id="PackSize"]')?.textContent.trim() ?? '';
          const block = card.querySelector('[data-slot-id="EdlpPrice"]');
          if (!block) return;
          const spans = [...block.querySelectorAll('span')];
          const price = parseMoney(spans[0]?.textContent);
          if (!price) return;
          const mrp   = parseMoney(spans[1]?.textContent ?? null);

          let discount = null;
          for (const sib of (block.parentElement?.children ?? [])) {
            if (sib === block) continue;
            const offSpan = [...sib.querySelectorAll('span')]
              .find((s) => s.textContent.trim().toUpperCase() === 'OFF');
            if (offSpan) {
              const amt = [...sib.querySelectorAll('span')].find((s) => s !== offSpan);
              discount = amt ? `${amt.textContent.trim()} OFF` : sib.textContent.replace(/\s+/g, ' ').trim();
              break;
            }
          }

          const rBlock = card.querySelector('[data-slot-id="RatingInformation"]');
          let rating = null, reviewCount = null;
          if (rBlock) {
            for (const s of rBlock.querySelectorAll('span')) {
              const shallow = shallowText(s);
              if (!rating && /^\d\.\d$/.test(shallow)) { rating = shallow; continue; }
              const full = s.textContent.trim();
              if (!reviewCount && /^\([\d.,kKmM]+\)$/.test(full))
                reviewCount = full.replace(/[()]/g, '');
            }
            if (!rating) { const m = rBlock.textContent.match(/\b(\d\.\d)\b/); if (m) rating = m[1]; }
          }

          const attrEl = card.querySelector('[data-slot-id="Attributes"] div, [data-slot-id="Attributes"] span');
          const isSponsored = !!card.querySelector('[data-slot-id="SponsorTag"]');
          const link = 'https://www.zepto.com' + (card.getAttribute('href') ?? '');

          items.push({ name, qty, price, mrp, discount, rating,
            reviewCount, attribute: attrEl?.textContent.trim() ?? null, isSponsored, link });
        } catch (_) {}
      });
      return items;
    });

    const seen = new Set();
    const deduped = rawItems.filter((p) => { if (seen.has(p.link)) return false; seen.add(p.link); return true; });
    console.log(`[Zepto] ${deduped.length} unique / ${rawItems.length} raw for "${query}"`);

    return deduped.map((p, i) => ({
      id: p.link || `zepto-${i}`,
      name: p.name, qty: p.qty || '1 unit',
      category: 'grocery', provider: 'zepto',
      price: p.price, mrp: p.mrp, discount: p.discount,
      delivery: '10 mins', rating: p.rating, reviewCount: p.reviewCount,
      attribute: p.attribute, isSponsored: p.isSponsored, link: p.link,
    }));
  } finally {
    await browser.close();
  }
}

// ─── Blinkit scraper ────────────────────────────────────────────────────────────
async function scrapeBlinkit(query) {
  const browser = await puppeteer.launch(LAUNCH_OPTS);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(CHROME_UA);
    blockAssets(page);

    const searchUrl = `https://blinkit.com/s/?q=${encodeURIComponent(query)}`;
    console.log(`[Blinkit] Navigating to: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 5000));

    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('div, span'))
        .filter((el) => el.children.length === 0 && /^₹\d+$/.test(el.textContent.trim()))
        .length >= 3,
      { timeout: 15000 }
    ).catch(() => console.warn('[Blinkit] Price elements not detected in time'));

    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await new Promise((r) => setTimeout(r, 1200));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 800));

    const rawItems = await page.evaluate(() => {
      function parseMoney(str) {
        if (!str) return null;
        const n = parseFloat(str.replace(/[^0-9.]/g, ''));
        return Number.isFinite(n) ? n : null;
      }

      const QTY_RE      = /^\d+(\.\d+)?(\s*x\s*\d+(\.\d+)?)?\s*(ml|l\b|g\b|kg|pcs?|pack|gm|ltr|oz|piece|litre)/i;
      const DELIVERY_RE = /^\d+\s*MINS?$/i;
      const PRICE_RE    = /^₹\d/;
      const DISCOUNT_RE = /^\d+%\s*OFF$/i;

      let resultsContainer = null;
      let maxAddCount = 0;
      const priceLeaf = Array.from(document.querySelectorAll('div, span'))
        .find((el) => el.children.length === 0 && /^₹\d+$/.test(el.textContent.trim()));

      if (priceLeaf) {
        let el = priceLeaf;
        for (let i = 0; i < 15; i++) {
          el = el.parentElement;
          if (!el || el.tagName === 'BODY') break;
          const addCount = (el.innerText?.match(/\bADD\b/g) || []).length;
          if (addCount > maxAddCount) { maxAddCount = addCount; resultsContainer = el; }
        }
      }

      if (!resultsContainer || maxAddCount < 2) return [];

      const allLines = resultsContainer.innerText
        .split('\n').map((l) => l.trim()).filter(Boolean);

      const chunks = [];
      let current = null;
      let pendingDiscount = null;

      for (const line of allLines) {
        if (DISCOUNT_RE.test(line)) { pendingDiscount = line; continue; }
        if (DELIVERY_RE.test(line)) {
          if (current) chunks.push(current);
          current = { delivery: line, discount: pendingDiscount, lines: [] };
          pendingDiscount = null;
          continue;
        }
        if (current) current.lines.push(line);
      }
      if (current) chunks.push(current);

      const items = [];
      for (const { delivery, discount, lines } of chunks) {
        if (!lines.some((l) => /^ADD$/i.test(l))) continue;
        const dataLines  = lines.filter((l) => !/^ADD$/i.test(l));
        const priceLines = dataLines.filter((l) => PRICE_RE.test(l));
        const price      = parseMoney(priceLines[0]);
        if (!price) continue;
        const mrp        = priceLines.length > 1 ? parseMoney(priceLines[1]) : null;
        const qtyLine    = dataLines.find((l) => QTY_RE.test(l));
        const nameLines  = dataLines.filter((l) => !PRICE_RE.test(l) && !QTY_RE.test(l));
        const name       = nameLines.sort((a, b) => b.length - a.length)[0] ?? '';
        if (!name || name.length < 2) continue;
        items.push({ name, qty: qtyLine ?? '', price, mrp, discount, delivery });
      }
      return items;
    });

    const seen = new Set();
    const deduped = rawItems.filter((p) => {
      const k = p.name.toLowerCase().trim();
      if (seen.has(k)) return false; seen.add(k); return true;
    });
    console.log(`[Blinkit] ${deduped.length} unique / ${rawItems.length} raw for "${query}"`);

    return deduped.map((p, i) => ({
      id: `blinkit-${i}-${p.name.slice(0, 20).replace(/\s+/g, '-')}`,
      name: p.name, qty: p.qty || '1 unit',
      category: 'grocery', provider: 'blinkit',
      price: p.price, mrp: p.mrp, discount: p.discount,
      delivery: p.delivery ?? '10 mins',
      rating: null, reviewCount: null,
      link: `https://blinkit.com/s/?q=${encodeURIComponent(p.name)}`,
    }));
  } finally {
    await browser.close();
  }
}

// ─── Instamart scraper ──────────────────────────────────────────────────────────
/**
 * URL: https://www.swiggy.com/instamart
 *
 * DOM structure (verified Aug 2025):
 *   Location gate:
 *     Open btn:   div[data-testid="search-location"]
 *     Input:      input[placeholder*="Search for area"]
 *     Pick first: div[class*="icon-location-marker"]
 *     Confirm:    button > span[text*="Confirm"]
 *     Dismiss:    div[data-testid="re-check-address-tooltip"] > div[role="button"]
 *
 *   Search:
 *     Open:       button[data-testid="search-container"]
 *     Input:      input[type="search"]
 *     Submit:     Enter key
 *
 *   Product cards:  div[data-testid*="default_container"]
 *
 *   Text-split pattern per card (innerText.split('\n'), blanks removed):
 *     lines[0]    → optional "X% OFF"     → n += 1 if present
 *     lines[?]    → optional "Ad"         → n += 1 if present
 *     lines[?]    → optional "Handpicked" → n += 1 if present
 *     lines[n+1]  → Product name
 *     lines[n+3]  → Description
 *     lines[n+4]  → Quantity  e.g. "500 ml"
 *     lines[n+5]  → Price     e.g. "₹39"
 *     lines[n+6]  → MRP (optional, only when discounted)
 *
 *   Set INSTAMART_LOCATION env var to your city (default: "Bangalore")
 *   e.g.  INSTAMART_LOCATION="Mumbai" node server.js
 */
async function scrapeInstamart(query) {
  const browser = await puppeteer.launch(LAUNCH_OPTS);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(CHROME_UA);
    blockAssets(page);

    console.log('[Instamart] Loading homepage...');
    await page.goto('https://www.swiggy.com/instamart', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 3000));

    // ── Step 1: Open location dialog ──────────────────────────────────────────
    const locationDiv = await page.$('div[data-testid="search-location"]').catch(() => null);
    if (locationDiv) {
      console.log('[Instamart] Opening location dialog...');
      await locationDiv.click();
      await new Promise((r) => setTimeout(r, 2000));

      // ── Step 2: Type city name ─────────────────────────────────────────────
      const locationInput = await page
        .waitForSelector('input[placeholder*="Search for area"]', { timeout: 8000 })
        .catch(() => null);

      if (locationInput) {
        const city = process.env.INSTAMART_LOCATION || 'Bangalore';
        await locationInput.type(city, { delay: 80 });
        await new Promise((r) => setTimeout(r, 3000));

        // ── Step 3: Click first location suggestion ────────────────────────
        const suggestionSelectors = [
          'div[class*="icon-location-marker"]',
          '[data-testid*="location-item"]',
          '[role="option"]',
          '[role="listbox"] > *',
        ];
        let locationResult = null;
        for (const sel of suggestionSelectors) {
          locationResult = await page.$(sel).catch(() => null);
          if (locationResult) { console.log(`[Instamart] Location result via: ${sel}`); break; }
        }

        if (locationResult) {
          await locationResult.click();
          await new Promise((r) => setTimeout(r, 3000));

          // ── Step 4: Confirm location ─────────────────────────────────────
          // Find the button whose child span contains "Confirm"
          const confirmBtn = await page.evaluateHandle(() =>
            [...document.querySelectorAll('button span')]
              .find((s) => s.textContent.trim().toLowerCase().includes('confirm'))
              ?.closest('button')
          ).catch(() => null);

          if (confirmBtn && (await confirmBtn.asElement())) {
            await confirmBtn.asElement().click();
            await new Promise((r) => setTimeout(r, 3000));
          }

          // ── Step 5: Dismiss re-check address tooltip if present ──────────
          await page.evaluate(() => {
            const tooltip = document.querySelector(
              'div[data-testid="re-check-address-tooltip"] > div[role="button"]'
            );
            if (tooltip) tooltip.click();
          }).catch(() => {});
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    // ── Step 6: Open search bar ───────────────────────────────────────────────
    const searchBtn = await page.$('button[data-testid="search-container"]').catch(() => null);
    if (searchBtn) {
      await searchBtn.click();
      await new Promise((r) => setTimeout(r, 1500));
    }

    // ── Step 7: Type query and submit ─────────────────────────────────────────
    const searchInput = await page
      .waitForSelector('input[type="search"]', { timeout: 8000 })
      .catch(() => null);

    if (!searchInput) {
      console.error('[Instamart] Search input not found');
      return [];
    }

    await searchInput.type(query, { delay: 60 });
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 4000));

    // ── Step 8: Wait for product cards ────────────────────────────────────────
    const CARD_SEL = 'div[data-testid*="default_container"]';
    const cardsFound = await page
      .waitForSelector(CARD_SEL, { timeout: 15000 })
      .catch(() => null);

    if (!cardsFound) {
      console.error('[Instamart] No product cards found');
      return [];
    }

    // ── Step 9: Scroll to load lazy cards ────────────────────────────────────
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await new Promise((r) => setTimeout(r, 1200));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 800));

    // ── Step 10: Extract ──────────────────────────────────────────────────────
    const rawItems = await page.evaluate((CARD_SEL) => {
      function parseMoney(str) {
        if (!str) return null;
        const n = parseFloat(str.replace(/[^0-9.]/g, ''));
        return Number.isFinite(n) ? n : null;
      }

      const items = [];

      document.querySelectorAll(CARD_SEL).forEach((card) => {
        try {
          const lines = card.innerText
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);

          if (lines.length < 4) return;

          // Calculate leading-badge offset
          let n = 0;
          if (/\d+%\s*OFF/i.test(lines[0])) n += 1;      // discount badge at top
          if (lines.some((l) => /^Ad$/i.test(l))) n += 1; // sponsored label
          if (lines.some((l) => /^Handpicked$/i.test(l))) n += 1; // handpicked badge

          const name        = lines[n + 1] ?? '';
          const description = lines[n + 3] ?? '';
          const qty         = lines[n + 4] ?? '';
          const priceRaw    = lines[n + 5] ?? '';
          const price       = parseMoney(priceRaw);

          if (!name || !price) return;

          // MRP — present as next ₹ line when discounted
          const mrpRaw = lines[n + 6] ?? '';
          const mrp    = /^₹\d/.test(mrpRaw) ? parseMoney(mrpRaw) : null;

          // Discount string
          const discount = /\d+%\s*OFF/i.test(lines[0]) ? lines[0] : null;

          // Delivery time anywhere in card text
          const deliveryLine = lines.find((l) => /^\d+\s*mins?$/i.test(l));
          const delivery     = deliveryLine ?? '10 mins';

          items.push({ name, description, qty, price, mrp, discount, delivery });
        } catch (_) {}
      });

      return items;
    }, CARD_SEL);

    // Deduplicate by name
    const seen = new Set();
    const deduped = rawItems.filter((p) => {
      const k = p.name.toLowerCase().trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    console.log(`[Instamart] ${deduped.length} unique / ${rawItems.length} raw for "${query}"`);

    return deduped.map((p, i) => ({
      id: `instamart-${i}-${p.name.slice(0, 20).replace(/\s+/g, '-')}`,
      name: p.name,
      qty: p.qty || '1 unit',
      category: 'grocery',
      provider: 'instamart',
      price: p.price,
      mrp: p.mrp,
      discount: p.discount,
      delivery: p.delivery,
      description: p.description || null,
      rating: null,
      reviewCount: null,
      link: `https://www.swiggy.com/instamart/search?query=${encodeURIComponent(p.name)}`,
    }));
  } finally {
    await browser.close();
  }
}

// ─── JioMart scraper ────────────────────────────────────────────────────────────
async function scrapeJioMart(query) {
  const browser = await puppeteer.launch(LAUNCH_OPTS);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(CHROME_UA);
    blockAssets(page);

    const searchUrl = `https://www.jiomart.com/search/${encodeURIComponent(query)}`;
    console.log(`[JioMart] Navigating to: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 5000));

    const gridSelectors = [
      'li.ais-InfiniteHits-item',
      '[class*="product-card"]',
      '[id="search-product-list"] li',
      'ol.ais-InfiniteHits-list li',
    ];
    let cardsFound = false;
    for (const sel of gridSelectors) {
      const found = await page.waitForSelector(sel, { timeout: 15000 }).catch(() => null);
      if (found) { console.log(`[JioMart] Cards via: ${sel}`); cardsFound = true; break; }
    }
    if (!cardsFound) {
      console.warn('[JioMart] No card selector matched — attempting extraction anyway');
    }

    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await new Promise((r) => setTimeout(r, 1200));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 800));

    const snap = await page.evaluate(() => {
      const cards = document.querySelectorAll('li.ais-InfiniteHits-item');
      const firstCard = cards[0];
      return {
        url: location.href,
        cardCount: cards.length,
        firstCardHTML: firstCard ? firstCard.innerHTML.slice(0, 600) : 'NOT FOUND',
        firstCardText: firstCard ? firstCard.innerText.slice(0, 300) : 'NOT FOUND',
        allProductClasses: (() => {
          const kw = ['product', 'price', 'title', 'name', 'qty', 'mrp', 'discount', 'pack'];
          const s = new Set();
          document.querySelectorAll('*').forEach((el) => {
            if (typeof el.className === 'string')
              el.className.split(/\s+/).forEach((c) => {
                if (c.length > 3 && kw.some((k) => c.toLowerCase().includes(k))) s.add(c);
              });
          });
          return [...s].slice(0, 30);
        })(),
      };
    });
    console.log('[JioMart] Snapshot:', JSON.stringify(snap, null, 2));

    const rawItems = await page.evaluate(() => {
      function parseMoney(str) {
        if (!str) return null;
        const n = parseFloat(str.replace(/[^0-9.]/g, ''));
        return Number.isFinite(n) ? n : null;
      }

      let cards = Array.from(document.querySelectorAll('li.ais-InfiniteHits-item'));
      if (cards.length === 0)
        cards = Array.from(document.querySelectorAll('[class*="product-card"]'));
      if (cards.length === 0) {
        const priceLeaves = Array.from(document.querySelectorAll('span, div')).filter(
          (el) => el.children.length === 0 && /^₹\d+/.test(el.textContent.trim())
        );
        const cardSet = new Set();
        priceLeaves.forEach((leaf) => {
          let el = leaf;
          for (let i = 0; i < 8; i++) {
            el = el.parentElement;
            if (!el) break;
            if (el.tagName === 'LI') { cardSet.add(el); break; }
          }
        });
        cards = [...cardSet];
      }

      const items = [];
      cards.forEach((card) => {
        try {
          const nameSelectors = [
            '[class*="product-title"]', '[class*="clamp"]',
            '[class*="product__name"]', 'p[class*="name"]', 'h3', 'h2',
          ];
          let name = '';
          for (const sel of nameSelectors) {
            const el = card.querySelector(sel);
            if (el?.textContent.trim()) { name = el.textContent.trim(); break; }
          }
          if (!name) return;

          const priceSelectors = [
            '[class*="final-price"]', '[id*="final_price"]',
            '[class*="selling-price"]', '[class*="offer-price"]',
          ];
          let priceText = '';
          for (const sel of priceSelectors) {
            const el = card.querySelector(sel);
            if (el?.textContent.includes('₹')) { priceText = el.textContent.trim(); break; }
          }
          if (!priceText) {
            card.querySelectorAll('span').forEach((s) => {
              if (!priceText && /₹\d/.test(s.textContent) && !s.className.includes('line'))
                priceText = s.textContent.trim();
            });
          }
          const price = parseMoney(priceText);
          if (!price) return;

          const mrpSelectors = [
            '[class*="line-through"]', '[id*="price_mrp"]',
            '[class*="mrp"]', 'del', 's',
          ];
          let mrpText = '';
          for (const sel of mrpSelectors) {
            const el = card.querySelector(sel);
            if (el?.textContent.includes('₹')) { mrpText = el.textContent.trim(); break; }
          }
          const mrp = parseMoney(mrpText);

          const discountSelectors = ['[class*="discount"]', '[class*="off"]'];
          let discount = null;
          for (const sel of discountSelectors) {
            const el = card.querySelector(sel);
            if (el?.textContent.trim()) { discount = el.textContent.trim(); break; }
          }

          const qtySelectors = [
            '[class*="product-qty"]', '[class*="pack-size"]',
            '[class*="weight"]', '[class*="qty"]',
          ];
          let qty = '';
          for (const sel of qtySelectors) {
            const el = card.querySelector(sel);
            if (el?.textContent.trim()) { qty = el.textContent.trim(); break; }
          }

          const anchor = card.querySelector('a[href]');
          const link = anchor
            ? (anchor.href.startsWith('http') ? anchor.href : 'https://www.jiomart.com' + anchor.getAttribute('href'))
            : '';

          items.push({ name, qty, price, mrp, discount, link });
        } catch (_) {}
      });
      return items;
    });

    const seen = new Set();
    const deduped = rawItems.filter((p) => {
      const k = p.link || p.name.toLowerCase();
      if (seen.has(k)) return false; seen.add(k); return true;
    });
    console.log(`[JioMart] ${deduped.length} unique / ${rawItems.length} raw for "${query}"`);

    return deduped.map((p, i) => ({
      id: p.link || `jiomart-${i}`,
      name: p.name, qty: p.qty || '1 unit',
      category: 'grocery', provider: 'jiomart',
      price: p.price, mrp: p.mrp, discount: p.discount,
      delivery: '2 hrs',
      rating: null, reviewCount: null,
      link: p.link,
    }));
  } finally {
    await browser.close();
  }
}

// ─── Run all 5 scrapers in parallel ─────────────────────────────────────────────
async function searchAllProviders(query) {
  const [bbResult, ztResult, blResult, imResult, jmResult] = await Promise.allSettled([
    scrapeBigBasket(query),
    scrapeZepto(query),
    scrapeBlinkit(query),
    scrapeInstamart(query),  // ← NEW
    scrapeJioMart(query),
  ]);

  if (bbResult.status === 'rejected') console.error('[BigBasket]  Error:', bbResult.reason);
  if (ztResult.status === 'rejected') console.error('[Zepto]      Error:', ztResult.reason);
  if (blResult.status === 'rejected') console.error('[Blinkit]    Error:', blResult.reason);
  if (imResult.status === 'rejected') console.error('[Instamart]  Error:', imResult.reason);  // ← NEW
  if (jmResult.status === 'rejected') console.error('[JioMart]    Error:', jmResult.reason);

  return [
    ...(bbResult.status === 'fulfilled' ? bbResult.value : []),
    ...(ztResult.status === 'fulfilled' ? ztResult.value : []),
    ...(blResult.status === 'fulfilled' ? blResult.value : []),
    ...(imResult.status === 'fulfilled' ? imResult.value : []),  // ← NEW
    ...(jmResult.status === 'fulfilled' ? jmResult.value : []),
  ];
}

// ─── Routes ─────────────────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const query = (req.query.q || '').toString().trim();
  if (!query) return res.json({ products: [] });
  try {
    const products = await searchAllProviders(query);
    res.json({ products });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Savr backend + frontend listening on http://localhost:${PORT}`);
});