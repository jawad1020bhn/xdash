/* =============================================================================
   Local library store

   Reads the extension capture schema (xBookmarks, xCaptureState, xDeadLetters)
   and keeps dashboard-owned state (viewed, archived, progress, prefs) beside it.
   Never mutates capture/scrape behaviour.
   ============================================================================= */
(function (root) {
  "use strict";

  const KEYS = {
    bookmarks: "xBookmarks",
    capture: "xCaptureState",
    dead: "xDeadLetters",
    library: "xLibraryState",
    prefs: "xDashboardPrefs",
  };

  const PREF_DEFAULTS = {
    visualization: "rails",
    collection: "all",
    sort: "newest_posted",
    search: "",
    filters: {},
    themeScheme: "system",
    contrast: "standard",
    seed: null,
    variant: "vibrant",
    tileSize: "medium",
    density: "comfortable",
    layoutMode: "natural",
    groupBy: "none",
    showMetadata: true,
    fullCaptions: false,
    autoplayPreviews: true,
    autoplayCenteredOnly: true,
    alwaysMuted: true,
    rememberProgress: true,
    defaultSpeed: 1,
    loopGifs: true,
    loopVideos: false,
    pip: true,
    reduceMotion: false,
    largeControls: false,
    alwaysAlt: false,
    markViewedOnOpen: true,
    restoreSession: true,
    shuffleSeed: 1,
    shuffleStrategy: "smart",
    shuffleScope: "results",
    lastItemId: null,
    lastScroll: 0,
    scrollPositions: {},
    railScrolls: {},
    recentSearches: [],
    discoveryCycle: 1,
    discoverySeed: 1,
    savedViews: [],
    workspace: "discover",
    lastWorkspace: "discover",
    landing: "discover",
    viewerFilmstrip: false,
    viewerState: "standard",
    viewerPaneWidth: 372,
    cinemaMode: false,
    focusMode: false,
    customSeed: "",
  };

  const LIBRARY_DEFAULTS = {
    viewed: {},
    archived: {},
    progress: {},
    lastOpened: {},
    surfaced: {},
  };

  function hasChrome() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  function isFileProtocol() {
    return location.protocol === "file:";
  }

  /* ==========================================================================
     Web storage backend (outside the extension)

     localStorage tops out around 5 MB per origin, which a real capture library
     blows through immediately — that is the QuotaExceededError people hit when
     saving bookmarks. IndexedDB has no such practical ceiling and works on
     file:// too, so it is the primary backend here; localStorage stays as a
     last-resort fallback (and as the source for a one-time migration).
     ========================================================================== */
  const IDB_NAME = "xbookmark";
  const IDB_STORE = "kv";
  const PING_KEY = "xStorageRev";      // tiny localStorage ping for cross-tab sync

  let dbPromise = null;
  let idbBroken = false;

  function openDb() {
    if (idbBroken || typeof indexedDB === "undefined") return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(IDB_NAME, 1);
      } catch {
        idbBroken = true;
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { idbBroken = true; resolve(null); };
      req.onblocked = () => { idbBroken = true; resolve(null); };
    });
    return dbPromise;
  }

  function idbTx(db, mode, run) {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(IDB_STORE, mode);
      } catch (err) {
        reject(err);
        return;
      }
      const store = tx.objectStore(IDB_STORE);
      let result;
      try {
        result = run(store);
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function idbGet(db, key) {
    const req = await idbTx(db, "readonly", (store) => ({ __req: store.get(key) }));
    return req;
  }

  async function idbSetMany(db, entries) {
    await idbTx(db, "readwrite", (store) => {
      entries.forEach(([k, v]) => store.put(v, k));
    });
  }

  async function idbDelMany(db, keys) {
    await idbTx(db, "readwrite", (store) => {
      keys.forEach((k) => store.delete(k));
    });
  }

  /* Local (JSON) helpers — also the fallback path. */
  function lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function reportStorageError(err, keys) {
    const quota = err && (err.name === "QuotaExceededError" ||
      err.name === "NS_ERROR_DOM_QUOTA_REACHED" || err.code === 22 || err.code === 1014);
    try {
      window.dispatchEvent(new CustomEvent("xb-storage-error", {
        detail: { error: err, quota: !!quota, keys: keys || [] },
      }));
    } catch { /* no CustomEvent — nothing else to do */ }
    if (quota) {
      console.warn("[xbookmark] Storage quota exceeded while saving " + (keys || []).join(", ") +
        ". Data kept in memory for this session; export a backup to keep it.");
    } else {
      console.warn("[xbookmark] Storage write failed:", err);
    }
  }

  /* One-time move of any legacy localStorage payloads into IndexedDB. Clearing
     them afterwards is what actually frees the 5 MB that was overflowing. */
  let migrated = false;
  async function migrateFromLocal(db) {
    if (migrated) return;
    migrated = true;
    for (const key of Object.values(KEYS)) {
      let raw = null;
      try { raw = localStorage.getItem(key); } catch { break; }
      if (raw == null) continue;
      try {
        const existing = await idbGet(db, key);
        if (existing === undefined) await idbSetMany(db, [[key, JSON.parse(raw)]]);
        localStorage.removeItem(key);
      } catch { /* leave the localStorage copy in place */ }
    }
  }

  async function get(keys) {
    if (hasChrome()) {
      return await chrome.storage.local.get(keys);
    }
    const out = {};
    const db = await openDb();
    if (db) {
      await migrateFromLocal(db);
      for (const k of Object.keys(keys)) {
        try {
          const v = await idbGet(db, k);
          out[k] = v === undefined ? lsGet(k, keys[k]) : v;
        } catch {
          out[k] = lsGet(k, keys[k]);
        }
      }
      return out;
    }
    for (const k of Object.keys(keys)) out[k] = lsGet(k, keys[k]);
    return out;
  }

  function ping() {
    try { localStorage.setItem(PING_KEY, String(Date.now())); } catch { /* fine */ }
  }

  async function set(obj) {
    if (hasChrome()) return chrome.storage.local.set(obj);
    const entries = Object.entries(obj);
    const db = await openDb();
    if (db) {
      try {
        await idbSetMany(db, entries);
        ping();
        return;
      } catch (err) {
        reportStorageError(err, Object.keys(obj));
        return;
      }
    }
    for (const [k, v] of entries) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (err) {
        reportStorageError(err, [k]);
        return;
      }
    }
  }

  async function remove(keys) {
    if (hasChrome()) return chrome.storage.local.remove(keys);
    const db = await openDb();
    if (db) {
      try { await idbDelMany(db, keys); } catch (err) { reportStorageError(err, keys); }
    }
    keys.forEach((k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
    ping();
  }

  function onChanged(fn) {
    if (hasChrome()) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local") fn(changes);
      });
      return;
    }
    window.addEventListener("storage", () => fn({}));
  }

  async function loadAll() {
    const data = await get({
      [KEYS.bookmarks]: [],
      [KEYS.capture]: null,
      [KEYS.dead]: [],
      [KEYS.library]: LIBRARY_DEFAULTS,
      [KEYS.prefs]: PREF_DEFAULTS,
    });
    // Outside the extension (localStorage mode), allow loading from empty files
    // without using the Import UI. Priority:
    // 1. chrome.storage (already loaded)
    // 2. localStorage (already loaded)
    // 3. window.XB_DEMO.bookmarks (js/demo.js — user can paste JSON there)
    // 4. ./POSTS.json (raw JSON array or {bookmarks: []}) — user can paste there
    if (!hasChrome() && (!data[KEYS.bookmarks] || !data[KEYS.bookmarks].length)) {
      if (root.XB_DEMO && Array.isArray(root.XB_DEMO.bookmarks) && root.XB_DEMO.bookmarks.length) {
        data[KEYS.bookmarks] = root.XB_DEMO.bookmarks;
      } else if (!isFileProtocol()) {
        // Try to fetch a JSON file the user can paste into. Only over http(s):
        // fetch() of a file:// URL is blocked by CORS in every browser, and the
        // failed attempt is logged by the network stack before we can catch it,
        // so under file:// we don't ask at all.
        const here = location.pathname.replace(/[^/]*$/, "");
        const urls = ["./POSTS.json"];
        if (!/\/dashboard\/$/.test(here)) urls.push("./dashboard/POSTS.json");
        for (const u of urls) {
          try {
            const res = await fetch(u, { cache: "no-store" });
            if (!res.ok) continue;
            const json = await res.json();
            const arr = Array.isArray(json) ? json : (json && Array.isArray(json.bookmarks) ? json.bookmarks : null);
            if (arr && arr.length) { data[KEYS.bookmarks] = arr; break; }
          } catch { /* try next */ }
        }
      } else {
        console.info("[xbookmark] Opened from file:// — POSTS.json can't be read here. " +
          "Paste your posts into js/demo.js, use Manage → Import, or serve the folder " +
          "over http (e.g. `python -m http.server`).");
      }
    }
    const library = Object.assign({}, LIBRARY_DEFAULTS, data[KEYS.library] || {});
    library.viewed = library.viewed || {};
    library.archived = library.archived || {};
    library.progress = library.progress || {};
    library.lastOpened = library.lastOpened || {};
    library.surfaced = library.surfaced || {};
    const prefs = Object.assign({}, PREF_DEFAULTS, data[KEYS.prefs] || {});
    // backfill for upgrades
    if (!Array.isArray(prefs.recentSearches)) prefs.recentSearches = [];
    if (!prefs.railScrolls || typeof prefs.railScrolls !== "object") prefs.railScrolls = {};
    if (!Array.isArray(prefs.savedViews)) prefs.savedViews = [];
    if (!prefs.layoutMode) prefs.layoutMode = "natural";
    if (!prefs.groupBy) prefs.groupBy = "none";
    return {
      bookmarks: Array.isArray(data[KEYS.bookmarks]) ? data[KEYS.bookmarks] : [],
      capture: data[KEYS.capture] || null,
      dead: Array.isArray(data[KEYS.dead]) ? data[KEYS.dead] : [],
      library,
      prefs,
    };
  }

  async function savePrefs(prefs) {
    await set({ [KEYS.prefs]: prefs });
  }

  async function saveLibrary(library) {
    await set({ [KEYS.library]: library });
  }

  async function saveBookmarks(list) {
    await set({ [KEYS.bookmarks]: list });
  }

  async function estimateBytes() {
    if (hasChrome() && chrome.storage.local.getBytesInUse) {
      try {
        return await chrome.storage.local.getBytesInUse(null);
      } catch {
        /* fall through */
      }
    }
    try {
      const all = await loadAll();
      return new Blob([JSON.stringify(all)]).size;
    } catch {
      return 0;
    }
  }

  async function backendName() {
    if (hasChrome()) return "extension";
    const db = await openDb();
    return db ? "indexeddb" : "localstorage";
  }

  root.XBStore = {
    KEYS,
    PREF_DEFAULTS,
    LIBRARY_DEFAULTS,
    loadAll,
    savePrefs,
    saveLibrary,
    saveBookmarks,
    remove,
    onChanged,
    estimateBytes,
    hasChrome,
    isFileProtocol,
    backendName,
  };
})(window);
