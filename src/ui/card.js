/* =============================================================================
   card v3.1 — the media tile.

   The tile is a <button>: the whole media surface opens the viewer, and the
   hover veil carries the two actions you actually use there — star and more.
   In selection mode the tap flips to the checkbox instead, which is the one
   gesture that must never mis-fire.
   ========================================================================== */

import { h, icon } from "./dom.js";
import { state, isStarred, isViewed, toggleSelected, markStarred, getProgress } from "../core/state.js";
import { post } from "../core/query.js";
import { mediaBox, avatar, fmtCount } from "./media.js";
import { registerTileBuilder } from "./grid.js";

export function tile(item, list, { eager = false, index } = {}) {
  const p = post(item);
  const idx = index ?? (Array.isArray(list) ? list.indexOf(item) : 0);

  const el = h("button.tile", {
    type: "button",
    dataset: { id: item.id, postId: item.postId },
    "aria-label": `Open ${item.kind === "photo" ? "photo" : "video"} by ${p.author_name || p.author_username}`,
  });

  const veil = h("div.tile__veil",
    starBtn(item),
    h("button.tile__act", {
      type: "button", "aria-label": "More actions",
      onclick: (e) => { e.stopPropagation(); openActions(item); },
    }, icon("more", 16)),
  );

  const media = mediaBox(item, p, { eager, sizes: "(max-width: 719px) 46vw, 220px" });
  media.append(veil);
  /* On-frame state: the star (touch has no hover veil) and the resume
     hairline for clips parked part-way through. */
  media.append(h("span.tile__star", { "aria-hidden": "true" }, icon("starFill", 12)));
  media.append(h("span.tile__progress", { "aria-hidden": "true" }, h("i")));

  const meta = h("div.tile__meta",
    avatar(p.author_profile_image_url, 20, p.author_name),
    h("span.tile__who", { text: p.author_name || p.author_username || "unknown" }),
    p.like_count_at_capture ? h("span.tile__stat", icon("heart", 11), fmtCount(p.like_count_at_capture)) : null,
  );

  el.append(media, meta);

  el.addEventListener("click", () => {
    if (state.ui.selecting) { toggleSelected(item.id); paint(el, item); return; }
    import("../viewer.js").then(({ openViewer }) => openViewer(list, idx));
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    toggleSelected(item.id);
    paint(el, item);
  });

  paint(el, item);
  return el;
}

/* The shared grid builds its tiles through us, without an import cycle. */
registerTileBuilder((item, list, i) => tile(item, list, { index: i, eager: i < 4 }));

/**
 * A horizontally scrollable strip of tiles, as used by Home's rails.
 * `items` doubles as the viewer's swipe list, so swiping inside a rail walks
 * that rail — not the whole archive.
 */
export function rail(items, { label, eager = 2 } = {}) {
  const strip = h("div.rail", { role: "group", "aria-label": label, tabindex: "0" });
  items.forEach((item, i) => {
    const t = tile(item, items, { eager: i < eager, index: i });
    t.style.setProperty("--i", String(Math.min(i, 11)));   /* entrance stagger */
    strip.append(t);
  });
  return strip;
}

function starBtn(item) {
  return h("button.tile__act", {
    type: "button",
    "aria-label": isStarred(item.id) ? "Remove star" : "Star this item",
    onclick: (e) => {
      e.stopPropagation();
      const on = markStarred(item.id);
      e.currentTarget.classList.toggle("is-on", on);
      e.currentTarget.replaceChildren(icon(on ? "starFill" : "star", 16));
    },
  }, icon(isStarred(item.id) ? "starFill" : "star", 16));
}

function paint(el, item) {
  el.classList.toggle("is-starred", isStarred(item.id));
  el.classList.toggle("is-seen", state.prefs.dimSeen && isViewed(item.id));
  el.classList.toggle("is-selected", state.ui.selected.has(item.id));
  el.setAttribute("aria-pressed", state.ui.selected.has(item.id) ? "true" : "false");
  const bar = el.querySelector(".tile__progress i");
  const secs = getProgress(item.id);
  const pct = item.dur > 5 && secs > 1 ? Math.min(100, (secs / item.dur) * 100) : 0;
  el.classList.toggle("has-progress", pct > 0);
  if (bar) bar.style.width = `${pct}%`;
}

/** Patch star / seen / selection state in place after a store change. */
export function syncTiles(root) {
  for (const el of root.querySelectorAll(".tile")) {
    const item = state.index.media.find((m) => m.id === el.dataset.id);
    if (item) paint(el, item);
  }
}

async function openActions(item) {
  const { itemActions } = await import("./actions.js");
  itemActions(item);
}
