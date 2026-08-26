/* =============================================================================
   card — one component, three shapes.

   `tile`   the grid cell in Library
   `rail`   the wider card in a horizontal strip on Home
   `hero`   the single large feature at the top of Home

   All three are the same element underneath, which is why selection, seen
   state, long-press actions and keyboard behaviour only have to be written
   once. That is the whole reason this file exists.
   ============================================================================= */

import { h, icon, isTouch, haptic } from "./dom.js";
import { thumb, avatar, describe, fmtCount, fmtAgo, fmtDuration } from "./media.js";
import { state, isViewed, isStarred, toggleSelected, markStarred } from "../core/state.js";
import { post as postOf } from "../core/query.js";
import { openViewer } from "../viewer.js";
import { openItemActions } from "./actions.js";

/**
 * @param item   projected media item
 * @param list   the full list this card belongs to, so the viewer can step
 * @param shape  "tile" | "rail" | "hero"
 */
export function card(item, list, { shape = "tile", eager = false, index = -1 } = {}) {
  const p = postOf(item);
  const at = index >= 0 ? index : list.indexOf(item);

  const el = h(`article.card.card--${shape}`, {
    tabindex: "0",
    role: "button",
    "aria-label": describe(item, p),
    dataset: { mediaId: item.id, viewed: isViewed(item.id) ? "true" : "false",
               selected: state.ui.selected.has(item.id) ? "true" : "false" },
  });

  const figure = thumb(item, p, { eager, sizes: shape === "hero" ? "min(100vw, 900px)" : "320px" });
  el.append(figure);

  /* A progress bar on anything already part-watched — the cheapest possible
     way to show "you were here" without a badge or a modal. */
  const progress = state.library.progress[item.id];
  if (progress && item.dur > 0) {
    figure.append(h("span.card__progress",
      h("span", { style: { width: `${Math.min(100, (progress / item.dur) * 100)}%` } }),
    ));
  }

  /* Starred marker — always visible, because it is a state the user set. */
  if (isStarred(item.id)) {
    figure.append(h("span.card__star", icon("star", 14)));
  }

  /* Selection affordance. On touch there is no hover, so a long press is the
     only way in; the checkbox appears for everyone once selection starts. */
  const pick = h("span.tile__pick", { "aria-hidden": "true" }, icon("check", 15));
  el.append(pick);

  if (shape !== "tile" || state.prefs.density !== "compact") {
    el.append(h("div.tile__meta",
      avatar(p.author_profile_image_url, 20, p.author_name),
      h("span.tile__name", { text: p.author_name || p.author_username || "Unknown" }),
      h("span.tile__seen", icon("check", 14)),
    ));
  }

  if (shape === "rail" || shape === "hero") {
    el.append(h("div.card__body",
      p.text ? h("p.card__text", { text: p.text.slice(0, shape === "hero" ? 220 : 110) }) : null,
      h("div.card__facts",
        h("span", {}, `@${p.author_username || "unknown"}`),
        p.like_count_at_capture ? h("span", {}, icon("heart", 12), fmtCount(p.like_count_at_capture)) : null,
        item.dur ? h("span", { text: fmtDuration(item.dur) }) : null,
        p.capturedAt ? h("span", { text: fmtAgo(p.capturedAt) }) : null,
      ),
    ));
  }

  /* ---------------------------------------------------------- behaviour -- */

  function activate() {
    if (state.ui.selecting) { toggle(); return; }
    haptic(10);
    openViewer(list, Math.max(0, at));
  }
  function toggle() {
    const on = toggleSelected(item.id);
    el.dataset.selected = on ? "true" : "false";
    haptic(12);
  }

  el.addEventListener("click", activate);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openItemActions(item, list, at, el);
  });

  /* Long press = the touch equivalent of a right click. 450ms is long enough
     to survive a scroll gesture and short enough to feel intentional. */
  if (isTouch()) {
    let timer = 0;
    let moved = false;
    let startX = 0, startY = 0;
    el.addEventListener("pointerdown", (e) => {
      moved = false;
      startX = e.clientX; startY = e.clientY;
      timer = setTimeout(() => {
        if (!moved) { haptic(18); openItemActions(item, list, at, el); }
      }, 450);
    });
    el.addEventListener("pointermove", (e) => {
      if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) {
        moved = true; clearTimeout(timer);
      }
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((n) =>
      el.addEventListener(n, () => clearTimeout(timer)));
  }

  return el;
}

/**
 * Re-syncs the seen/selected markers after a state change, without rebuilding
 * the grid. With 1,200 tiles on screen, a full re-render on every star tap is
 * the difference between a UI that answers and one that stutters.
 */
export function syncCards(root = document) {
  for (const el of root.querySelectorAll(".card[data-media-id]")) {
    const id = el.dataset.mediaId;
    const nextViewed = isViewed(id) ? "true" : "false";
    if (el.dataset.viewed !== nextViewed) el.dataset.viewed = nextViewed;

    const nextSelected = state.ui.selected.has(id) ? "true" : "false";
    if (el.dataset.selected !== nextSelected) el.dataset.selected = nextSelected;

    const star = el.querySelector(".card__star");
    const starred = isStarred(id);
    if (starred && !star) {
      el.querySelector(".media")?.append(h("span.card__star", icon("star", 14)));
    } else if (!starred && star) {
      star.remove();
    }
  }
  document.body.dataset.selecting = state.ui.selecting ? "true" : "false";
}

/** A horizontal strip of cards. Native scroll on touch, arrow keys anywhere. */
export function rail(items, { eager = 0, label } = {}) {
  const track = h("div.rail__track", {
    role: "group", "aria-label": label || "Items",
  });
  items.forEach((item, i) => track.append(card(item, items, { shape: "rail", eager: i < eager })));

  const scroller = h("div.rail__scroll", track);

  /* Arrow keys walk the strip without stealing page scroll, and only when the
     strip actually has focus. */
  scroller.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    if (!scroller.contains(document.activeElement)) return;
    e.preventDefault();
    const cards = [...track.children];
    const i = cards.indexOf(document.activeElement);
    const next = cards[Math.max(0, Math.min(cards.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)))];
    next?.focus({ preventScroll: true });
    next?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  });

  return scroller;
}
