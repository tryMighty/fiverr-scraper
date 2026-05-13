// ─── State ────────────────────────────────────────────────────────────────────
let isScraping        = false;
let isAutonomous      = false;
let scrapedData       = [];   // Final aggregated export
let searchTabId       = null;
let keywordQueue      = [];
let totalKeywordsCount = 0;   // Locked in once the queue is built
let currentKeyword    = '';
let doneKeywords      = 0;    // How many keywords have been fully processed

// ─── Message Router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'getStatus') {
    sendResponse(buildStatus());
  } else if (msg.action === 'startSearchAndScrape') {
    runAgent(msg.tabId, msg.keyword, msg.isAutonomous);
  } else if (msg.action === 'stopScraping') {
    isScraping = false;
    broadcast('Scraping stopped by user.');
  }
  return true;
});

// ─── Status Helpers ───────────────────────────────────────────────────────────
function buildStatus() {
  const totalGigs = scrapedData.reduce((n, kw) => n + kw.gigs.length, 0);
  return {
    isScraping,
    statusText: isScraping
      ? `🔍 Processing: "${currentKeyword}" — ${totalGigs} gigs captured`
      : (scrapedData.length > 0
          ? `✅ Done! ${totalGigs} gigs across ${scrapedData.length} keywords.`
          : 'Ready to initialize.'),
    totalGigs,
    totalKeywords: totalKeywordsCount,
    doneKeywords,
    latestGigs: scrapedData.flatMap(k => k.gigs).slice(-50)
  };
}

function broadcast(text) {
  chrome.runtime.sendMessage({
    action: 'updateStatus',
    data:   { ...buildStatus(), statusText: text }
  }).catch(() => {});
}

