/* =============================================================================
   query — filtering, sorting and search over the projected index.

   Runs over 1,205 media items. That is small enough for a straight pass, so
   there is deliberately no index, no web worker and no incremental machinery
   here: one filter, one sort, memoised on a signature that changes only when
   the inputs do.
   ============================================================================= */

import { state, isViewed, isStarred, isArchived, isHidden } from "./state.js";

const SORTS = {
  recent:   (a, b) => post(b).capturedAt - post(a).capturedAt || a.pos - b.pos,
  oldest:   (a, b) => post(a).createdAt - post(b).createdAt || a.pos - b.pos,
  liked:    (a, b) => (post(b).like_count_at_capture || 0) - (post(a).like_count_at_capture || 0),
  reposted: (a, b) => (post(b).retweet_count_at_capture || 0) - (post(a).retweet_count_at_capture || 0),
  viewed:   (a, b) => (post(b).view_count_at_capture || 0) - (post(a).view_count_at_capture || 0),
  longest:  (a, b) => b.dur - a.dur,
  shortest: (a, b) => (a.dur || 1e9) - (b.dur || 1e9),
};

export const SORT_LABELS = {
  recent: "Recently saved",
  oldest: "Oldest posts",
  liked: "Most liked",
  reposted: "Most reposted",
  viewed: "Most viewed",
  longest: "Longest video",
  shortest: "Shortest video",
  random: "Shuffled",
};

export function post(media) {
  return state.index.posts.get(media.postId) || EMPTY_POST;
}
const EMPTY_POST = { capturedAt: 0, createdAt: 0, text: "", author_username: "" };

/* Fisher–Yates with a session-stable seed, so a shuffle does not reshuffle
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

/* -------------------------------------------------------------- search -- */

/**
 * Terms are ANDed; a leading "-" negates. Quoted phrases match literally.
 * Deliberately substring-based rather than fuzzy: for an archive you already
 * own, people remember exact words, and fuzzy matching returns confident
 * nonsense.
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

function matchesTokens(post_, tokens) {
  for (const { term, negate } of tokens) {
    const hit = post_.haystack.includes(term);
    if (hit === negate) return false;
  }
  return true;
}

/* -------------------------------------------------------------- results -- */

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
    if (q.kind !== "all") {
      if (q.kind === "photo" && item.kind !== "photo") continue;
      if (q.kind === "video" && item.kind === "photo") continue;
    }
    if (q.unseen && isViewed(item.id)) continue;
    if (q.starred && !isStarred(item.id)) continue;
    if (q.author) {
      const p = post(item);
      if (p.author_username !== q.author) continue;
    }
    if (tokens) {
      const p = post(item);
      if (!p.haystack || !matchesTokens(p, tokens)) continue;
    }
    out.push(item);
  }

  if (q.sort === "random") memoValue = seededShuffle(out);
  else out.sort(SORTS[q.sort] || SORTS.recent), memoValue = out;

  memoKey = key;
  return memoValue;
}

/** The same list narrowed to what a grid actually needs to lay out. */
export function count() {
  return results().length;
}

/* ---------------------------------------------------------------- stats -- */

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
  let photos = 0, videos = 0, seconds = 0, seen = 0;
  for (const item of media) {
    if (item.kind === "photo") photos++;
    else { videos++; seconds += item.dur || 0; }
    if (isViewed(item.id)) seen++;
  }
  statsValue = {
    posts: state.index.posts.size,
    media: media.length,
    photos,
    videos,
    creators: state.index.authors.length,
    seen,
    unseen: media.length - seen,
    starred: Object.keys(state.library.starred).length,
    watchTime: seconds,
    pctSeen: media.length ? Math.round((seen / media.length) * 100) : 0,
  };
  statsMemoKey = key;
  return statsValue;
}

/** Authors ranked by how much of the archive they account for. */
export function topAuthors(limit = 24) {
  return state.index.authors
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** Media by a single author, newest first. */
export function byAuthor(username) {
  return state.index.media
    .filter((m) => post(m).author_username === username)
    .sort(SORTS.recent);
}
