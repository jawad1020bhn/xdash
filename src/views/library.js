/* =============================================================================
   library v3 — the whole archive in one windowed grid.

   1,205 items would be 1,205 DOM subtrees and 1,205 image requests. Instead
   the grid positions tiles absolutely inside a box whose height equals the
   full archive, and renders only the rows near the viewport. Because the
   geometry is computed in JS from the container's real width, holes and
   mis-sized rows are impossible at any breakpoint — the bug v2 shipped.
   ========================================================================== */

import { h, icon, clear, onBreakpoint, onIdle } from "../ui/dom.js";
import {
  state, setQuery, resetQuery, subscribe, clearSelection, selectAll, notify,
  saveView, deleteView,
} from "../core/state.js";
import { results, stats, SORT_LABELS, SORT_IDS, post as postOf, reshuffle, authorOf } from "../core/query.js";
import { tile, syncTiles } from "../ui/card.js";
import { avatar, fmtCount } from "../ui/media.js";
import { selectionBar, runSelection } from "../ui/actions.js";
import { emptyState, overlay, toast, promptDialog } from "../ui/feedback.js";

const OVERSCAN = 2;
const META_H = 30;

let root = null;
let grid = null;
let unsub = [];
let lastKey = "";
let renderSelBar = null;

/* geometry */
let cols = 1, colW = 0, rowH = 0, gap = 10, gridTop = 0, rows = 0;
const nodes = new Map();
let rangeStart = -1, rangeEnd = -1;

export function mount(host) {
  root = h("section.lib.view-in");
  host.append(root);
  draw();
  unsub.push(subscribe(onState));
  unsub.push(onBreakpoint(() => { measure(); paint(true); }));
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
}

export function unmount() {
  unsub.forEach((fn) => fn());
  unsub = [];
  removeEventListener("scroll", onScroll);
  removeEventListener("resize", onScroll);
  nodes.clear();
  root = null;
  grid = null;
  lastKey = "";
}

function onState() {
  /* Mounted before the archive arrived? Draw for real now. */
  if (!grid && state.index.media.length) { draw(); return; }
  const key = signature();
  if (key === lastKey) {
    if (grid) syncTiles(grid);
    renderSelBar?.();
    updateCount();
    return;
  }
  lastKey = key;
  measure();
  paint(true);
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
  nodes.clear();

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

  grid = h("div.grid", { role: "list", "aria-label": "Archive items" });
  root.append(grid);

  renderSelBar = selectionBar((action) => runSelection(action));
  renderSelBar();

  lastKey = signature();
  measure();
  paint(true);
  updateCount();
}

function head() {
  if (state.query.author) {
    const a = authorOf(state.query.author);
    return h("div.author-head.hue", { style: { "--hue": "var(--hue-b)" } },
      avatar(a?.avatar, 48, a?.name),
      h("div.author-head__text",
        h("h1", { text: a?.name || state.query.author }),
        h("p", { text: `@${state.query.author} · ${a?.count || 0} items in your archive` }),
      ),
      h("button.icon-btn", { type: "button", "aria-label": "Show all creators", onclick: () => setQuery({ author: null }) }, icon("close", 20)),
    );
  }
  return h("div.lib__title-row", { style: { display: "flex", alignItems: "baseline", gap: "10px" } },
    h("h1.t-h1", { text: "Library" }),
    h("span.lib__count.t-small", { text: "" }),
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
      onclick: () => { selectAll([]); state.ui.selecting = true; notify(); toast("Tap tiles to select · right-click works too"); },
    }, icon("check", 14), "Select"),
  );
}

function facets() {
  const q = state.query;
  const chip = (label, on, onclick, hue) =>
    h(`button.chip hue${on ? " is-on" : ""}`, { type: "button", style: hue ? { "--hue": hue } : null, onclick }, label);

  const sortChip = h("button.chip hue", { type: "button", style: { "--hue": "var(--hue-c)" }, onclick: openSort },
    icon("sort", 14), SORT_LABELS[q.sort] || "Sort");

  return h("div.lib__facets",
    chip("Everything", q.kind === "all" && !q.unseen && !q.starred, () => resetQuery(), "var(--hue-b)"),
    chip("Photos", q.kind === "photo", () => setQuery({ kind: q.kind === "photo" ? "all" : "photo" }), "var(--hue-a)"),
    chip("Videos", q.kind === "video", () => setQuery({ kind: q.kind === "video" ? "all" : "video" }), "var(--hue-c)"),
    h("span.gap"),
    chip("Unseen", q.unseen, () => setQuery({ unseen: !q.unseen }), "var(--hue-d)"),
    chip("Starred", q.starred, () => setQuery({ starred: !q.starred }), "var(--hue-e)"),
    h("span.gap"),
    sortChip,
    h("button.chip hue", { type: "button", style: { "--hue": "var(--hue-f)" }, onclick: saveCurrentView }, icon("plus", 14), "Save view"),
  );
}

