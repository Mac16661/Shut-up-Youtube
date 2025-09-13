// ────────────── State ──────────────
let blockingEnabled = true;
const DEFAULT_CATEGORY = 0; // software dev/engineering
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
    if (res?.channelDecisions)
      Object.assign(channelCache, res.channelDecisions);
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
      console.log("Blocking disabled – all cards restored.");
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
  return entry.block;
}

function saveDecision(id, block) {
  if (!id) return;
  channelCache[id] = { block, ts: Date.now() };
  chrome.storage.local.set({ channelDecisions: channelCache });
}

// ────────────── Core logic ──────────────
function scanAndBlock() {
  if (!blockingEnabled) return;

  if (location.pathname === "/results") {
    console.log("Search page – skipping scanAndBlock :: ", location.pathname);
    return;
  }

  console.log("scanAndBlock running…");

  const nodes = Array.from(document.querySelectorAll(cardSelectors.join(",")));
  console.log("Found nodes:", nodes.length);

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
  entries.forEach((e) => {
    if (!e.channel_id && !e.channel_name) return;
    console.log(`[${e.idx}] name="${e.channel_name}" id="${e.channel_id}"`);
  });

  // apply cache / collect pending
  const pending = [];
  entries.forEach((e) => {
    if (!e.channel_id && !e.channel_name) return;
    const cached = getCachedDecision(e.channel_id);
    if (cached !== null) {
      if (cached) {
        e.node.style.display = "none";
        console.debug("Applied cached block:", e.channel_name, e.channel_id);
      }
    } else {
      pending.push({
        idx: e.idx,
        channel_name: e.channel_name,
        channel_id: e.channel_id,
      });
    }
  });

  if (pending.length) {
    console.debug("Calling background for", pending.length, "channels");
    chrome.runtime.sendMessage(
      { action: "callAPI", data: pending },
      (response) => {
        console.debug("callAPI response:", response);
        const results = response?.data?.result ?? response?.result ?? [];
        if (!Array.isArray(results)) {
          console.warn("Unexpected callAPI response shape", results);
          return;
        }

        results.forEach((r) => {
          const incomingId = normalizeId(r.channel_id || r.id || r.href || "");
          const incomingName = r.channel_name || r.name || null;
          const shouldBlock =
            typeof r.channel_category !== "undefined"
              ? r.channel_category !== DEFAULT_CATEGORY
              : !!r.block;

          let local = null;
          if (incomingId)
            local = entries.find((e) => e.channel_id === incomingId);
          if (!local && incomingName)
            local = entries.find((e) => e.channel_name === incomingName);

          const keyToSave = incomingId || (local && local.channel_id) || null;
          if (keyToSave) saveDecision(keyToSave, shouldBlock);

          if (local && shouldBlock) {
            local.node.style.display = "none";
            console.log(
              `Blocked ${local.channel_name || incomingName} (${keyToSave})`
            );
          }
        });
      }
    );
  }

  // hide obvious "Mix" rows
  entries.forEach((e) => {
    if (!e || !e.node) return;
    const isMix =
      e.node.innerText?.toLowerCase().includes("mix") ||
      e.node.querySelector("ytd-badge-supported-renderer[icon='MIX']");
    if (isMix) e.node.style.display = "none";
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
  if (location.pathname === "/results") {
    console.log("Search page detected :: ", location.pathname);
    return;
  }

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
