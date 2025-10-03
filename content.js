// content.js — auto-load .dirdocs.nu + swap commit messages with dirdocs descriptions + custom tooltip

/* ------------------ storage + repo helpers ------------------ */
function getRepoFromLocation() {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return null;
}

async function getSettings() {
  const repo = getRepoFromLocation();
  const keyEnabled = repo ? `enabled:${repo}` : `enabled:_global`;
  const keyMap = repo ? `map:${repo}` : `map:_global`;
  const obj = await chrome.storage.local.get([keyEnabled, keyMap]);
  return {
    repo,
    enabled: !!obj[keyEnabled],
    map: obj[keyMap] || {},
  };
}

async function setRepoMap(repo, map) {
  const keyMap = repo ? `map:${repo}` : `map:_global`;
  await chrome.storage.local.set({ [keyMap]: map });
}

/* ------------------ fetch + parse .dirdocs.nu ------------------ */
function buildRawUrlForRepo(repo) {
  // Use HEAD so we follow the default branch automatically (main/master/etc.)
  return `https://raw.githubusercontent.com/${repo}/HEAD/.dirdocs.nu`;
}

// Walk dirdocs JSON -> { "path/relative.ext": "description", ... }
function mapFromDirdocsJSON(rootObj) {
  const out = {};
  if (!rootObj || !Array.isArray(rootObj.entries)) return out;

  function visit(nodes) {
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;

      // Directory-like: has entries; recurse
      if (Array.isArray(n.entries)) {
        visit(n.entries);
        continue;
      }

      // File-like: has doc with fileDescription
      const rel = typeof n.path === "string" ? n.path : null;
      const desc =
        n.doc && typeof n.doc.fileDescription === "string"
          ? n.doc.fileDescription.trim()
          : "";

      if (rel && desc) {
        out[rel] = desc;
      }
    }
  }

  visit(rootObj.entries);
  return out;
}

async function tryLoadRepoDirdocsMap(repo) {
  if (!repo) return null;
  const url = buildRawUrlForRepo(repo);

  try {
    const resp = await fetch(url, { credentials: "omit", cache: "no-cache" });
    if (!resp.ok) {
      // 404/403/etc. — just skip silently
      return null;
    }
    const text = await resp.text();

    // Nuon-compatible strict JSON is expected; try JSON.parse first.
    // If parsing fails, we bail (no map).
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.warn("[dirdocs] Failed to parse .dirdocs.nu as JSON:", e);
      return null;
    }

    const map = mapFromDirdocsJSON(json);
    if (Object.keys(map).length === 0) {
      return null;
    }
    return map;
  } catch (err) {
    console.warn("[dirdocs] Fetch error for .dirdocs.nu:", err);
    return null;
  }
}

// Ensure map for current repo is loaded (fetch and cache if empty)
async function ensureRepoMapLoaded() {
  const settings = await getSettings();
  if (!settings.repo) return settings;

  if (Object.keys(settings.map).length > 0) {
    return settings; // already have a map
  }

  // Try to fetch from raw.githubusercontent.com
  const fetched = await tryLoadRepoDirdocsMap(settings.repo);
  if (fetched && Object.keys(fetched).length > 0) {
    await setRepoMap(settings.repo, fetched);
    return { ...settings, map: fetched };
  }

  // Nothing fetched; keep settings as-is
  return settings;
}

/* ------------------ path helpers ------------------ */
function findNameLinkInRow(row) {
  return (
    row.querySelector('td a.Link--primary') ||
    row.querySelector('td a[data-pjax="true"]') ||
    row.querySelector('td a[href*="/blob/"], td a[href*="/tree/"]') ||
    row.querySelector('td a')
  );
}
function relPathFromLink(a) {
  if (!a) return null;
  try {
    const url = new URL(a.href, location.origin);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = Math.max(parts.indexOf("blob"), parts.indexOf("tree"));
    if (idx >= 2 && parts.length > idx + 2) {
      return parts.slice(idx + 2).join("/");
    }
  } catch {}
  return (a?.textContent || "").trim() || null;
}
function relPathFromRowGrid(row) {
  const link =
    row.querySelector('a[data-testid="tree-list-item-link"]') ||
    row.querySelector('a.js-navigation-open') ||
    row.querySelector('a.Link--primary') ||
    row.querySelector('a[href*="/tree/"], a[href*="/blob/"]');
  return relPathFromLink(link);
}

/* ------------------ tooltip (custom popup) ------------------ */
let TOOLTIP_EL = null;
let TOOLTIP_STYLE_INJECTED = false;

