// ────────────── State ──────────────
let blockingEnabled = true;
let ALLOWED_CATEGORIES = [];

chrome.storage.sync.get({ allowedCategories: [] }, (data) => {
  ALLOWED_CATEGORIES = data.allowedCategories;
  // console.log("Allowed categories:", ALLOWED_CATEGORIES);
});

// listening to the changes in categories
chrome.storage.onChanged.addListener((changes) => {
  if (changes.allowedCategories) {
    ALLOWED_CATEGORIES = changes.allowedCategories.newValue;

    // TODO: Reloading the page after allowing new categories
    // console.log("Updated categories:", ALLOWED_CATEGORIES);
  }
});

// chrome.storage.local.get("channelDecisions", (result) => {
//   console.log("Channel decisions:", result.channelDecisions);
// });

const CACHE_TTL = 24 * 60 * 60 * 1000; // 1 day
// const CACHE_TTL = 0;

// in-memory mirror of chrome.storage.local (keyed by normalized channel_id)
const channelCache = {};

// track DOM nodes we've already processed
const processedCards = new WeakSet();

// ────────────── Startup ──────────────
chrome.storage.sync.get({ blockEnabled: true }, (data) => {
  blockingEnabled = data.blockEnabled;
  chrome.storage.local.get("channelDecisions", (res) => {
    // On startup re-checking the cache expiration and removing it form the chrome local storage
    if (res?.channelDecisions) {
      Object.assign(channelCache, res.channelDecisions);
      // Clean expired entries
      for (const [id, entry] of Object.entries(channelCache)) {
        if (Date.now() - entry.ts > CACHE_TTL) {
          delete channelCache[id];
        }
      }

      // Save cleaned cache back to storage
      chrome.storage.local.set({ channelDecisions: channelCache });
    }
    if (blockingEnabled) scanAndBlock();
  });
});

// react to popup toggle
chrome.storage.onChanged.addListener((changes) => {
  if (changes.blockEnabled) {
    blockingEnabled = changes.blockEnabled.newValue;
    if (blockingEnabled) {
      scanAndBlock();
    } else {
      unhideAll();
      // console.log("Blocking disabled – all cards restored.");
    }
  }
});

// ────────────── Selectors & helpers ──────────────
const cardSelectors = [
  "ytd-rich-item-renderer",
  "ytd-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-grid-video-renderer",
  "ytd-playlist-video-renderer",
];

