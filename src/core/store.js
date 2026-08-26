/* =============================================================================
   store — persistence, and only persistence.

   Deliberately keeps the previous product's storage keys (xBookmarks,
   xLibraryState, xDashboardPrefs) so anyone who already has an archive in this
   browser or in the extension opens it unchanged. That contract is the one
   thing this rebuild treats as load-bearing.

   Backends, in preference order:
     1. chrome.storage.local  — when running inside the capture extension
     2. IndexedDB             — everywhere else; localStorage's ~5MB ceiling is
                                far below a real archive
     3. localStorage          — last resort, and the migration source
   ============================================================================= */

export const KEYS = {
  bookmarks: "xBookmarks",
  capture: "xCaptureState",
  dead: "xDeadLetters",
  library: "xLibraryState",
  prefs: "xDashboardPrefs",
  index: "xMediaIndex",      // projection cache, owned by this rebuild
};

const IDB_NAME = "xbookmark";
const IDB_STORE = "kv";

let dbPromise = null;
let idbBroken = false;

export const hasExtension = () =>
  typeof chrome !== "undefined" && !!chrome.storage?.local;

function openDb() {
  if (idbBroken || typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(IDB_NAME, 1); }
    catch { idbBroken = true; return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { idbBroken = true; resolve(null); };
    req.onblocked = () => { idbBroken = true; resolve(null); };
    setTimeout(() => { idbBroken = true; resolve(null); }, 4000);
  });
  return dbPromise;
}

function idbOp(db, mode, run) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode);
    const result = run(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getMany(keys) {
  if (hasExtension()) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }
  const db = await openDb();
  const out = {};
  if (db) {
    try {
      const got = await idbOp(db, "readonly", (store) => store.get(keys));
      got.forEach((value, i) => { out[keys[i]] = value; });
      for (const key of keys) {
        if (out[key] === undefined) out[key] = readLocal(key);
      }
      return out;
    } catch { /* fall through to localStorage */ }
  }
  for (const key of keys) out[key] = readLocal(key);
  return out;
}

function readLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch { return undefined; }
}

export async function setMany(entries) {
  if (hasExtension()) {
    return new Promise((resolve) => chrome.storage.local.set(entries, resolve));
  }
  const db = await openDb();
  if (db) {
    try {
      await idbOp(db, "readwrite", (store) => {
        for (const [key, value] of Object.entries(entries)) store.put(value, key);
      });
      // Mirror a ping so other tabs notice; the payload stays in IndexedDB.
      try { localStorage.setItem("xStorageRev", String(Date.now())); } catch { /* full */ }
      return;
    } catch { /* fall through */ }
  }
  for (const [key, value] of Object.entries(entries)) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
  }
}

export async function removeMany(keys) {
  if (hasExtension()) {
    return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
  }
  const db = await openDb();
  if (db) {
    try {
      await idbOp(db, "readwrite", (store) => { keys.forEach((k) => store.delete(k)); });
    } catch { /* ignore */ }
  }
  keys.forEach((k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
}

export async function backendName() {
  if (hasExtension()) return "extension";
  return (await openDb()) ? "IndexedDB" : "localStorage";
}

/** Rough size of what this origin is holding, for the storage meter. */
export async function estimateBytes() {
  if (navigator.storage?.estimate) {
    try {
      const { usage } = await navigator.storage.estimate();
      if (usage) return usage;
    } catch { /* ignore */ }
  }
  try {
    const all = await getMany(Object.values(KEYS));
    return new Blob([JSON.stringify(all)]).size;
  } catch { return 0; }
}

/** Cross-tab + extension change notification. */
export function onChanged(fn) {
  if (hasExtension()) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local") fn(changes);
    });
    return () => {};
  }
  const handler = () => fn({});
  addEventListener("storage", handler);
  return () => removeEventListener("storage", handler);
}