function ensureTooltipStyle() {
  if (TOOLTIP_STYLE_INJECTED) return;
  const css = `
  .dirdocs-tooltip {
    position: fixed;
    z-index: 2147483647;
    background: #1a1a1a; /* darker panel */
    color: #fad07a;      /* chalk yellow to match settings */
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    padding: 10px 12px;  /* a little larger */
    font-size: 13px;     /* a little larger */
    line-height: 1.5;
    max-width: min(760px, 85vw); /* a bit wider */
    box-shadow: 0 6px 24px rgba(0,0,0,.25), 0 2px 8px rgba(0,0,0,.18);
    pointer-events: none;
    white-space: normal;
    overflow-wrap: anywhere;
    display: none;
  }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  TOOLTIP_STYLE_INJECTED = true;
}

function getTooltip() {
  ensureTooltipStyle();
  if (!TOOLTIP_EL) {
    TOOLTIP_EL = document.createElement("div");
    TOOLTIP_EL.className = "dirdocs-tooltip";
    document.body.appendChild(TOOLTIP_EL);
  }
  return TOOLTIP_EL;
}

function showTooltip(text, x, y) {
  const tip = getTooltip();
  tip.textContent = text;
  const margin = 12;
  tip.style.display = "block";
  const rect = tip.getBoundingClientRect();
  let left = x + margin;
  let top = y + margin;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (left + rect.width + margin > vw) left = Math.max(margin, vw - rect.width - margin);
  if (top + rect.height + margin > vh) top = Math.max(margin, vh - rect.height - margin);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideTooltip() {
  const tip = getTooltip();
  tip.style.display = "none";
}

function bindTooltip(el, getText) {
  if (!el || el._dirdocsTooltipBound) return;
  el._dirdocsTooltipBound = true;

  const onEnter = (e) => {
    const t = getText();
    if (t && t.trim().length) showTooltip(t, e.clientX, e.clientY);
  };
  const onMove = (e) => {
    const t = getText();
    if (t && t.trim().length) showTooltip(t, e.clientX, e.clientY);
  };
  const onLeave = () => hideTooltip();

  el._dirdocsOnEnter = onEnter;
  el._dirdocsOnMove = onMove;
  el._dirdocsOnLeave = onLeave;

  el.addEventListener("mouseenter", onEnter);
  el.addEventListener("mousemove", onMove);
  el.addEventListener("mouseleave", onLeave);
}

function unbindTooltip(el) {
  if (!el || !el._dirdocsTooltipBound) return;
  el.removeEventListener("mouseenter", el._dirdocsOnEnter);
  el.removeEventListener("mousemove", el._dirdocsOnMove);
  el.removeEventListener("mouseleave", el._dirdocsOnLeave);
  el._dirdocsTooltipBound = false;
  delete el._dirdocsOnEnter;
  delete el._dirdocsOnMove;
  delete el._dirdocsOnLeave;
}

/* ------------------ table (React directory) ------------------ */
function applyRowTable(commitCell, map, enabled) {
  const msg = commitCell.querySelector(".react-directory-commit-message");
  if (!msg) return;

  if (!msg.dataset._dirdocsOrig) msg.dataset._dirdocsOrig = msg.textContent || "";

  const row = commitCell.closest("tr");
  const nameLink = row && findNameLinkInRow(row);
  const rel = relPathFromLink(nameLink);

  if (enabled) {
    if (rel && map[rel]) {
      const full = map[rel];
      msg.textContent = full;
      msg.removeAttribute("title");
      msg.removeAttribute("aria-label");
      bindTooltip(msg, () => full);
    } else {
      msg.textContent = ""; // blank when no description
      msg.removeAttribute("title");
      msg.removeAttribute("aria-label");
      unbindTooltip(msg);
    }
  } else {
    const orig = msg.dataset._dirdocsOrig || msg.textContent || "";
    msg.textContent = orig;
    msg.removeAttribute("title");
    msg.removeAttribute("aria-label");
    unbindTooltip(msg);
  }
}

/* ------------------ grid (fallback) ------------------ */
function findCommitMessageCellGrid(row) {
  const candidates = [
    'td:last-child .Link--secondary',
    'div[data-testid="last-commit"]',
    'a.Link--secondary[href*="/commit/"]',
    'a.Link--secondary',
    '[data-testid="cell-content"] .color-fg-muted',
    'div[role="gridcell"]:last-child',
  ];
  for (const sel of candidates) {
    const el = row.querySelector(sel);
    if (el) return el;
  }
  return row.querySelector(".color-fg-muted");
}

function applyRowGrid(row, map, enabled) {
  const cell = findCommitMessageCellGrid(row);
  if (!cell) return;

  if (!cell.dataset._dirdocsOrig) cell.dataset._dirdocsOrig = cell.textContent || "";

  const rel = relPathFromRowGrid(row);

  if (enabled) {
    if (rel && map[rel]) {
      const full = map[rel];
      cell.textContent = full;
      cell.removeAttribute("title");
      cell.removeAttribute("aria-label");
      bindTooltip(cell, () => full);
    } else {
      cell.textContent = ""; // blank when no description
      cell.removeAttribute("title");
      cell.removeAttribute("aria-label");
      unbindTooltip(cell);
    }
  } else {
    const orig = cell.dataset._dirdocsOrig || cell.textContent || "";
    cell.textContent = orig;
    cell.removeAttribute("title");
    cell.removeAttribute("aria-label");
    unbindTooltip(cell);
  }
}

/* ------------------ scanners ------------------ */
function scanReactTable({ map, enabled }) {
  const commitCells = document.querySelectorAll("td.react-directory-row-commit-cell");
  commitCells.forEach((cell) => applyRowTable(cell, map, enabled));
}
function scanGrid({ map, enabled }) {
  const grid =
    document.querySelector('div[role="grid"]') ||
    document.querySelector('div[aria-label="Files"]') ||
    document.querySelector("table[role='grid']");
  if (!grid) return;
  const rows = grid.querySelectorAll(
    'tr, div[role="row"], div.js-navigation-item, div[data-testid="tree-item"]'
  );
  rows.forEach((row) => applyRowGrid(row, map, enabled));
}
function scanAndApply(settings) {
  scanReactTable(settings);
  scanGrid(settings);
}

/* ------------------ boot with observer ------------------ */
let observer = null;
async function boot() {
  // Ensure we have a map for this repo (auto-load .dirdocs.nu if missing)
  const warm = await ensureRepoMapLoaded();
  scanAndApply(warm);

  if (observer) observer.disconnect();
  observer = new MutationObserver(async () => {
    const s = await getSettings();
    scanAndApply(s);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("pjax:send", hideTooltip, { passive: true });
  window.addEventListener("scroll", hideTooltip, { passive: true });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "REDRAW") boot();
});

boot();
