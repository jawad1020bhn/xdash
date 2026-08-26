/* =============================================================================
   icons — a single 24px set, returned as real SVG elements.

   Returning elements rather than markup strings means an icon can never be a
   vector for injected HTML, and callers can attach listeners to it directly.
   ============================================================================= */

const NS = "http://www.w3.org/2000/svg";

/* Filled shapes. `stroke` entries below are drawn instead of filled. */
const FILLED = {
  home: "M12 3 3 10.2V21h6v-6h6v6h6V10.2L12 3Z",
  grid: "M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z",
  play: "M8 5.2v13.6L19 12 8 5.2Z",
  search: "M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z",
  close: "m12 10.6 5-5 1.4 1.4-5 5 5 5-1.4 1.4-5-5-5 5-1.4-1.4 5-5-5-5L7 5.6l5 5Z",
  check: "M9.6 16.6 5 12l-1.4 1.4L9.6 19.4 21 8l-1.4-1.4-9 10Z",
  more: "M12 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z",
  chevronLeft: "M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12l4.6-4.6Z",
  chevronRight: "M8.6 16.6 10 18l6-6-6-6-1.4 1.4L13.2 12l-4.6 4.6Z",
  chevronDown: "M7.4 8.6 6 10l6 6 6-6-1.4-1.4L12 13.2 7.4 8.6Z",
  arrowLeft: "M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20v-2Z",
  arrowRight: "M4 11h12.2l-5.6-5.6L12 4l8 8-8 8-1.4-1.4L16.2 13H4v-2Z",
  external: "M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14V3ZM5 5h5v2H6v11h11v-4h2v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  copy: "M8 2h10a2 2 0 0 1 2 2v12h-2V4H8V2ZM4 6h11a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm1 2v12h9V8H5Z",
  trash: "M9 3h6l1 2h4v2H4V5h4l1-2ZM6 9h12l-.8 11.1a1 1 0 0 1-1 .9H7.8a1 1 0 0 1-1-.9L6 9Z",
  download: "M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4L11 12.2V3ZM4 18h16v3H4v-3Z",
  upload: "M12 3.4 17.7 9l-1.4 1.4L13 7.2V16h-2V7.2L7.7 10.4 6.3 9 12 3.4ZM4 18h16v3H4v-3Z",
  settings: "M12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Zm7.4-2.6.1-.9-.1-.9 1.9-1.5-1.9-3.3-2.3.9a7 7 0 0 0-1.6-.9l-.3-2.4H9.8l-.3 2.4c-.6.2-1.1.5-1.6.9l-2.3-.9-1.9 3.3 1.9 1.5-.1.9.1.9-1.9 1.5 1.9 3.3 2.3-.9c.5.4 1 .7 1.6.9l.3 2.4h4.4l.3-2.4c.6-.2 1.1-.5 1.6-.9l2.3.9 1.9-3.3-1.9-1.5Z",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM11 1h2v3h-2V1Zm0 19h2v3h-2v-3ZM1 11h3v2H1v-2Zm19 0h3v2h-3v-2ZM4.2 5.6 5.6 4.2l2.1 2.1-1.4 1.4-2.1-2.1Zm12.1 12.1 1.4-1.4 2.1 2.1-1.4 1.4-2.1-2.1Zm2.1-12.1 2.1-2.1 1.4 1.4-2.1 2.1-1.4-1.4ZM5.6 17.7l2.1-2.1 1.4 1.4-2.1 2.1-1.4-1.4Z",
  moon: "M12.5 3a9 9 0 1 0 8.5 12 7 7 0 0 1-8.5-12Z",
  filter: "M3 5h18v2.6l-7 7V21l-4-2v-4.4l-7-7V5Z",
  sort: "M3 6h12v2H3V6Zm0 5h9v2H3v-2Zm0 5h6v2H3v-2Zm14.5-9L21 10.5h-2.5V19h-2v-8.5H14L17.5 7Z",
  eye: "M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  eyeOff: "M2.4 3.8 3.8 2.4l17.8 17.8-1.4 1.4-3.2-3.2A10 10 0 0 1 12 19c-5 0-9-4.5-9-7 0-1.4 1.3-3.4 3.4-5L2.4 3.8ZM12 5c5 0 9 4.5 9 7 0 1.1-.8 2.7-2.4 4.2l-3-3A4 4 0 0 0 10.8 8L8.9 6.1C9.9 5.4 11 5 12 5Z",
  heart: "M12 20.5 4.2 13a4.8 4.8 0 0 1 6.8-6.8l1 1 1-1A4.8 4.8 0 0 1 19.8 13L12 20.5Z",
  volume: "M4 9h3l5-4v14l-5-4H4V9Zm12.5-1.5 1.4-1.4A8 8 0 0 1 18 12a8 8 0 0 1-.1 5.9l-1.4-1.4A6 6 0 0 0 16.5 12a6 6 0 0 0 0-4.5Z",
  mute: "M4 9h3l5-4v14l-5-4H4V9Zm12.3.3 1.4-1.4 2.1 2.1 2.1-2.1 1.4 1.4-2.1 2.1 2.1 2.1-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2.1-2.1-2.1Z",
  fullscreen: "M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z",
  pip: "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v12h14V6H5Zm7 5h6v5h-6v-5Z",
  pause: "M7 5h4v14H7V5Zm6 0h4v14h-4V5Z",
  next: "M6 5 15 12l-9 7V5Zm10 0h2v14h-2V5Z",
  prev: "M18 5 9 12l9 7V5ZM8 5H6v14h2V5Z",
  layers: "M12 2 2 8l10 6 10-6-10-6ZM2 12.5 12 18.5l10-6 2 1.2-12 7.2L0 13.7l2-1.2Z",
  clock: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm1 5h-2v6l5 3 1-1.7-4-2.3V7Z",
  spark: "M12 2 9.6 8.6 3 11l6.6 2.4L12 20l2.4-6.6L21 11l-6.6-2.4L12 2Z",
  archive: "M3 4h18v4H3V4Zm1 6h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9Zm5 3v2h6v-2H9Z",
  archiveOff: "M3 4h18v4h-8.3l-2-2H3V4Zm13.2 8H20v7a1 1 0 0 1-1 1h-6.6l-2-2H20v-6h-3.8ZM3.5 2.1 22 20.6l-1.4 1.4-4.4-4.4H5a1 1 0 0 1-1-1v-9h2v7h.6L2.1 3.5 3.5 2.1Z",
  user: "M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 10c4.4 0 8 2.2 8 4v2H4v-2c0-1.8 3.6-4 8-4Z",
  link: "M10.6 13.4a1 1 0 0 1 0-1.4l3-3a3.5 3.5 0 0 1 5 5l-1.6 1.5-1.4-1.4 1.5-1.5a1.5 1.5 0 0 0-2.1-2.2l-3 3a1 1 0 0 1-1.4 0Zm2.8-2.8a1 1 0 0 1 0 1.4l-3 3a1.5 1.5 0 0 0 2.1 2.2l1.6-1.6 1.4 1.4-1.5 1.6a3.5 3.5 0 0 1-5-5l3-3a1 1 0 0 1 1.4 0Z",
  plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z",
  refresh: "M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z",
  info: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm1 8h-2v8h2v-8Zm0-4h-2v2h2V6Z",
  warning: "M12 2 1 21h22L12 2Zm1 13h-2v2h2v-2Zm0-6h-2v4h2V9Z",
  lock: "M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3Z",
  image: "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 13h14l-4.5-6-3.5 4.5-2.5-3L5 17Zm3-7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  video: "M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm6 3v6l5-3-5-3ZM7 19h10v2H7v-2Z",
  keyboard: "M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm2 3v2h2V9H5Zm4 0v2h2V9H9Zm4 0v2h2V9h-2Zm4 0v2h2V9h-2ZM5 13v2h2v-2H5Zm4 0v2h6v-2H9Zm8 0v2h2v-2h-2Z",
  database: "M12 2c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Zm8 6.5c0 1.7-3.6 3-8 3s-8-1.3-8-3V12c0 1.7 3.6 3 8 3s8-1.3 8-3V8.5Zm0 5c0 1.7-3.6 3-8 3s-8-1.3-8-3V17c0 1.7 3.6 3 8 3s8-1.3 8-3v-3.5Z",
  shuffle: "M17 3h4v4h-2V6.4l-4 4-1.4-1.4 4-4H17V3ZM3 6h4.6l4 4-1.4 1.4L6.8 8H3V6Zm11.6 6L19 16.4V15h2v4h-4v-2h1.4L15 13.4l1.6-1.4ZM3 16h3.8l2-2 1.4 1.4-2 2H3v-2Z",
  star: "M12 2 9.6 8.6 3 11l6.6 2.4L12 20l2.4-6.6L21 11l-6.6-2.4L12 2Z",
  bolt: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
};

const STROKED = {
  wave: "M3 12c1.6 0 1.6-4 3.2-4s1.6 8 3.2 8 1.6-8 3.2-8 1.6 4 3.2 4 1.6-4 3.2-4 1.6 8 3.2 8 1.6-8 3.2-8 1.6 4 3.2 4",
};

/** Returns an <svg> element. Unknown names return an empty span, never a crash. */
export function icon(name, size = 20, opts = {}) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (opts.class) svg.setAttribute("class", opts.class);

  const filled = FILLED[name];
  const stroked = STROKED[name];
  if (filled) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", filled);
    path.setAttribute("fill", "currentColor");
    svg.append(path);
  } else if (stroked) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", stroked);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    svg.append(path);
  }
  return svg;
}

export const ICON_NAMES = Object.keys(FILLED).concat(Object.keys(STROKED));
