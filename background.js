// ─── State Management (Persistent via chrome.storage.local) ───────────────
const defaultState = {
  isScraping: false,
  isAutonomous: false,
  scrapedData: [],      // Final aggregated export
  searchTabId: null,
  keywordQueue: [],
  totalKeywordsCount: 0,
  doneKeywords: 0,
  awaitingSelection: false,
  currentKeyword: '',
  seedKeyword: '',
  suggestedKeywords: []
};

let memState = { ...defaultState };

// Initialize state from storage on startup
chrome.storage.local.get(['fiverrState'], (result) => {
  if (result.fiverrState) {
    memState = result.fiverrState;
    // If it was scraping when the worker died, we could auto-resume here,
    // but for safety, we just mark it as paused so the user can resume manually.
    if (memState.isScraping) {
      memState.isScraping = false;
      saveState();
    }
  }
});

async function saveState(updates = {}) {
  memState = { ...memState, ...updates };
  await chrome.storage.local.set({ fiverrState: memState });
}

async function getState() {
  const result = await chrome.storage.local.get(['fiverrState']);
  if (result.fiverrState) memState = result.fiverrState;
  return memState;
}

// ─── Message Router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'getStatus') {
    sendResponse(buildStatus());
    
  } else if (msg.action === 'startSearchAndScrape') {
    fetchSuggestions(msg.tabId, msg.keyword, msg.isAutonomous);
    
  } else if (msg.action === 'confirmKeywords') {
    if (memState.awaitingSelection) {
      saveState({ awaitingSelection: false }).then(() => {
        runExtraction(msg.keywords);
      });
    }
    
  } else if (msg.action === 'stopScraping') {
    saveState({ isScraping: false, awaitingSelection: false }).then(() => {
      broadcast('Scraping stopped by user.');
    });
  }
  return true;
});

// ─── Status Helpers ───────────────────────────────────────────────────────────
function buildStatus() {
  const totalGigs = memState.scrapedData.reduce((n, kw) => n + (kw.gigs?.length || 0), 0);
  return {
    isScraping: memState.isScraping,
    awaitingSelection: memState.awaitingSelection,
    statusText: memState.isScraping
      ? `🔍 Processing: "${memState.currentKeyword}" — ${totalGigs} gigs captured`
      : (memState.awaitingSelection
          ? '🔎 Select keywords to extract'
          : (memState.scrapedData.length > 0
              ? `✅ Done! ${totalGigs} gigs across ${memState.scrapedData.length} keywords.`
              : 'Ready to initialize.')),
    totalGigs,
    totalKeywords: memState.totalKeywordsCount,
    doneKeywords: memState.doneKeywords,
    latestGigs: memState.scrapedData.flatMap(k => k.gigs || []).slice(-50),
    suggestedKeywords: memState.suggestedKeywords,
    seedKeyword: memState.seedKeyword
  };
}

async function broadcast(text, extra = {}) {
  const status = buildStatus();
  chrome.runtime.sendMessage({
    action: 'updateStatus',
    data:   { ...status, ...extra, statusText: text }
  }).catch(() => {});
}

// ─── Keep-Alive Ping ─────────────────────────────────────────────────────────
// Continuously ping ourselves or the content script to extend MV3 lifetime
setInterval(() => {
  if (memState.isScraping && memState.searchTabId) {
    chrome.tabs.sendMessage(memState.searchTabId, { action: 'ping' }).catch(() => {});
  }
}, 20000);

// ─── Phase 1: Fetch Suggestions ───────────────────────────────────────────────
async function fetchSuggestions(tabId, seedKeyword, autonomous) {
  await saveState({
    isScraping: false,
    isAutonomous: !!autonomous,
    scrapedData: [],
    searchTabId: tabId,
    doneKeywords: 0,
    keywordQueue: [],
    awaitingSelection: false,
    seedKeyword,
    suggestedKeywords: []
  });

  broadcast('Initializing — navigating to Fiverr…');

  try {
    const searchUrl = `https://www.fiverr.com/search/gigs?query=${encodeURIComponent(seedKeyword)}`;
    await goTo(tabId, searchUrl);
    await injectContent(tabId);
    await sendTab(tabId, { action: 'initAgentMode' });

    broadcast('Typing keyword and triggering autocomplete…');
    const sugResp  = await sendTab(tabId, { action: 'getSearchSuggestions', keyword: seedKeyword }, 35000);
    const rawSuggs = sugResp?.suggestions || [];

    if (sugResp?.error) {
      console.warn('[FiverrScraper] Suggestion error:', sugResp.error);
    }

    const seen = new Set();
    const allKeywords = [seedKeyword, ...rawSuggs].filter(kw => {
      const key = kw.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });

    await saveState({
      awaitingSelection: true,
      suggestedKeywords: allKeywords
    });

    broadcast(`Found ${allKeywords.length} keywords — choose which to extract`, {
      awaitingSelection: true,
      suggestedKeywords: allKeywords,
      seedKeyword
    });

  } catch (err) {
    console.error('[FiverrScraper] fetchSuggestions error:', err);
    broadcast(`Error: ${err.message}`);
  }
}

