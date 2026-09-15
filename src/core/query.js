/* =============================================================================
   query v3 — filtering, sorting, search and headline stats over the index.

   1,205 items is small enough for a straight pass: one filter, one sort,
   memoised on a signature that changes only when the inputs do. No index, no
   worker, no machinery.
   ========================================================================== */

import { state, isViewed, isStarred, isArchived, isHidden } from "./state.js";

const SORTS = {
  recent:   (a, b) => post(b).capturedAt - post(a).capturedAt || a.pos - b.pos,
  oldest:   (a, b) => post(a).createdAt - post(b).createdAt || a.pos - b.pos,
  liked:    (a, b) => (post(b).like_count_at_capture || 0) - (post(a).like_count_at_capture || 0),
  reposted: (a, b) => (post(b).retweet_count_at_capture || 0) - (post(a).retweet_count_at_capture || 0),
  longest:  (a, b) => b.dur - a.dur,
  shortest: (a, b) => (a.dur || 1e9) - (b.dur || 1e9),
};

export const SORT_LABELS = {
  recent: "Recently saved",
  oldest: "Oldest first",
  liked: "Most liked",
  reposted: "Most reposted",
  longest: "Longest",
  shortest: "Shortest",
  random: "Shuffled",
};

export const SORT_IDS = Object.keys(SORT_LABELS);

const EMPTY_POST = { capturedAt: 0, createdAt: 0, text: "", author_username: "", like_count_at_capture: 0 };

export function post(media) {
  return state.index.posts.get(media.postId) || EMPTY_POST;
}

/* Fisher–Yates with a session-stable seed, so "shuffled" does not reshuffle
   every time something unrelated repaints. */
let shuffleSeed = Math.random() * 1e9;
export function reshuffle() { shuffleSeed = Math.random() * 1e9; memoKey = ""; }

function seededShuffle(list) {
  const out = list.slice();
  let seed = shuffleSeed;
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* -------------------------------------------------------------- search ---- */

/**
 * Terms are ANDed; a leading "-" negates; quoted phrases match literally.
 * Substring, not fuzzy: for an archive you own, people remember exact words.
 */
export function parseSearch(input) {
  const tokens = [];
  const re = /(-?)"([^"]+)"|(-?\S+)/g;
  let m;
  while ((m = re.exec(input.trim()))) {
    const negate = (m[1] || m[3] || "").startsWith("-");
    const term = (m[2] ?? m[3] ?? "").replace(/^-/, "").toLowerCase();
    if (term) tokens.push({ term, negate });
  }
  return tokens;
}

function matchesTokens(p, tokens) {
  for (const { term, negate } of tokens) {
    if (p.haystack.includes(term) === negate) return false;
  }
  return true;
}

/* -------------------------------------------------------------- results --- */

let memoKey = "";
let memoValue = [];

function signature() {
  const q = state.query;
  return [
    state.index.media.length,
    q.search, q.kind, q.author, q.sort, q.unseen, q.starred, q.includeHidden,
    Object.keys(state.library.archived).length,
    Object.keys(state.library.hidden).length,
    Object.keys(state.library.starred).length,
    q.unseen || q.starred ? Object.keys(state.library.viewed).length : 0,
    q.sort === "random" ? shuffleSeed : 0,
  ].join("~");
}

export function results() {
  const key = signature();
  if (key === memoKey) return memoValue;

  const q = state.query;
  const tokens = q.search ? parseSearch(q.search) : null;
  const out = [];

  for (const item of state.index.media) {
    if (!q.includeHidden && isHidden(item.id)) continue;
    if (isArchived(item.postId)) continue;
    if (q.kind === "photo" && item.kind !== "photo") continue;
    if (q.kind === "video" && item.kind === "photo") continue;
    if (q.unseen && isViewed(item.id)) continue;
    if (q.starred && !isStarred(item.id)) continue;
    if (q.author && post(item).author_username !== q.author) continue;
    if (tokens && !matchesTokens(post(item), tokens)) continue;
    out.push(item);
  }

  memoValue = q.sort === "random" ? seededShuffle(out) : out.sort(SORTS[q.sort] || SORTS.recent);
  memoKey = key;
  return memoValue;
}

export const count = () => results().length;

/* ---------------------------------------------------------------- stats --- */

let statsMemoKey = "";
let statsValue = null;

export function stats() {
  const key = [
    state.index.media.length,
    Object.keys(state.library.viewed).length,
    Object.keys(state.library.starred).length,
    Object.keys(state.library.archived).length,
  ].join("~");
  if (key === statsMemoKey) return statsValue;

  const media = state.index.media;
  let photos = 0, videos = 0, gifs = 0, seconds = 0, seen = 0, likes = 0;
  const seenPosts = new Set();
  for (const item of media) {
    if (item.kind === "photo") photos++;
    else if (item.kind === "gif") gifs++;
    else { videos++; seconds += item.dur || 0; }
    if (isViewed(item.id)) { seen++; seenPosts.add(item.postId); }
    likes += post(item).like_count_at_capture || 0;
  }
  statsValue = {
    posts: state.index.posts.size,
    media: media.length,
    photos,
    videos,
    gifs,
    creators: state.index.authors.length,
    seen,
    unseen: media.length - seen,
    starred: Object.keys(state.library.starred).length,
    watchTime: seconds,
    pctSeen: media.length ? Math.round((seen / media.length) * 100) : 0,
    likes,
  };
  statsMemoKey = key;
  return statsValue;
}

/** Authors ranked by share of the archive. */
export function topAuthors(limit = 24) {
  return state.index.authors.slice().sort((a, b) => b.count - a.count).slice(0, limit);
}

export function authorOf(username) {
  return state.index.authors.find((a) => a.username === username) || null;
}

/** Media by one author, newest first. */
export function byAuthor(username) {
  return state.index.media
    .filter((m) => post(m).author_username === username)
    .sort(SORTS.recent);
}

/** The first post of a media item's parent, for captions. */
export const textOf = (media, len = 180) => {
  const t = (post(media).text || "").replace(/\s+/g, " ").trim();
  return t.length > len ? `${t.slice(0, len)}…` : t;
};
