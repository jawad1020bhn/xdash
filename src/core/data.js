/* =============================================================================
   data — turning an X bookmark export into something a phone can hold.

   The export this app reads is 17.7 MB, and 6.9 MB of that (39%) is a `raw`
   field holding verbatim Twitter API payloads that no screen in this product
   has ever read. The UI needs about 1.2 MB. So this module:

     1. prefers a pre-projected data/posts.slim.json if the repo has one
     2. otherwise fetches the export and projects it here, dropping `raw` and
        every other field the UI does not use
     3. caches the projection in IndexedDB, keyed on the file's HTTP
        fingerprint, so a reload parses zero bytes of JSON

   The on-disk contract is untouched: POSTS.json stays exactly as the capture
   extension writes it. This is a read-side projection, not a migration.
   ============================================================================= */

import { KEYS, getMany, setMany } from "./store.js";

/* Fields kept per post. Everything else in the export is discarded. */
const POST_FIELDS = [
  "tweet_id", "author_id", "author_name", "author_username", "author_profile_image_url",
  "text", "tweet_created_at", "captured_at", "capture_order", "canonical_url", "tweet_url",
  "like_count_at_capture", "retweet_count_at_capture", "reply_count_at_capture",
  "view_count_at_capture", "has_media", "media_types", "quoted_tweet_id",
  "retweeted_by_username", "urls_expanded", "has_links", "type", "state", "source_type",
];

/* Media URLs on pbs.twimg.com accept a size name; without one, X serves a
   ~1200px image to a 170px thumbnail slot. `name=small` caps that at 680px.
   NOTE: this CDN behaviour could not be verified from the sandbox (outbound
   network to pbs.twimg.com is blocked here), so media.js falls back to the
   bare URL on error — a wrong guess degrades to today's behaviour, not worse. */
export function sizedImage(url, name) {
  if (!url || !/pbs\.twimg\.com\//.test(url)) return url;
  if (/[?&]name=/.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + "name=" + name;
}

/** Profile images use a _normal / _bigger / _200x200 filename convention. */
export function sizedAvatar(url, variant = "_200x200") {
  if (!url) return "";
  return url.replace(/_(normal|bigger|mini|reasonably_small|\d+x\d+)\.(jpg|jpeg|png|gif|webp)$/i,
    `${variant}.$2`);
}

const MEDIA_FIELDS = ["type", "url", "poster", "mp4", "hls", "aspect", "width",
  "height", "duration", "position", "alt"];

function projectPost(raw) {
  const post = {};
  for (const field of POST_FIELDS) {
    const value = raw[field];
    if (value !== undefined && value !== null) post[field] = value;
  }
  post.id = String(raw.tweet_id ?? raw.original_tweet_id ?? Math.random());
  post.createdAt = Date.parse(raw.tweet_created_at) || 0;
  post.capturedAt = Date.parse(raw.captured_at) || post.createdAt;
  return post;
}

function projectMedia(rawMedia, postId, count) {
  const kind = rawMedia.type === "animated_gif" ? "gif" : (rawMedia.type === "video" ? "video" : "photo");
  const width = rawMedia.width || 0;
  const height = rawMedia.height || 0;
  return {
    id: `${postId}:${rawMedia.position ?? 1}`,
    postId,
    kind,
    // For photos `url` is the image itself; for video `url` is a stand-in
    // thumbnail, and `mp4` is the stream. Both shapes exist in one export.
    thumb: rawMedia.type === "photo" ? rawMedia.url : rawMedia.poster,
    full: rawMedia.type === "photo" ? rawMedia.url : rawMedia.poster,
    video: rawMedia.mp4 || null,
    poster: rawMedia.poster || null,
    aspect: rawMedia.aspect > 0 ? rawMedia.aspect : (width && height ? width / height : 1),
    w: width,
    h: height,
    dur: (rawMedia.duration || 0) / 1000,   // ms -> s
    alt: rawMedia.alt || "",
    pos: rawMedia.position ?? 1,
    n: count,
  };
}

/**
 * The whole projection. Returns posts (keyed), media (flat array, the thing
 * every grid iterates), and a lowercase haystack per post for search.
 */
export function project(bookmarks) {
  const posts = new Map();
  const media = [];
  const authors = new Map();

  for (const raw of bookmarks) {
    if (!raw) continue;
    const post = projectPost(raw);
    posts.set(post.id, post);

    const username = post.author_username || "unknown";
    if (!authors.has(username)) {
      authors.set(username, {
        username,
        name: post.author_name || username,
        avatar: sizedAvatar(post.author_profile_image_url),
        count: 0,
      });
    }
    const author = authors.get(username);
    author.count++;

    const items = Array.isArray(raw.media_items) ? raw.media_items : [];
    post.mediaIds = [];
    for (const item of items) {
      const projected = projectMedia(item, post.id, items.length);
      media.push(projected);
      post.mediaIds.push(projected.id);
    }

    post.haystack = [
      post.text, post.author_name, post.author_username,
      ...(post.urls_expanded || []).map((u) => (u && (u.expanded_url || u.url)) || ""),
    ].filter(Boolean).join(" ").toLowerCase();
  }

  return { posts, media, authors: [...authors.values()] };
}

/* ==========================================================================
   Loading
   ========================================================================== */

/** Accepts a bare array, {bookmarks:[]}, or {posts:[]}. */
function extractBookmarks(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.bookmarks)) return json.bookmarks;
  if (Array.isArray(json?.posts)) return json.posts;
  if (Array.isArray(json?.data)) return json.data;
  return [];
}

