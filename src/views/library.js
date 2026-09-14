/* =============================================================================
   library — the whole archive, one windowed grid.

   v3 keeps the windowing that made this view fast (only rows near the
   viewport exist; spacers keep the scrollbar truthful) and rebuilds the
   chrome around it the way Apple Photos would: a large title with a live
   count, a sticky iOS search field with Cancel, a segmented kind control,
   toggle chips, a sort menu, a scroll-to-top pill with position, skeleton
   states, and pull-to-refresh.

   State changes rebuild the chrome (cheap) rather than patching it — the v2
   approach of repainting only the grid left chips and sort labels showing
   stale state. Search focus and caret survive the rebuild.
   ============================================================================= */

import { h, icon, clear, onBreakpoint, reducedMotion, haptic } from "../ui/dom.js";
import { state, setQuery, subscribe, clearSelection, selectAll } from "../core/state.js";
import { results, SORT_LABELS, reshuffle } from "../core/query.js";
import { card, syncCards } from "../ui/card.js";
import { fmtCount } from "../ui/media.js";
import { selectionBar } from "../ui/actions.js";
import { emptyState, toast, overlay } from "../ui/feedback.js";
import { largeTitle, watchProminent } from "../components/largeTitle.js";
import { attachPullToRefresh } from "../components/pullrefresh.js";
import { setProminent } from "../shell.js";
import { refreshIndex } from "../core/data.js";

const OVERSCAN = 2;
const GRID_ASPECT = 4 / 5;

let root = null;
let grid = null;
let viewport = null;
let fab = null;
let fabLabel = null;
let unsub = [];
let disposables = [];
let frame = 0;
let lastKey = "";
let renderSelBar = null;
let colWidth = 0;
let rowHeight = 0;
let cols = 1;
let range = { first: 1, total: 0 };

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
  dispose();
  setProminent(false);
  removeEventListener("scroll", onScroll);
  removeEventListener("resize", onScroll);
  root = null;
  grid = null;
  viewport = null;
  fab = null;
  fabLabel = null;
  lastKey = "";
}

function dispose() {
  for (const fn of disposables) {
    try { fn(); } catch { /* teardown must never throw */ }
  }
  disposables = [];
}

function onState() {
  /* Selection and star changes are patched in place. Anything that changes
     the result set or the chrome rebuilds it. */
  const key = signature();
  if (key === lastKey) {
    if (grid) syncCards(grid);
    renderSelBar?.();
    updateCount();
    updateFab();
    return;
  }
  draw();
}

function signature() {
  const q = state.query;
  return [state.ready, state.prefs.blurMedia,
    document.documentElement.dataset.density,
    q.search, q.kind, q.author, q.sort, q.unseen, q.starred, q.includeHidden,
    state.index.media.length,
    Object.keys(state.library.viewed).length,
    Object.keys(state.library.archived).length,
    Object.keys(state.library.hidden).length,
    Object.keys(state.library.starred).length,
  ].join("~");
}

/* ----------------------------------------------------------------- chrome -- */

function draw() {
  if (!root) return;
  dispose();
  const searchFocus = root.querySelector(".lib__search input") === document.activeElement;
  clear(root);
  grid = null;
  viewport = null;
  fab = null;
  clearSelection();
  lastKey = signature();

  if (!state.ready) {
    skeleton();
    return;
  }

  root.append(head());
  root.append(searchBar());
  root.append(kindSeg());
  root.append(filterChips());
  root.append(tools());

  viewport = h("div.grid-viewport");
  grid = h("div.grid", { role: "list", "aria-label": "Library items" });
  viewport.append(grid);
  root.append(viewport);

  fabLabel = h("span.t-num");
  fab = h("button.lib__top", {
    type: "button",
    "aria-label": "Scroll back to the top",
    dataset: { visible: "false" },
    onclick: () => {
      haptic(8);
      scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    },
  }, icon("arrowUp", 17), fabLabel);
  root.append(fab);

  renderSelBar = selectionBar(root);
  renderSelBar();

  disposables.push(attachPullToRefresh(root, { onRefresh: refresh }));

  measure();
  paintWindow(true);
  updateCount();
  updateFab();

  if (searchFocus) {
    const input = root.querySelector(".lib__search input");
    if (input) {
      input.focus({ preventScroll: true });
      try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* noop */ }
    }
  }
}

