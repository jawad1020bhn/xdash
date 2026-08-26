/* =============================================================================
   library — the whole archive, one windowed grid.

   1,205 items would be 1,205 DOM subtrees with 1,205 image requests. Instead the
   grid renders only the rows near the viewport (plus two rows of overscan) and
   keeps the scroll height honest with spacers, so the scrollbar, the position
   and the fling all behave as if every tile were real. At any moment there are
   roughly forty tiles in the document.

   Tiles are a uniform aspect ratio on purpose. A masonry layout looks nicer in a
   screenshot and makes both windowing and scanning worse; an archive you are
   hunting through wants a grid you can predict.
   ============================================================================= */

import { h, icon, clear, onBreakpoint } from "../ui/dom.js";
import { state, setQuery, subscribe, clearSelection, toggleSelected, selectAll } from "../core/state.js";
import { results, stats, SORT_LABELS, post as postOf, reshuffle } from "../core/query.js";
import { card, syncCards } from "../ui/card.js";
import { avatar, fmtCount } from "../ui/media.js";
import { selectionBar } from "../ui/actions.js";
import { emptyState, toast } from "../ui/feedback.js";

const OVERSCAN = 2;
const GRID_ASPECT = 4 / 5;

let root = null;
let grid = null;
let viewport = null;
let unsub = [];
let frame = 0;
let lastKey = "";
let renderSelBar = null;
let colWidth = 0;
let rowHeight = 0;
let cols = 1;

export function mount(host) {
  root = h("section.library");
  host.append(root);
  draw();
  unsub.push(subscribe(onState));
  unsub.push(onBreakpoint(() => { measure(); paintWindow(true); }));
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
}

export function unmount() {
  unsub.forEach((fn) => fn());
  unsub = [];
  removeEventListener("scroll", onScroll);
  removeEventListener("resize", onScroll);
  root = null;
  grid = null;
  lastKey = "";
}

function onState() {
  /* Selection and star changes are patched in place. Anything that changes the
     result set means a real redraw. */
  const key = signature();
  if (key === lastKey) {
    if (grid) syncCards(grid);
    renderSelBar?.();
    updateCount();
    return;
  }
  lastKey = key;
  paintWindow(true);
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
  ].join("~");
}

/* ----------------------------------------------------------------- chrome -- */

function draw() {
  clear(root);
  clearSelection();

  const s = stats();

  /* Result count and the author banner, if we are filtered to one person. */
  const head = h("div.lib__head");
  if (state.query.author) {
    const author = state.index.authors.find((a) => a.username === state.query.author);
    head.append(h("div.author-head",
      avatar(author?.avatar, 48, author?.name),
      h("div.author-head__text",
        h("h1.t-title", { text: author?.name || state.query.author }),
        h("p.t-small", { text: `@${state.query.author} · ${author?.count || 0} items in your archive` }),
      ),
      h("button.icon-btn", {
        type: "button", "aria-label": "Show all creators",
        onclick: () => setQuery({ author: null }),
      }, icon("close", 20)),
    ));
  } else {
    head.append(h("div.lib__title-row",
      h("h1.t-title", { text: "Library" }),
      h("span.lib__count.t-small.t-num", { text: `${fmtCount(s.media)} items` }),
    ));
  }
  root.append(head);

  /* Search — inline here, because in the Library you are always searching. */
  const search = h("div.field.lib__search",
    icon("search", 18),
    h("input", {
      type: "search", placeholder: "Search text, creator, link…",
      "aria-label": "Search the library", autocomplete: "off",
      enterkeyhint: "search", value: state.query.search,
      oninput: (e) => debounceSearch(e.target.value),
      onkeydown: (e) => { if (e.key === "Escape") { e.target.value = ""; setQuery({ search: "" }); } },
    }),
    state.query.search ? h("button.icon-btn", {
      type: "button", "aria-label": "Clear search",
      onclick: (e) => {
        const input = e.target.closest(".field").querySelector("input");
        input.value = ""; setQuery({ search: "" }); input.focus();
      },
    }, icon("close", 18)) : null,
  );
  root.append(search);

  /* Filters, one row, horizontally scrollable on a phone. */
  const kinds = [["all", "Everything"], ["video", "Videos"], ["photo", "Photos"]];
  const chips = h("div.chips.lib__chips");
  for (const [value, label] of kinds) {
    chips.append(h("button.chip", {
      type: "button", "aria-pressed": state.query.kind === value ? "true" : "false",
      onclick: () => setQuery({ kind: value }),
    }, label));
  }
  chips.append(h("button.chip", {
    type: "button", "aria-pressed": state.query.unseen ? "true" : "false",
    onclick: () => setQuery({ unseen: !state.query.unseen }),
  }, icon("eye", 15), "Unseen"));
  chips.append(h("button.chip", {
    type: "button", "aria-pressed": state.query.starred ? "true" : "false",
    onclick: () => setQuery({ starred: !state.query.starred }),
  }, icon("star", 15), "Starred"));
  if (state.query.author) {
    chips.append(h("button.chip.is-active", {
      type: "button", onclick: () => setQuery({ author: null }),
    }, `@${state.query.author}`, icon("close", 14)));
  }
  root.append(chips);

  /* Sort + selection. These sit on one line so the controls never wrap into a
     second row and eat the viewport. */
  const tools = h("div.lib__tools",
    h("button.lib__sort", {
      type: "button", "aria-label": "Change sort order",
      onclick: cycleSort,
    }, icon("sort", 16), h("span", { text: SORT_LABELS[state.query.sort] || "Recently saved" })),
    h("span.lib__spacer"),
    h("button.icon-btn", {
      type: "button", "aria-label": "Select all visible", title: "Select all",
      onclick: () => { selectAll(results().slice(0, 400).map((m) => m.id)); toast("Selected up to 400 items"); },
    }, icon("check", 19)),
  );
  root.append(tools);

  /* The windowed grid. */
  viewport = h("div.grid-viewport");
  grid = h("div.grid", { role: "list", "aria-label": "Library items" });
  viewport.append(grid);
  root.append(viewport);

  renderSelBar = selectionBar(root);
  renderSelBar();

  measure();
  lastKey = signature();
  paintWindow(true);
}

