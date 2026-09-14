/* =============================================================================
   largeTitle — the iOS large-title header.

   A 34pt display title with an eyebrow and a sub-row, which slides under the
   slim navbar as you scroll while the navbar's inline title crossfades in.
   The shell owns the navbar; this module owns the header and the handoff
   between the two.

   Usage: append largeTitle(...) to the view, then watchProminent(header) and
   call the returned detach on unmount or redraw.
   ============================================================================= */

import { h } from "../ui/dom.js";
import { setProminent } from "../shell.js";

export function largeTitle({ eyebrow, title }, ...children) {
  return h("header.large-title",
    eyebrow ? h("p.large-title__eyebrow", { text: eyebrow }) : null,
    h("h1.large-title__title", { text: title }),
    children.length ? h("div.large-title__row", ...children) : null,
  );
}

/**
 * Tracks the header against the navbar's real bottom edge (safe areas move
 * it around) and tells the shell whether the large title still owns the top
 * of the screen. One layout read per scroll frame, rAF-throttled.
 */
export function watchProminent(el, { offset = 28 } = {}) {
  const bar = document.getElementById("navbar");
  let frame = 0;

  const probe = () => {
    frame = 0;
    const limit = (bar?.getBoundingClientRect().bottom ?? 64) - offset;
    setProminent(el.getBoundingClientRect().top > limit);
  };
  const onScroll = () => {
    if (!frame) frame = requestAnimationFrame(probe);
  };

  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  probe();

  return () => {
    removeEventListener("scroll", onScroll);
    removeEventListener("resize", onScroll);
    if (frame) cancelAnimationFrame(frame);
    setProminent(false);
  };
}
