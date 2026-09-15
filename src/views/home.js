/* =============================================================================
   home v3.2 — the curated front page.

   Not a search surface (that is Library's job) and not a dashboard (Insights
   owns the numbers). Home is an edit of the archive: a greeting, the clip you
   were halfway through, one spotlight, five rails, your top creators, and a
   door into the full library. Everything here is a tile or a button.
   ========================================================================== */

import { h, icon, clear } from "../ui/dom.js";
import { state, subscribe, setQuery } from "../core/state.js";
import { post as postOf, stats, topAuthors } from "../core/query.js";
import { mediaBox, avatar, thumbImg, fmtCount, fmtDuration, fmtAgo, fmtHours } from "../ui/media.js";
import { rail } from "../ui/card.js";
import { emptyState } from "../ui/feedback.js";
import { navigate } from "../shell.js";

let unsub = [];
let root = null;

export function mount(host) {
  root = h("section.home.view-in");
  host.append(root);
  draw();
  unsub.push(subscribe(draw));
}

export function unmount() {
  unsub.forEach((fn) => fn());
  unsub = [];
  root = null;
  unseenMemo = null;
  unseenKey = "";
}

/* ------------------------------------------------------------------ draw -- */

function draw() {
  if (!root) return;
  clear(root);

  if (!state.index.media.length) {
    emptyState(root, {
      icon: "database",
      title: "Your archive is empty",
      message: "Drop an export into the project as POSTS.json, or import one here. Everything stays on this device.",
      action: { label: "Import", onClick: () => import("./manage.js").then((m) => m.openManage()) },
    });
    return;
  }

  const s = stats();
  root.append(greeting(s));

  const resume = resumeRow();
  if (resume) root.append(resume);

  const spot = spotlight();
  if (spot) root.append(spot);

  const rails = [
    ["Jump back in", "Things you saved and never opened", unseenList(), 12],
    ["Most liked", "The posts that landed hardest", byLikes(), 12],
    ["Long form", "Videos over three minutes", longForm(), 10],
    ["Photo stories", "Posts with more than one image", multiPhoto(), 10],
    ["Recently saved", "Newest first", recentList(), 12],
  ];
  rails.forEach(([title, subtitle, items, limit], i) => {
    const sec = railSection(title, subtitle, items, limit, i + 1);
    if (sec) root.append(sec);
  });

  const cr = creators(rails.length + 1);
  if (cr) root.append(cr);

  root.append(footer(s));
}

/* -------------------------------------------------------------- greeting -- */

function greeting(s) {
  const hour = new Date().getHours();
  const word = hour < 5 ? "Still up" : hour < 12 ? "Good morning"
    : hour < 18 ? "Good afternoon" : "Good evening";
  const [first, ...rest] = word.split(" ");
  const today = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  return h("header.greet",
    h("div.greet__text",
      h("span.t-kicker", { text: `Private collection · ${today}` }),
      h("h1.t-display", `${first} `, h("em", { text: `${rest.join(" ")}.` })),
      h("p.greet__line",
        h("b.t-num", { text: fmtCount(s.media) }), " items from ",
        h("b.t-num", { text: fmtCount(s.creators) }), " creators",
        s.unseen ? h("span", { text: ` · ${fmtCount(s.unseen)} unopened` })
          : " · you've seen it all")),
    h("button.greet__cta.btn.btn--pri", {
      type: "button",
      onclick: () => {
        setQuery({ unseen: true, sort: "recent", search: "", kind: "all", author: null, starred: false });
        navigate("library");
      },
    },
      icon("spark", 17),
      h("span", { text: s.unseen ? "Show unopened" : "Browse everything" })));
}

/* ------------------------------------------------------------- spotlight -- */

function spotlight() {
  const list = unseenList();
  const items = list.length ? list : recentList();
  const item = items[0];
  if (!item) return null;
  const p = postOf(item);
  return h("section.spotlight",
    h("div.spotlight__head",
      h("h2.t-h2", { text: state.prefs.blurMedia ? "Saved for later" : "Fresh in your archive" }),
      h("button.spotlight__all", {
        type: "button",
        onclick: () => { setQuery({ unseen: true, sort: "recent" }); navigate("library"); },
      },
        h("span", { text: "See all" }), icon("arrowRight", 15))),
    h("div.spotlight__frame",
      h("button.spotlight__media", {
        type: "button",
        "aria-label": `Open item by @${p.author_username}`,
        onclick: () => import("../viewer.js").then(({ openViewer }) => openViewer(items, 0)),
      },
        mediaBox(item, p, { eager: true, sizes: "min(92vw, 1100px)", className: "spotlight__box" })),
      h("div.spotlight__foot",
      avatar(p.author_profile_image_url, 28, p.author_name),
      h("span.spotlight__who",
        h("b", { text: p.author_name || p.author_username }),
        h("small", { text: `@${p.author_username}` })),
      p.like_count_at_capture
        ? h("span.spotlight__likes.t-num", icon("heart", 12), fmtCount(p.like_count_at_capture))
        : null,
      h("p.spotlight__why.t-small", {
          text: p.text ? p.text.replace(/\s+/g, " ").slice(0, 160) : `Saved ${fmtAgo(p.capturedAt)}`,
        }))));
}

/* ----------------------------------------------------------------- rails -- */