// ─── Main Agent Entry Point ───────────────────────────────────────────────────
async function runAgent(tabId, seedKeyword, autonomous) {
  isScraping    = true;
  isAutonomous  = !!autonomous;
  scrapedData   = [];
  searchTabId   = tabId;
  doneKeywords  = 0;

  broadcast('Initializing — navigating to Fiverr…');

  try {
    // ── Step 1: Homepage → type keyword → collect dropdown suggestions ────────
    await goTo(searchTabId, 'https://www.fiverr.com/');
    await injectContent(searchTabId);
    await sendTab(searchTabId, { action: 'initAgentMode' });

    const sugResp  = await sendTab(searchTabId, { action: 'getSearchSuggestions', keyword: seedKeyword });
    const suggestions = sugResp?.suggestions || [];

    // Deduplicate: seed keyword often appears in the dropdown too
    const seen = new Set();
    keywordQueue = [seedKeyword, ...suggestions].filter(kw => {
      const key = kw.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    totalKeywordsCount = keywordQueue.length; // Lock in the count for progress tracking
    broadcast(`Keyword expansion: ${keywordQueue.length} unique keywords queued`);
    await sleep(1500);

    // ── Step 2: For every keyword → search results → extract gig links ────────
    for (const kw of keywordQueue) {
      if (!isScraping) break;
      currentKeyword = kw;
      await processKeyword(kw); // result is already live in scrapedData
      doneKeywords++;
      broadcast(`Completed "${kw}" — ${doneKeywords}/${totalKeywordsCount} keywords done`);
    }

  } catch (err) {
    console.error('[FiverrScraper] Agent error:', err);
    broadcast(`Error: ${err.message}`);
  }

  await finish();
}

// ─── Process One Keyword ──────────────────────────────────────────────────────
async function processKeyword(keyword) {
  broadcast(`Searching: "${keyword}"`);

  const searchUrl = `https://www.fiverr.com/search/gigs?query=${encodeURIComponent(keyword)}`;
  await goTo(searchTabId, searchUrl);
  await injectContent(searchTabId);
  if (isAutonomous) await sendTab(searchTabId, { action: 'initAgentMode' });

  // Get ranked gig links (already includes gig title from the card)
  const linkResp = await sendTab(searchTabId, { action: 'extractGigLinks' });
  const links    = linkResp?.links || [];

  broadcast(`"${keyword}" — found ${links.length} gigs on page 1`);

  // —— Push a live placeholder into scrapedData immediately so buildStatus()
  // can serve fresh gigs to the popup during the loop (not just after it ends).
  const kwResult = { keyword, totalGigs: 0, gigs: [] };
  scrapedData.push(kwResult);

  for (const linkObj of links) {
    if (!isScraping) break;
    broadcast(`Extracting gig ${linkObj.rank}/${links.length} for "${keyword}"…`);

    try {
      // ── A. Navigate to gig page and extract from live React DOM ────────────
      // We navigate directly instead of using fetch() so that:
      //   1. React renders ALL 3 package tiers (not just the active SSR tab)
      //   2. window.__INITIAL_STATE__ is live and fully populated
      //   3. Rating, image, and FAQ are immediately available in the DOM
      broadcast(`Loading gig page ${linkObj.rank}/${links.length}…`);
      await goTo(searchTabId, linkObj.url);
      await injectContent(searchTabId);
      if (isAutonomous) await sendTab(searchTabId, { action: 'initAgentMode' });
      await sleep(1500); // Let React hydrate

      const gigResp = await sendTab(searchTabId, { action: 'extractLiveGigData' });
      const gigData = gigResp?.gigData || {};

      // Card title from search is a reliable fallback for the slug title
      if (!gigData.title && linkObj.title) gigData.title = linkObj.title;

      // ── B. Navigate to seller profile and deep-extract ─────────────────────
      // Username is always derivable from the gig URL: fiverr.com/{username}/{slug}
      // We use this directly instead of waiting for gigData.extractedUsername
      // so seller profiling always runs even if __INITIAL_STATE__ parsing failed.
      let sellerData = null;
      const username =
        gigData.extractedUsername ||
        (() => { try { return new URL(linkObj.url).pathname.split('/').filter(Boolean)[0]; } catch(_){return '';} })();

      if (username) {
        try {
          const profileUrl = `https://www.fiverr.com/${username}`;
          broadcast(`Loading profile: ${username}…`);
          await goTo(searchTabId, profileUrl);
          await injectContent(searchTabId);
          if (isAutonomous) await sendTab(searchTabId, { action: 'initAgentMode' });
          await sleep(1500); // Let profile page hydrate

          const sellerResp = await sendTab(searchTabId, { action: 'deepExtractSeller' });
          sellerData = sellerResp?.sellerData || { username }; // Always return at least username
        } catch (sellerErr) {
          console.warn('[FiverrScraper] Seller fetch failed for', username, sellerErr.message);
          sellerData = { username, error: sellerErr.message }; // Never return null
        }
      }

      kwResult.gigs.push({
        keyword,
        rank:   linkObj.rank,
        gigUrl: linkObj.url,
        gig:    gigData,
        seller: sellerData
      });

    } catch (e) {
      console.warn('[FiverrScraper] Gig failed:', linkObj.url, e.message);
      kwResult.gigs.push({ rank: linkObj.rank, gigUrl: linkObj.url, error: e.message });
    }

    kwResult.totalGigs = kwResult.gigs.length;

    // Broadcast after every gig so the popup feed + counters update in real-time
    broadcast(`Gig ${linkObj.rank}/${links.length} captured for "${keyword}"`);

    // Human-like delay between gigs
    await sleep(isAutonomous ? 900 + Math.random() * 800 : 400);
  }

  return kwResult;
}

// ─── Finish & Export ──────────────────────────────────────────────────────────
async function finish() {
  isScraping = false;

  // Remove overlay from the active tab
  sendTab(searchTabId, { action: 'stopAgentMode' }).catch(() => {});

  const totalGigs = scrapedData.reduce((n, kw) => n + kw.gigs.length, 0);

  if (totalGigs === 0) {
    broadcast('No data extracted.');
    return;
  }

  broadcast(`Exporting ${totalGigs} gigs across ${scrapedData.length} keywords…`);

  const exportPayload = {
    meta: {
      exportedAt:   new Date().toISOString(),
      seedKeyword:  keywordQueue[0] || '',
      allKeywords:  keywordQueue,
      totalKeywords:scrapedData.length,
      totalGigs
    },
    results: scrapedData
  };

  const blob = new Blob(
    [JSON.stringify(exportPayload, null, 2)],
    { type: 'application/json' }
  );

  const slug = (keywordQueue[0] || 'fiverr')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')   // spaces/symbols → hyphens
    .replace(/^-+|-+$/g, '');       // trim leading/trailing hyphens

  const reader = new FileReader();
  reader.onload = () => {
    chrome.downloads.download({
      url:      reader.result,
      filename: `${slug}-fiverr-data.json`,
      saveAs:   false
    });
  };
  reader.readAsDataURL(blob);

  broadcast(`✅ Export complete — ${totalGigs} gigs, ${scrapedData.length} keywords.`);
}

// ─── Tab Helpers ──────────────────────────────────────────────────────────────

/** Navigate a tab and wait until it is fully loaded + extra settle time */
function goTo(tabId, url) {
  return new Promise(resolve => {
    let settled = false;

    const listener = (tid, changeInfo) => {
      if (tid !== tabId || changeInfo.status !== 'complete' || settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(hardTimeout);
      // Extra 3 s for JS/dynamic content to render
      setTimeout(resolve, 3000);
    };

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url });

    // Hard timeout: 15 s max
    const hardTimeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });
}

/** Inject content.js (idempotent — the guard in content.js prevents double-init) */
async function injectContent(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files:  ['content.js']
    });
    await sleep(300); // brief pause so the script registers its listener
  } catch (e) {
    console.warn('[FiverrScraper] Injection warning:', e.message);
  }
}

/** Send a message to a tab with a timeout fallback */
function sendTab(tabId, msg, timeout = 12000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({}), timeout);
    chrome.tabs.sendMessage(tabId, msg, resp => {
      clearTimeout(timer);
      resolve(resp || {});
    });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
