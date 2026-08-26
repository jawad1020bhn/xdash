/* =============================================================================
   build-slim — POSTS.json → data/posts.slim.json

   The capture export carries a `raw` field holding verbatim Twitter API
   payloads. Nothing in this product reads it, and it is 6.9 MB of a 17.7 MB
   file — 39% of every first visit. This script writes the projection the app
   actually renders, which is ~1.2 MB and parses in a fraction of the time.

   POSTS.json itself is left exactly as the extension wrote it. This is a
   read-side optimisation with a build step, not a change to the contract.

   Usage:  npm run build
   The app prefers data/posts.slim.json when present and falls back to
   POSTS.json automatically, so deleting the output is always safe.
   ============================================================================= */

import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "POSTS.json");
const OUT = join(ROOT, "data", "posts.slim.json");

const POST_FIELDS = [
  "tweet_id", "author_id", "author_name", "author_username", "author_profile_image_url",
  "text", "tweet_created_at", "captured_at", "capture_order", "canonical_url", "tweet_url",
  "like_count_at_capture", "retweet_count_at_capture", "reply_count_at_capture",
  "view_count_at_capture", "has_media", "media_types", "quoted_tweet_id",
  "retweeted_by_username", "urls_expanded", "has_links", "type", "state", "source_type",
];

const MEDIA_FIELDS = ["type", "url", "poster", "mp4", "aspect", "width",
  "height", "duration", "position", "alt"];

function main() {
  const source = statSync(SRC);
  const doc = JSON.parse(readFileSync(SRC, "utf8"));
  const bookmarks = Array.isArray(doc) ? doc : doc.bookmarks || doc.posts || [];
  if (!bookmarks.length) {
    console.error("No bookmarks found in POSTS.json — nothing written.");
    process.exit(1);
  }

  const slim = bookmarks.map((post) => {
    const out = {};
    for (const field of POST_FIELDS) {
      if (post[field] !== undefined && post[field] !== null) out[field] = post[field];
    }
    out.media_items = (post.media_items || []).map((m) => {
      const item = {};
      for (const field of MEDIA_FIELDS) {
        if (m[field] !== undefined && m[field] !== null) item[field] = m[field];
      }
      return item;
    });
    return out;
  });

  const payload = {
    export_version: 1,
    exported_at: doc.exported_at || new Date().toISOString(),
    derived_from: "POSTS.json",
    note: "Projection of POSTS.json without the unused `raw` payload. Regenerate with npm run build.",
    bookmarks: slim,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload));

  const outSize = statSync(OUT).size;
  const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
  console.log(`POSTS.json          ${mb(source.size)}`);
  console.log(`data/posts.slim.json ${mb(outSize)}  (${((1 - outSize / source.size) * 100).toFixed(1)}% smaller)`);
  console.log(`${slim.length} posts · ${slim.reduce((n, p) => n + p.media_items.length, 0)} media items`);
}

main();
