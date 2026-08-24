/* =============================================================================
   Application state

   One store, one notify. Views never read chrome.storage or recompute the
   library themselves — they read `S` and subscribe. Derived data (flattened
   items, filtered set, collections, stats) is memoised behind a revision
   counter so a keystroke in search doesn't re-flatten thousands of records.

   The storage boundary from the capture side is preserved exactly: bookmarks
   are the extension's data, xLibraryState/xDashboardPrefs are ours.
   ============================================================================= */
(function (root) {
  "use strict";

  const WORKSPACES = ["discover", "library", "watch", "settings", "manage", "capture"];

  const SORTS = [
    { id: "newest_posted", label: "Newest posted", group: "Time" },
    { id: "oldest_posted", label: "Oldest posted", group: "Time" },
    { id: "capture_order", label: "Capture order", group: "Time" },
    { id: "recently_viewed", label: "Recently viewed", group: "Activity" },
    { id: "forgotten", label: "Longest untouched", group: "Activity" },
    { id: "most_liked", label: "Most liked", group: "Engagement" },
    { id: "most_reposted", label: "Most reposted", group: "Engagement" },
    { id: "most_viewed", label: "Most viewed", group: "Engagement" },
    { id: "most_replied", label: "Most replied", group: "Engagement" },
    { id: "engagement", label: "Engagement", group: "Engagement" },
    { id: "longest", label: "Longest", group: "Duration" },
    { id: "shortest", label: "Shortest", group: "Duration" },
  ];

  /* Random is the DEFAULT Library ordering — a stable, session-scoped random
     sequence rather than a deterministic sort. Two modes: Balanced (the smart
     mode — varied creators, posts and media types) and Pure random. Distinct
     from the deterministic Sort options, which live in the overflow menu. */
  const SHUFFLE_STRATEGIES = [
    { id: "balanced", label: "Balanced", hint: "Varied creators, posts and media types" },
    { id: "random", label: "Pure random", hint: "No logic, just chance" },
  ];
  const SHUFFLE_SCOPES = [
    { id: "results", label: "Current results", hint: "Shuffle within your filtered set" },
    { id: "library", label: "Entire library", hint: "Shuffle across everything you've saved" },
  ];

  const SIZES = ["compact", "comfortable", "large"];

  /* Legacy pref values from the previous dashboard generation. */
  const SIZE_MIGRATION = { small: "compact", medium: "comfortable", large: "large" };
  const LAYOUT_MIGRATION = { uniform: "grid", natural: "natural", masonry: "natural" };

  const state = {
    ready: false,
    bookmarks: [],
    capture: null,
    dead: [],
    library: null,
    prefs: null,

    workspace: "discover",
    search: "",
    sort: "shuffle",
    shuffleStrategy: "balanced",
    shuffleScope: "results",
    filters: {},
    layout: "natural",
    size: "comfortable",
    groupBy: "none",
    selection: new Set(),

    /* transient */
    filtersOpen: false,
    viewerIndex: -1,
    viewerList: null,
    viewerState: "standard",
    focusCollection: null,
  };

  let rev = 0;                 // bumped whenever the item universe changes
  let cache = { rev: -1 };
  let discoveryCache = { cycle: -1, rev: -1, result: null };  // per-cycle recommendation memo
  const listeners = new Set();
  let saveTimer = null;

  /* ------------------------------------------------------------- lifecycle -- */
  async function load() {
    const data = await root.XBStore.loadAll();
    state.bookmarks = data.bookmarks;
    state.capture = data.capture;
    state.dead = data.dead;
    state.library = data.library;
    state.prefs = data.prefs;

    state.search = data.prefs.search || "";
    /* Random is the default Library ordering: a stable, session-scoped random
       order rather than a deterministic sort. Existing choices (including the
       deterministic sorts) are preserved; only a missing/invalid preference
       falls back to Random. */
    const validSort = data.prefs.sort === "shuffle" || SORTS.some((s) => s.id === data.prefs.sort);
    state.sort = validSort ? data.prefs.sort : "shuffle";
    state.shuffleStrategy = SHUFFLE_STRATEGIES.some((s) => s.id === data.prefs.shuffleStrategy) ? data.prefs.shuffleStrategy : "balanced";
    state.shuffleScope = SHUFFLE_SCOPES.some((s) => s.id === data.prefs.shuffleScope) ? data.prefs.shuffleScope : "results";
    state.filters = data.prefs.filters && typeof data.prefs.filters === "object" ? data.prefs.filters : {};
    state.layout = LAYOUT_MIGRATION[data.prefs.layoutMode] || "natural";
    state.size = SIZE_MIGRATION[data.prefs.tileSize] || "comfortable";
    state.groupBy = data.prefs.groupBy || "none";
    /* Where the app opens. "Continue where I left off" restores the last
       workspace; otherwise the chosen landing view wins. Watch is never a
       landing view — you opt into immersion, you don't wake up inside it. */
    state.viewerState = ["focus", "standard", "context"].includes(data.prefs.viewerState)
      ? data.prefs.viewerState : "standard";

    const landing = data.prefs.landing || "discover";
    const last = WORKSPACES.includes(data.prefs.workspace) ? data.prefs.workspace : "discover";
    state.workspace = landing === "last"
      ? last
      : (WORKSPACES.includes(landing) ? landing : "discover");
    state.ready = true;
    rev++;
    return state;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify(reason) {
    listeners.forEach((fn) => {
      try { fn(reason || "change"); } catch (err) { console.error(err); }
    });
  }

  /* -------------------------------------------------------------- derived -- */
  function compute() {
    const seed = state.prefs ? state.prefs.shuffleSeed : 1;
    if (cache.rev === rev &&
        cache.search === state.search &&
        cache.sort === state.sort &&
        cache.shuffleSeed === seed &&
        cache.filterKey === JSON.stringify(state.filters)) {
      return cache;
    }

    const L = root.XBLibrary;
    const all = (cache.rev === rev && cache.all) ? cache.all : L.flatten(state.bookmarks, state.library);
    const filtered = L.applyFilters(all, state.filters, state.search);
    const sorted = L.sortItems(filtered, state.sort, seed, state.shuffleStrategy);

    cache = {
      rev,
      search: state.search,
      sort: state.sort,
      shuffleSeed: seed,
      filterKey: JSON.stringify(state.filters),
      all,
      filtered: sorted,
      stats: L.stats(state.bookmarks, all, state.dead),
      collections: (cache.rev === rev && cache.collections) ? cache.collections : L.collections(all, Date.now()),
      authors: (cache.rev === rev && cache.authors) ? cache.authors : L.authors(all),
    };
    return cache;
  }

  /* The recommendation result is memoised per discovery CYCLE, not per render.
     A cycle changes only on a fresh dashboard open or an explicit "Refresh
     discoveries" — so opening the viewer, toggling filters elsewhere, or any
     ordinary re-render leaves Discover stable, while every load surfaces new
     things. Exposure is recorded once per cycle (idempotently). */
  function computeDiscovery() {
    const cycle = Number(state.prefs.discoveryCycle) || 1;
    const seed = Number(state.prefs.discoverySeed) || 1;
    if (discoveryCache.cycle === cycle && discoveryCache.rev === rev && discoveryCache.result) {
      return discoveryCache.result;
    }
    const all = compute().all;
    if (state.library && typeof state.library.surfaced !== "object") state.library.surfaced = {};
    const surfaced = state.library.surfaced || (state.library.surfaced = {});
    const result = root.XBLibrary.discover(all, { surfaced, cycle, seed, now: Date.now() });
    recordExposure(result.surfacedIds || [], cycle, surfaced);
    discoveryCache = { cycle, rev, result };
    return result;
  }

  /* Mark what Discover surfaced this cycle, idempotently (a re-compute within
     the same cycle never double-counts). Persists so the memory survives a
     reload — this is the rotation's long-term memory. */
  function recordExposure(ids, cycle, surfaced) {
    let changed = false;
    for (const id of ids) {
      const rec = surfaced[id] || { count: 0, last: 0, engaged: false };
      if (rec.last !== cycle) { rec.count = (rec.count || 0) + 1; rec.last = cycle; changed = true; }
      surfaced[id] = rec;
    }
    if (changed) persistLibraryNow();
  }

  const derived = {
    get all() { return compute().all; },
    get items() { return compute().filtered; },
    get stats() { return compute().stats; },
    get collections() { return compute().collections; },
    get authors() { return compute().authors; },
    get discovery() { return computeDiscovery(); },
    collection(id) { return compute().collections.find((c) => c.id === id) || null; },
  };

  /* ------------------------------------------------------------- mutation -- */
  function schedulePersist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      Object.assign(state.prefs, {
        workspace: state.workspace,
        search: state.search,
        sort: state.sort,
        shuffleStrategy: state.shuffleStrategy,
        shuffleScope: state.shuffleScope,
        filters: state.filters,
        layoutMode: state.layout,
        tileSize: state.size,
        groupBy: state.groupBy,
      });
      root.XBStore.savePrefs(state.prefs);
    }, 220);
  }

  function persistLibraryNow() { root.XBStore.saveLibrary(state.library); }

  /** Update prefs and repaint. `patch` may be partial. */
  function setPrefs(patch, reason) {
    Object.assign(state.prefs, patch);
    root.XBStore.savePrefs(state.prefs);
    notify(reason || "prefs");
  }

  function set(patch, reason) {
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (state[key] === value) continue;
      state[key] = value;
      changed = true;
    }
    if (!changed && reason !== "force") return;
    schedulePersist();
    notify(reason || "state");
  }

  function setFilter(key, value) {
    const next = Object.assign({}, state.filters);
    if (value == null || value === "" || value === false) delete next[key];
    else next[key] = value;
    state.filters = next;
    state.selection.clear();
    schedulePersist();
    notify("filters");
  }

  /* Multi-value filter: OR within a group, AND across groups. Toggling a value
     adds or removes it from that key's array without touching other keys, so
     "Photo OR Video" composes naturally with "AND unseen AND @abc". */
  function toggleFilter(key, value) {
    if (value == null || value === "") return;
    const next = Object.assign({}, state.filters);
    const cur = Array.isArray(next[key]) ? next[key].slice()
      : (next[key] != null && next[key] !== "" ? [next[key]] : []);
    const at = cur.indexOf(value);
    if (at >= 0) cur.splice(at, 1); else cur.push(value);
    if (!cur.length) delete next[key]; else next[key] = cur.length === 1 ? cur[0] : cur;
    state.filters = next;
    state.selection.clear();
    schedulePersist();
    notify("filters");
  }

  /* Whether a filter value is active — accepts both single and array storage. */
  function filterHas(key, value) {
    const v = state.filters[key];
    if (v == null) return false;
    return Array.isArray(v) ? v.indexOf(value) >= 0 : v === value;
  }

  function clearFilters() {
    state.filters = {};
    state.selection.clear();
    schedulePersist();
    notify("filters");
  }

  /* Shuffle is an action, not a sort. Each call rolls a new random seed so
     "Shuffle now" and "Reshuffle" always produce a fresh order, while the
     strategy and scope persist as preferences. Scope "library" widens the pool
     to everything by clearing the active filters and search. */
  /* Reshuffle: roll a new stable random order for the Library's default
     ordering. The mode (strategy) can be set at the same time. Filters are
     ALWAYS preserved — Random browses within whatever you've filtered to. */
  function shuffle(opts) {
    const o = opts || {};
    if (o.strategy) state.shuffleStrategy = o.strategy;
    state.prefs.shuffleSeed = (Number(state.prefs.shuffleSeed) || 0) + 1;
    root.XBStore.savePrefs(state.prefs);
    state.sort = "shuffle";
    state.selection.clear();
    notify("shuffle");
  }

  /* A discovery cycle is the unit of "fresh content". It advances on a genuine
     new dashboard session and on an explicit Refresh — never on an ordinary
     re-render. Each cycle rolls a new recommendation seed, which reorders the
     dynamic sections (Fresh discoveries, Rediscover) while the stable ones
     barely move. */
  function newDiscoveryCycle() {
    state.prefs.discoveryCycle = (Number(state.prefs.discoveryCycle) || 0) + 1;
    state.prefs.discoverySeed = Math.floor(Math.random() * 1e9) + 1;
    discoveryCache = { cycle: -1, rev: -1, result: null };
    root.XBStore.savePrefs(state.prefs);
    notify("discovery");
  }

  /* "Shown" vs "engaged": opening something Discover surfaced marks it engaged,
     so it gets a normal cooldown and a small quality signal, instead of being
     treated as ignored. A no-op for items never surfaced. */
  function markEngaged(id) {
    const rec = state.library && state.library.surfaced && state.library.surfaced[id];
    if (rec && !rec.engaged) {
      rec.engaged = true;
      persistLibraryNow();
    }
  }

  /* Roll a fresh random seed for the Library's default ordering. Called once
     per session on boot, so every fresh dashboard load shows a new random
     order — but the order stays stable while you browse, and never reshuffles
     on an ordinary re-render. (Reshuffle is the explicit, in-session version.) */
  function rollSessionRandom() {
    state.prefs.shuffleSeed = Math.floor(Math.random() * 1e9) + 1;
    root.XBStore.savePrefs(state.prefs);
  }

  function activeFilterCount() {
    return Object.keys(state.filters).reduce((n, k) => {
      const v = state.filters[k];
      if (v == null || v === "" || v === false) return n;
      return n + (Array.isArray(v) ? v.length : 1);
    }, 0);
  }

  /* ------------------------------------------------- library state writes -- */
  function markViewed(id) {
    if (!state.prefs.markViewedOnOpen) return;
    const now = Date.now();
    state.library.viewed[id] = state.library.viewed[id] || now;
    state.library.lastOpened[id] = now;
    rev++;
    persistLibraryNow();
  }

  function setSeen(ids, seen) {
    ids.forEach((id) => {
      if (seen) state.library.viewed[id] = state.library.viewed[id] || Date.now();
      else { delete state.library.viewed[id]; delete state.library.lastOpened[id]; }
    });
    rev++;
    persistLibraryNow();
    notify("library");
  }

  function setArchived(ids, archived) {
    ids.forEach((id) => {
      if (archived) state.library.archived[id] = Date.now();
      else delete state.library.archived[id];
    });
    rev++;
    persistLibraryNow();
    notify("library");
  }

  /** Progress API handed to the video controller. */
  const progress = {
    get(id) { return state.prefs.rememberProgress ? state.library.progress[id] || null : null; },
    set(id, t, d) {
      if (!state.prefs.rememberProgress) return;
      state.library.progress[id] = { t, d };
      root.XBStore.saveLibrary(state.library);
    },
    clear(id) {
      delete state.library.progress[id];
      root.XBStore.saveLibrary(state.library);
    },
  };

  /** Delete media entries, dropping now-empty posts. Returns an undo snapshot. */
  function removeItems(ids) {
    const set = new Set(ids);
    const snapshot = {
      bookmarks: structuredClone(state.bookmarks),
      library: structuredClone(state.library),
    };
    const L = root.XBLibrary;
    state.bookmarks = state.bookmarks
      .map((post) => {
        if (!post || !Array.isArray(post.media_items)) return post;
        const kept = post.media_items.filter((m, i) => {
          const pos = Number(m && m.position) || i + 1;
          return !set.has(L.mediaId(post.tweet_id, pos));
        });
        if (kept.length === post.media_items.length) return post;
        return Object.assign({}, post, { media_items: kept });
      })
      .filter((post) => post && Array.isArray(post.media_items) && post.media_items.length);

    ids.forEach((id) => {
      delete state.library.viewed[id];
      delete state.library.archived[id];
      delete state.library.progress[id];
      delete state.library.lastOpened[id];
    });

    rev++;
    state.selection.clear();
    root.XBStore.saveBookmarks(state.bookmarks);
    persistLibraryNow();
    notify("data");
    return snapshot;
  }

  function restore(snapshot) {
    state.bookmarks = snapshot.bookmarks;
    state.library = snapshot.library;
    rev++;
    root.XBStore.saveBookmarks(state.bookmarks);
    persistLibraryNow();
    notify("data");
  }

  function replaceBookmarks(list) {
    state.bookmarks = list;
    rev++;
    root.XBStore.saveBookmarks(list);
    notify("data");
  }

  function reloadFromStorage() {
    return load().then(() => notify("data"));
  }

  /* -------------------------------------------------------- recent search -- */
  function pushRecentSearch(term) {
    const q = String(term || "").trim();
    if (q.length < 2) return;
    const list = (state.prefs.recentSearches || []).filter((x) => x.toLowerCase() !== q.toLowerCase());
    list.unshift(q);
    state.prefs.recentSearches = list.slice(0, 8);
    root.XBStore.savePrefs(state.prefs);
  }

  /* ------------------------------------------------------------ selection -- */
  function toggleSelection(id) {
    if (state.selection.has(id)) state.selection.delete(id);
    else state.selection.add(id);
    notify("selection");
  }

  function clearSelection() {
    if (!state.selection.size) return;
    state.selection.clear();
    notify("selection");
  }

  function selectAll(ids) {
    ids.forEach((id) => state.selection.add(id));
    notify("selection");
  }

  /* ------------------------------------------------------------ url sync --- */
  function writeUrl() {
    const p = new URLSearchParams();
    if (state.workspace !== "discover") p.set("w", state.workspace);
    if (state.search) p.set("q", state.search);
    if (state.sort !== "newest_posted") p.set("sort", state.sort);
    if (Object.keys(state.filters).length) p.set("f", JSON.stringify(state.filters));
    if (state.focusCollection) p.set("c", state.focusCollection);
    const hash = p.toString();
    if (location.hash.slice(1) === hash) return;
    /* file:// pages are unique security origins: history.replaceState with a
       URL — even a bare hash — is rejected as a cross-origin load. There we
       assign location.hash directly instead; http(s) keeps clean replaceState. */
    if (location.protocol === "file:") {
      try { location.hash = hash; } catch (_) { /* ignore */ }
      return;
    }
    const url = hash ? "#" + hash : location.pathname + location.search;
    try {
      history.replaceState(null, "", url);
    } catch (_) {
      try { location.hash = hash; } catch (_2) { /* ignore */ }
    }
  }

  function readUrl() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (!p.toString()) return false;
    if (p.has("w") && WORKSPACES.includes(p.get("w"))) state.workspace = p.get("w");
    if (p.has("q")) state.search = p.get("q");
    if (p.has("sort")) state.sort = p.get("sort");
    if (p.has("c")) state.focusCollection = p.get("c");
    if (p.has("f")) {
      try { state.filters = JSON.parse(p.get("f")) || {}; } catch (_) { /* ignore */ }
    }
    return true;
  }

  root.S = state;
  root.XBState = {
    WORKSPACES, SORTS, SIZES, SHUFFLE_STRATEGIES, SHUFFLE_SCOPES,
    state, derived,
    load, subscribe, notify, set, setPrefs, setFilter, toggleFilter, filterHas, clearFilters, activeFilterCount, shuffle,
    markViewed, setSeen, setArchived, progress, removeItems, restore, replaceBookmarks,
    reloadFromStorage, pushRecentSearch, toggleSelection, clearSelection, selectAll,
    newDiscoveryCycle, markEngaged, rollSessionRandom,
    writeUrl, readUrl,
    bump() { rev++; },
  };
})(window);
