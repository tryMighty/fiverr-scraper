// Guard against double injection
if (!window.__fiverrScraperLoaded) {
  window.__fiverrScraperLoaded = true;

  // ─── State ────────────────────────────────────────────────────────────────
  let lockoutOverlay = null;
  let virtualCursor  = null;

  // ─── Message Router ───────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {
      case 'initAgentMode':
        initAgentMode();
        sendResponse({ success: true });
        break;

      case 'stopAgentMode':
        stopAgentMode();
        sendResponse({ success: true });
        break;

      case 'getSearchSuggestions':
        getSearchSuggestions(msg.keyword)
          .then(suggestions => sendResponse({ suggestions }))
          .catch(err => sendResponse({ suggestions: [], error: err.message }));
        return true; // async

      case 'extractGigLinks':
        sendResponse({ links: extractGigLinks() });
        break;

      case 'fetchGigData':
        fetchGigData(msg.url)
          .then(gigData => sendResponse({ gigData }))
          .catch(err => sendResponse({ gigData: null, error: err.message }));
        return true; // async

      case 'extractLiveGigData':
        try { sendResponse({ gigData: extractLiveGigData() }); } catch(e) { sendResponse({ gigData: null, error: e.message }); }
        break;

      case 'deepExtractSeller':
        deepExtractSeller()
          .then(sellerData => sendResponse({ sellerData }))
          .catch(err => sendResponse({ sellerData: null, error: err.message }));
        return true; // async
    }
    return true;
  });

  // ─── Agent UI ─────────────────────────────────────────────────────────────
  function initAgentMode() {
    if (lockoutOverlay) return;

    lockoutOverlay = document.createElement('div');
    lockoutOverlay.id = 'fiverr-scraper-lockout';
    Object.assign(lockoutOverlay.style, {
      position:        'fixed',
      inset:           '0',
      zIndex:          '2147483647',
      background:      'rgba(0,0,0,0.08)',
      backdropFilter:  'blur(1.5px)',
      cursor:          'none',
      display:         'flex',
      flexDirection:   'column',
      alignItems:      'center',
      justifyContent:  'flex-end',
      paddingBottom:   '32px',
      pointerEvents:   'all'
    });

    const badge = document.createElement('div');
    badge.id = 'fsp-badge';
    Object.assign(badge.style, {
      background:    'linear-gradient(135deg,#1dbf73,#0e9f5f)',
      color:         '#fff',
      padding:       '10px 24px',
      borderRadius:  '999px',
      fontFamily:    'Inter,system-ui,sans-serif',
      fontWeight:    '700',
      fontSize:      '13px',
      letterSpacing: '0.4px',
      boxShadow:     '0 8px 28px rgba(29,191,115,.45)',
      marginBottom:  '8px',
      pointerEvents: 'none'
    });
    badge.textContent = '🤖 SCRAPER PRO — INITIALIZING';

    const sub = document.createElement('div');
    sub.id = 'fsp-sub';
    Object.assign(sub.style, {
      color:         'rgba(255,255,255,0.85)',
      fontFamily:    'Inter,system-ui,sans-serif',
      fontSize:      '11px',
      pointerEvents: 'none'
    });
    sub.textContent = 'Synchronizing with browser engine…';

    lockoutOverlay.appendChild(badge);
    lockoutOverlay.appendChild(sub);
    document.body.appendChild(lockoutOverlay);

    virtualCursor = document.createElement('div');
    virtualCursor.id = 'fsp-cursor';
    Object.assign(virtualCursor.style, {
      position:     'fixed',
      width:        '18px',
      height:       '18px',
      background:   '#1dbf73',
      border:       '2.5px solid #fff',
      borderRadius: '50%',
      zIndex:       '2147483647',
      pointerEvents:'none',
      transition:   'left .55s cubic-bezier(.16,1,.3,1), top .55s cubic-bezier(.16,1,.3,1)',
      boxShadow:    '0 0 16px rgba(29,191,115,.7)',
      left:         '50%',
      top:          '50%'
    });
    document.body.appendChild(virtualCursor);
  }

  function setStatus(main, sub) {
    const b = document.getElementById('fsp-badge');
    const s = document.getElementById('fsp-sub');
    if (b) b.textContent = `\uD83E\uDD16 ${main.toUpperCase()}`;
    if (s) s.textContent = sub || '';
  }

  function stopAgentMode() {
    lockoutOverlay?.remove(); lockoutOverlay = null;
    virtualCursor?.remove();  virtualCursor  = null;
  }

  async function aimAt(el) {
    if (!el || !virtualCursor) return;
    const r = el.getBoundingClientRect();
    virtualCursor.style.left = `${r.left + r.width  / 2 - 9}px`;
    virtualCursor.style.top  = `${r.top  + r.height / 2 - 9}px`;
    const prev = el.style.outline;
    el.style.outline = '2px solid #1dbf73';
    el.style.outlineOffset = '3px';
    await sleep(600);
    el.style.outline = prev;
  }

  // ─── 1. Keyword Suggestion Extraction ────────────────────────────────────
  async function getSearchSuggestions(keyword) {
    setStatus('Typing Keyword', `"${keyword}"`);

    const input = document.querySelector(
      'input[data-qa="search-input"], ' +
      'input[name="query"], ' +
      '.search-bar-panel input, ' +
      'input[placeholder*="earch"]'
    );
    if (!input) throw new Error('Search input not found');

    input.focus();
    ['input','change','keydown','keyup'].forEach(e =>
      input.dispatchEvent(new Event(e, { bubbles: true }))
    );
    input.value = '';

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;

    for (const ch of keyword) {
      nativeInputValueSetter.call(input, input.value + ch);
      input.dispatchEvent(new Event('input',   { bubbles: true }));
      input.dispatchEvent(new Event('keydown', { bubbles: true }));
      input.dispatchEvent(new Event('keyup',   { bubbles: true }));
      await sleep(60 + Math.random() * 60);
    }

    setStatus('Waiting for Suggestions', 'Holding 8 s for Fiverr to rank keywords…');

    // Wait 8 seconds so Fiverr has time to fetch and render autocomplete
    await sleep(8000);

    // Read suggestions covering multiple known Fiverr DOM structures
    const suggEls = document.querySelectorAll(
      'ul[data-impression-id="suggest-tags"] li button, ' +
      'ul[data-impression-id="suggest-tags"] li span, ' +
      'ul[role="listbox"] li[role="option"], ' +
      '.search-suggestions ul li, ' +
      '.suggest-list ul li, ' +
      '.Macromn ul li' // A common obfuscated class on Fiverr search dropdowns
    );
    
    // We get innerText, split by newlines (in case of child spans), take the first meaningful line
    const suggestions = Array.from(suggEls)
      .map(el => el.innerText.trim().split('\n')[0].trim())
      .filter(Boolean);

    setStatus('Suggestions Ready', `Found ${suggestions.length} keywords`);
    return suggestions;
  }

  // ─── 2. Gig Link Extraction ───────────────────────────────────────────────
  function extractGigLinks() {
    const seen = new Map();
    let rank   = 1;

    const gigAnchors = document.querySelectorAll('a[aria-label="Go to gig"]');
    for (const a of gigAnchors) {
      try {
        const url   = new URL(a.href, location.origin);
        const clean = url.origin + url.pathname.replace(/\/$/, '');
        if (seen.has(clean)) continue;
        const titleEl = a.querySelector('p[role="heading"], p.gig-header');
        const title   = (titleEl?.getAttribute('title') || titleEl?.textContent || '').trim();
        seen.set(clean, { url: clean, rank: rank++, title });
      } catch (_) {}
    }

    if (seen.size === 0) {
      for (const a of document.querySelectorAll('a[href]')) {
        try {
          const url   = new URL(a.href, location.origin);
          if (!url.hostname.includes('fiverr.com')) continue;
          const parts = url.pathname.split('/').filter(Boolean);
          if (parts.length !== 2) continue;
          const skip  = ['categories','search','users','login','join','inbox','cp','support','pages','hire'];
          if (skip.includes(parts[0])) continue;
          const clean = url.origin + '/' + parts[0] + '/' + parts[1];
          if (seen.has(clean)) continue;
          const titleEl = a.querySelector('p[role="heading"], p.gig-header');
          const title   = (titleEl?.getAttribute('title') || titleEl?.textContent || '').trim();
          seen.set(clean, { url: clean, rank: rank++, title });
        } catch (_) {}
      }
    }

    return Array.from(seen.values());
  }

  // ─── 3. Gig Page Data Fetch ───────────────────────────────────────────────
  async function fetchGigData(url) {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    const doc  = new DOMParser().parseFromString(html, 'text/html');

    const data = {
      title:             '',
      description:       '',
      image:             '',
      rating:            '',
      reviewsCount:      '',
      extractedUsername: '',
      packages:          [],
      faq:               []
    };

    // ── Username: always extractable from the gig URL ─────────────────────
    try {
      data.extractedUsername = new URL(url).pathname.split('/').filter(Boolean)[0];
    } catch (_) {}

    // ── Try __INITIAL_STATE__ first (most complete when available) ────────
    const state = extractInitialState(doc);
    if (state && state.gig) {
      const gigInfo  = state.gig.gigInfo;
      const seller   = state.gig.seller;
      const packages = state.gig.packages;

      if (gigInfo) {
        data.title        = gigInfo.title        || '';
        data.description  = gigInfo.description  || '';
        data.image        = (gigInfo.assets && gigInfo.assets[0]) ? gigInfo.assets[0].url : '';
        data.rating       = (gigInfo.rating && gigInfo.rating.rating) ? String(gigInfo.rating.rating) : '';
        data.reviewsCount = (gigInfo.rating && gigInfo.rating.count)  ? String(gigInfo.rating.count)  : '';
        if (Array.isArray(gigInfo.faqs)) {
          data.faq = gigInfo.faqs.map(f => ({
            question: f.title       || f.question || '',
            answer:   f.description || f.answer   || ''
          }));
        }
      }
      if (seller && seller.username) data.extractedUsername = seller.username;
      if (Array.isArray(packages) && packages.length > 0) {
        data.packages = packages.map(p => ({
          type:         p.type         || '',
          name:         p.name         || '',
          description:  p.description  || '',
          price:        (p.price && p.price.amount != null) ? p.price.amount : (p.price || ''),
          deliveryTime: p.deliveryTime  || '',
          revisions:    p.revisionsCount != null ? p.revisionsCount : '',
          features:     (p.items || []).map(it => ({
            name:     it.name     || '',
            value:    it.value    != null ? it.value : '',
            included: it.included != null ? it.included : false
          }))
        }));
      }
    }

    // ── DOM fallbacks — fire for any field still empty ─────────────────────

    // Title
    if (!data.title) {
      const h1 = doc.querySelector('h1');
      if (h1) data.title = h1.textContent.trim();
    }

    // Description — strip the "About this gig" header Fiverr injects
    if (!data.description) {
      const descEl = doc.querySelector('#description, .description-wrapper, [class*="description"]');
      if (descEl) data.description = (descEl.innerText || descEl.textContent || '').trim();
    }
    // Always clean the prefix regardless of which path populated it
    if (data.description) {
      data.description = data.description
        .replace(/^about this gig[\s\r\n]*/i, '')
        .trim();
    }

    // Image — confirmed selector from live Fiverr HTML: img.box-image-ratio
    if (!data.image) {
      const imgEl = doc.querySelector('img.box-image-ratio');
      if (imgEl) {
        // Prefer 2× srcset for better resolution
        const srcset = imgEl.getAttribute('srcset') || '';
        const hd = srcset.split(',').find(s => s.trim().endsWith('2x'));
        data.image = hd ? hd.trim().replace(/\s+2x$/, '') : (imgEl.getAttribute('src') || '');
      }
    }
    // Broader cloudinary fallback
    if (!data.image) {
      const anyImg = doc.querySelector('img[src*="fiverr-res.cloudinary.com"][src*="gigs"]');
      if (anyImg) data.image = anyImg.getAttribute('src') || '';
    }

    // Rating & review count — confirmed: .orca-rating > strong.rating-score + .rating-count-number
    if (!data.rating) {
      const scoreEl = doc.querySelector('.orca-rating .rating-score, strong.rating-score');
      if (scoreEl) data.rating = scoreEl.textContent.trim();
    }
    if (!data.reviewsCount) {
      const countEl = doc.querySelector('.orca-rating .rating-count-number, .rating-count-number');
      if (countEl) data.reviewsCount = countEl.textContent.trim();
    }

    // ── Packages — extract all 3 tiers ──────────────────────────────────────
    // Strategy 1: __INITIAL_STATE__ already handled above.
    // Strategy 2: DOM — Fiverr renders ALL package panels in the HTML; they're
    // toggled by CSS radio inputs so querySelectorAll captures all of them.
    if (data.packages.length === 0) {
      const TIERS = ['Basic', 'Standard', 'Premium'];

      // Fiverr wraps each tier in a .b27f71b container with a .package-content child
      const tierWrappers = doc.querySelectorAll('.b27f71b .package-content, .package-content');

      // De-dupe in case both selectors match the same element
      const seen = new Set();
      const pkgEls = Array.from(tierWrappers).filter(el => {
        if (seen.has(el)) return false;
        seen.add(el); return true;
      });

      data.packages = pkgEls.map((pkg, i) => {
        // Package name — bold text in h3 or first strong/b
        const nameEl = pkg.querySelector('header h3 b, header h3 strong, h3 b, h3 strong');
        const name   = nameEl ? nameEl.textContent.trim() : (TIERS[i] || '');

        // Price — first leaf node starting with '$'
        let price = '';
        for (const el of pkg.querySelectorAll('span, div, strong')) {
          if (el.children.length === 0 && /^\$[\d,]+/.test(el.textContent.trim())) {
            price = el.textContent.trim(); break;
          }
        }

        // Delivery — <b class="delivery">14-day delivery</b>
        const delivEl   = pkg.querySelector('b.delivery, .delivery b, .delivery-wrapper b, [class*="delivery"] b');
        const delivery  = delivEl ? delivEl.textContent.trim() : '';

        // Revisions — <b class="revisions">2 Revisions</b>
        const revEl    = pkg.querySelector('b.revisions, .revisions b, .revisions-wrapper b, [class*="revision"] b');
        const revisions = revEl ? revEl.textContent.trim() : '';

        // Description paragraph under header
        const dEl = pkg.querySelector('header p, p[data-track-tag="typography"]');
        const description = dEl ? dEl.textContent.trim() : '';

        // Features — <ul class="features"> li text
        const features = Array.from(pkg.querySelectorAll('ul.features li, ul[class*="feature"] li'))
          .map(li => li.textContent.replace(/[\u2022\u2713\u2714\u2718]/g, '').trim())
          .filter(Boolean);

        return { tier: TIERS[i] || '', name, description, price, delivery, revisions, features };
      }).filter(p => p.name || p.price || p.features.length > 0);
    }

    // ── FAQ — confirmed selectors from live Fiverr HTML ─────────────────────
    // Structure: .faq-collapsable > .faq-collapsible-group > article.faq-collapsible
    //   Question: .faq-collapsible-title .dfb728b p
    //   Answer:   .faq-collapsible-content p
    if (data.faq.length === 0) {
      const faqArticles = doc.querySelectorAll('article.faq-collapsible');
      if (faqArticles.length > 0) {
        data.faq = Array.from(faqArticles).map(article => {
          const qEl = article.querySelector('.faq-collapsible-title .dfb728b p, .faq-collapsible-title p, .e234f7b p');
          const aEl = article.querySelector('.faq-collapsible-content p, .faq-collapsible-content');
          return {
            question: qEl ? qEl.textContent.trim() : '',
            answer:   aEl ? aEl.textContent.trim() : ''
          };
        }).filter(f => f.question);
      }

      // Broad fallback for older Fiverr FAQ layout
      if (data.faq.length === 0) {
        const faqItems = doc.querySelectorAll('.faq-list > li, .faq-item');
        data.faq = Array.from(faqItems).map(item => ({
          question: (item.querySelector('[class*="question"], dt, h3') || {}).textContent?.trim() || '',
          answer:   (item.querySelector('[class*="answer"], dd, p')    || {}).textContent?.trim() || ''
        })).filter(f => f.question);
      }
    }

    return data;
  }

  // ─── 4. Live Gig Page Extraction (runs on the actual navigated gig page) ───
  // This is called AFTER background.js navigates to the gig URL so React has
  // rendered all 3 package tiers and window.__INITIAL_STATE__ is live.
  function extractLiveGigData() {
    const data = {
      title:             '',
      description:       '',
      image:             '',
      rating:            '',
      reviewsCount:      '',
      extractedUsername: '',
      packages:          [],
      faq:               []
    };

    // Username always available from page URL
    try { data.extractedUsername = window.location.pathname.split('/').filter(Boolean)[0]; } catch (_) {}

    // ── Try live window.__INITIAL_STATE__ first (richest source) ─────────────
    const state = extractInitialState(document);
    if (state) {
      // Fiverr packages can live at multiple paths — try them all
      let pkgs = null;
      const gig = state.gigPage || state.gig || state.managedGig || state;
      if (gig.packages && Array.isArray(gig.packages))              pkgs = gig.packages;
      else if (gig.gigInfo && Array.isArray(gig.gigInfo.packages))  pkgs = gig.gigInfo.packages;
      // Flat basic/standard/premium object
      else if (gig.basicPackage || gig.standardPackage || gig.premiumPackage) {
        pkgs = [gig.basicPackage, gig.standardPackage, gig.premiumPackage].filter(Boolean);
      }
      // Deep scan: find first array of 1–3 objects that all have a 'price' field
      if (!pkgs) {
        (function scan(obj, depth) {
          if (depth > 5 || pkgs) return;
          if (Array.isArray(obj) && obj.length >= 1 && obj.length <= 3 && obj[0] && typeof obj[0] === 'object' && 'price' in obj[0]) {
            pkgs = obj; return;
          }
          if (obj && typeof obj === 'object') Object.values(obj).forEach(v => scan(v, depth + 1));
        })(state, 0);
      }

      if (pkgs) {
        const TIERS = ['Basic', 'Standard', 'Premium'];
        data.packages = pkgs.map((p, i) => {
          // Price normalization: Fiverr stores prices in USD cents (e.g. 15000 = $150)
          // or as a plain dollar number (e.g. 150). Handle both.
          let priceStr = '';
          if (p.price != null) {
            const raw = typeof p.price === 'object' ? (p.price.amount ?? p.price.value ?? '') : p.price;
            if (raw !== '') {
              const num = Number(raw);
              if (!isNaN(num)) {
                // If value > 1000 it's likely in cents
                priceStr = '$' + (num > 1000 ? (num / 100).toFixed(0) : num);
              } else {
                priceStr = String(raw).startsWith('$') ? String(raw) : '$' + String(raw);
              }
            }
          }
          return {
            tier:         TIERS[i] || (p.type || ''),
            name:         p.name        || p.title        || '',
            description:  p.description || '',
            price:        priceStr,
            delivery:     p.deliveryTime != null ? p.deliveryTime + '-day delivery' : (p.delivery || ''),
            revisions:    p.revisionsCount != null ? p.revisionsCount + ' Revisions' : (p.revisions || ''),
            features:     (p.items || p.features || []).map(it =>
              typeof it === 'string' ? it : (it.name || it.value || '')
            ).filter(Boolean)
          };
        });
      }

      const info = state.gigPage?.gigInfo || state.gig?.gigInfo || state.gigInfo || null;
      if (info) {
        if (!data.title)        data.title        = info.title       || '';
        if (!data.description)  data.description  = info.description || '';
        if (!data.image && info.assets?.[0]) data.image = info.assets[0].url || '';
        if (!data.rating && info.rating)     data.rating       = String(info.rating.rating || '');
        if (!data.reviewsCount && info.rating) data.reviewsCount = String(info.rating.count || '');
        if (!data.faq.length && Array.isArray(info.faqs)) {
          data.faq = info.faqs.map(f => ({ question: f.title || f.question || '', answer: f.description || f.answer || '' })).filter(f => f.question);
        }
      }
    }

    // ── DOM fallbacks — always try for anything still empty ───────────────────
    if (!data.title) {
      const h1 = document.querySelector('h1, h1[data-track-tag]');
      if (h1) data.title = h1.textContent.trim();
    }
    if (!data.description) {
      const d = document.querySelector('#description, .description-wrapper, [class*="description"]');
      if (d) data.description = (d.innerText || d.textContent || '').trim();
    }
    // Strip Fiverr UI noise from description
    // These sections are injected by Fiverr's UI into the SSR HTML
    if (data.description) {
      data.description = data.description
        .replace(/^about this gig[\s\r\n]*/i, '')
        .replace(/\+\s*See More[\s\S]*/i, '')        // "+ See More" collapses to here + all metadata after
        .replace(/\n+(Website type|Programming language|Website features|Platform|Expertise|Frontend framework|Backend framework|Website Type|Service type|Plugins)[\s\S]*/i, '') // Fiverr structured tags section
        .replace(/\n{3,}/g, '\n\n')                  // Collapse excessive blank lines
        .trim();
    }

    // Image — live DOM: img.box-image-ratio or first cloudinary gig image
    if (!data.image) {
      const imgEl = document.querySelector('img.box-image-ratio, img[src*="fiverr-res.cloudinary.com"][src*="gigs"]');
      if (imgEl) {
        const srcset = imgEl.getAttribute('srcset') || '';
        const hd = srcset.split(',').find(s => s.trim().endsWith('2x'));
        data.image = hd ? hd.trim().replace(/\s+2x$/, '') : (imgEl.getAttribute('src') || '');
      }
    }

    // Rating + review count from live DOM
    if (!data.rating) {
      const el = document.querySelector('.orca-rating .rating-score, strong.rating-score, ._8f7e6a');
      if (el) data.rating = el.textContent.trim();
    }
    if (!data.reviewsCount) {
      const el = document.querySelector('.orca-rating .rating-count-number, .rating-count-number');
      if (el) data.reviewsCount = el.textContent.trim();
    }

    // Packages from live DOM — React renders ALL tabs, so all 3 are in the DOM
    if (data.packages.length === 0) {
      const TIERS = ['Basic', 'Standard', 'Premium'];
      const panels = document.querySelectorAll(
        '[id^="package-tab-panel-"], [id^="tab-panel-package"], .package-content, .b27f71b .package-content'
      );
      const seen = new Set();
      const pkgEls = Array.from(panels).filter(el => { if (seen.has(el)) return false; seen.add(el); return true; });

      if (pkgEls.length > 0) {
        data.packages = pkgEls.map((pkg, i) => {
          const nameEl    = pkg.querySelector('header h3 b, header h3 strong, h3 b, h3 strong');
          const name      = nameEl ? nameEl.textContent.trim() : (TIERS[i] || '');
          // Price: TreeWalker over all text nodes, first $N match wins
          let price = '';
          const walker = document.createTreeWalker(pkg, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const t = node.textContent.trim();
            if (/^\$[\d,.]+/.test(t)) { price = t.replace(/[^$\d.]/g, '').replace(/\.\d+$/, ''); break; }
          }
          // If TreeWalker missed it, try a broader querySelector
          if (!price) {
            const priceEl = pkg.querySelector('[class*="price"], [class*="Price"]');
            if (priceEl) {
              const t = (priceEl.innerText || priceEl.textContent || '').trim();
              const m = t.match(/\$([\d,]+)/);
              if (m) price = '$' + m[1].replace(/,/g, '');
            }
          }
          const delivEl   = pkg.querySelector('[class*="delivery"], [class*="Delivery"]');
          const delivery  = delivEl ? delivEl.textContent.trim().replace(/[^\d\w\s-]/g, '').trim() : '';
          const revEl     = pkg.querySelector('[class*="revision"], [class*="Revision"]');
          const revisions = revEl  ? revEl.textContent.trim() : '';
          const dEl       = pkg.querySelector('header p, p[data-track-tag="typography"]');
          const desc      = dEl ? dEl.textContent.trim() : '';
          const features  = Array.from(pkg.querySelectorAll('ul.features li, ul[class*="feature"] li'))
            .map(li => li.textContent.replace(/[\u2022\u2713\u2714\u2718]/g, '').trim()).filter(Boolean);
          return { tier: TIERS[i] || '', name, description: desc, price, delivery, revisions, features };
        }).filter(p => p.name || p.price);
      }
    }

    // FAQ from live DOM
    if (data.faq.length === 0) {
      const faqArticles = document.querySelectorAll('article.faq-collapsible');
      if (faqArticles.length > 0) {
        data.faq = Array.from(faqArticles).map(article => {
          const qEl = article.querySelector('.faq-collapsible-title .dfb728b p, .faq-collapsible-title p');
          const aEl = article.querySelector('.faq-collapsible-content p, .faq-collapsible-content');
          return { question: qEl?.textContent.trim() || '', answer: aEl?.textContent.trim() || '' };
        }).filter(f => f.question);
      }
    }

    return data;
  }

  async function deepExtractSeller() {
    setStatus('Seller Profile', 'Locating profile data…');

    // Click "More about me" if present
    const allButtons = Array.from(document.querySelectorAll('button[data-track-tag="button"]'));
    const moreBtn = allButtons.find(b =>
      b.textContent.replace(/\s+/g, ' ').trim().toLowerCase().includes('more about me')
    );
    if (moreBtn) {
      moreBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(500);
      await aimAt(moreBtn);
      setStatus('Expanding Profile', 'Opening detail view…');
      moreBtn.click();
      await sleep(4000); // Allow the profile popup to fully render
    }

    const popup = document.querySelector('div.bf11ae8') || document;

    const info = {
      username:        '',
      publicName:      '',
      sellerLevel:     '',
      rating:          '',
      reviewsCount:    '',
      about:           '',
      skills:          [],
      education:       [],
      certifications:  [],
      courses:         [],
      languages:       [],
      memberSince:     '',
      country:         ''
    };

    // ── Username: derive from the live page URL first (always works) ─────────
    try {
      info.username = window.location.pathname.split('/').filter(Boolean)[0] || '';
    } catch (_) {}

    // ── Public name ──────────────────────────────────────────────────────────
    info.publicName = (popup.querySelector('[aria-label="Public Name"]') || {}).textContent
      ? popup.querySelector('[aria-label="Public Name"]').textContent.trim() : '';
    // Fallback: document-wide scan
    if (!info.publicName) {
      const el = document.querySelector('[aria-label="Public Name"]');
      if (el) info.publicName = el.textContent.trim();
    }

    // ── Rating (from live HTML: div.orca-rating > strong.rating-score + span.rating-count-number)
    const ratingWrap = popup.querySelector('.orca-rating') || document.querySelector('.orca-rating');
    if (ratingWrap) {
      const scoreEl = ratingWrap.querySelector('.rating-score');
      const countEl = ratingWrap.querySelector('.rating-count-number');
      info.rating       = scoreEl ? scoreEl.textContent.trim() : '';
      info.reviewsCount = countEl ? countEl.textContent.trim() : '';
    }
    // Broad fallback — scan whole document
    if (!info.rating) {
      const scoreEl = document.querySelector('.orca-rating .rating-score');
      if (scoreEl) info.rating = scoreEl.textContent.trim();
    }
    if (!info.reviewsCount) {
      const countEl = document.querySelector('.orca-rating .rating-count-number');
      if (countEl) info.reviewsCount = countEl.textContent.trim();
    }

    // ── Seller Level ─────────────────────────────────────────────────────────
    // Strategy 1: known class-based selectors
    const levelSelectors = [
      '[class*="level-title"]',
      '[class*="seller-level"]',
      '[data-testid*="level"]',
      '.level-title',
      '.seller-level-title'
    ];
    for (const sel of levelSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) { info.sellerLevel = el.textContent.trim(); break; }
    }

    // Strategy 2: Scan leaf nodes for known badge strings
    if (!info.sellerLevel) {
      const levelPatterns = ['Top Rated Seller','Level 2 Seller','Level 1 Seller','Top Rated','Level 2','Level 1','New Seller'];
      const leaves = Array.from(document.querySelectorAll('span, p, div, strong, b'));
      for (const el of leaves) {
        if (el.children.length > 0) continue;
        const txt = el.textContent.trim();
        if (levelPatterns.indexOf(txt) !== -1) { info.sellerLevel = txt; break; }
      }
    }

    // Strategy 3: __INITIAL_STATE__ numeric level map
    if (!info.sellerLevel) {
      const st = extractInitialState(document);
      const s  = (st && (st.sellerProfile && st.sellerProfile.seller)) || (st && st.seller) || (st && st.user);
      if (s) {
        const lvl = s.sellerLevel != null ? s.sellerLevel : (s.level != null ? s.level : s.seller_level);
        if (lvl != null) {
          const map = { 0: 'New Seller', 1: 'Level 1 Seller', 2: 'Level 2 Seller', 3: 'Top Rated Seller' };
          info.sellerLevel = map[lvl] || ('Level ' + lvl);
        }
        if (!info.rating && s.rating)        info.rating       = String(s.rating.rating || s.score || '');
        if (!info.reviewsCount && s.rating)  info.reviewsCount = String(s.rating.count  || s.reviews_count || '');
      }
    }



    // Helper: query popup first, fall back to full document
    function qSel(selector) {
      return (popup !== document ? popup.querySelector(selector) : null)
          || document.querySelector(selector);
    }
    function qSelAll(selector) {
      const inPopup  = popup !== document ? Array.from(popup.querySelectorAll(selector))  : [];
      const inDoc    = Array.from(document.querySelectorAll(selector));
      // Merge & de-dupe by element identity
      const set = new Set([...inPopup, ...inDoc]);
      return Array.from(set);
    }

    // ── About me — .d8fc2e8 confirmed selector ─────────────────────────────
    const aboutEl = qSel('.d8fc2e8');
    info.about = aboutEl ? (aboutEl.innerText || aboutEl.textContent || '').trim() : '';
    // Strip Fiverr's truncation artifacts
    if (info.about) {
      info.about = info.about
        .replace(/\.{3}\s*Read more\s*$/i, '')
        .replace(/Read more\s*$/i, '')
        .trim();
    }

    // ── Skills — aria-label="Skills List" confirmed ─────────────────────────
    info.skills = qSelAll('ul[aria-label="Skills List"] li a[aria-label]')
      .map(a => a.getAttribute('aria-label') || a.textContent.trim())
      .filter(Boolean);
    // De-dupe skills
    info.skills = [...new Set(info.skills)];

    // ── Education ─────────────────────────────────────────────────────────────
    info.education = qSelAll('ul[aria-label="Educations List"] li').map(li => ({
      institution: (li.querySelector('[aria-label="Title"]')       || {}).textContent?.trim() || '',
      degree:      (li.querySelector('[aria-label="Sub Title"]')   || {}).textContent?.trim() || '',
      year:        (li.querySelector('[aria-label="Description"]') || {}).textContent?.trim() || ''
    }));

    // ── Certifications ────────────────────────────────────────────────────────
    info.certifications = qSelAll('ul[aria-label="Certifications List"] li').map(li => ({
      name: (li.querySelector('[aria-label="Title"]')       || {}).textContent?.trim() || '',
      year: (li.querySelector('[aria-label="Description"]') || {}).textContent?.trim() || ''
    }));

    // ── Courses ───────────────────────────────────────────────────────────────
    info.courses = qSelAll('ul[aria-label="Courses List"] li').map(li => ({
      name: (li.querySelector('[aria-label="Title"]')       || {}).textContent?.trim() || '',
      date: (li.querySelector('[aria-label="Description"]') || {}).textContent?.trim() || ''
    }));

    // ── Member Since — "On Fiverr since Jun 2021" pattern ─────────────────────
    // Guide.html: <div class="m-l-12 tbody-5 text-semi-bold">On Fiverr since Jun 2021</div>
    if (!info.memberSince) {
      const allLeaves = Array.from(document.querySelectorAll('div, span, p'));
      for (const el of allLeaves) {
        if (el.children.length > 0) continue;
        const txt = el.textContent.trim();
        if (/^on fiverr since/i.test(txt)) {
          info.memberSince = txt.replace(/^on fiverr since\s*/i, '').trim();
          break;
        }
      }
    }

    // ── Languages ──────────────────────────────────────────────────────────────
    // GUARD: rejects garbage values like "5 Stars", "4 Stars" from the review widget
    const isRealLanguage = (s) => s && !/^\d+\s*stars?$/i.test(s) && s.length > 1;

    // Strategy 1 (CONFIRMED HTML): div.m-b-16 > span.co-grey-1200 + span.m-l-16
    // Source: <div class="m-b-16"><span class="co-grey-1200">Spanish</span><span class="m-l-16" style="color:...">Basic</span></div>
    if (info.languages.length === 0) {
      const langDivs = qSelAll('div.m-b-16');
      const parsed = langDivs
        .filter(div => div.querySelector('span.co-grey-1200'))
        .map(div => ({
          language: (div.querySelector('span.co-grey-1200') || {}).textContent?.trim() || '',
          level:    (div.querySelector('span.m-l-16') || {}).textContent?.trim() || ''
        }))
        .filter(l => isRealLanguage(l.language));
      if (parsed.length > 0) info.languages = parsed;
    }

    // Strategy 2: aria-label="Languages List" — same pattern as Skills/Education
    if (info.languages.length === 0) {
      const langItems = qSelAll('ul[aria-label="Languages List"] li');
      if (langItems.length > 0) {
        const parsed = langItems.map(li => ({
          language: (li.querySelector('[aria-label="Title"]')       || {}).textContent?.trim() || '',
          level:    (li.querySelector('[aria-label="Sub Title"]')   || {}).textContent?.trim() ||
                    (li.querySelector('[aria-label="Description"]') || {}).textContent?.trim() || ''
        })).filter(l => isRealLanguage(l.language));
        if (parsed.length > 0) info.languages = parsed;
      }
    }
    // Strategy 3: "I speak" header walk (covers older profile layouts)
    if (info.languages.length === 0) {
      const allEls = Array.from(document.querySelectorAll('div, span, p'));
      const speakHeader = allEls.find(el =>
        el.children.length === 0 && el.textContent.trim().toLowerCase() === 'i speak'
      );
      if (speakHeader) {
        let container = speakHeader.parentElement;
        while (container && !container.nextElementSibling) container = container.parentElement;
        const langBox = container ? container.nextElementSibling : null;
        if (langBox) {
          const parsed = Array.from(langBox.querySelectorAll('.m-b-16, div'))
            .filter(el => el.children.length >= 2 || (el.querySelectorAll('span').length >= 2))
            .map(el => {
              const spans = el.querySelectorAll('span, .co-grey-1200');
              return { language: spans[0]?.textContent.trim() || '', level: spans[1]?.textContent.trim() || '' };
            })
            .filter(l => isRealLanguage(l.language));
          if (parsed.length > 0) info.languages = parsed;
        }
      }
    }

    // ── Country — profile sidebar or __INITIAL_STATE__ ────────────────────────
    if (!info.country) {
      // Look for flag img alt or a country-labeled element
      const flagImg = document.querySelector('[class*="flag"] img, [class*="country"] img');
      if (flagImg) info.country = flagImg.getAttribute('alt') || flagImg.getAttribute('title') || '';
    }

    // ── __INITIAL_STATE__ master fallback (catches anything still empty) ───────
    const stF = extractInitialState(document);
    const sellerSt = (stF && (stF.sellerProfile?.seller || stF.seller || stF.user)) || null;
    if (sellerSt) {
      if (!info.username)        info.username        = sellerSt.username        || info.username;
      if (!info.country)         info.country         = sellerSt.country         || '';
      if (!info.memberSince)     info.memberSince     = sellerSt.memberSince     || sellerSt.member_since || '';
      if (!info.ordersCompleted) {
        const o = sellerSt.ordersInQueue ?? sellerSt.completed_orders ?? sellerSt.completedOrders ?? sellerSt.orders_count;
        if (o != null) info.ordersCompleted = String(o);
      }
      if (!info.rating)        info.rating        = String(sellerSt.rating?.rating || sellerSt.score || info.rating || '');
      if (!info.reviewsCount)  info.reviewsCount  = String(sellerSt.rating?.count  || sellerSt.reviews_count || info.reviewsCount || '');
      if (!info.sellerLevel && sellerSt.sellerLevel != null) {
        const map = { 0: 'New Seller', 1: 'Level 1 Seller', 2: 'Level 2 Seller', 3: 'Top Rated Seller' };
        info.sellerLevel = map[sellerSt.sellerLevel] || sellerSt.sellerLevel;
      }
    }

    setStatus('Data Captured', '@' + (info.username || 'seller') + ' \u2014 ' + (info.sellerLevel || 'N/A') + ' \u2014 \u2B50' + (info.rating || 'N/A'));

    // ── Normalize empty scalar fields → "N/A" ──────────────────────────────────
    // Makes the JSON immediately readable — "N/A" signals "field exists on Fiverr
    // but was absent on this profile", vs a missing key which means "not scraped".
    const NA = 'N/A';
    const scalarFields = ['username','publicName','sellerLevel','rating','reviewsCount',
                          'about','memberSince','country'];
    for (const f of scalarFields) {
      if (info[f] === '' || info[f] == null) info[f] = NA;
    }
    // Normalize empty strings in nested arrays too
    info.languages = info.languages.map(l => ({
      language: l.language || NA,
      level:    l.level    || NA
    }));

    return info;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  // Robust __INITIAL_STATE__ extractor — uses brace-depth counting so it works
  // even when the JSON blob contains semicolons inside string values.
  function extractInitialState(docOrEl) {
    const root = (docOrEl === document || !docOrEl) ? document : docOrEl;
    const scripts = root.querySelectorAll ? root.querySelectorAll('script') : [];
    for (const s of scripts) {
      const text = s.textContent || '';
      if (!text.includes('window.__INITIAL_STATE__')) continue;
      try {
        const marker = 'window.__INITIAL_STATE__=';
        const startIdx = text.indexOf(marker);
        if (startIdx === -1) continue;
        const jsonStart = startIdx + marker.length;
        const firstChar = text[jsonStart];
        if (firstChar !== '{' && firstChar !== '[') continue;
        // Walk char-by-char tracking nesting depth and string context
        let depth = 0, inString = false, escape = false;
        for (let i = jsonStart; i < text.length; i++) {
          const c = text[i];
          if (escape)                       { escape = false; continue; }
          if (c === '\\' && inString)       { escape = true;  continue; }
          if (c === '"' && !escape)         { inString = !inString; continue; }
          if (inString)                      continue;
          if (c === '{' || c === '[')        depth++;
          if (c === '}' || c === ']')        { depth--; if (depth === 0) { try { return JSON.parse(text.slice(jsonStart, i + 1)); } catch(_) { break; } } }
        }
      } catch (_) {}
    }
    // Last resort: live window object (works when extracting from live page)
    try { if (typeof window !== 'undefined') return window.__INITIAL_STATE__ || null; } catch (_) {}
    return null;
  }

  function sleep(ms) {
    return new Promise(function(r) { return setTimeout(r, ms); });
  }

} // end guard
