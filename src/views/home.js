/* =============================================================================
   home v3.1 — a media-first front page.

   No dashboard, no numbers: a continue-watching row when there is something
   to continue, a filter chip row, and the archive itself in one windowed
   grid. The same surface language as the feeds it archives.
   ========================================================================== */

import { h, icon, clear } from "../ui/dom.js";
import { state, subscribe } from "../core/state.js";
import { post as postOf } from "../core/query.js";
import { createGrid } from "../ui/grid.js";
import { syncTiles } from "../ui/card.js";
import { thumbImg, fmtDuration } from "../ui/media.js";
import { emptyState } from "../ui/feedback.js";

const FILTERS = [
  { id: "recent", label: "Recent" },
  { id: "unopened", label: "Unopened" },
  { id: "videos", label: "Videos" },
  { id: "photos", label: "Photos" },
  { id: "starred", label: "Starred" },
];

let unsub = [];
let root = null;
let grid = null;
let filter = "recent";
let lastKey = "";

export function mount(host) {
  root = h("section.home.view-in");
  host.append(root);
  draw();
  unsub.push(subscribe(onState));
}

export function unmount() {
  unsub.forEach((fn) => fn());
  unsub = [];
  grid?.destroy();
  grid = null;
  root = null;
  lastKey = "";
}

/* ------------------------------------------------------------------ draw -- */

function draw() {
  clear(root);
  grid?.destroy();
  grid = null;

  if (!state.index.media.length) {
    emptyState(root, {
      icon: "database",
      title: "Your archive is empty",
      message: "Drop an export into the project as POSTS.json, or import one here. Everything stays on this device.",
      action: { label: "Import", onClick: () => import("./manage.js").then((m) => m.openManage()) },
    });
    return;
  }

  const resume = resumeRow();
  if (resume) root.append(resume);
  root.append(chips());

  grid = createGrid(root, currentList, {
    ariaLabel: "Saved media",
    emptyBuilder: () => h("div.empty", { style: { position: "static" } },
      h("div.empty__icon", icon("search", 26)),
      h("h2", { text: "Nothing in this filter" }),
      h("p", { text: "Try another chip above." }),
    ),
  });

  lastKey = signature();
  grid.refresh(true);
}

function onState() {
  if (!root) return;
  if (!state.index.media.length) { draw(); return; }
  const key = signature();
  if (key === lastKey) {
    grid?.sync(syncTiles);
    return;
  }
  const structural = key.split("|")[0] !== lastKey.split("|")[0];
  lastKey = key;
  if (!grid) { draw(); return; }
  if (structural) draw();
  else { grid.refresh(true); grid.sync(syncTiles); }
}

function signature() {
  /* structural part | cosmetic part */
  return [
    state.index.media.length, filter,
    Object.keys(state.library.hidden).length,
    Object.keys(state.library.archived).length,
    Object.keys(state.library.starred).length,
  ].join("~") + "|" + Object.keys(state.library.viewed).length;
}

/* ----------------------------------------------------------------- list -- */

function currentList() {
  const lib = state.library;
  const live = (m) => !lib.hidden[m.id] && !lib.archived[m.postId];
  let out;
  switch (filter) {
    case "unopened": out = state.index.media.filter((m) => live(m) && !lib.viewed[m.id]); break;
    case "videos":   out = state.index.media.filter((m) => live(m) && m.kind !== "photo"); break;
    case "photos":   out = state.index.media.filter((m) => live(m) && m.kind === "photo"); break;
    case "starred":  out = state.index.media.filter((m) => lib.starred[m.id]); break;
    default:         out = state.index.media.filter(live);
  }
  return out.sort((a, b) => postOf(b).capturedAt - postOf(a).capturedAt);
}

/* ---------------------------------------------------------------- chrome -- */

function chips() {
  const bar = h("div.home__chips", { role: "tablist", "aria-label": "Home filter" });
  for (const f of FILTERS) {
    const count = f.id === "recent" ? state.index.media.length : countFor(f.id);
    bar.append(h("button.chip", {
      type: "button",
      role: "tab",
      "aria-selected": filter === f.id ? "true" : "false",
      class: filter === f.id ? "is-on" : "",
      onclick: () => {
        if (filter === f.id) return;
        filter = f.id;
        for (const c of bar.children) c.classList.remove("is-on");
        bar.querySelector(`[data-f="${f.id}"]`)?.classList.add("is-on");
        for (const c of bar.children) c.setAttribute("aria-selected", c.dataset.f === f.id ? "true" : "false");
        scrollTo({ top: 0, behavior: "instant" });
        lastKey = signature();
        grid?.refresh(true);
        grid?.sync(syncTiles);
      },
      dataset: { f: f.id },
    }, f.label, count ? h("span.n", { text: compact(count) }) : null));
  }
  return bar;
}

function countFor(id) {
  const lib = state.library;
  const live = (m) => !lib.hidden[m.id] && !lib.archived[m.postId];
  switch (id) {
    case "unopened": return state.index.media.filter((m) => live(m) && !lib.viewed[m.id]).length;
    case "videos": return state.index.media.filter((m) => live(m) && m.kind !== "photo").length;
    case "photos": return state.index.media.filter((m) => live(m) && m.kind === "photo").length;
    case "starred": return Object.keys(lib.starred).length;
    default: return 0;
  }
}

const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

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
      h("span.resume__play", icon("play", 16)),
    ),
    h("span.resume__text",
      h("small.t-label", { text: "Continue watching" }),
      h("b", { text: p.text ? p.text.replace(/\s+/g, " ").slice(0, 80) : `@${p.author_username}` }),
      h("span.resume__bar", h("span", { style: { width: `${pct}%` } })),
      h("small", { text: `${fmtDuration(seconds)} of ${fmtDuration(item.dur)} · @${p.author_username}` }),
    ),
  );
}