function viewsRow() {
  return h("div.lib__views",
    h("span.t-label", { text: "Views" }),
    state.prefs.views.map((v) => h("button.chip", {
      type: "button",
      onclick: () => { setQuery({ ...v.query }); toast(`View “${v.name}” applied`); },
      oncontextmenu: async (e) => {
        e.preventDefault();
        const { confirmDialog } = await import("../ui/feedback.js");
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

/* -------------------------------------------------------------- geometry -- */

function measure() {
  if (!grid) return;
  const cs = getComputedStyle(document.documentElement);
  const min = parseFloat(cs.getPropertyValue("--tile-min")) || 172;
  gap = parseFloat(cs.getPropertyValue("--gap")) || 10;
  const aspect = (cs.getPropertyValue("--tile-aspect") || "4 / 5").split("/").map(Number);
  const ratio = (aspect[0] || 4) / (aspect[1] || 5);

  const w = grid.clientWidth || root.clientWidth || 360;
  cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
  colW = (w - gap * (cols - 1)) / cols;
  rowH = colW / ratio + META_H;

  const total = results().length;
  rows = Math.ceil(total / cols);
  grid.style.height = `${Math.max(rows * (rowH + gap) - gap, 0)}px`;
  gridTop = grid.getBoundingClientRect().top + window.scrollY;
}

let frame = 0;
function onScroll() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; paint(false); });
}

/* ---------------------------------------------------------------- window -- */

function paint(reset) {
  if (!grid) return;
  if (reset) { nodes.forEach((el) => el.remove()); nodes.clear(); rangeStart = rangeEnd = -1; }

  const list = results();
  if (!list.length) {
    if (!grid.querySelector(".empty")) {
      grid.style.height = "auto";
      grid.append(h("div.empty", { style: { position: "static" } },
        h("div.empty__icon", icon("search", 26)),
        h("h2", { text: "No matches" }),
        h("p", { text: "Loosen a filter or clear the search to see your archive again." }),
        h("button.btn", { type: "button", text: "Clear filters", onclick: () => resetQuery() }),
      ));
    }
    return;
  }
  grid.querySelector(".empty")?.remove();

  const vh = window.innerHeight;
  const y = window.scrollY;
  const firstRow = Math.max(0, Math.floor((y - gridTop) / (rowH + gap)) - OVERSCAN);
  const lastRow = Math.min(rows - 1, Math.ceil((y + vh - gridTop) / (rowH + gap)) + OVERSCAN);
  const start = firstRow * cols;
  const end = Math.min(list.length, (lastRow + 1) * cols);

  if (start === rangeStart && end === rangeEnd && !reset) return;
  rangeStart = start; rangeEnd = end;

  const wanted = new Set();
  for (let i = start; i < end; i++) {
    const item = list[i];
    wanted.add(item.id);
    let el = nodes.get(item.id);
    if (!el) {
      el = tile(item, list, { index: i });
      el.setAttribute("role", "listitem");
      nodes.set(item.id, el);
      grid.append(el);
    }
    place(el, i);
  }
  for (const [id, el] of nodes) {
    if (!wanted.has(id)) { el.remove(); nodes.delete(id); }
  }
}

function place(el, i) {
  const row = Math.floor(i / cols);
  const col = i % cols;
  el.style.left = `${col * (colW + gap)}px`;
  el.style.top = `${row * (rowH + gap)}px`;
  el.style.width = `${colW}px`;
  el.style.height = `${rowH}px`;
}

function updateCount() {
  const el = root?.querySelector(".lib__count");
  if (!el) return;
  const n = results().length;
  const total = state.index.media.length;
  el.textContent = n === total ? `${fmtCount(total)} items` : `${fmtCount(n)} of ${fmtCount(total)}`;
}

/* Prime the window once layout settles, so the first paint is not empty. */
queueMicrotask(() => onIdle(() => paint(false)));