// ─── Phase 2: Run Extraction for Confirmed Keywords ───────────────────────────
async function runExtraction(selectedKeywords) {
  if (!selectedKeywords || selectedKeywords.length === 0) {
    broadcast('No keywords selected — nothing to extract.');
    return;
  }

  await saveState({
    isScraping: true,
    keywordQueue: selectedKeywords,
    totalKeywordsCount: selectedKeywords.length,
    doneKeywords: 0,
    scrapedData: [] // reset on new job
  });

  broadcast(`Starting extraction for ${selectedKeywords.length} keyword(s)…`);

  try {
    for (const kw of memState.keywordQueue) {
      await getState();
      if (!memState.isScraping) break;
      
      await saveState({ currentKeyword: kw });
      await processKeyword(kw);
      
      await getState();
      if (!memState.isScraping) break; // Check again in case stopped during processing
      
      await saveState({ doneKeywords: memState.doneKeywords + 1 });
      broadcast(`Completed "${kw}" — ${memState.doneKeywords}/${memState.totalKeywordsCount} keywords done`);
    }
  } catch (err) {
    console.error('[FiverrScraper] Extraction error:', err);
    broadcast(`Error: ${err.message}`);
  }

  await finish();
}

// ─── Process One Keyword ──────────────────────────────────────────────────────
async function processKeyword(keyword) {
  broadcast(`Searching: "${keyword}"`);

  const searchUrl = `https://www.fiverr.com/search/gigs?query=${encodeURIComponent(keyword)}`;
  await goTo(memState.searchTabId, searchUrl);
  await injectContent(memState.searchTabId);
  if (memState.isAutonomous) await sendTab(memState.searchTabId, { action: 'initAgentMode' });

  // Get ranked gig links from page 1 only
  const linkResp = await sendTab(memState.searchTabId, { action: 'extractGigLinks' });
  const links    = linkResp?.links || [];

  broadcast(`"${keyword}" — found ${links.length} gigs on page 1`);

  // Initialize keyword result object
  const kwResult = { keyword, totalGigs: 0, gigs: [] };
  
  // Update state immediately
  await getState();
  const newScrapedData = [...memState.scrapedData, kwResult];
  await saveState({ scrapedData: newScrapedData });

  for (let i = 0; i < links.length; i++) {
    const linkObj = links[i];
    await getState();
    if (!memState.isScraping) break;
    
    broadcast(`Extracting gig ${linkObj.rank}/${links.length} for "${keyword}"…`);

    try {
      // ── A. Navigate to gig page ──────
      broadcast(`Loading gig page ${linkObj.rank}/${links.length}…`);
      await goTo(memState.searchTabId, linkObj.url);
      await injectContent(memState.searchTabId);
      if (memState.isAutonomous) await sendTab(memState.searchTabId, { action: 'initAgentMode' });
      await sleep(1500); 

      const gigResp = await sendTab(memState.searchTabId, { action: 'extractLiveGigData' });
      const gigData = gigResp?.gigData || {};

      if (!gigData.title && linkObj.title) gigData.title = linkObj.title;

      // ── B. Navigate to seller profile and deep-extract ────────────────────────
      let sellerData = null;
      const username = gigData.extractedUsername || 
        (() => { try { return new URL(linkObj.url).pathname.split('/').filter(Boolean)[0]; } catch(_){return '';} })();

      if (username) {
        try {
          const profileUrl = `https://www.fiverr.com/${username}`;
          broadcast(`Loading profile: ${username}…`);
          await goTo(memState.searchTabId, profileUrl);
          await injectContent(memState.searchTabId);
          if (memState.isAutonomous) await sendTab(memState.searchTabId, { action: 'initAgentMode' });
          await sleep(1500);

          const sellerResp = await sendTab(memState.searchTabId, { action: 'deepExtractSeller' });
          sellerData = sellerResp?.sellerData || { username };
        } catch (sellerErr) {
          console.warn('[FiverrScraper] Seller fetch failed for', username, sellerErr.message);
          sellerData = { username, error: sellerErr.message };
        }
      }

      // Add the gig to our state securely
      await getState();
      // Find the keyword entry
      const updatedData = [...memState.scrapedData];
      const kwIndex = updatedData.findIndex(k => k.keyword === keyword);
      if (kwIndex !== -1) {
        updatedData[kwIndex].gigs.push({
          keyword,
          rank:   linkObj.rank,
          gigUrl: linkObj.url,
          gig:    gigData,
          seller: sellerData
        });
        updatedData[kwIndex].totalGigs = updatedData[kwIndex].gigs.length;
        await saveState({ scrapedData: updatedData });
      }

    } catch (e) {
      console.warn('[FiverrScraper] Gig failed:', linkObj.url, e.message);
      await getState();
      const updatedData = [...memState.scrapedData];
      const kwIndex = updatedData.findIndex(k => k.keyword === keyword);
      if (kwIndex !== -1) {
        updatedData[kwIndex].gigs.push({ rank: linkObj.rank, gigUrl: linkObj.url, error: e.message });
        await saveState({ scrapedData: updatedData });
      }
    }

    broadcast(`Gig ${linkObj.rank}/${links.length} captured for "${keyword}"`);
    await sleep(memState.isAutonomous ? 900 + Math.random() * 800 : 400);
  }
}

