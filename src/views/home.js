/* =============================================================================
   home v3 — the hybrid dashboard.

   Top: the numbers that answer "how is my archive doing?" — four KPI cards,
   a 12-month activity chart, the media mix and the creators you save most.
   Below: the media itself, in rails that are the same sections in the same
   order every single load. Predictability is the feature.
   ========================================================================== */

import { h, icon, clear, countUp } from "../ui/dom.js";
import { state, setQuery, subscribe } from "../core/state.js";
import { stats, post as postOf, topAuthors } from "../core/query.js";
import { timeline, pulse, mix, leaderboard, activityFeed } from "../core/analytics.js";
import { areaChart, donut, sparkline, meter } from "../ui/charts.js";
import { tile, rail, syncTiles } from "../ui/card.js";
import { avatar, fmtCount, fmtHours, fmtAgo, fmtDate, caption, thumbImg } from "../ui/media.js";
import { emptyState } from "../ui/feedback.js";
import { navigate } from "../shell.js";

const HUES = ["var(--hue-a)", "var(--hue-b)", "var(--hue-c)", "var(--hue-d)", "var(--hue-e)", "var(--hue-f)"];

let unsub = [];
let root = null;

export function mount(host) {
  root = h("section.dash.view-in");
  host.append(root);
  draw();
  unsub.push(subscribe(() => draw()));
}

export function unmount() {
  unsub.forEach((fn) => fn());
  unsub = [];
  root = null;
}

function draw() {
  if (!root) return;
  clear(root);
  const s = stats();

  if (!s.media) {
    emptyState(root, {
      icon: "database",
      title: "Your archive is empty",
      message: "Drop an export into the project as POSTS.json, or import one here. Everything stays on this device.",
      action: { label: "Import an export", onClick: () => import("./manage.js").then((m) => m.openManage()) },
    });
    return;
  }

  root.append(head(s), kpis(), panels(), spotlight(), rails(), foot(s));
  syncTiles(root);
}

/* ------------------------------------------------------------------ head -- */

function head(s) {
  const hour = new Date().getHours();
  const word = hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const p = pulse();

  return h("header.dash__head",
    h("div.dash__greet",
      h("span.t-label", { text: `${weekday()} · your archive` }),
      h("h1.t-display", {}, h("span", { text: word + ", " }), h("span.t-grad", { text: "collector" }), h("span", { text: "." })),
      h("p.dash__sub",
        h("b", { text: fmtCount(s.media) }), " items from ", h("b", { text: fmtCount(s.creators) }), " creators",
        h("span.sep", { text: "·" }),
        p.singleImport
          ? h("span", {}, "imported ", h("b", { text: fmtDate(p.importedAt) }), " in one go")
          : h("span", {}, h("b.t-num", { text: `${p.last30}` }), " saved in 30d"),
        !p.singleImport && p.delta30 ? h("span.sep", { text: "·" }) : null,
        !p.singleImport && p.delta30 ? h("span", { style: { color: p.delta30 >= 0 ? "var(--ok)" : "var(--warn)", fontWeight: 750 }, text: `${p.delta30 > 0 ? "+" : ""}${p.delta30}% vs prior 30` }) : null,
      ),
    ),
    h("div.dash__acts",
      h("button.btn", { type: "button", onclick: () => import("../shell.js").then(() => surprise()) }, icon("shuffle", 16), h("span", { text: "Surprise" })),
      h("button.btn.btn--pri", {
        type: "button",
        onclick: () => { setQuery({ unseen: true, sort: "recent", search: "", kind: "all", author: null, starred: false }); navigate("library"); },
      }, icon("spark", 16), h("span", { text: s.unseen ? `${fmtCount(s.unseen)} unopened` : "Browse all" })),
    ),
  );
}