async function fingerprint(url) {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (!res.ok) return null;
    return [
      res.headers.get("last-modified") || "",
      res.headers.get("content-length") || "",
      res.headers.get("etag") || "",
    ].join("|");
  } catch { return null; }
}

async function tryJson(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/**
 * Loads and projects the archive.
 *
 * Returns { posts, media, authors, source, fromCache }.
 *
 * The cache path is the point: what is stored is the *projection* (~1.2 MB of
 * structured data), not the 17.7 MB export, and it is keyed on the file's HTTP
 * fingerprint. An unchanged file therefore costs one HEAD request and zero
 * JSON parsing on reload.
 */
export async function loadIndex(onProgress) {
  const cached = (await getMany([KEYS.index]))[KEYS.index];

  const SOURCES = ["./data/posts.slim.json", "./POSTS.json"];
  for (const url of SOURCES) {
    const stamp = await fingerprint(url);
    if (stamp === null) continue;

    if (cached && cached.source === url && cached.stamp === stamp && cached.media?.length) {
      const index = revive(cached);
      return { ...index, source: url, fromCache: true };
    }

    onProgress?.(`Reading ${url.split("/").pop()}…`);
    const json = await tryJson(url);
    const bookmarks = extractBookmarks(json);
    if (!bookmarks.length) continue;

    onProgress?.("Indexing…");
    const index = project(bookmarks);
    // Cache the compact projection, not the export.
    await setMany({ [KEYS.index]: {
      source: url,
      stamp,
      posts: [...index.posts.values()],
      media: index.media,
      authors: index.authors,
    } }).catch(() => { /* a full cache is not fatal */ });

    return { ...index, source: url, fromCache: false };
  }

  /* Nothing on the network — but a previously imported library is still in
     storage, and that beats an empty screen. */
  const stored = (await getMany([KEYS.bookmarks]))[KEYS.bookmarks];
  if (Array.isArray(stored) && stored.length) {
    return { ...project(stored), source: "storage", fromCache: false };
  }
  return { ...project([]), source: "none", fromCache: false };
}

/** Structured clone gives back plain objects; put the Map back. */
function revive(cached) {
  return {
    posts: new Map(cached.posts.map((p) => [p.id, p])),
    media: cached.media,
    authors: cached.authors,
  };
}

/** Drops the projection cache — used after an import or a "reset" action. */
export async function invalidateIndex() {
  const { removeMany } = await import("./store.js");
  await removeMany([KEYS.index]);
}

