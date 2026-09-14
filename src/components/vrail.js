/* =============================================================================
   vrail — a virtualized horizontal rail.

   Home holds five rails of up to twelve rich cards each. Rendered naively
   that is sixty card subtrees with sixty image requests on the first paint. Instead each rail renders only the window around the viewport
   (plus overscan) and holds its scroll width honest with spacers, reusing
   card nodes by id as the window moves — the same technique as the Library
   grid, turned sideways.

   Scroll position survives view redraws: it is remembered per scrollKey in
   module state, so starring something in the viewer does not fling every
   rail back to its start.
   ============================================================================= */

import { h, reducedMotion } from "../ui/dom.js";

const savedScroll = new Map();

export function vrail(items, { label, render, scrollKey = null, overscan = 2 } = {}) {
  const track = h("div.rail__track", { role: "group", "aria-label": label || "Items" });
  const scroller = h("div.rail__scroll", track);
  const nodes = new Map();

  let stride = 180; // card width + gap; re-measured from layout below
  let frame = 0;
  let destroyed = false;
  let window_ = { start: -1, end: -1 };

  function measure() {
    const first = track.querySelector(":scope > .card");
    if (first && first.offsetWidth > 0) {
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      stride = first.offsetWidth + gap;
    }
  }

  function paint(force = false) {
    if (destroyed) return;
    const n = items.length;
    if (!n) return;

    const sl = scroller.scrollLeft || 0;
    const vw = scroller.clientWidth || 0;
    let start, end;
    if (vw <= 0 || stride <= 0) {
      /* No layout yet (or no layout at all, as in tests): the first window. */
      start = 0;
      end = Math.min(n, 8);
    } else {
      start = Math.max(0, Math.floor(sl / stride) - overscan);
      end = Math.min(n, start + Math.ceil(vw / stride) + 1 + overscan * 2);
    }
    if (!force && start === window_.start && end === window_.end) return;
    window_ = { start, end };

    const frag = document.createDocumentFragment();
    const keep = new Set();
    if (start > 0) {
      frag.append(h("div.rail__spacer",
        { style: { width: `${Math.round(start * stride)}px` }, "aria-hidden": "true" }));
    }
    for (let i = start; i < end; i++) {
      const item = items[i];
      keep.add(item.id);
      let node = nodes.get(item.id);
      if (!node) {
        node = render(item, i);
        nodes.set(item.id, node);
      }
      node.dataset.idx = String(i);
      frag.append(node);
    }
    if (n - end > 0) {
      frag.append(h("div.rail__spacer",
        { style: { width: `${Math.round((n - end) * stride)}px` }, "aria-hidden": "true" }));
    }
    for (const [id, node] of nodes) {
      if (!keep.has(id)) { nodes.delete(id); node.remove(); }
    }
    track.replaceChildren(frag);
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
      if (scrollKey) savedScroll.set(scrollKey, scroller.scrollLeft);
    });
  }

  function onKey(e) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const active = document.activeElement;
    if (!active || !track.contains(active)) return;
    e.preventDefault();
    const at = Number(active.dataset.idx || 0) + (e.key === "ArrowRight" ? 1 : -1);
    const clamped = Math.max(0, Math.min(items.length - 1, at));
    if (clamped < window_.start || clamped >= window_.end) {
      scroller.scrollLeft = Math.max(0, clamped * stride - scroller.clientWidth / 2);
      measure();
      paint(true);
    }
    const target = track.querySelector(`[data-idx="${clamped}"]`);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({
      inline: "nearest", block: "nearest",
      behavior: reducedMotion() ? "auto" : "smooth",
    });
  }

  scroller.addEventListener("scroll", schedule, { passive: true });
  scroller.addEventListener("keydown", onKey);
  const onResize = () => { measure(); paint(true); };
  addEventListener("resize", onResize, { passive: true });

  if (scrollKey && savedScroll.has(scrollKey)) {
    scroller.scrollLeft = savedScroll.get(scrollKey);
  }
  paint(true);
  /* First paint runs before layout settles; re-measure once it has. */
  requestAnimationFrame(() => {
    if (destroyed) return;
    measure();
    paint(true);
  });

  return {
    el: scroller,
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
      scroller.removeEventListener("keydown", onKey);
      removeEventListener("resize", onResize);
      nodes.clear();
    },
  };
}