let searchTimer = 0;
function debounceSearch(value) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => setQuery({ search: value }), 180);
}

function cycleSort() {
  const order = ["recent", "oldest", "liked", "reposted", "viewed", "longest", "shortest", "random"];
  const i = order.indexOf(state.query.sort);
  const next = order[(i + 1) % order.length];
  if (next === "random") reshuffle();
  setQuery({ sort: next });
  toast(SORT_LABELS[next]);
}

function updateCount() {
  const el = root?.querySelector(".lib__count");
  if (!el) return;
  const n = results().length;
  const total = state.index.media.length;
  el.textContent = n === total ? `${fmtCount(total)} items` : `${fmtCount(n)} of ${fmtCount(total)}`;
}

/* ------------------------------------------------------------ windowing -- */

function measure() {
  if (!viewport) return;
  const style = getComputedStyle(document.documentElement);
  const min = parseFloat(style.getPropertyValue("--tile-min")) || 168;
  const gap = parseFloat(style.getPropertyValue("--gap")) || 8;
  const width = viewport.clientWidth || window.innerWidth - 32;

  cols = Math.max(1, Math.floor((width + gap) / (min + gap)));
  colWidth = (width - gap * (cols - 1)) / cols;
  rowHeight = colWidth / GRID_ASPECT + gap + 34;   // 34px = the meta strip
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.style.setProperty("--grid-aspect", String(GRID_ASPECT));
}

function paintWindow(force = false) {
  if (!grid || !viewport) return;
  const list = results();

  if (!list.length) {
    viewport.style.height = "";
    emptyState(grid, {
      icon: "search",
      title: "Nothing matches",
      message: state.query.search
        ? `No item in your archive matches “${state.query.search}”.`
        : "No item matches these filters.",
      action: { label: "Clear filters", onClick: () => setQuery({ search: "", kind: "all", unseen: false, starred: false, author: null }) },
    });
    return;
  }

  const rows = Math.ceil(list.length / cols);
  const totalHeight = rows * rowHeight;
  viewport.style.height = `${totalHeight}px`;

  const top = Math.max(0, viewport.getBoundingClientRect().top + window.scrollY);
  const start = Math.max(0, Math.floor((window.scrollY - top) / rowHeight) - OVERSCAN);
  const visibleRows = Math.ceil(window.innerHeight / rowHeight) + OVERSCAN * 2;
  const end = Math.min(rows, start + visibleRows);

  const key = `${start}:${end}:${cols}:${list.length}`;
  if (!force && key === grid.dataset.window) return;
  grid.dataset.window = key;

  /* Translate instead of padding-top: a transformed grid does not create the
     scroll anchoring jumps that spacer elements do. */
  grid.style.transform = `translateY(${start * rowHeight}px)`;
  grid.style.position = "absolute";
  grid.style.insetInline = "0";
  grid.style.top = "0";

  const existing = new Map();
  for (const el of grid.querySelectorAll(".card")) existing.set(el.dataset.mediaId, el);

  const frag = document.createDocumentFragment();
  const keep = new Set();
  for (let r = start; r < end; r++) {
    for (let c = 0; c < cols; c++) {
      const item = list[r * cols + c];
      if (!item) break;
      keep.add(item.id);
      const cached = existing.get(item.id);
      if (cached) { frag.append(cached); continue; }
      frag.append(card(item, list, {
        shape: "tile",
        index: r * cols + c,
        eager: r === start && c < cols,
      }));
    }
  }
  /* Drop what scrolled away so the document stays small. */
  for (const [id, el] of existing) if (!keep.has(id)) el.remove();
  grid.replaceChildren(frag);
  syncCards(grid);
}

function onScroll() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; paintWindow(); });
}

/* Long-press anywhere in the grid starts selection; a single tap never does. */
export function beginSelection(id) {
  toggleSelected(id);
}
void beginSelection;