// normalize YouTube href into consistent key
function normalizeId(href) {
  if (!href) return null;
  href = href.split(/[?#]/)[0].trim();
  if (!href.startsWith("/")) href = "/" + href;
  return href;
}

// try many anchor patterns to pull channel info
function extractChannelInfo(card) {
  const link =
    card.querySelector("a[href^='/@']") ||
    card.querySelector("a[href^='/channel/']") ||
    card.querySelector("#channel-name a[href^='/@']") ||
    card.querySelector("ytd-channel-name a[href^='/@']") ||
    card.querySelector("ytd-video-owner-renderer a[href^='/@']") ||
    card.querySelector("ytd-video-owner-renderer a[href^='/channel/']") ||
    card.querySelector("yt-content-metadata-view-model a[href^='/@']") ||
    card.querySelector("yt-content-metadata-view-model a[href^='/channel/']") ||
    card.querySelector(
      "yt-content-metadata-view-model a[href^='/@'], a.yt-core-attributed-string__link[href^='/@']"
    ) ||
    card.querySelector(
      "yt-content-metadata-view-model a[href^='/channel/'], a.yt-core-attributed-string__link[href^='/channel/']"
    );

  if (link) {
    const rawHref = link.getAttribute("href") || "";
    let cleanHref = normalizeId(rawHref); // "/@manuarora" or "/channel/UC…"

    // 🔹 If it’s a /channel/ link, strip everything except the actual ID
    if (cleanHref.startsWith("/channel/")) {
      cleanHref = cleanHref.replace("/channel/", "");
    }

    const visibleName = (link.textContent || "").trim();
    return {
      channel_id: cleanHref, // now just "UC…" or "@handle"
      channel_name: visibleName || null,
    };
  }

  // fallback for cards that only have text
  const owner =
    card.querySelector("ytd-channel-name") ||
    card.querySelector("ytd-video-owner-renderer");
  if (owner) {
    const name = owner.textContent.trim();
    return { channel_id: null, channel_name: name || null };
  }

  return { channel_id: null, channel_name: null };
}

// ────────────── Cache helpers ──────────────
function getCachedDecision(id) {
  if (!id) return null;
  const entry = channelCache[id];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) return null;
  return entry.channel_categories;
}

function saveDecision(id, channel_categories) {
  if (!id) return;
  channelCache[id] = { channel_categories, ts: Date.now() };
  chrome.storage.local.set({ channelDecisions: channelCache });
}

// ────────────── Core logic ──────────────
function scanAndBlock() {
  if (!blockingEnabled) return;

  // console.log("scanAndBlock running…");

  const nodes = Array.from(document.querySelectorAll(cardSelectors.join(",")));
  // console.log("Found nodes:", nodes.length);

  const entries = [];

  nodes.forEach((node, idx) => {
    // Skip if already processed
    if (processedCards.has(node)) return;
    processedCards.add(node);

    const info = extractChannelInfo(node);
    entries.push({
      idx,
      node,
      channel_name: info?.channel_name || null,
      channel_id: info?.channel_id || null,
    });
  });

  // quick debug dump
  // entries.forEach((e) => {
  // if (!e.channel_id && !e.channel_name) return;
  // console.log(`[${e.idx}] name="${e.channel_name}" id="${e.channel_id}"`);
  //   console.log(e);
  // });

  // apply cache / collect pending
  const pending = [];
  entries.forEach((e) => {
    if (!e.channel_id && !e.channel_name) {
      if (e.node) e.node.style.display = "none";
      // console.log(e)
      return;
    }

    // TODO: Need to change here after modification in block from boolean val to video categories array
    const cached = getCachedDecision(e.channel_id);
    // console.log(cached);

    if (cached !== null && cached != undefined) {
      // Check if cached (contains an arr have at least one of the allowed categories), if yes set cached to true else false
      const shouldBlock =
        Array.isArray(cached) && cached.length > 0
          ? !cached.some((cat) => ALLOWED_CATEGORIES.includes(cat))
          : true;

      if (shouldBlock) {
        e.node.style.display = "none";
        // console.debug("Applied cached block:", e.channel_name, e.channel_id);
      }
    } else {
      pending.push({
        idx: e.idx,
        channel_name: e.channel_name,
        channel_id: e.channel_id,
      });
    }
  });

  if (location.pathname === "/results") {
    if (!pending.length) {
      console.debug("No pending channels found");
      return;
    }

    // console.log(`Calling processChannels for ${pending.length} channels`);

    chrome.runtime.sendMessage(
      { action: "processChannels", data: pending },
      (response) => {
        // Debugging statements for save channels
        // if (chrome.runtime.lastError) {
        //   console.warn("Runtime error:", chrome.runtime.lastError.message);
        //   return;
        // }
        // console.log("Got response:", response);
      }
    );

    return;
  }

  if (pending.length) {
    // console.debug("Calling background for", pending.length, "channels");
    chrome.runtime.sendMessage(
      { action: "callAPI", data: pending },
      (response) => {
        // console.debug("callAPI response:", response);
        const results = response?.data?.result ?? response?.result ?? [];
        if (!Array.isArray(results)) {
          console.warn("Unexpected callAPI response shape", results);
          return;
        }

        results.forEach((r) => {
          const incomingId = normalizeId(r.channel_id || r.id || r.href || "");
          const incomingName = r.channel_name || r.name || null;
          const shouldBlock =
            Array.isArray(r.channel_categories) &&
            r.channel_categories.length > 0
              ? !r.channel_categories.some((cat) =>
                  ALLOWED_CATEGORIES.includes(cat)
                )
              : true; // previously !!r.block (not sure what is is doing here) changing it to true statement

          let local = null;
          if (incomingId)
            local = entries.find((e) => e.channel_id === incomingId);
          if (!local && incomingName)
            local = entries.find((e) => e.channel_name === incomingName);

          const keyToSave = incomingId || (local && local.channel_id) || null;
          // TODO: Instead of setting boolean values we must store the actual video categories arr
          if (keyToSave) saveDecision(keyToSave, r.channel_categories);

          // Block video if consists category of -1 and also if it dose not match any default value
          if (local && shouldBlock) {
            local.node.style.display = "none";
            // console.log(
            //   `Blocked:${shouldBlock} -> ${incomingName} -> ${r.channel_categories} Allowed Category: ${ALLOWED_CATEGORIES}`
            // );
          } else {
            console.log(
              `Allowed: ${incomingName} -> ${r.channel_categories} Allowed Category: ${ALLOWED_CATEGORIES}`
            );
          }
        });
      }
    );
  }

  // Just upgraded the mix for detecting auto generated videos
  // hide obvious "Mix" rows
  entries.forEach((e) => {
    if (!e || !e.node) return;

    // Get the video link (handles all layouts)
    const link = e.node.querySelector("a[href*='/watch']");
    const href = link?.getAttribute("href") || "";

    // Detect Mix video by URL pattern (most reliable)
    const isMixByURL = href.includes("list=RD");

    // Your existing detection methods
    const isMixByText = e.node.innerText?.toLowerCase().includes("mix");
    const isMixByBadge = e.node.querySelector(
      "ytd-badge-supported-renderer[icon='MIX']"
    );

    // Final mix detection
    const isMix = isMixByURL || isMixByText || isMixByBadge;

    if (isMix) {
      e.node.style.display = "none";
    }
  });

  // hide shorts/rich sections
  document.querySelectorAll("ytd-rich-section-renderer").forEach((section) => {
    section.style.display = "none";
  });
}

function unhideAll() {
  location.reload();
}

// ────────────── Observe DOM ──────────────
(() => {
  const feed = document.querySelector("ytd-page-manager") || document.body;

  const observer = new MutationObserver((mutations) => {
    if (!blockingEnabled) return;
    let found = false;

    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (cardSelectors.some((sel) => node.matches(sel))) {
          found = true;
        } else if (
          node.querySelector &&
          node.querySelector(cardSelectors.join(","))
        ) {
          found = true;
        }
      }
    }
    if (found) scanAndBlock();
  });

  observer.observe(feed, { childList: true, subtree: true });
})();
