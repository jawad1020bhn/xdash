/* =============================================================================
   icons — one 24px grid, 2px strokes, round joins. Returned as elements so
   nothing is ever injected as a string.
   ========================================================================== */

const P = {
  home: '<path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4V15h-5v5.5h-4A1.5 1.5 0 0 1 4 19Z"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  play: '<path d="M8 5.5v13l11-6.5Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3 7 7M17 17l1.7 1.7M18.7 5.3 17 7M7 17l-1.7 1.7"/>',
  moon: '<path d="M20 13.6A8 8 0 1 1 10.4 4a6.6 6.6 0 0 0 9.6 9.6Z"/>',
  more: '<circle cx="12" cy="5.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.6" fill="currentColor" stroke="none"/>',
  spark: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4Z"/><path d="M18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/>',
  star: '<path d="m12 4 2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9L9.6 9Z"/>',
  starFill: '<path d="m12 4 2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9L9.6 9Z" fill="currentColor"/>',
  eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.9 5.2A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3 3.9M6.2 6.9A16.6 16.6 0 0 0 2.5 12S6 19 12 19a9.6 9.6 0 0 0 4-.9"/><path d="M9.6 9.9a2.9 2.9 0 0 0 4 4.1"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8l1.2 2.6 2.8-.6 1 2.6 2.7 1-.4 2.9 2 2.1-2 2.1.4 2.9-2.7 1-1 2.6-2.8-.6L12 21.2l-1.2-2.6-2.8.6-1-2.6-2.7-1 .4-2.9-2-2.1 2-2.1-.4-2.9 2.7-1 1-2.6 2.8.6Z"/>',
  keyboard: '<rect x="2.5" y="6.5" width="19" height="11" rx="2.5"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 13.5h.01M18 10h.01M18 13.5h.01M9 13.5h6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevronRight: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  chevronLeft: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  chevronDown: '<path d="m5.5 9.5 6.5 6.5 6.5-6.5"/>',
  arrowRight: '<path d="M4 12h15M13.5 6.5 19 12l-5.5 5.5"/>',
  arrowUpRight: '<path d="M7 17 17 7M9 7h8v8"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-9.7A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20Z"/>',
  bolt: '<path d="M13 3 5 13.5h6L11 21l8-10.5h-6Z"/>',
  download: '<path d="M12 4v10M7.5 10.5 12 15l4.5-4.5M4.5 19h15"/>',
  upload: '<path d="M12 15V5M7.5 9.5 12 5l4.5 4.5M4.5 19h15"/>',
  trash: '<path d="M4.5 7h15M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l1 12a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-12"/><path d="M10 11v6M14 11v6"/>',
  shuffle: '<path d="M3 6.5h3.5L17 17.5h4M21 17.5l-2.5-2.5M21 17.5l-2.5 2.5M3 17.5h3.5l2.6-3.4M14 9.4l3-2.9h4M21 6.5l-2.5-2.5M21 6.5l-2.5 2.5"/>',
  filter: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  sort: '<path d="M7 4.5v15M7 19.5 4 16.5M7 19.5l3-3M17 19.5v-15M17 4.5l-3 3M17 4.5l3 3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5"/>',
  archive: '<rect x="3.5" y="4" width="17" height="4.5" rx="1.5"/><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M10 12.5h4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M16 5.4a3.5 3.5 0 0 1 0 6.2M17.5 14.6a5.5 5.5 0 0 1 3 4.9"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4.5 17 4.8-4.5 3.7 3.4 3-2.7 3.5 3.3"/>',
  film: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M8 4.5v15M16 4.5v15M3.5 12h17M3.5 8.2H8M3.5 15.8H8M16 8.2h4.5M16 15.8h4.5"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8.5 16.5v-5M12.5 16.5V7.5M16.5 16.5v-3"/>',
  volume: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.8a7.5 7.5 0 0 1 0 10.4"/>',
  volumeOff: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  expand: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>',
  compress: '<path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5"/>',
  calendar: '<rect x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3.5v4M16 3.5v4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1.2-1.2"/>',
  bookmark: '<path d="M6 3.5h12A1 1 0 0 1 19 4.5v16l-7-3.8-7 3.8v-16a1 1 0 0 1 1-1Z" fill="currentColor" stroke="none"/>',
  fire: '<path d="M12 21c3.6 0 6.5-2.6 6.5-6.2 0-4.4-4-6.4-4.6-10.3-2 1.3-3 3.3-3 5.2-1.2-.6-2-1.7-2.3-3C7 8.4 5.5 11 5.5 14.2 5.5 18 8.4 21 12 21Z"/>',
  gauge: '<path d="M4.5 18a8.5 8.5 0 1 1 15 0"/><path d="M12 13.5 15.5 10"/><circle cx="12" cy="14" r="1.6" fill="currentColor" stroke="none"/>',
};

const cache = new Map();

/** icon("star", 20) → <svg>. Cached per name; size is set per call. */
export function icon(name, size = 20) {
  const key = name;
  let tpl = cache.get(key);
  if (!tpl) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = P[name] || P.info;
    tpl = svg;
    cache.set(key, tpl);
  }
  const clone = tpl.cloneNode(true);
  clone.setAttribute("width", size);
  clone.setAttribute("height", size);
  return clone;
}

export const hasIcon = (name) => name in P;
