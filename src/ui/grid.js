/* =============================================================================
   grid v3.1 — the windowed media grid, shared by Home and Library.

   1,205 items would be 1,205 DOM subtrees and 1,205 image requests. Instead
   tiles are positioned absolutely inside a box whose height equals the whole
   list, and only the rows near the viewport exist. Geometry is computed from
   the container's real width, so holes and mis-sized rows are impossible at
   any breakpoint.
   ========================================================================== */

import { h, icon, onBreakpoint } from "./dom.js";

const OVERSCAN = 2;
const META_H = 30;   /* the author line under each tile */

/**
 * createGrid(host, getList, { emptyBuilder, ariaLabel })
 *   → { el, refresh(reset), sync(fn), destroy() }
 *
 * getList() is read at paint time, so the owner only has to call refresh()
 * when its inputs change.
 */
export function createGrid(host, getList, { emptyBuilder, ariaLabel = "Archive items" } = {}) {
  let grid = null;
  let cols = 1, colW = 0, rowH = 0, gap = 10, gridTop = 0, rows = 0;
  let rangeStart = -1, rangeEnd = -1, frame = 0;
  const nodes = new Map();
  const unsubs = [];

  grid = h("div.grid", { role: "list", "aria-label": ariaLabel });
  host.append(grid);

  unsubs.push(onBreakpoint(() => { measure(); paint(true); }));
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  unsubs.push(() => {
    removeEventListener("scroll", onScroll);
    removeEventListener("resize", onScroll);
  });

  function measure() {
    if (!grid) return;
    const cs = getComputedStyle(document.documentElement);
    const min = parseFloat(cs.getPropertyValue("--tile-min")) || 172;
    gap = parseFloat(cs.getPropertyValue("--gap")) || 10;
    const aspect = (cs.getPropertyValue("--tile-aspect") || "4 / 5").split("/").map(Number);
    const ratio = (aspect[0] || 4) / (aspect[1] || 5);

    const w = grid.clientWidth || host.clientWidth || 360;
    cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
    colW = (w - gap * (cols - 1)) / cols;
    rowH = colW / ratio + META_H;

    rows = Math.ceil(getList().length / cols);
    grid.style.height = `${Math.max(rows * (rowH + gap) - gap, 0)}px`;
    gridTop = grid.getBoundingClientRect().top + window.scrollY;
  }

  function onScroll() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; paint(false); });
  }

  function paint(reset) {
    if (!grid) return;
    if (reset) { nodes.forEach((el) => el.remove()); nodes.clear(); rangeStart = rangeEnd = -1; }

    const list = getList();
    if (!list.length) {
      if (!grid.querySelector(".empty")) {
        grid.style.height = "auto";
        grid.append(emptyBuilder ? emptyBuilder() : defaultEmpty());
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

    if (!reset && start === rangeStart && end === rangeEnd) return;
    rangeStart = start; rangeEnd = end;

    const wanted = new Set();
    for (let i = start; i < end; i++) {
      const item = list[i];
      wanted.add(item.id);
      let el = nodes.get(item.id);
      if (!el) {
        el = tileFor(item, list, i);
        nodes.set(item.id, el);
        grid.append(el);
      }
      place(el, i);
    }
    for (const [id, el] of nodes) {
      if (!wanted.has(id)) { el.remove(); nodes.delete(id); }
    }
  }

  function tileFor(item, list, i) {
    /* Imported lazily-ish (static import would cycle): card.js owns tiles. */
    const el = buildTile(item, list, i);
    el.setAttribute("role", "listitem");
    return el;
  }

  function place(el, i) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    el.style.left = `${col * (colW + gap)}px`;
    el.style.top = `${row * (rowH + gap)}px`;
    el.style.width = `${colW}px`;
    el.style.height = `${rowH}px`;
  }

  function refresh(reset = false) {
    measure();
    paint(reset);
  }

  function destroy() {
    unsubs.forEach((fn) => fn());
    nodes.clear();
    grid?.remove();
    grid = null;
  }

  /* Prime the window once layout settles so the first paint is never empty. */
  queueMicrotask(() => { measure(); paint(false); });

  return {
    get el() { return grid; },
    refresh,
    destroy,
    /** Patch tile state (star/seen/selection) in place. */
    sync(syncFn) { if (grid) syncFn(grid); },
  };
}

let buildTile = () => h("div");
/** card.js registers its tile builder here to avoid an import cycle. */
export function registerTileBuilder(fn) { buildTile = fn; }

function defaultEmpty() {
  return h("div.empty", { style: { position: "static" } },
    h("div.empty__icon", icon("grid", 26)),
    h("h2", { text: "Nothing here yet" }),
  );
}
