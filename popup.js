document.addEventListener('DOMContentLoaded', () => {
  // ── DOM refs ──────────────────────────────────────────────────────────────
  const startBtn       = document.getElementById('start-btn');
  const stopBtn        = document.getElementById('stop-btn');
  const keywordInput   = document.getElementById('keyword-input');
  const autoToggle     = document.getElementById('autonomous-toggle');
  const statusText     = document.getElementById('status-text');
  const statusDot      = document.getElementById('status-dot');
  const setupView      = document.getElementById('setup-view');
  const runningView    = document.getElementById('running-view');
  const resultsFeed    = document.getElementById('results-feed');
  const feedCount      = document.getElementById('feed-count');
  const progressBar    = document.getElementById('progress-bar');
  const progressPct    = document.getElementById('progress-pct');
  const progressStats  = document.getElementById('progress-stats');
  const robotMouth     = document.getElementById('robot-mouth');
  const eyeLeft        = document.getElementById('eye-left');
  const eyeRight       = document.getElementById('eye-right');

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

  // ── Start ─────────────────────────────────────────────────────────────────
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

      chrome.runtime.sendMessage({
        action:      'startSearchAndScrape',
        tabId:       activeTab.id,
        keyword,
        isAutonomous: autoToggle.checked
      });
    });
  });

  // ── Stop ──────────────────────────────────────────────────────────────────
  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stopScraping' });
  });

  // ── Listen for background updates ────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action !== 'updateStatus') return;
    const d = msg.data;
    updateUI(d);

    // Update progress numbers from rich status data
    if (typeof d.totalKeywords  === 'number') totalKeywords     = d.totalKeywords;
    if (typeof d.doneKeywords   === 'number') processedKeywords = d.doneKeywords;

    const pct = (totalKeywords > 0)
      ? Math.round((processedKeywords / totalKeywords) * 100)
      : 0;
    if (d.isScraping) setProgress(pct, d.totalGigs || 0, totalKeywords, processedKeywords);

    // Render new gigs to feed
    if (Array.isArray(d.latestGigs) && d.latestGigs.length > totalGigsCaptures) {
      const newItems = d.latestGigs.slice(totalGigsCaptures);
      renderFeedItems(newItems);
      totalGigsCaptures = d.latestGigs.length;
      feedCount.textContent = totalGigsCaptures + ' gig' + (totalGigsCaptures === 1 ? '' : 's');
    }
  });

  // ── UI State management ───────────────────────────────────────────────────
  function updateUI(data) {
    setStatus(data.statusText, data.isScraping ? 'active' : (data.statusText.includes('Done') ? 'done' : 'idle'));
    setRobotMode(data.isScraping);

    if (data.isScraping) {
      setupView.classList.add('hidden');
      runningView.classList.remove('hidden');
    } else {
      setupView.classList.remove('hidden');
      runningView.classList.add('hidden');
      // Reset feed for next run
      totalGigsCaptures = 0;
      processedKeywords = 0;
      totalKeywords     = 0;
      feedInitialized   = false;
      feedCount.textContent = '0 gigs';
      progressBar.style.width = '0';
      progressPct.textContent = '—';
      progressStats.textContent = 'Initializing…';
      resetFeed();
    }
  }

  // ── Robot face animation ──────────────────────────────────────────────────
  function setRobotMode(active) {
    if (!robotMouth) return;
    if (active) {
      // Faster talking mouth + brighter eyes during scrape
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
    statusDot.className = 'status-dot';
    if (mode && mode !== 'idle') statusDot.classList.add(mode);
  }

  function setProgress(pct, gigsTotal, kwTotal, kwDone) {
    progressBar.style.width = pct + '%';
    progressPct.textContent = pct + '%';
    progressStats.textContent =
      gigsTotal + ' gigs extracted' +
      (kwTotal > 0 ? ' · ' + kwDone + '/' + kwTotal + ' keywords' : '');
  }

  // ── Feed rendering ────────────────────────────────────────────────────────
  function resetFeed() {
    resultsFeed.innerHTML =
      '<div class="feed-empty">' +
        '<div class="pulse-ring"></div>' +
        '<span>Waiting for data stream\u2026</span>' +
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

      // Suppress N/A from display — only show real values
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

    // Keep feed from getting too long in the DOM
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