function weekday() {
  return new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

function surprise() {
  const list = state.index.media;
  if (!list.length) return;
  import("../viewer.js").then(({ openViewer }) => openViewer([list[Math.floor(Math.random() * list.length)]], 0));
}

/* ------------------------------------------------------------------ kpis -- */

function kpis() {
  const s = stats();
  const p = pulse();

  const months = timeline();
  const cards = [
    { hue: HUES[0], label: "Items saved", value: s.media, foot: `${fmtCount(s.posts)} posts`, spark: months.map((b) => b.total) },
    { hue: HUES[1], label: "Creators", value: s.creators, foot: `top: ${fmtCount(topAuthors(1)[0]?.count || 0)} saves`, spark: creatorSpark() },
    { hue: HUES[2], label: "Watch time", value: s.watchTime, foot: `${fmtCount(s.videos)} videos`, spark: months.map((b) => b.videos), fmt: fmtHours },
    { hue: HUES[3], label: "Still unopened", value: s.unseen, foot: `${s.pctSeen}% explored`, spark: unseenSpark(), fmt: fmtCount },
  ];

  return h("div.kpis", cards.map((c) => {
    const val = h("span.kpi__val");
    countUp(val, c.value, { format: (n) => (c.fmt ? c.fmt(Math.round(n)) : fmtCount(Math.round(n))) });
    return h("div.kpi.hue", { style: { "--hue": c.hue } },
      h("span.kpi__lbl", h("span.t-label", { text: c.label })),
      val,
      h("div.kpi__foot",
        h("span", { text: c.foot }),
        sparkline(c.spark.length ? c.spark : [0, 1], { color: "currentColor" }),
      ),
    );
  }));
}

function creatorSpark() {
  const buckets = timeline();
  const seen = new Set();
  const out = buckets.map(() => 0);
  for (const item of state.index.media) {
    const t = new Date(postOf(item).capturedAt);
    const i = buckets.findIndex((b) => b.y === t.getFullYear() && b.m === t.getMonth());
    if (i < 0) continue;
    const u = postOf(item).author_username;
    if (!seen.has(u)) { seen.add(u); out[i]++; }
  }
  return out;
}

function unseenSpark() {
  const buckets = timeline();
  let remaining = stats().unseen;
  return buckets.map((b) => (remaining += b.total, remaining));
}

/* ---------------------------------------------------------------- panels -- */

function panels() {
  const a = mix();
  const total = a.reduce((s, x) => s + x.n, 0) || 1;
  const board = leaderboard(6);
  const maxCount = board[0]?.count || 1;

  const chartPanel = h("section.panel.hue", { style: { "--hue": HUES[0] } },
    h("div.panel__head",
      h("div.panel__title",
        h("h2", { text: "Posting activity" }),
        h("p", { text: "When the things you saved were originally posted" }),
      ),
    ),
    areaChart(timeline()),
    h("div.chart__legend",
      h("span", { style: { color: "var(--brand-1)" } }, h("i"), " everything"),
      h("span", { style: { color: "var(--brand-2)" } }, h("i"), " photos"),
    ),
  );

  const mixPanel = h("section.panel.hue", { style: { "--hue": HUES[2] } },
    h("div.panel__head",
      h("div.panel__title", h("h2", { text: "Media mix" }), h("p", { text: "How your archive breaks down" })),
    ),
    h("div.mix",
      donut(a),
      h("div.mix__rows", a.map((part, i) =>
        h("div.mix__row.hue", { style: { "--hue": HUES[i % HUES.length] } },
          h("span.t-label", { text: part.label }),
          meter(part.n / total, { hue: "var(--hue-c)" }),
          h("span.mix__n", { text: fmtCount(part.n) }),
        ))),
    ),
  );

  const boardPanel = h("section.panel.hue", { style: { "--hue": HUES[1] } },
    h("div.panel__head",
      h("div.panel__title", h("h2", { text: "Top creators" }), h("p", { text: `${stats().creators} people in your archive` })),
      h("button.btn.btn--sm.btn--ghost", { type: "button", text: "All", onclick: () => openCreators() }, icon("arrowRight", 14)),
    ),
    h("div.board", board.map((row, i) =>
      h("button.board__row", {
        type: "button",
        onclick: () => { setQuery({ author: row.username, search: "", unseen: false, starred: false }); navigate("library"); },
      },
        h("span.board__rank", { text: String(i + 1).padStart(2, "0") }),
        avatar(row.avatar, 36, row.name),
        h("span.board__who",
          h("b", { text: row.name || row.username }),
          h("span.board__bar", h("i", { style: { width: "0%" } })),
        ),
        h("span.board__n", { text: fmtCount(row.count) }),
      ))),
  );

  requestAnimationFrame(() => {
    boardPanel.querySelectorAll(".board__row").forEach((el, i) => {
      el.querySelector(".board__bar i").style.width = `${Math.round((board[i].count / maxCount) * 100)}%`;
    });
  });

  const feedPanel = h("section.panel.hue", { style: { "--hue": HUES[4] } },
    h("div.panel__head",
      h("div.panel__title", h("h2", { text: "Latest saves" }), h("p", { text: "The newest things in the vault" })),
    ),
    h("div.feed", activityFeed(8).map((item) => {
      const p = postOf(item);
      return h("button.feed__row", {
        type: "button",
        onclick: () => import("../viewer.js").then(({ openViewer }) => openViewer([item], 0)),
      },
        h("span.feed__thumb", thumbImg(item, p, { eager: false, sizes: "44px" })),
        h("span.feed__text",
          h("b", { text: caption(p, 60) || `@${p.author_username}` }),
          h("small", { text: `@${p.author_username} · ${item.kind}` }),
        ),
        h("span.feed__when", { text: fmtAgo(p.capturedAt) }),
      );
    })),
  );

  return h("div.dash__grid",
    h("div", { style: { display: "grid", gap: "var(--s-4)", alignContent: "start" } }, chartPanel, feedPanel),
    h("div", { style: { display: "grid", gap: "var(--s-4)", alignContent: "start" } }, mixPanel, boardPanel),
  );
}

function openCreators() {
  setQuery({ author: null, sort: "recent" });
  navigate("library");
}

/* ------------------------------------------------------------- spotlight -- */

function spotlight() {
  const item = unseenList()[0] || recentList()[0];
  if (!item) return null;
  const p = postOf(item);

  return h("section.hue", { style: { "--hue": HUES[0] } },
    h("div.rail__head",
      h("div.rail__title", h("span.swatch"), h("div", {}, h("h2", { text: "Spotlight" }), h("p", { text: "The newest thing you have not opened" }))),
    ),
    h("button.spot", {
      type: "button",
      onclick: () => import("../viewer.js").then(({ openViewer }) => openViewer(unseenList().length ? unseenList() : recentList(), 0)),
    },
      h("div.spot__media", thumbImg(item, p, { eager: true, sizes: "(max-width: 719px) 100vw, 900px" })),
      h("div.spot__scrim"),
      h("div.spot__body",
        h("span.spot__kicker", icon("spark", 12), " fresh"),
        h("p.spot__text", { text: caption(p, 180) || `Saved ${fmtAgo(p.capturedAt)}` }),
        h("div.spot__meta",
          avatar(p.author_profile_image_url, 24, p.author_name),
          h("span", { text: `@${p.author_username}` }),
          h("span", { text: "·" }),
          h("span", { text: fmtAgo(p.capturedAt) }),
          p.like_count_at_capture ? h("span", { style: { display: "inline-flex", gap: "4px", alignItems: "center" } }, icon("heart", 12), fmtCount(p.like_count_at_capture)) : null,
        ),
      ),
    ),
  );
}

/* ----------------------------------------------------------------- rails -- */

function rails() {
  const sections = [
    railBlock("Jump back in", "Saved and never opened", unseenList(), 12, HUES[1], { unseen: true, sort: "recent" }),
    railBlock("Most liked", "The posts that landed hardest", byLikes(), 12, HUES[0], { sort: "liked" }),
    railBlock("Long form", "Videos over three minutes", longForm(), 10, HUES[2], { sort: "longest", kind: "video" }),
    railBlock("Photo stories", "Posts with more than one image", multiPhoto(), 10, HUES[3], { kind: "photo", sort: "recent" }),
    railBlock("Recently saved", "Newest first", recentList(), 12, HUES[4], { sort: "recent" }),
  ].filter(Boolean);
  return h("div.rails", sections);
}

function railBlock(title, subtitle, items, limit, hue, query) {
  if (!items.length) return null;
  return h("section.hue", { style: { "--hue": hue } },
    h("div.rail__head",
      h("div.rail__title",
        h("span.swatch"),
        h("div", {}, h("h2", { text: title }), h("p", { text: subtitle })),
      ),
      h("button.rail__all", {
        type: "button",
        onclick: () => { setQuery({ search: "", author: null, starred: false, unseen: false, kind: "all", ...query }); navigate("library"); },
      }, "All", icon("arrowRight", 14)),
    ),
    rail(items.slice(0, limit), { label: title, eager: 2 }),
  );
}

/* ------------------------------------------------------------------ foot -- */

function foot(s) {
  return h("footer", { style: { display: "grid", gap: "var(--s-4)" } },
    h("button.btn.btn--block", { type: "button", onclick: () => navigate("library") },
      "Open the full library", icon("arrowRight", 16)),
    h("p.t-tiny", {
      style: { color: "var(--text-3)", textAlign: "center", paddingBottom: "var(--s-4)" },
      text: `${fmtCount(s.photos)} photos · ${fmtCount(s.videos)} videos · ${fmtHours(s.watchTime)} of runtime · everything indexed on this device`,
    }),
  );
}

/* --------------------------------------------------------------- queries -- */

const cache = {};
let cacheKey = "";

function fresh() {
  const key = `${state.index.media.length}:${Object.keys(state.library.viewed).length}`;
  if (key !== cacheKey) { cacheKey = key; Object.keys(cache).forEach((k) => delete cache[k]); }
  return cache;
}

function unseenList() {
  const c = fresh();
  if (!c.unseen) {
    c.unseen = state.index.media
      .filter((m) => !state.library.viewed[m.id] && !state.library.hidden[m.id] && !state.library.archived[m.postId])
      .sort((a, b) => postOf(b).capturedAt - postOf(a).capturedAt);
  }
  return c.unseen;
}
function recentList() {
  const c = fresh();
  if (!c.recent) {
    c.recent = state.index.media
      .filter((m) => !state.library.archived[m.postId] && !state.library.hidden[m.id])
      .sort((a, b) => postOf(b).capturedAt - postOf(a).capturedAt);
  }
  return c.recent;
}
function byLikes() {
  const c = fresh();
  if (!c.liked) {
    c.liked = recentList().slice().sort((a, b) => (postOf(b).like_count_at_capture || 0) - (postOf(a).like_count_at_capture || 0)).slice(0, 24);
  }
  return c.liked;
}
function longForm() {
  const c = fresh();
  if (!c.long) {
    c.long = state.index.media.filter((m) => m.kind !== "photo" && m.dur > 180 && !state.library.archived[m.postId]).sort((a, b) => b.dur - a.dur).slice(0, 20);
  }
  return c.long;
}
function multiPhoto() {
  const c = fresh();
  if (!c.multi) {
    c.multi = state.index.media.filter((m) => m.kind === "photo" && m.n > 1 && !state.library.archived[m.postId]).sort((a, b) => postOf(b).capturedAt - postOf(a).capturedAt).slice(0, 20);
  }
  return c.multi;
}