// ─── Finish & Export ──────────────────────────────────────────────────────────
async function finish() {
  await getState();
  
  if (memState.searchTabId) {
    sendTab(memState.searchTabId, { action: 'stopAgentMode' }).catch(() => {});
  }

  const totalGigs = memState.scrapedData.reduce((n, kw) => n + (kw.gigs?.length || 0), 0);

  if (totalGigs === 0) {
    broadcast('No data extracted.');
    await saveState({ isScraping: false });
    return;
  }

  broadcast(`Exporting ${totalGigs} gigs across ${memState.scrapedData.length} keywords…`);

  const results = memState.scrapedData.map(kwResult => {
    return {
      keyword: kwResult.keyword,
      totalGigs: kwResult.gigs?.length || 0,
      gigs: (kwResult.gigs || []).map(g => {
        if (g.error) {
          return {
            keyword: kwResult.keyword,
            rank: g.rank,
            gigUrl: g.gigUrl,
            error: g.error
          };
        }
        
        const gigData = g.gig || {};
        const sellerData = g.seller || {};
        
        return {
          keyword: kwResult.keyword,
          rank: g.rank,
          gigUrl: g.gigUrl,
          gig: {
            title: gigData.title || "",
            description: gigData.description || "",
            image: gigData.image || "",
            rating: gigData.rating || "",
            reviewsCount: gigData.reviewsCount || "",
            packages: gigData.packages || [],
            faq: gigData.faq || []
          },
          seller: {
            username: sellerData.username || gigData.extractedUsername || "",
            publicName: sellerData.publicName || "",
            sellerLevel: sellerData.sellerLevel || "",
            rating: sellerData.rating || "",
            reviewsCount: sellerData.reviewsCount || "",
            memberSince: sellerData.memberSince || "",
            country: sellerData.country || "",
            about: sellerData.about || "",
            skills: sellerData.skills || [],
            education: sellerData.education || [],
            certifications: sellerData.certifications || [],
            languages: sellerData.languages || []
          }
        };
      })
    };
  });

  const exportPayload = {
    metadata: {
      exportedAt: new Date().toISOString(),
      seedKeyword: memState.seedKeyword || '',
      allKeywords: memState.suggestedKeywords || [],
      totalKeywords: memState.scrapedData.length,
      totalGigs: totalGigs
    },
    results: results
  };

  const blob = new Blob(
    [JSON.stringify(exportPayload, null, 2)],
    { type: 'application/json' }
  );

  const slug = (memState.seedKeyword || 'fiverr')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const reader = new FileReader();
  reader.onload = () => {
    chrome.downloads.download({
      url:      reader.result,
      filename: `${slug}-fiverr-data.json`,
      saveAs:   false
    });
  };
  reader.readAsDataURL(blob);

  broadcast(`✅ Export complete — ${totalGigs} gigs across ${memState.scrapedData.length} keywords.`);
  await saveState({ isScraping: false });
}

// ─── Tab Helpers ──────────────────────────────────────────────────────────────

/** Navigate a tab and wait until it is fully loaded + extra settle time */
function goTo(tabId, url) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const listener = (tid, changeInfo, tab) => {
      if (tid !== tabId) return;
      
      // If the tab closes, handle the error gracefully
      if (changeInfo.status === 'unloaded' && !tab) {
        settled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(hardTimeout);
        return reject(new Error('Tab closed during navigation'));
      }

      if (changeInfo.status !== 'complete' || settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(hardTimeout);
      setTimeout(resolve, 3000);
    };

    chrome.tabs.onUpdated.addListener(listener);
    
    // Explicitly handle failure to even start navigation (e.g., Chrome internal errors)
    chrome.tabs.update(tabId, { url }).catch(err => {
      if (!settled) {
        settled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(hardTimeout);
        reject(err);
      }
    });

    const hardTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(); // We still resolve on hard timeout to keep scraping, though it might be an error page
      }
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
    await sleep(300);
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
