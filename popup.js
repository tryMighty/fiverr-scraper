document.addEventListener('DOMContentLoaded', () => {
  // ── DOM refs ──────────────────────────────────────────────────────────────
  const startBtn       = document.getElementById('start-btn');
  const stopBtn        = document.getElementById('stop-btn');
  const keywordInput   = document.getElementById('keyword-input');
  const autoToggle     = document.getElementById('autonomous-toggle');
  const statusText     = document.getElementById('status-text');
  const statusDot      = document.getElementById('status-dot');
  const setupView      = document.getElementById('setup-view');
  const selectionView  = document.getElementById('selection-view');
  const runningView    = document.getElementById('running-view');
  const resultsFeed    = document.getElementById('results-feed');
  const feedCount      = document.getElementById('feed-count');
  const progressBar    = document.getElementById('progress-bar');
  const progressStats  = document.getElementById('progress-stats');
  const robotMouth     = document.getElementById('robot-mouth');
  const eyeLeft        = document.getElementById('eye-left');
  const eyeRight       = document.getElementById('eye-right');

  // Selection-view refs
  const selKeywordList = document.getElementById('sel-keyword-list');
  const selAllBtn      = document.getElementById('sel-all-btn');
  const selNoneBtn     = document.getElementById('sel-none-btn');
  const extractBtn     = document.getElementById('extract-btn');

  let totalGigsCaptures = 0;
  let totalKeywords     = 0;
  let processedKeywords = 0;
  let feedInitialized   = false;

  // ── Initial state poll ────────────────────────────────────────────────────
  chrome.runtime.sendMessage({ action: 'getStatus' }, (resp) => {
    if (resp) updateUI(resp);
  });

  // ── Enter key to start ────────────────────────────────────────────────────
  keywordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startBtn.click();
  });

  // ── Phase 1: Initialize — fetch suggestions ───────────────────────────────
  startBtn.addEventListener('click', () => {
    const keyword = keywordInput.value.trim();
    if (!keyword) {
      setStatus('⚠️ Enter a seed keyword first.', 'idle');
      keywordInput.focus();
      keywordInput.style.borderColor = '#e84040';
      setTimeout(() => { keywordInput.style.borderColor = ''; }, 2000);
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab) { setStatus('No active tab found.', 'error'); return; }

      // Show the status strip as active while we wait for suggestions
      setStatus('🔍 Fetching keyword suggestions…', 'active');
      setRobotMode(true);

      chrome.runtime.sendMessage({
        action:       'startSearchAndScrape',
        tabId:        activeTab.id,
        keyword,
        isAutonomous: autoToggle.checked
      });
    });
  });

  // ── Phase 2: Extract selected keywords ────────────────────────────────────
  extractBtn.addEventListener('click', () => {
    const checked = Array.from(selKeywordList.querySelectorAll('input[type="checkbox"]:checked'))
      .map(cb => cb.value);

    if (checked.length === 0) {
      // Flash the list border if nothing is selected
      selKeywordList.style.borderColor = '#e84040';
      selKeywordList.style.boxShadow   = '0 0 0 2px rgba(232,64,64,.2)';
      setTimeout(() => {
        selKeywordList.style.borderColor = '';
        selKeywordList.style.boxShadow   = '';
      }, 1800);
      return;
    }

    chrome.runtime.sendMessage({ action: 'confirmKeywords', keywords: checked });
  });

  // ── Stop ──────────────────────────────────────────────────────────────────
  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stopScraping' });
  });

  // ── Bulk select / deselect ────────────────────────────────────────────────
  selAllBtn.addEventListener('click', () => {
    selKeywordList.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
  });
  selNoneBtn.addEventListener('click', () => {
    selKeywordList.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  });

  // ── Listen for background updates ─────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action !== 'updateStatus') return;
    const d = msg.data;

    // Check if background wants us to show the keyword selection screen
    if (d.awaitingSelection && Array.isArray(d.suggestedKeywords)) {
      renderSelectionView(d.suggestedKeywords, d.seedKeyword || '');
      setStatus('🔎 Choose keywords to extract', 'active');
      setRobotMode(false);
      return;
    }

    updateUI(d);

    if (typeof d.totalKeywords  === 'number') totalKeywords     = d.totalKeywords;
    if (typeof d.doneKeywords   === 'number') processedKeywords = d.doneKeywords;

    const pct = (totalKeywords > 0)
      ? Math.round((processedKeywords / totalKeywords) * 100)
      : 0;
    if (d.isScraping) setProgress(pct, d.totalGigs || 0, totalKeywords, processedKeywords);

    // Append new gigs to the feed
    if (Array.isArray(d.latestGigs) && d.latestGigs.length > totalGigsCaptures) {
      const newItems = d.latestGigs.slice(totalGigsCaptures);
      renderFeedItems(newItems);
      totalGigsCaptures = d.latestGigs.length;
      feedCount.textContent = totalGigsCaptures + ' gig' + (totalGigsCaptures === 1 ? '' : 's');
    }
  });

  // ── Render keyword selection panel ────────────────────────────────────────
  function renderSelectionView(keywords, seedKeyword) {
    selKeywordList.innerHTML = '';

    keywords.forEach((kw, i) => {
      const isSeed = kw.toLowerCase() === seedKeyword.toLowerCase();
      const id     = 'sel-kw-' + i;

      const label = document.createElement('label');
      label.className = 'sel-item';
      label.htmlFor   = id;

      label.innerHTML =
        `<input type="checkbox" id="${escHtml(id)}" value="${escHtml(kw)}" ${isSeed || i === 0 ? 'checked' : ''}>` +
        `<span class="sel-check"></span>` +
        `<span class="sel-kw-label">${escHtml(kw)}</span>` +
        (isSeed || i === 0 ? `<span class="sel-badge-seed">seed</span>` : '');

      selKeywordList.appendChild(label);
    });

    // Show selection view, hide others
    setupView.classList.add('hidden');
    runningView.classList.add('hidden');
    selectionView.classList.remove('hidden');
  }

  // ── UI State management ───────────────────────────────────────────────────
  function updateUI(data) {
    setStatus(data.statusText, data.isScraping ? 'active' : (data.statusText?.includes('Done') ? 'done' : 'idle'));
    setRobotMode(data.isScraping);

    if (data.isScraping) {
      setupView.classList.add('hidden');
      selectionView.classList.add('hidden');
      runningView.classList.remove('hidden');
    } else if (!data.awaitingSelection) {
      // Back to setup (idle / done / error)
      setupView.classList.remove('hidden');
      selectionView.classList.add('hidden');
      runningView.classList.add('hidden');
      // Reset counters for next run
      totalGigsCaptures = 0;
      processedKeywords = 0;
      totalKeywords     = 0;
      feedInitialized   = false;
      feedCount.textContent = '0 gigs';
      progressBar.style.width = '0';
      progressStats.textContent = 'Initializing…';
      resetFeed();
    }
  }

  // ── Robot face animation ──────────────────────────────────────────────────
  function setRobotMode(active) {
    if (!robotMouth) return;
    if (active) {
      robotMouth.style.animationDuration = '0.6s';
      if (eyeLeft)  eyeLeft.style.boxShadow  = '0 0 12px rgba(29,191,115,.9)';
      if (eyeRight) eyeRight.style.boxShadow = '0 0 12px rgba(29,191,115,.9)';
    } else {
      robotMouth.style.animationDuration = '3s';
      if (eyeLeft)  eyeLeft.style.boxShadow  = '';
      if (eyeRight) eyeRight.style.boxShadow = '';
    }
  }

  function setStatus(text, mode /* 'active' | 'done' | 'error' | 'idle' */) {
    statusText.textContent = String(text).toUpperCase();
    statusDot.className = 'status-indicator';
    if (mode && mode !== 'idle') statusDot.classList.add(mode);
  }

  function setProgress(pct, gigsTotal, kwTotal, kwDone) {
    progressBar.style.width = pct + '%';
    progressStats.textContent =
      gigsTotal + ' gigs extracted' +
      (kwTotal > 0 ? ' · ' + kwDone + '/' + kwTotal + ' keywords' : '');
  }

  // ── Feed rendering ────────────────────────────────────────────────────────
  function resetFeed() {
    resultsFeed.innerHTML =
      '<div class="feed-empty">' +
        '<div class="radar-ring"></div>' +
        '<div class="radar-ring r2"></div>' +
        '<div class="radar-dot"></div>' +
        '<span class="mono">Waiting for data stream\u2026</span>' +
      '</div>';
  }

  function renderFeedItems(items) {
    if (!feedInitialized) {
      resultsFeed.innerHTML = '';
      feedInitialized = true;
    }

    items.forEach((item) => {
      if (!item || item.error) return;

      const gig    = item.gig    || {};
      const seller = item.seller || {};

      const title   = gig.title   || item.gigUrl || 'Gig';
      const rank    = item.rank   || '?';
      const rating  = seller.rating       || gig.rating       || '';
      const reviews = seller.reviewsCount || gig.reviewsCount || '';
      const level   = seller.sellerLevel  || '';
      const user    = seller.username     || gig.extractedUsername || '';
      const pkg     = (gig.packages && gig.packages[0]) ? gig.packages[0].price : '';

      const el = document.createElement('div');
      el.className = 'feed-item';

      const ratingStr  = (rating  && rating  !== 'N/A') ? rating  : '';
      const reviewsStr = (reviews && reviews !== 'N/A') ? reviews : '';
      const levelStr   = (level   && level   !== 'N/A') ? level   : '';
      const pkgStr     = (pkg     && pkg     !== 'N/A') ? pkg     : '';

      el.innerHTML =
        '<span class="feed-rank">#' + rank + '</span>' +
        '<div class="feed-body">' +
          '<div class="feed-title">' + escHtml(title) + '</div>' +
          '<div class="feed-meta">' +
            (user      ? '<span>@' + escHtml(user) + '</span>' : '') +
            (levelStr  ? '<span class="feed-level">' + escHtml(levelStr) + '</span>' : '') +
            (ratingStr ? '<span class="feed-rating">\u2B50 ' + escHtml(ratingStr) + (reviewsStr ? ' (' + escHtml(reviewsStr) + ')' : '') + '</span>' : '') +
            (pkgStr    ? '<span class="feed-price">from ' + escHtml(pkgStr) + '</span>' : '') +
          '</div>' +
        '</div>';

      resultsFeed.insertBefore(el, resultsFeed.firstChild);
    });

    const maxItems = 40;
    while (resultsFeed.children.length > maxItems) {
      resultsFeed.removeChild(resultsFeed.lastChild);
    }
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;');
  }
});
