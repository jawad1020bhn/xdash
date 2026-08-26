/* =============================================================================
   home — one screen that answers "what is worth my time right now?"

   The previous product generated up to eleven algorithmic rails and rotated them
   on every load, which meant the page you returned to was never the page you
   left. This is deliberately the opposite: the same sections, in the same
   order, every time, each one answering a different question. Predictability is
   the feature.
   ============================================================================= */

import { h, icon, clear, onBreakpoint } from "../ui/dom.js";
import { state, setQuery, subscribe } from "../core/state.js";
import { stats, post as postOf, byAuthor, topAuthors } from "../core/query.js";
import { card, rail, syncCards } from "../ui/card.js";
import { avatar, fmtCount, fmtHours, fmtAgo, fmtDuration } from "../ui/media.js";
import { openViewer } from "../viewer.js";
import { emptyState } from "../ui/feedback.js";
import { navigate } from "../shell.js";

let unsub = [];
let root = null;

export function mount(host) {
  root = h("section.home");
  host.append(root);
  draw();
  unsub.push(subscribe(() => { draw(); }));
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
      message: "Drop an export file into the project as POSTS.json, or import one here. Everything stays on this device.",
      action: { label: "Import an export", onClick: () => import("./manage.js").then((m) => m.openManage()) },
    });
    return;
  }

  root.append(greeting(s));
  if (resume()) root.append(resume());
  root.append(hero());

  const sections = [
    railSection("Jump back in", "Things you saved and never opened", unseen(), 12),
    railSection("Most liked", "The posts that landed hardest", byLikes(), 12),
    railSection("Long form", "Videos over three minutes", longForm(), 10),
    railSection("Photo stories", "Posts with more than one image", multiPhoto(), 10),
    railSection("Recently saved", "Newest first", recent(), 12),
  ].filter(Boolean);

  for (const section of sections) root.append(section);

  root.append(creators());
  root.append(footer(s));
  syncCards(root);
}

/* ------------------------------------------------------------- sections -- */

function greeting(s) {
  const hour = new Date().getHours();
  const word = hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return h("header.greet",
    h("div.greet__text",
      h("h1.t-display", { text: word + "." }),
      h("p.greet__line",
        h("b.t-num", { text: fmtCount(s.media) }), " items from ",
        h("b.t-num", { text: fmtCount(s.creators) }), " creators",
        s.unseen ? h("span", {}, ` · ${fmtCount(s.unseen)} unopened`) : " · you've seen it all",
      ),
    ),
    h("button.greet__cta.btn", {
      type: "button",
      onclick: () => { setQuery({ unseen: true, sort: "recent", search: "", kind: "all", author: null, starred: false }); navigate("library"); },
    }, icon("spark", 17), h("span", { text: s.unseen ? "Show unopened" : "Browse everything" })),
  );
}

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
      h("img", { src: item.thumb || item.poster || "", alt: "", loading: "lazy",
                 decoding: "async", referrerpolicy: "no-referrer" }),
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

/** One large feature: the newest thing you have not opened. */
function hero() {
  const item = unseen()[0] || recent()[0];
  if (!item) return null;
  const p = postOf(item);

  return h("section.feature",
    h("div.feature__head",
      h("h2.t-title", { text: state.prefs.blurMedia ? "Saved for later" : "Fresh in your archive" }),
      h("button.feature__all", {
        type: "button", text: "See all",
        onclick: () => { setQuery({ unseen: true, sort: "recent" }); navigate("library"); },
      }, icon("arrowRight", 15)),
    ),
    card(item, unseen().length ? unseen() : recent(), { shape: "hero", eager: true }),
    h("p.feature__why.t-small", {},
      p.text ? p.text.slice(0, 160) : `Saved ${fmtAgo(p.capturedAt)}`,
    ),
  );
}

function railSection(title, subtitle, items, limit) {
  if (!items.length) return null;
  const shown = items.slice(0, limit);
  return h("section.block",
    h("div.block__head",
      h("div.block__title",
        h("h2", { text: title }),
        h("p.t-small", { text: subtitle }),
      ),
      h("button.block__all", {
        type: "button", text: "All",
        onclick: () => openAll(title),
      }, icon("arrowRight", 15)),
    ),
    rail(shown, { label: title, eager: 2 }),
  );
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

function creators() {
  const list = topAuthors(14).filter((a) => a.count >= 2);
  if (list.length < 3) return null;

  return h("section.block",
    h("div.block__head",
      h("div.block__title",
        h("h2", { text: "Creators you save most" }),
        h("p.t-small", { text: `${stats().creators} in your archive` }),
      ),
    ),
    h("div.creators",
      list.map((a) => h("button.creator", {
        type: "button",
        onclick: () => { setQuery({ author: a.username, search: "", unseen: false, starred: false }); navigate("library"); },
        title: `@${a.username} · ${a.count} items`,
      },
        avatar(a.avatar, 52, a.name),
        h("span.creator__name", { text: a.name || a.username }),
        h("span.creator__count.t-tiny.t-num", { text: String(a.count) }),
      )),
    ),
  );
}

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

/* -------------------------------------------------------------- queries -- */

const seen = new Set();
function unseen() {
  const key = `unseen:${state.index.media.length}:${Object.keys(state.library.viewed).length}`;
  if (seen.has(key)) return cache.unseen;
  cache.unseen = state.index.media
    .filter((m) => !state.library.viewed[m.id] && !state.library.hidden[m.id] && !state.library.archived[m.postId])
    .sort((a, b) => postOf(b).capturedAt - postOf(a).capturedAt);
  seen.add(key);
  return cache.unseen;
}
const cache = {};

function byLikes() {
  return state.index.media
    .filter((m) => !state.library.archived[m.postId] && !state.library.hidden[m.id])
    .sort((a, b) => (postOf(b).like_count_at_capture || 0) - (postOf(a).like_count_at_capture || 0))
    .slice(0, 24);
}

function longForm() {
  return state.index.media
    .filter((m) => m.kind !== "photo" && m.dur > 180 && !state.library.archived[m.postId])
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 20);
}

function multiPhoto() {
  return state.index.media
    .filter((m) => m.kind === "photo" && m.n > 1 && !state.library.archived[m.postId])
    .sort((a, b) => postOf(b).capturedAt - postOf(a).capturedAt)
    .slice(0, 20);
}

function recent() {
  return state.index.media
    .filter((m) => !state.library.archived[m.postId] && !state.library.hidden[m.id])
    .sort((a, b) => postOf(b).capturedAt - postOf(a).capturedAt)
    .slice(0, 24);
}

void onBreakpoint;
void byAuthor;
