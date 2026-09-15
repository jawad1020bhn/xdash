/* =============================================================================
   library v3.1 — search, facets and saved views over the shared windowed grid.
   ========================================================================== */

import { h, icon, clear } from "../ui/dom.js";
import {
  state, setQuery, resetQuery, subscribe, clearSelection, selectAll, notify,
  saveView, deleteView,
} from "../core/state.js";
import { results, stats, SORT_LABELS, SORT_IDS, reshuffle, authorOf } from "../core/query.js";
import { createGrid } from "../ui/grid.js";
import { syncTiles } from "../ui/card.js";
import { avatar, fmtCount } from "../ui/media.js";
import { selectionBar, runSelection } from "../ui/actions.js";
import { emptyState, overlay, toast, promptDialog, confirmDialog, loadingState } from "../ui/feedback.js";

let root = null;
let grid = null;
let unsub = [];
let lastKey = "";
let renderSelBar = null;

export function mount(host) {
  root = h("section.lib.view-in");
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

function onState() {
  if (!root) return;
  if (!grid && state.ready) { draw(); return; }
  const key = signature();
  if (key === lastKey) {
    grid?.sync(syncTiles);
    renderSelBar?.();
    updateCount();
    return;
  }
  lastKey = key;
  grid?.refresh(true);
  grid?.sync(syncTiles);
  renderSelBar?.();
  updateCount();
}

function signature() {
  const q = state.query;
  return [q.search, q.kind, q.author, q.sort, q.unseen, q.starred, q.includeHidden,
    state.index.media.length,
    Object.keys(state.library.viewed).length,
    Object.keys(state.library.archived).length,
    Object.keys(state.library.hidden).length,
    Object.keys(state.library.starred).length,
    state.prefs.density, state.prefs.aspect,
  ].join("~");
}

/* ------------------------------------------------------------------ draw -- */

function draw() {
  clear(root);
  clearSelection();
  grid?.destroy();
  grid = null;

  if (!state.ready) {
    loadingState(root, "library");
    return;
  }

  const s = stats();
  if (!s.media) {
    emptyState(root, {
      icon: "database", title: "Nothing to browse yet",
      message: "Import an export or drop POSTS.json into the project folder.",
      action: { label: "Import", onClick: () => import("./manage.js").then((m) => m.openManage()) },
    });
    return;
  }

  root.append(head());
  root.append(bar());
  root.append(facets());
  if (state.prefs.views.length) root.append(viewsRow());

  grid = createGrid(root, results, {
    ariaLabel: "Search results",
    emptyBuilder: () => h("div.empty", { style: { position: "static" } },
      h("div.empty__icon", icon("search", 26)),
      h("h2", { text: "No matches" }),
      h("p", { text: "Loosen a filter or clear the search." }),
      h("button.btn", { type: "button", text: "Clear filters", onclick: () => resetQuery() }),
    ),
  });

  renderSelBar = selectionBar((action) => runSelection(action));
  renderSelBar();

  lastKey = signature();
  grid.refresh(true);
  updateCount();
}

function head() {
  if (state.query.author) {
    const a = authorOf(state.query.author);
    return h("div.author-head.hue", { style: { "--hue": "var(--hue-b)" } },
      avatar(a?.avatar, 48, a?.name),
      h("div.author-head__text",
        h("h1", { text: a?.name || state.query.author }),
        h("p", { text: `@${state.query.author} · ${a?.count || 0} items` }),
      ),
      h("button.icon-btn", { type: "button", "aria-label": "Show all creators", onclick: () => setQuery({ author: null }) }, icon("close", 20)),
    );
  }
  return h("div", { style: { display: "flex", alignItems: "baseline", gap: "10px" } },
    h("h1.t-h1", { text: "Library" }),
    h("span.lib__count.t-small", { text: "", "aria-live": "polite" }),
  );
}

function bar() {
  const input = h("input", {
    type: "search", placeholder: "Search text, creator, link…",
    "aria-label": "Search the library", autocomplete: "off",
    value: state.query.search,
  });
  let timer = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => setQuery({ search: input.value }), 130);
  });

  return h("div.lib__bar",
    h("div.field", icon("search", 17), input),
    h("button.chip.hue", {
      type: "button", style: { "--hue": "var(--hue-d)" },
      onclick: () => { selectAll([]); state.ui.selecting = true; notify(); toast("Tap tiles to select"); },
    }, icon("check", 14), "Select"),
  );
}

function facets() {
  const q = state.query;
  const chip = (label, on, onclick, hue) =>
    h(`button.chip.hue${on ? " is-on" : ""}`, { type: "button", style: hue ? { "--hue": hue } : null, onclick }, label);

  return h("div.lib__facets",
    chip("Everything", q.kind === "all" && !q.unseen && !q.starred, () => resetQuery(), "var(--hue-b)"),
    chip("Photos", q.kind === "photo", () => setQuery({ kind: q.kind === "photo" ? "all" : "photo" }), "var(--hue-a)"),
    chip("Videos", q.kind === "video", () => setQuery({ kind: q.kind === "video" ? "all" : "video" }), "var(--hue-c)"),
    h("span.gap"),
    chip("Unseen", q.unseen, () => setQuery({ unseen: !q.unseen }), "var(--hue-d)"),
    chip("Starred", q.starred, () => setQuery({ starred: !q.starred }), "var(--hue-e)"),
    h("span.gap"),
    h("button.chip.hue", { type: "button", style: { "--hue": "var(--hue-c)" }, onclick: openSort },
      icon("sort", 14), SORT_LABELS[q.sort] || "Sort"),
    h("button.chip.hue", { type: "button", style: { "--hue": "var(--hue-f)" }, onclick: saveCurrentView },
      icon("plus", 14), "Save view"),
  );
}

function viewsRow() {
  return h("div.lib__views",
    h("span.t-label", { text: "Views" }),
    state.prefs.views.map((v) => h("button.chip", {
      type: "button",
      onclick: () => { setQuery({ ...v.query }); toast(`View “${v.name}”`); },
      oncontextmenu: async (e) => {
        e.preventDefault();
        if (await confirmDialog({ title: `Delete view “${v.name}”?`, message: "This only removes the saved filter.", confirmLabel: "Delete", danger: true })) deleteView(v.name);
      },
    }, v.name)),
  );
}

async function openSort() {
  const sheet = overlay({ title: "Sort by", size: "sm" });
  for (const id of SORT_IDS) {
    sheet.content.append(h("button.menu-row", {
      type: "button",
      onclick: () => { if (id === "random") reshuffle(); setQuery({ sort: id }); sheet.close(); },
    },
      h("span.menu-row__icon", icon(state.query.sort === id ? "check" : "sort", 17)),
      h("span.menu-row__text", h("b", { text: SORT_LABELS[id] })),
    ));
  }
}

async function saveCurrentView() {
  const name = await promptDialog({ title: "Save this view", label: "View name", placeholder: "e.g. Long videos, unopened" });
  if (!name) return;
  saveView(name);
  toast(`View “${name}” saved`);
}

/* ----------------------------------------------------------------- count -- */

function updateCount() {
  const el = root?.querySelector(".lib__count");
  if (!el) return;
  const n = results().length;
  const total = state.index.media.length;
  el.textContent = n === total ? `${fmtCount(total)} items` : `${fmtCount(n)} of ${fmtCount(total)}`;
}
