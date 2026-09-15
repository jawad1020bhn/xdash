/* =============================================================================
   grid v3.2 — the windowed media grid, shared by Home and Library.

   1,205 items would be 1,205 DOM subtrees and 1,205 image requests. Instead
   tiles are positioned absolutely inside a box whose height equals the whole
   list, and only the tiles near the viewport exist.

   Tiles keep the REAL aspect ratio of their photo or video (the export
   carries width/height for every item) and are packed shortest-column-first,
   Pinterest-style. A landscape clip and a portrait clip therefore sit side by
   side without either being centre-cropped into a stranger's framing — the
   old fixed-row layout did exactly that. Extreme ratios are clamped so a
   cinemascope frame cannot eat a whole screen. Geometry is computed from the
   container's real width, so holes are impossible at any breakpoint.
   ========================================================================== */

import { h, icon, onBreakpoint } from "./dom.js";
import { itemAspect } from "./media.js";

const OVERSCAN = 2;
const META_H = 27;    /* author line: 7px top padding + a 20px avatar */

/**
 * createGrid(host, getList, { emptyBuilder, ariaLabel })
 *   → { el, refresh(reset), sync(fn), destroy() }
 *
 * getList() is read at measure/paint time, so the owner only has to call
 * refresh() when its inputs change.
 */
export function createGrid(host, getList, { emptyBuilder, ariaLabel = "Archive items" } = {}) {
  let grid = null;
  let cols = 1, colW = 0, gap = 10, gridTop = 0, listLen = 0;
  let activeId = null;   /* roving tabindex: the one tabbable tile */
  let positions = [];          /* { x, y, h } per list index          */
  let rangeStart = -1, rangeEnd = -1, frame = 0;
  const nodes = new Map();
  const unsubs = [];

  grid = h("div.grid", { role: "list", "aria-label": ariaLabel });
  host.append(grid);
  grid.addEventListener("keydown", onKey);
  grid.addEventListener("focusin", (e) => {
    const t = e.target.closest?.(".tile");
    if (t && t.dataset.id !== activeId) { activeId = t.dataset.id; syncTabindex(); }
  });

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
    const fallback = (aspect[0] || 4) / (aspect[1] || 5);

    const list = getList();
    listLen = list.length;
    const w = grid.clientWidth || host.clientWidth || 360;
    cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
    colW = (w - gap * (cols - 1)) / cols;

    /* Shortest-column packing: each item drops into whichever column is
       currently shortest, so the ragged right edge masonry would have in a
       row layout is shared across every column instead. */
    const colH = new Array(cols).fill(0);
    positions = new Array(list.length);
    for (let i = 0; i < list.length; i++) {
      let c = 0;
      for (let k = 1; k < cols; k++) if (colH[k] < colH[c]) c = k;
      const mediaH = colW / itemAspect(list[i], fallback);
      const h = mediaH + META_H;
      positions[i] = { x: c * (colW + gap), y: colH[c], h };
      colH[c] += h + gap;
    }

    const total = Math.max(0, ...colH) - gap;
    grid.style.height = `${Math.max(total, 0)}px`;
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

    /* Visibility is per-tile now (columns end at different heights), so a
       cheap linear scan replaces the old first-row/last-row maths. 1,205
       float compares is well under a frame. */
    const vh = window.innerHeight;
    const top = window.scrollY - gridTop;
    const bottom = top + vh;
    const wanted = new Set();
    let first = -1, last = -1;
    for (let i = 0; i < list.length; i++) {
      const p = positions[i];
      if (!p) continue;
      if (p.y < bottom + OVERSCAN * 320 && p.y + p.h > top - OVERSCAN * 320) {
        wanted.add(list[i].id);
        if (first < 0) first = i;
        last = i;
      }
    }

    /* The index band determines the wanted set exactly for a static list,
       so equal bands between scroll frames mean nothing to do. */
    if (!reset && first === rangeStart && last === rangeEnd) return;
    rangeStart = first; rangeEnd = last;

    for (let i = Math.max(0, first); i <= last && i >= 0; i++) {
      const item = list[i];
      if (!wanted.has(item.id)) continue;
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
    let el;
    try {
      el = buildTile(item, list, i);
    } catch (err) {
      console.error("[grid] tile failed to build", err);
      el = h("button.tile", {
        type: "button", dataset: { id: item.id },
        "aria-label": "An item that could not be drawn",
      }, h("div.tile__media", h("span.vid-fallback", { text: "Couldn't draw this tile" })));
    }
    el.setAttribute("role", "listitem");
    el.tabIndex = item.id === activeId ? 0 : -1;
    return el;
  }

  function place(el, i) {
    const p = positions[i];
    if (!p) return;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.width = `${colW}px`;
    el.setAttribute("aria-posinset", String(i + 1));
    el.setAttribute("aria-setsize", String(listLen));
  }

  /* Arrow-key travel across the windowed grid, with a roving tabindex so
     fifty tiles cost one Tab stop. Targets outside the window scroll into
     it, then take focus once painted. */
  function onKey(e) {
    const t = e.target.closest?.(".tile");
    if (!t) return;
    const list = getList();
    const cur = list.findIndex((m) => m.id === t.dataset.id);
    if (cur < 0) return;
    let next = -1;
    if (e.key === "ArrowRight") next = cur + 1;
    else if (e.key === "ArrowLeft") next = cur - 1;
    else if (e.key === "ArrowDown") next = cur + cols;
    else if (e.key === "ArrowUp") next = cur - cols;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = list.length - 1;
    else return;
    e.preventDefault();
    focusIndex(Math.max(0, Math.min(list.length - 1, next)));
  }

  function focusIndex(i) {
    const list = getList();
    const item = list[i];
    if (!item) return;
    activeId = item.id;
    const el = nodes.get(item.id);
    if (el) {
      syncTabindex();
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest" });
      return;
    }
    const p = positions[i];
    if (p) scrollTo({ top: Math.max(0, gridTop + p.y - window.innerHeight / 2), behavior: "instant" });
    setTimeout(() => { syncTabindex(); nodes.get(item.id)?.focus({ preventScroll: true }); }, 140);
  }

  function syncTabindex() {
    for (const [id, el] of nodes) el.tabIndex = id === activeId ? 0 : -1;
  }

  function refresh(reset = false) {
    measure();
    if (!getList().some((m) => m.id === activeId)) activeId = getList()[0]?.id ?? null;
    paint(reset);
    syncTabindex();
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
