/* =============================================================================
   home — one screen that answers "what is worth my time right now?"

   v3 keeps the product decision the previous rebuild got right — the same
   sections, in the same order, every time — and rebuilds everything around
   it: an iOS large-title header that hands off to the navbar on scroll, a
   creators row with unseen rings, rails that render only their visible
   window and mount only near the viewport, skeleton states while the
   archive loads, and pull-to-refresh.

   Redraws are signature-gated: a star tap or a scroll-position save does
   not rebuild the page. Rail scroll positions additionally survive redraws
   via the rail's own memory.
   ============================================================================= */

import { h, icon, clear } from "../ui/dom.js";
import { state, setQuery, subscribe } from "../core/state.js";
import { stats, post as postOf, topAuthors } from "../core/query.js";
import { card, syncCards } from "../ui/card.js";
import { avatar, fmtCount, fmtHours, fmtAgo, fmtDuration } from "../ui/media.js";
import { openViewer } from "../viewer.js";
import { emptyState, toast } from "../ui/feedback.js";
import { navigate, setProminent } from "../shell.js";
import { largeTitle, watchProminent } from "../components/largeTitle.js";
import { vrail } from "../components/vrail.js";
import { attachPullToRefresh } from "../components/pullrefresh.js";

let root = null;
let unsub = null;
let lastSig = "";
let disposables = [];

export function mount(host) {
  root = h("section.home");
  host.append(root);
  lastSig = "";
  draw();
  unsub = subscribe(() => {
    const sig = signature();
    if (sig === lastSig) {
      if (root) syncCards(root);
      return;
    }
    draw();
  });
}

export function unmount() {
  unsub?.();
  unsub = null;
  dispose();
  setProminent(false);
  root = null;
  lastSig = "";
}

function dispose() {
  for (const fn of disposables) {
    try { fn(); } catch { /* teardown must never throw */ }
  }
  disposables = [];
}

function signature() {
  return [
    state.ready,
    state.index.media.length,
    Object.keys(state.library.viewed).length,
    Object.keys(state.library.starred).length,
    Object.keys(state.library.archived).length,
    Object.keys(state.library.hidden).length,
    Object.keys(state.library.progress).length,
    state.prefs.blurMedia,
  ].join("~");
}

function draw() {
  if (!root) return;
  dispose();
  clear(root);
  lastSig = signature();
  const s = stats();

  if (!state.ready) {
    skeleton();
    return;
  }

  if (!s.media) {
    emptyState(root, {
      icon: "database",
      title: "Your archive is empty",
      message: "Drop an export file into the project as POSTS.json, or import one here. Everything stays on this device.",
      action: { label: "Import an export", onClick: () => import("./manage.js").then((m) => m.openManage()) },
    });
    disposables.push(attachPullToRefresh(root, { onRefresh: refresh }));
    return;
  }

  root.append(header(s));

  const stories = storyRow();
  if (stories) root.append(stories);

  const r = resume();
  if (r) root.append(r);
  root.append(hero());

  for (const [title, subtitle, items, limit, key] of sections()) {
    if (!items.length) continue;
    root.append(lazySection(title, subtitle, items.slice(0, limit), key));
  }

  root.append(footer(s));
  syncCards(root);
  disposables.push(attachPullToRefresh(root, { onRefresh: refresh }));
}

/* ------------------------------------------------------------- header -- */

function header(s) {
  const hour = new Date().getHours();
  const word = hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const el = largeTitle({ eyebrow: date, title: `${word}.` },
    h("p.greet__line",
      h("b.t-num", { text: fmtCount(s.media) }), " items from ",
      h("b.t-num", { text: fmtCount(s.creators) }), " creators",
      s.unseen ? ` · ${fmtCount(s.unseen)} unopened` : " · you've seen it all",
    ),
    h("button.greet__cta.btn", {
      type: "button",
      onclick: () => {
        if (s.unseen) setQuery({ unseen: true, sort: "recent", search: "", kind: "all", author: null, starred: false });
        else setQuery({ unseen: false, sort: "recent", search: "", kind: "all", author: null, starred: false });
        navigate("library");
      },
    }, icon("spark", 16), h("span", { text: s.unseen ? "Unopened" : "Browse" })),
  );
  disposables.push(watchProminent(el));
  return el;
}

