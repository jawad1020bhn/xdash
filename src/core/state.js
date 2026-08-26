/* =============================================================================
   state — one object, one subscription channel, one place truth lives.

   Views never hold state; they render a slice and subscribe to changes. The
   previous product kept 48 persisted preferences, most of which were decisions
   the product should simply have made. This keeps the ones a person would
   actually miss.
   ============================================================================= */

import { KEYS, getMany, setMany } from "./store.js";

/* ------------------------------------------------------------------ prefs -- */

export const PREF_DEFAULTS = {
  /* Appearance */
  themeMode: "system",      // system | dark | light
  density: "cozy",          // compact | cozy | roomy
  motion: "auto",           // auto | reduced

  /* Playback */
  autoplay: true,           // play the centred item in Watch
  startMuted: true,         // a feed that shouts at you is a feed you close
  loop: true,
  rememberProgress: true,
  defaultSpeed: 1,

  /* Library behaviour */
  markViewedOnOpen: true,
  showSeen: true,           // dim tiles you have already opened
  blurMedia: false,         // privacy blur until tapped
  landing: "home",

  /* Access — user-set, replacing the hard-coded password the old app shipped */
  pin: null,
};

export const LIBRARY_DEFAULTS = {
  viewed: {},        // mediaId -> timestamp
  archived: {},      // postId -> true
  starred: {},       // mediaId -> true
  progress: {},      // mediaId -> seconds
  hidden: {},        // mediaId -> true
};

/* ------------------------------------------------------------------ shape -- */

export const state = {
  ready: false,
  route: "home",
  index: { posts: new Map(), media: [], authors: [] },
  source: "none",
  prefs: { ...PREF_DEFAULTS },
  library: { ...LIBRARY_DEFAULTS },
  query: {
    search: "",
    kind: "all",           // all | video | photo
    author: null,
    sort: "recent",        // recent | oldest | liked | longest | shortest | random
    unseen: false,
    starred: false,
    includeHidden: false,
  },
  /* Transient UI, deliberately not persisted. */
  ui: {
    paletteOpen: false,
    viewer: { open: false, list: [], index: 0 },
    selecting: false,
    selected: new Set(),
    busy: null,
    loadMessage: "",
  },
};

/* -------------------------------------------------------------- subscribe -- */

const listeners = new Set();
let scheduled = false;
let lastSnapshot = "";

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Coalesces a burst of mutations into one repaint per frame. */
export function notify() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const fn of listeners) {
      try { fn(state); } catch (err) { console.error("[state] listener failed", err); }
    }
  });
}

/** Replaces state shallowly and schedules one repaint. */
export function set(patch) {
  Object.assign(state, patch);
  notify();
}

export function setQuery(patch) {
  Object.assign(state.query, patch);
  notify();
}

export function setUI(patch) {
  Object.assign(state.ui, patch);
  notify();
}

/* ----------------------------------------------------------------- prefs -- */

let saveTimer = 0;

export function setPrefs(patch) {
  Object.assign(state.prefs, patch);
  applyPrefs();
  notify();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    setMany({ [KEYS.prefs]: state.prefs }).catch(() => {});
  }, 200);
}

export function resetPrefs() {
  const pin = state.prefs.pin;   // a lock is a decision, not a preference
  Object.assign(state.prefs, PREF_DEFAULTS, { pin });
  applyPrefs();
  notify();
  setMany({ [KEYS.prefs]: state.prefs }).catch(() => {});
}

/** The preferences that change how the document itself renders. */
export function applyPrefs() {
  const root = document.documentElement;
  const dark = state.prefs.themeMode === "system"
    ? matchMedia?.("(prefers-color-scheme: dark)").matches ?? true
    : state.prefs.themeMode === "dark";
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.density = state.prefs.density;
  root.dataset.motion = state.prefs.motion === "reduced" ? "reduced" : "full";
  root.dataset.blur = state.prefs.blurMedia ? "on" : "off";

  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute("content", dark ? "#0B0B0E" : "#FBFBFD");
}

/* --------------------------------------------------------------- library -- */

let libTimer = 0;
function saveLibrary() {
  clearTimeout(libTimer);
  libTimer = setTimeout(() => {
    setMany({ [KEYS.library]: state.library }).catch(() => {});
  }, 250);
}

export function markViewed(mediaId, on = true) {
  if (on) state.library.viewed[mediaId] = Date.now();
  else delete state.library.viewed[mediaId];
  saveLibrary();
  notify();
}

export function markStarred(mediaId, on = !state.library.starred[mediaId]) {
  if (on) state.library.starred[mediaId] = true;
  else delete state.library.starred[mediaId];
  saveLibrary();
  notify();
  return on;
}

export function markArchived(postId, on = !state.library.archived[postId]) {
  if (on) state.library.archived[postId] = true;
  else delete state.library.archived[postId];
  saveLibrary();
  notify();
  return on;
}

export function markHidden(mediaId, on = !state.library.hidden[mediaId]) {
  if (on) state.library.hidden[mediaId] = true;
  else delete state.library.hidden[mediaId];
  saveLibrary();
  notify();
  return on;
}

export function saveProgress(mediaId, seconds) {
  if (!state.prefs.rememberProgress) return;
  if (seconds > 1) state.library.progress[mediaId] = Math.round(seconds);
  else delete state.library.progress[mediaId];
  saveLibrary();
}

export const isViewed = (id) => !!state.library.viewed[id];
export const isStarred = (id) => !!state.library.starred[id];
export const isArchived = (postId) => !!state.library.archived[postId];
export const isHidden = (id) => !!state.library.hidden[id];

/* ------------------------------------------------------------------ load -- */

export async function loadPersisted() {
  const data = await getMany([KEYS.prefs, KEYS.library]);
  state.prefs = { ...PREF_DEFAULTS, ...(data[KEYS.prefs] || {}) };
  state.library = { ...LIBRARY_DEFAULTS, ...(data[KEYS.library] || {}) };
  for (const key of Object.keys(LIBRARY_DEFAULTS)) {
    if (!state.library[key] || typeof state.library[key] !== "object") {
      state.library[key] = {};
    }
  }
  applyPrefs();
}

export async function persistBookmarks(list) {
  await setMany({ [KEYS.bookmarks]: list });
}

/* ------------------------------------------------------------- selection -- */

export function toggleSelected(id) {
  const next = new Set(state.ui.selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  state.ui.selected = next;
  state.ui.selecting = next.size > 0;
  notify();
  return next.has(id);
}

export function clearSelection() {
  if (!state.ui.selected.size && !state.ui.selecting) return;
  state.ui.selected = new Set();
  state.ui.selecting = false;
  notify();
}

export function selectAll(ids) {
  state.ui.selected = new Set(ids);
  state.ui.selecting = ids.length > 0;
  notify();
}
