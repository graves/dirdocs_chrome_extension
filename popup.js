// popup.js — Jellybeans UI, repo-scoped toggle, upload + fetch, counts

/* ---------- storage keys ---------- */
function repoFromUrl(u) {
  try {
    const url = new URL(u);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  } catch {}
  return null;
}
async function getActiveRepo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? repoFromUrl(tab.url || "") : null;
}
function keyEnabled(repo) { return repo ? `enabled:${repo}` : `enabled:_global`; }
function keyMap(repo) { return repo ? `map:${repo}` : `map:_global`; }

/* ---------- parse dirdocs JSON -> map ---------- */
function mapFromDirdocsJSON(rootObj) {
  const out = {};
  if (!rootObj || !Array.isArray(rootObj.entries)) return out;
  const visit = (nodes) => {
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      if (Array.isArray(n.entries)) { visit(n.entries); continue; }
      const rel = typeof n.path === "string" ? n.path : null;
      const desc = n?.doc?.fileDescription && typeof n.doc.fileDescription === "string"
        ? n.doc.fileDescription.trim() : "";
      if (rel && desc) out[rel] = desc;
    }
  };
  visit(rootObj.entries);
  return out;
}

/* ---------- fetch from repo default branch (HEAD) ---------- */
function rawUrlHEAD(repo) {
  return `https://raw.githubusercontent.com/${repo}/HEAD/.dirdocs.nu`;
}
async function fetchRepoMap(repo) {
  if (!repo) return null;
  try {
    const res = await fetch(rawUrlHEAD(repo), { cache: "no-cache", credentials: "omit" });
    if (!res.ok) return null;
    const txt = await res.text();
    let json;
    try { json = JSON.parse(txt); }
    catch { return null; }
    const map = mapFromDirdocsJSON(json);
    return Object.keys(map).length ? map : null;
  } catch {
    return null;
  }
}

/* ---------- UI helpers ---------- */
async function updateCounts(repo) {
  const obj = await chrome.storage.local.get([keyMap(repo)]);
  const m = obj[keyMap(repo)] || {};
  document.getElementById("mappingCount").textContent = `mappings: ${Object.keys(m).length}`;
}
async function setStatus(msg, isWarn = false) {
  const el = document.getElementById("status");
  el.textContent = msg || "";
  el.style.color = isWarn ? "#cf6a4c" : "var(--jb-green)";
}

/* ---------- wire up ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  const repo = await getActiveRepo();
  const repoLabel = document.getElementById("repoLabel");
  repoLabel.textContent = repo ? `repo: ${repo}` : "repo: (not a repo page)";

  // load enabled + map count
  const store = await chrome.storage.local.get([keyEnabled(repo), keyMap(repo)]);
  const enabled = !!store[keyEnabled(repo)];
  document.getElementById("enabledToggle").checked = enabled;
  await updateCounts(repo);

  // toggle enabled (repo-scoped)
  document.getElementById("enabledToggle").addEventListener("change", async (e) => {
    await chrome.storage.local.set({ [keyEnabled(repo)]: e.target.checked });
    await setStatus("Saved. Refreshing…");
    // poke content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "REDRAW" });
    setTimeout(() => setStatus(""), 800);
  });

  // upload file
  document.getElementById("btnUseFile").addEventListener("click", async () => {
    const file = document.getElementById("fileInput").files?.[0];
    if (!file) return setStatus("No file selected.", true);
    try {
      const txt = await file.text();
      let json;
      try { json = JSON.parse(txt); }
      catch { return setStatus("Failed to parse JSON/NUON.", true); }
      const map = mapFromDirdocsJSON(json);
      await chrome.storage.local.set({ [keyMap(repo)]: map });
      await updateCounts(repo);
      await setStatus(`Loaded ${Object.keys(map).length} mappings from file.`);
      // refresh page view
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "REDRAW" });
    } catch (e) {
      setStatus("Error reading file.", true);
    }
  });

  // fetch from repo default branch (HEAD)
  document.getElementById("btnFetch").addEventListener("click", async () => {
    if (!repo) return setStatus("Not on a repo page.", true);
    setStatus("Fetching…");
    const map = await fetchRepoMap(repo);
    if (!map) {
      await setStatus("No .dirdocs.nu found or parse failed.", true);
      return;
    }
    await chrome.storage.local.set({ [keyMap(repo)]: map });
    await updateCounts(repo);
    await setStatus(`Fetched ${Object.keys(map).length} mappings from HEAD.`);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "REDRAW" });
  });

  // clear mapping
  document.getElementById("btnClear").addEventListener("click", async () => {
    await chrome.storage.local.set({ [keyMap(repo)]: {} });
    await updateCounts(repo);
    await setStatus("Cleared mapping.");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "REDRAW" });
  });

  // manual redraw
  document.getElementById("btnRedraw").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "REDRAW" });
    await setStatus("Redrew page.");
    setTimeout(() => setStatus(""), 700);
  });
});