/* ------------------------------------------------------------ stories -- */

/** Creators as a stories row. The accent ring means "has unopened items" —
    the single most useful thing this row can say at a glance. */
function storyRow() {
  const counts = new Map();
  for (const m of state.index.media) {
    if (state.library.hidden[m.id] || state.library.archived[m.postId]) continue;
    const u = postOf(m).author_username || "unknown";
    let entry = counts.get(u);
    if (!entry) { entry = { total: 0, unseen: 0 }; counts.set(u, entry); }
    entry.total++;
    if (!state.library.viewed[m.id]) entry.unseen++;
  }

  const list = topAuthors(14).filter((a) => (counts.get(a.username)?.total || 0) >= 2);
  if (list.length < 3) return null;

  const row = h("div.creators", list.map((a) => {
    const c = counts.get(a.username) || { total: a.count, unseen: 0 };
    return h("button.creator", {
      type: "button",
      dataset: { unseen: c.unseen > 0 ? "true" : "false" },
      "aria-label": `@${a.username}, ${c.total} items${c.unseen ? `, ${c.unseen} unopened` : ""}`,
      onclick: () => {
        setQuery({ author: a.username, search: "", unseen: false, starred: false });
        navigate("library");
      },
      title: `@${a.username} · ${c.total} items`,
    },
      avatar(a.avatar, 60, a.name),
      h("span.creator__name", { text: a.name || a.username }),
      h("span.creator__count.t-tiny.t-num", { text: String(c.total) }),
    );
  }));

  return h("section.block.stories",
    h("div.block__head",
      h("div.block__title",
        h("h2", { text: "Creators" }),
        h("p.t-small", { text: `${stats().creators} in your archive` }),
      ),
    ),
    h("div.stories__scroll", row),
  );
}

/* ------------------------------------------------------------- resume -- */

/** The item you were part-way through, if there is one. */
function resume() {
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
    onclick: () => openViewer([item], 0),
  },
    h("span.resume__thumb",
      h("img", {
        src: item.thumb || item.poster || "", alt: "",
        loading: "lazy", decoding: "async", referrerpolicy: "no-referrer",
      }),
      h("span.resume__play", icon("play", 18)),
    ),
    h("span.resume__text",
      h("small.t-tiny", { text: "CONTINUE WATCHING" }),
      h("b", { text: p.text ? p.text.slice(0, 90) : `Video by @${p.author_username}` }),
      h("span.resume__bar", h("span", { style: { width: `${pct}%` } })),
      h("small", {}, `${fmtDuration(seconds)} of ${fmtDuration(item.dur)} · @${p.author_username}`),
    ),
  );
}

/* --------------------------------------------------------------- hero -- */

/** One large feature: the newest thing you have not opened. */
function hero() {
  const fresh = unseen();
  const item = fresh[0] || recent()[0];
  if (!item) return h("div");
  const p = postOf(item);

  return h("section.feature",
    h("div.feature__head",
      h("h2.t-title", { text: state.prefs.blurMedia ? "Saved for later" : "Fresh in your archive" }),
      h("button.feature__all", {
        type: "button",
        onclick: () => { setQuery({ unseen: true, sort: "recent" }); navigate("library"); },
      }, "See all", icon("arrowRight", 15)),
    ),
    card(item, fresh.length ? fresh : recent(), { shape: "hero", eager: true }),
    h("p.feature__why.t-small", {},
      p.text ? p.text.slice(0, 160) : `Saved ${fmtAgo(p.capturedAt)}`,
    ),
  );
}

/* ------------------------------------------------------------ sections -- */

function sections() {
  return [
    ["Jump back in", "Things you saved and never opened", unseen(), 12, "unseen"],
    ["Most liked", "The posts that landed hardest", byLikes(), 12, "liked"],
    ["Long form", "Videos over three minutes", longForm(), 10, "long"],
    ["Photo stories", "Posts with more than one image", multiPhoto(), 10, "multi"],
    ["Recently saved", "Newest first", recent(), 12, "recent"],
  ];
}

/**
 * A section whose rail mounts only near the viewport. Until then a skeleton
 * strip holds its exact geometry, so mounting never moves the page.
 */