function head() {
  let el;
  if (state.query.author) {
    const author = state.index.authors.find((a) => a.username === state.query.author);
    el = largeTitle(
      {
        eyebrow: `@${state.query.author} · ${fmtCount(author?.count || 0)} items`,
        title: author?.name || state.query.author,
      },
      h("p.lib__count.t-small.t-num"),
      h("button.btn", {
        type: "button", text: "Clear",
        onclick: () => setQuery({ author: null }),
      }),
    );
  } else {
    el = largeTitle({ title: "Library" }, h("p.lib__count.t-small.t-num"));
  }
  disposables.push(watchProminent(el));
  return el;
}

function searchBar() {
  const input = h("input", {
    type: "search", placeholder: "Search", "aria-label": "Search the library",
    autocomplete: "off", enterkeyhint: "search", value: state.query.search,
  });
  const clearBtn = h("button.lib__search-clear", {
    type: "button", "aria-label": "Clear search",
    hidden: !state.query.search,
    onclick: () => {
      input.value = "";
      clearBtn.hidden = true;
      setQuery({ search: "" });
      input.focus();
    },
  }, icon("close", 15));

  const wrap = h("div.lib__search",
    h("div.field.lib__search-field", icon("search", 17), input, clearBtn),
    h("button.lib__cancel", {
      type: "button", text: "Cancel",
      onclick: () => {
        input.value = "";
        clearBtn.hidden = true;
        setQuery({ search: "" });
        input.blur();
      },
    }),
  );

  input.addEventListener("input", () => {
    clearBtn.hidden = !input.value;
    debounceSearch(input.value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      clearBtn.hidden = true;
      setQuery({ search: "" });
      input.blur();
    }
  });
  input.addEventListener("focus", () => wrap.classList.add("is-focused"));
  input.addEventListener("blur", () => wrap.classList.remove("is-focused"));

  return wrap;
}

let searchTimer = 0;
function debounceSearch(value) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (value !== state.query.search) setQuery({ search: value });
  }, 180);
}

function kindSeg() {
  const kinds = [["all", "All"], ["video", "Videos"], ["photo", "Photos"]];
  return h("div.lib__seg",
    h("div.seg", { role: "radiogroup", "aria-label": "Media type" },
      kinds.map(([value, label]) => h("button.seg__item", {
        type: "button", role: "radio",
        "aria-checked": state.query.kind === value ? "true" : "false",
        onclick: () => setQuery({ kind: value }),
      }, label)),
    ),
  );
}

function filterChips() {
  return h("div.chips.lib__chips",
    h("button.chip", {
      type: "button", "aria-pressed": state.query.unseen ? "true" : "false",
      onclick: () => setQuery({ unseen: !state.query.unseen }),
    }, icon("eye", 15), "Unseen"),
    h("button.chip", {
      type: "button", "aria-pressed": state.query.starred ? "true" : "false",
      onclick: () => setQuery({ starred: !state.query.starred }),
    }, icon("star", 15), "Starred"),
  );
}

function tools() {
  return h("div.lib__tools",
    h("button.lib__sort", {
      type: "button", "aria-label": "Change sort order",
      "aria-haspopup": "dialog",
      onclick: openSortMenu,
    }, icon("sort", 16), h("span", { text: SORT_LABELS[state.query.sort] || "Recently saved" })),
    h("span.lib__spacer"),
    h("button.icon-btn", {
      type: "button", "aria-label": "Select all visible", title: "Select all",
      onclick: () => { selectAll(results().slice(0, 400).map((m) => m.id)); toast("Selected up to 400 items"); },
    }, icon("check", 19)),
  );
}

