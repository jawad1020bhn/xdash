/* =============================================================================
   analytics v3 — the dashboard brain.

   Pure reads over the projected index, memoised on the same signals the rest
   of the query layer uses. Everything here is a reduction over ≤ a few
   thousand items, so it runs in single-digit milliseconds and stays on the
   main thread — a worker would cost more in messaging than it saves.
   ========================================================================== */

import { state, isViewed } from "./state.js";
import { post } from "./query.js";

const MONTHS = 12;
const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let memoKey = "";
let memo = {};

function key() {
  return `${state.index.media.length}:${Object.keys(state.library.viewed).length}`;
}

function compute() {
  const media = state.index.media;
  const now = new Date();

  /* ---- 12-month timeline, by when the post was originally posted ----
     A capture is usually one import session, so "saves per month" is a single
     spike. The shape people actually recognise is when the content was made. */
  const buckets = [];
  for (let i = MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      y: d.getFullYear(),
      m: d.getMonth(),
      label: MONTH_LABEL[d.getMonth()],
      photos: 0,
      videos: 0,
      total: 0,
    });
  }
  const first = buckets[0];
  const index = new Map(buckets.map((b, i) => [`${b.y}-${b.m}`, i]));

  for (const item of media) {
    const t = new Date(post(item).createdAt || post(item).capturedAt);
    const i = index.get(`${t.getFullYear()}-${t.getMonth()}`);
    if (i === undefined) continue;
    buckets[i].total++;
    if (item.kind === "photo") buckets[i].photos++; else buckets[i].videos++;
  }
  /* A month before the archive started is noise; trim leading empties but
     keep at least six columns so the chart never looks broken. */
  while (buckets.length > 6 && buckets[0].total === 0 && buckets[1].total === 0) buckets.shift();
  void first;

  /* ---- 30-day pulse ---- */
  /* ---- capture shape: one import session, or a habit ---- */
  let capMin = Infinity, capMax = 0;
  for (const item of media) {
    const t = post(item).capturedAt || 0;
    if (t) { capMin = Math.min(capMin, t); capMax = Math.max(capMax, t); }
  }
  const spanDays = media.length ? (capMax - capMin) / 86400000 : 0;
  const singleImport = spanDays < 3;

  /* ---- 30-day posting pulse ---- */
  const day = 86400000;
  const nowMs = Date.now();
  let last30 = 0, prev30 = 0, last7 = 0;
  for (const item of media) {
    const age = Math.floor((nowMs - (post(item).createdAt || 0)) / day);
    if (age < 0) continue;
    if (age < 30) last30++;
    else if (age < 60) prev30++;
    if (age < 7) last7++;
  }
  const delta30 = prev30 ? Math.round(((last30 - prev30) / prev30) * 100) : (last30 ? 100 : 0);

  /* ---- media mix ---- */
  let photos = 0, videos = 0, gifs = 0;
  for (const item of media) {
    if (item.kind === "photo") photos++;
    else if (item.kind === "gif") gifs++;
    else videos++;
  }

  /* ---- creator leaderboard with engagement ---- */
  const byUser = new Map();
  for (const item of media) {
    const p = post(item);
    const u = p.author_username || "unknown";
    let row = byUser.get(u);
    if (!row) {
      row = { username: u, name: p.author_name || u, avatar: p.author_profile_image_url || "", count: 0, likes: 0 };
      byUser.set(u, row);
    }
    row.count++;
    row.likes += p.like_count_at_capture || 0;
  }
  const leaderboard = [...byUser.values()].sort((a, b) => b.count - a.count);

  /* ---- recent activity feed ---- */
  const feed = media
    .slice()
    .sort((a, b) => post(b).capturedAt - post(a).capturedAt)
    .slice(0, 14);

  /* ---- records ---- */
  let top = null;
  for (const item of media) {
    const l = post(item).like_count_at_capture || 0;
    if (!top || l > top.likes) top = { item, likes: l };
  }
  let longest = null;
  for (const item of media) {
    if (item.kind === "photo") continue;
    if (!longest || item.dur > longest.dur) longest = item;
  }

  /* ---- seen pace (last 30 opened, for the "caught up" meter) ---- */
  let seenRecent = 0;
  for (const item of media.slice(-200)) if (isViewed(item.id)) seenRecent++;

  return { buckets, last30, prev30, last7, delta30, photos, videos, gifs, leaderboard, feed, top, longest, seenRecent, singleImport, importedAt: capMax, spanDays };
}

export function analytics() {
  const k = key();
  if (k !== memoKey) { memo = compute(); memoKey = k; }
  return memo;
}

/* Convenience slices ------------------------------------------------------- */

export const timeline = () => analytics().buckets;
export const pulse = () => {
  const a = analytics();
  return { last30: a.last30, prev30: a.prev30, last7: a.last7, delta30: a.delta30, singleImport: a.singleImport, importedAt: a.importedAt };
};
export const mix = () => {
  const a = analytics();
  return [
    { id: "photos", label: "Photos", n: a.photos, hue: "var(--hue-c)" },
    { id: "videos", label: "Videos", n: a.videos, hue: "var(--hue-b)" },
    { id: "gifs", label: "GIFs", n: a.gifs, hue: "var(--hue-d)" },
  ].filter((x) => x.n > 0);
};
export const leaderboard = (limit = 8) => analytics().leaderboard.slice(0, limit);
export const activityFeed = (limit = 10) => analytics().feed.slice(0, limit);
export const records = () => {
  const a = analytics();
  return { top: a.top, longest: a.longest };
};
