/* =============================================================================
   insights v3.1 — the archive's numbers, off the main path.

   The owner's call: this is a media-first player, not a stats dashboard. So
   the counts and charts live one tap deep, behind Settings, and the front
   page stays media.
   ========================================================================== */

import { h, countUp } from "../ui/dom.js";
import { state } from "../core/state.js";
import { stats, post as postOf } from "../core/query.js";
import { timeline, mix, leaderboard } from "../core/analytics.js";
import { areaChart, donut, sparkline, meter } from "../ui/charts.js";
import { overlay } from "../ui/feedback.js";
import { avatar, fmtCount, fmtHours } from "../ui/media.js";

export function openInsights() {
  const s = stats();
  const sheet = overlay({ title: "Insights", size: "wide" });
  const c = sheet.content;

  /* ---- headline numbers, plain ---- */
  const months = timeline();
  c.append(h("div.ins",
    cell(fmtCount(s.media), "items", sparkline(months.map((b) => b.total)), s.media, fmtCount),
    cell(fmtCount(s.creators), "creators", sparkline(creatorSpark(months)), s.creators, fmtCount),
    cell(fmtHours(s.watchTime), "watch time", sparkline(months.map((b) => b.videos)), s.watchTime, fmtHours),
    cell(`${s.pctSeen}%`, "opened", sparkline(months.map((b) => b.total).reverse()), s.pctSeen, (n) => `${Math.round(n)}%`),
  ));

  /* ---- activity ---- */
  c.append(label("Activity"));
  c.append(areaChart(timeline()));
  c.append(h("div.chart__legend",
    h("span", { style: { color: "var(--brand-1)" } }, h("i"), " everything"),
    h("span", { style: { color: "var(--brand-2)" } }, h("i"), " photos"),
  ));

  /* ---- mix + creators ---- */
  const parts = mix();
  const total = parts.reduce((sum, x) => sum + x.n, 0) || 1;
  const board = leaderboard(8);
  const max = board[0]?.count || 1;

  c.append(label("Media mix"));
  c.append(h("div.mix",
    donut(parts),
    h("div.mix__rows", parts.map((part, i) =>
      h("div.mix__row.hue", { style: { "--hue": HUES[i % HUES.length] } },
        h("span.t-label", { text: part.label }),
        meter(part.n / total, { hue: "var(--hue-c)" }),
        h("span.mix__n", { text: fmtCount(part.n) }),
      ))),
  ));

  c.append(label("Top creators"));
  c.append(h("div.board", board.map((row, i) =>
    h("div.board__row", { style: { cursor: "default" } },
      h("span.board__rank", { text: String(i + 1).padStart(2, "0") }),
      avatar(row.avatar, 36, row.name),
      h("span.board__who",
        h("b", { text: row.name || row.username }),
        h("span.board__bar", h("i", { style: { width: `${Math.round((row.count / max) * 100)}%` } })),
      ),
      h("span.board__n", { text: fmtCount(row.count) }),
    ))));

  c.append(h("p.t-tiny", {
    style: { color: "var(--text-3)", padding: "var(--s-4) 4px 0" },
    text: `${fmtCount(s.photos)} photos · ${fmtCount(s.videos)} videos · ${fmtCount(s.posts)} posts · indexed on this device`,
  }));
}

const HUES = ["var(--hue-a)", "var(--hue-b)", "var(--hue-c)", "var(--hue-d)"];

function cell(value, lbl, spark, target, format) {
  const b = h("b.t-num", { text: value });
  if (typeof target === "number") countUp(b, target, { format });
  return h("div.ins__cell",
    b,
    h("small", { text: lbl }),
    h("span.ins__spark", spark),
  );
}

function label(text) {
  return h("div.sheet__group", h("span.t-label", { text }));
}

function creatorSpark(months) {
  const seen = new Set();
  const out = months.map(() => 0);
  for (const item of state.index.media) {
    const t = new Date(postOf(item).createdAt || postOf(item).capturedAt);
    const i = months.findIndex((b) => b.y === t.getFullYear() && b.m === t.getMonth());
    if (i < 0) continue;
    const u = postOf(item).author_username;
    if (!seen.has(u)) { seen.add(u); out[i]++; }
  }
  return out;
}