/** The eight sort orders as a radio menu — the cycle-on-tap it replaces was
    seven taps away from the order you wanted and told you nothing. */
function openSortMenu() {
  const order = ["recent", "oldest", "liked", "reposted", "viewed", "longest", "shortest", "random"];
  const sheet = overlay({ title: "Sort by", size: "sm" });
  for (const key of order) {
    const active = state.query.sort === key;
    sheet.content.append(h("button.menu-row", {
      type: "button",
      onclick: () => {
        if (key === "random") reshuffle();
        setQuery({ sort: key });
        sheet.close();
        toast(SORT_LABELS[key]);
      },
    },
      h("span.menu-row__text", h("b", { text: SORT_LABELS[key] })),
      active ? icon("check", 19) : h("span", { style: { width: "19px", flex: "none" } }),
    ));
  }
}

function updateCount() {
  const el = root?.querySelector(".lib__count");
  if (!el) return;
  const n = results().length;
  const total = state.index.media.length;
  el.textContent = n === total ? `${fmtCount(total)} items` : `${fmtCount(n)} of ${fmtCount(total)}`;
}

function updateFab() {
  if (!fab || !fabLabel) return;
  const show = window.scrollY > 1400 && range.total > 60;
  fab.dataset.visible = show ? "true" : "false";
  if (show) fabLabel.textContent = `${range.first.toLocaleString()} / ${range.total.toLocaleString()}`;
}

/* --------------------------------------------------------------- skeleton -- */

function skeleton() {
  const head = h("header.large-title", { "aria-hidden": "true" },
    h("div.sk.sk--line.sk--w40"),
    h("div.sk.sk--line.sk--w25"));
  root.append(head);
  disposables.push(watchProminent(head));
  root.append(h("div.lib__search", { "aria-hidden": "true" },
    h("div.sk", { style: { height: "36px", borderRadius: "10px" } })));
  root.append(h("div.lib-sk", { "aria-hidden": "true" },
    Array.from({ length: 12 }, () => h("div.sk.sk--tile"))));
  root.append(h("p.sr-only", { role: "status", text: "Loading your library" }));
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
  /* The meta strip hides at compact density — measuring it anyway would open
     a blank band under every row. */
  const metaH = document.documentElement.dataset.density === "compact" ? 0 : 34;
  rowHeight = colWidth / GRID_ASPECT + gap + metaH;
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.style.setProperty("--grid-aspect", String(GRID_ASPECT));
}

function paintWindow(force = false) {
  if (!grid || !viewport) return;
  const list = results();

  if (!list.length) {
    viewport.style.height = "";
    range = { first: 0, total: 0 };
    emptyState(grid, {
      icon: "search",
      title: "Nothing matches",
      message: state.query.search
        ? `No item in your archive matches “${state.query.search}”.`
        : "No item matches these filters.",
      action: { label: "Clear filters", onClick: () => setQuery({ search: "", kind: "all", unseen: false, starred: false, author: null }) },
    });
    updateFab();
    return;
  }

  const rows = Math.ceil(list.length / cols);
  const totalHeight = rows * rowHeight;
  viewport.style.height = `${totalHeight}px`;

  const top = Math.max(0, viewport.getBoundingClientRect().top + window.scrollY);
  const start = Math.max(0, Math.floor((window.scrollY - top) / rowHeight) - OVERSCAN);
  const visibleRows = Math.ceil(window.innerHeight / rowHeight) + OVERSCAN * 2;
  const end = Math.min(rows, start + visibleRows);
  range = { first: Math.min(list.length, start * cols + 1), total: list.length };

  const key = `${start}:${end}:${cols}:${list.length}`;
  if (!force && key === grid.dataset.window) { updateFab(); return; }
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
  updateFab();
}

function onScroll() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; paintWindow(); });
}

/* ------------------------------------------------------------ refresh -- */

async function refresh() {
  const result = await refreshIndex();
  toast(result.fromCache ? "Already up to date" : "Archive updated");
}