function lazySection(title, subtitle, items, key) {
  const section = h("section.block",
    h("div.block__head",
      h("div.block__title",
        h("h2", { text: title }),
        h("p.t-small", { text: subtitle }),
      ),
      h("button.block__all", {
        type: "button",
        onclick: () => openAll(title),
      }, "All", icon("arrowRight", 15)),
    ),
  );

  const placeholder = h("div.rail-sk", { "aria-hidden": "true" },
    Array.from({ length: 6 }, () => h("div.sk.sk--tile")));
  section.append(placeholder);

  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      io.disconnect();
      if (!placeholder.isConnected) return;
      const v = vrail(items, {
        label: title,
        scrollKey: `home:${key}`,
        render: (item, i) => card(item, items, { shape: "rail", eager: i < 2 }),
      });
      disposables.push(v.destroy);
      placeholder.replaceWith(v.el);
      syncCards(section);
    }
  }, { rootMargin: "480px 0px" });
  io.observe(placeholder);
  disposables.push(() => io.disconnect());

  return section;
}

/* Maps a Home section to the Library filter that reproduces it exactly. "See
   all" has to land somewhere true, not somewhere similar. */
function openAll(title) {
  const map = {
    "Jump back in": { unseen: true, sort: "recent" },
    "Most liked": { sort: "liked", unseen: false },
    "Long form": { sort: "longest", kind: "video" },
    "Photo stories": { kind: "photo", sort: "recent" },
    "Recently saved": { sort: "recent" },
  };
  setQuery({ search: "", author: null, starred: false, ...(map[title] || { sort: "recent" }) });
  navigate("library");
}

/* ------------------------------------------------------------- footer -- */

function footer(s) {
  return h("footer.home__foot",
    h("div.home__stats",
      stat("Photos", fmtCount(s.photos)),
      stat("Videos", fmtCount(s.videos)),
      stat("Watch time", fmtHours(s.watchTime)),
      stat("Seen", `${s.pctSeen}%`),
    ),
    h("button.btn.btn--ghost.btn--block", {
      type: "button", onclick: () => navigate("library"),
    }, "Open the full library", icon("arrowRight", 16)),
  );
}

function stat(label, value) {
  return h("div.stat", h("b.t-num", { text: value }), h("small", { text: label }));
}

/* ------------------------------------------------------------ loading -- */

function skeleton() {
  const head = h("header.large-title", { "aria-hidden": "true" },
    h("div.sk.sk--line.sk--w25"),
    h("div.sk.sk--line.sk--w70"));
  root.append(head);
  disposables.push(watchProminent(head));

  for (let i = 0; i < 3; i++) {
    root.append(h("section.block", { "aria-hidden": "true" },
      h("div.sk.sk--line.sk--w40"),
      h("div.rail-sk",
        Array.from({ length: 5 }, () => h("div.sk.sk--tile")))));
  }
  root.append(h("p.sr-only", { role: "status", text: "Loading your archive" }));
}

/* ------------------------------------------------------------ refresh -- */

async function refresh() {
  const { refreshIndex } = await import("../core/data.js");
  const result = await refreshIndex();
  toast(result.fromCache ? "Already up to date" : "Archive updated");
}

/* ------------------------------------------------------------ queries -- */

const byCapturedDesc = (a, b) => postOf(b).capturedAt - postOf(a).capturedAt;
const live = (m) => !state.library.archived[m.postId] && !state.library.hidden[m.id];

function unseen() {
  return state.index.media
    .filter((m) => !state.library.viewed[m.id] && live(m))
    .sort(byCapturedDesc);
}

function byLikes() {
  return state.index.media
    .filter(live)
    .sort((a, b) => (postOf(b).like_count_at_capture || 0) - (postOf(a).like_count_at_capture || 0))
    .slice(0, 24);
}

function longForm() {
  return state.index.media
    .filter((m) => m.kind !== "photo" && m.dur > 180 && live(m))
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 20);
}

function multiPhoto() {
  return state.index.media
    .filter((m) => m.kind === "photo" && m.n > 1 && live(m))
    .sort(byCapturedDesc)
    .slice(0, 20);
}

function recent() {
  return state.index.media
    .filter(live)
    .sort(byCapturedDesc)
    .slice(0, 24);
}