function railSection(title, subtitle, items, limit, index = 0) {
  if (!items.length) return null;
  return h("section.block",
    h("div.block__head",
      h("div.block__title",
        index ? h("span.block__eyebrow", h("span.block__idx.t-num", { text: String(index).padStart(2, "0") })) : null,
        h("h2.t-h2", { text: title }),
        h("p.t-small", { text: subtitle })),
      h("button.block__all", { type: "button", onclick: () => openAll(title) },
        h("span", { text: "All" }), icon("arrowRight", 15))),
    rail(items.slice(0, limit), { label: title, eager: 2 }));
}

/** Each "All" lands on the Library query that reproduces its rail. */
function openAll(title) {
  const map = {
    "Jump back in": { unseen: true, sort: "recent" },
    "Most liked": { sort: "liked", unseen: false },
    "Long form": { sort: "longest", kind: "video" },   // kind video = not-photo; matches the rail predicate
    "Photo stories": { kind: "photo", sort: "recent" },
    "Recently saved": { sort: "recent" },
  };
  setQuery({ search: "", author: null, starred: false, ...(map[title] || { sort: "recent" }) });
  navigate("library");
}

/* --------------------------------------------------------------- creators -- */

function creators(index = 0) {
  const list = topAuthors(14).filter((a) => a.count >= 2);
  if (list.length < 3) return null;
  return h("section.block",
    h("div.block__head",
      h("div.block__title",
        index ? h("span.block__eyebrow", h("span.block__idx.t-num", { text: String(index).padStart(2, "0") })) : null,
        h("h2.t-h2", { text: "Creators you save most" }),
        h("p.t-small", { text: `${stats().creators} in your archive` }))),
    h("div.creators", list.map((a) => h("button.creator", {
      type: "button",
      title: `@${a.username} · ${a.count} items`,
      onclick: () => {
        setQuery({ author: a.username, search: "", unseen: false, starred: false });
        navigate("library");
      },
    },
      avatar(a.avatar, 58, a.name),
      h("span.creator__name", { text: a.name || a.username }),
      h("span.creator__count.t-tiny.t-num", { text: String(a.count) })))));
}

/* ---------------------------------------------------------------- footer -- */

const stat = (label, value) =>
  h("div.stat", h("b.t-num", { text: value }), h("small", { text: label }));

function footer(s) {
  return h("footer.home__foot",
    h("div.home__stats",
      stat("Photos", fmtCount(s.photos)),
      stat("Videos", fmtCount(s.videos)),
      stat("Watch time", fmtHours(s.watchTime)),
      stat("Seen", `${s.pctSeen}%`)),
    h("button.btn.btn--ghost.btn--block", { type: "button", onclick: () => navigate("library") },
      "Open the full library", icon("arrowRight", 16)));
}

/* --------------------------------------------------------------- queries -- */

let unseenMemo = null;
let unseenKey = "";
function unseenList() {
  const lib = state.library;
  const key = [
    state.index.media.length,
    Object.keys(lib.viewed).length,
    Object.keys(lib.hidden).length,
    Object.keys(lib.archived).length,
  ].join(":");
  if (unseenKey === key && unseenMemo) return unseenMemo;
  unseenMemo = state.index.media
    .filter((m) => !lib.viewed[m.id] && !lib.hidden[m.id] && !lib.archived[m.postId])
    .sort((a, b) => postOf(b).capturedAt - postOf(a).capturedAt);
  unseenKey = key;
  return unseenMemo;
}

const live = (m) => !state.library.hidden[m.id] && !state.library.archived[m.postId];

function byLikes() {
  return state.index.media.filter(live)
    .sort((a, b) => (postOf(b).like_count_at_capture || 0) - (postOf(a).like_count_at_capture || 0))
    .slice(0, 24);
}

function longForm() {
  return state.index.media
    .filter((m) => live(m) && m.kind !== "photo" && m.dur > 180)
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 20);
}

function multiPhoto() {
  return state.index.media
    .filter((m) => live(m) && m.kind === "photo" && m.n > 1)
    .sort((a, b) => postOf(b).capturedAt - postOf(a).capturedAt)
    .slice(0, 20);
}

function recentList() {
  return state.index.media.filter(live)
    .sort((a, b) => postOf(b).capturedAt - postOf(a).capturedAt)
    .slice(0, 24);
}

/* ---------------------------------------------------------------- resume -- */

/** The item you were part-way through, if there is one. */
function resumeRow() {
  const entries = Object.entries(state.library.progress)
    .filter(([, seconds]) => seconds > 5)
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;

  const [id, seconds] = entries[0];
  const item = state.index.media.find((m) => m.id === id);
  if (!item) return null;
  const p = postOf(item);
  const pct = item.dur ? Math.min(100, (seconds / item.dur) * 100) : 0;

  return h("button.resume", {
    type: "button",
    onclick: () => import("../viewer.js").then(({ openViewer }) => openViewer([item], 0)),
  },
    h("span.resume__thumb",
      thumbImg(item, p, { eager: true, sizes: "96px" }),
      h("span.resume__play", icon("play", 16))),
    h("span.resume__text",
      h("small.t-label", { text: "Continue watching" }),
      h("b", { text: p.text ? p.text.replace(/\s+/g, " ").slice(0, 80) : `@${p.author_username}` }),
      h("span.resume__bar", h("span", { style: { width: `${pct}%` } })),
      h("small", { text: `${fmtDuration(seconds)} of ${fmtDuration(item.dur)} · @${p.author_username}` })),
  );
}
