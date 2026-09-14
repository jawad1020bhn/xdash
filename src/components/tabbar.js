/* =============================================================================
   tabbar — the phone's primary control.

   Three destinations, icon over a 10pt label, translucent blur, exactly like
   the platform tab bar people already know. The shell owns what a tap *does*;
   this component owns how it looks and feels.

   Icon direction (slice 6): iOS pairs an outlined glyph at rest with a filled
   one when active. The set in ui/icons.js is filled-only today, so both states
   share the filled glyph and colour carries the meaning — accent at rest
   would be wrong, so rest is a tertiary label tone.
   ============================================================================= */

import { h, icon, clear, haptic } from "../ui/dom.js";

/**
 * @param host     the <nav> element to build into
 * @param routes   [{ id, label, icon }]
 * @param onSelect called with the route id on every tap, including re-taps
 * @returns        { setActive } — paints which destination is current
 */
export function buildTabBar(host, routes, onSelect) {
  clear(host);
  const items = new Map();

  for (const route of routes) {
    const item = h("button.tabbar__item", {
      type: "button",
      dataset: { route: route.id },
      "aria-label": route.title || route.label,
      onclick: () => {
        haptic(8);
        onSelect(route.id);
      },
    },
      icon(route.icon, 25),
      h("span", { text: route.label }),
    );
    host.append(item);
    items.set(route.id, item);
  }

  function setActive(id) {
    for (const [key, item] of items) {
      if (key === id) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    }
  }

  return { setActive };
}
