/* =============================================================================
   UI kit — icons, formatting, and a tiny DOM builder.

   Deliberately dependency-free and side-effect free: everything here is a pure
   helper the views compose. Exposed as window.XBUI.
   ============================================================================= */
(function (root) {
  "use strict";

  /* ---------------------------------------------------------------- icons --
     One flat set, 24px grid, single-path where possible. Rendered through
     icon() so stroke/size policy stays in one place. */
  const PATHS = {
    discover: "M12 2 9.6 8.6 3 11l6.6 2.4L12 20l2.4-6.6L21 11l-6.6-2.4L12 2Z",
    library: "M4 5h6v6H4V5Zm10 0h6v6h-6V5ZM4 13h6v6H4v-6Zm10 0h6v6h-6v-6Z",
    watch: "M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm6 3v6l5-3-5-3ZM7 19h10v2H7v-2Z",
    settings: "M12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Zm7.4-2.6.1-.9-.1-.9 1.9-1.5-1.9-3.3-2.3.9a7 7 0 0 0-1.6-.9l-.3-2.4H9.8l-.3 2.4c-.6.2-1.1.5-1.6.9l-2.3-.9-1.9 3.3 1.9 1.5-.1.9.1.9-1.9 1.5 1.9 3.3 2.3-.9c.5.4 1 .7 1.6.9l.3 2.4h4.4l.3-2.4c.6-.2 1.1-.5 1.6-.9l2.3.9 1.9-3.3-1.9-1.5Z",
    manage: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm16 4.5c0 1.7-3.6 3-8 3s-8-1.3-8-3V8c1.6 1.2 4.6 2 8 2s6.4-.8 8-2v2.5Zm0 5c0 1.7-3.6 3-8 3s-8-1.3-8-3V13c1.6 1.2 4.6 2 8 2s6.4-.8 8-2v2.5Z",
    search: "M10 4a6 6 0 1 1-3.9 10.6l-3.4 3.4-1.4-1.4 3.4-3.4A6 6 0 0 1 10 4Zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    close: "m12 10.6 5-5 1.4 1.4-5 5 5 5-1.4 1.4-5-5-5 5-1.4-1.4 5-5-5-5L7 5.6l5 5Z",
    check: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z",
    chevronLeft: "M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6 4.6-4.6Z",
    chevronRight: "M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6-4.6 4.6Z",
    arrowLeft: "M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20v-2Z",
    play: "M8 5v14l11-7L8 5Z",
    filter: "M4 5h16v2l-6 6v6l-4-2v-4L4 7V5Z",
    sort: "M3 6h12v2H3V6Zm0 5h9v2H3v-2Zm0 5h6v2H3v-2Zm14.5-9L21 10.5h-2.5V19h-2v-8.5H14L17.5 7Z",
    view: "M3 5h8v6H3V5Zm10 0h8v3h-8V5ZM3 13h8v6H3v-6Zm10 3h8v3h-8v-3Zm0-5h8v3h-8v-3Z",
    more: "M12 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z",
    external: "M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14V3ZM5 5h5v2H6v11h11v-4h2v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
    copy: "M8 2h10a2 2 0 0 1 2 2v12h-2V4H8V2ZM4 6h11a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm1 2v12h9V8H5Z",
    archive: "M3 4h18v4H3V4Zm1 6h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9Zm5 3v2h6v-2H9Z",
    unarchive: "M3 4h18v4H3V4Zm1 6h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9Zm8 1.5L8.5 15H11v3h2v-3h2.5L12 11.5Z",
    trash: "M9 3h6l1 2h4v2H4V5h4l1-2ZM6 9h12l-.8 11.1a1 1 0 0 1-1 .9H7.8a1 1 0 0 1-1-.9L6 9Z",
    seen: "M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    unseen: "M2.4 3.8 3.8 2.4l17.8 17.8-1.4 1.4-3.2-3.2A10 10 0 0 1 12 19c-5 0-9-4.5-9-7 0-1.4 1.3-3.4 3.4-5L2.4 3.8ZM12 5c5 0 9 4.5 9 7 0 1.1-.8 2.7-2.4 4.2l-3-3A4 4 0 0 0 10.8 8L8.9 6.1C9.9 5.4 11 5 12 5Z",
    download: "M11 3h2v9.2l3.3-3.3 1.4 1.4-5.7 5.7-5.7-5.7 1.4-1.4L11 12.2V3ZM4 18h16v3H4v-3Z",
    upload: "M12 3.4 17.7 9l-1.4 1.4L13 7.2V16h-2V7.2L7.7 10.4 6.3 9 12 3.4ZM4 18h16v3H4v-3Z",
    refresh: "M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z",
    info: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm1 8h-2v8h2v-8Zm0-4h-2v2h2V6Z",
    clock: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm1 5h-2v6l5 3 1-1.7-4-2.3V7Z",
    photo: "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 13h14l-4.5-6-3.5 4.5-2.5-3L5 17Zm3-7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
    star: "M12 2 9.6 8.6 3 11l6.6 2.4L12 20l2.4-6.6L21 11l-6.6-2.4L12 2Z",
    layers: "M12 2 2 8l10 6 10-6-10-6ZM2 12.5 12 18.5l10-6 -2-1.2-8 4.8-8-4.8L2 12.5Zm0 4L12 22.5l10-6-2-1.2-8 4.8-8-4.8L2 16.5Z",
    mark: "M5 3h14a1 1 0 0 1 1 1v17l-8-4-8 4V4a1 1 0 0 1 1-1Z",
    keyboard: "M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm2 3v2h2V9H5Zm4 0v2h2V9H9Zm4 0v2h2V9h-2Zm4 0v2h2V9h-2ZM5 13v2h2v-2H5Zm4 0v2h6v-2H9Zm8 0v2h2v-2h-2Z",
    palette: "M12 3a9 9 0 0 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H16a5 5 0 0 0 5-5c0-3.9-4-6.7-9-6.7ZM6.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3.5 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z",
    accessibility: "M12 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM21 8.5 15 10v3.5l2.5 7-1.9.7L13.2 15h-2.4l-2.4 6.2-1.9-.7L9 13.5V10L3 8.5 3.5 6.6 12 8.7l8.5-2.1.5 1.9Z",
    session: "M12 2a10 10 0 1 1-7.1 17.1l1.4-1.4A8 8 0 1 0 4 12H7l-4 4-4-4h3A10 10 0 0 1 12 2Z",
    arrowRight: "M12 4l-1.4 1.4L16.2 11H4v2h12.2l-5.6 5.6L12 20l8-8-8-8Z",
    lock: "M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3Zm0 10a2 2 0 0 1 1 3.7V18a1 1 0 0 1-2 0v-2.3A2 2 0 0 1 12 14Z",
    wave: "M3 12c1.6 0 1.6-4 3.2-4s1.6 8 3.2 8 1.6-8 3.2-8 1.6 4 3.2 4 1.6-4 3.2-4 1.6 8 3.2 8 1.6-8 3.2-8 1.6 4 3.2 4",
    plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z",
    inbox: "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 10v4h14v-4h-4a3 3 0 0 1-6 0H5Zm0-8v6h6a1 1 0 0 1 1 1 1 1 0 0 0 2 0 1 1 0 0 1 1-1h6V6H5Z",
  };

  function icon(name, size) {
    const d = PATHS[name];
    if (!d) return "";
    const s = size || 20;
    return (
      '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s +
      '" fill="currentColor" aria-hidden="true" focusable="false"><path d="' + d + '"/></svg>'
    );
  }

  /* ------------------------------------------------------------- escaping -- */
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ------------------------------------------------------------ formatting -- */
  const NF = new Intl.NumberFormat();

  function num(n) { return NF.format(Number(n) || 0); }

  function compact(n) {
    const v = Number(n) || 0;
    if (v < 1000) return String(v);
    if (v < 1e6) return (v / 1e3).toFixed(v < 1e4 ? 1 : 0).replace(/\.0$/, "") + "K";
    return (v / 1e6).toFixed(v < 1e7 ? 1 : 0).replace(/\.0$/, "") + "M";
  }

  function bytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return v + " B";
    if (v < 1048576) return (v / 1024).toFixed(1) + " KB";
    if (v < 1073741824) return (v / 1048576).toFixed(1) + " MB";
    return (v / 1073741824).toFixed(2) + " GB";
  }

  function date(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function dateLong(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleString(undefined, {
      month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
    });
  }

  /** Short relative age — "3h", "5d", "Mar 2024". Reads at a glance in a chip. */
  function ago(ts) {
    if (!ts) return "";
    const at = typeof ts === "number" ? ts : Date.parse(ts);
    if (!at) return "";
    const diff = Date.now() - at;
    if (diff < 0) return "now";
    const min = diff / 6e4;
    if (min < 1) return "now";
    if (min < 60) return Math.round(min) + "m";
    const hr = min / 60;
    if (hr < 24) return Math.round(hr) + "h";
    const day = hr / 24;
    if (day < 7) return Math.round(day) + "d";
    if (day < 30) return Math.round(day / 7) + "w";
    if (day < 365) return Math.round(day / 30) + "mo";
    return Math.round(day / 365) + "y";
  }

  function duration(ms) {
    const total = Math.round((Number(ms) || 0) / 1000);
    if (!total) return "";
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
  }

  /** "12 minutes left" style copy for the resume hero. */
  function remaining(progress) {
    if (!progress || !progress.d) return "";
    const left = Math.max(0, progress.d - progress.t);
    if (left < 60) return Math.round(left) + " seconds left";
    return Math.round(left / 60) + " min left";
  }

  /* --------------------------------------------------------- DOM building -- */
  /**
   * h("div.card", { attrs }, children…)
   * Terse enough to build a whole view inline without a template language,
   * explicit enough that nothing is stringly-typed but the tag.
   */
  function h(spec, props, ...children) {
    const [tagPart, ...classes] = String(spec).split(".");
    const el = document.createElement(tagPart || "div");
    if (classes.length) el.className = classes.join(" ");
    if (props && typeof props === "object" && !(props instanceof Node) && !Array.isArray(props)) {
      for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key === "html") el.innerHTML = value;
        else if (key === "text") el.textContent = value;
        else if (key === "class") el.className = el.className ? el.className + " " + value : value;
        else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
        else if (key === "dataset") Object.assign(el.dataset, value);
        else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
        else if (value === true) el.setAttribute(key, "");
        else el.setAttribute(key, value);
      }
    } else if (props != null) {
      children.unshift(props);
    }
    append(el, children);
    return el;
  }

  function append(parent, children) {
    for (const child of children) {
      if (child == null || child === false) continue;
      if (Array.isArray(child)) append(parent, child);
      else if (child instanceof Node) parent.appendChild(child);
      else parent.appendChild(document.createTextNode(String(child)));
    }
  }

  /** Buttons carry so many attributes that a dedicated helper pays for itself. */
  function button(cls, opts) {
    const o = opts || {};
    const el = h("button." + cls, { type: "button" });
    if (o.icon) el.insertAdjacentHTML("beforeend", icon(o.icon, o.iconSize || 16));
    if (o.label) el.appendChild(h("span", { text: o.label }));
    if (o.title) el.title = o.title;
    if (o.aria) el.setAttribute("aria-label", o.aria);
    else if (!o.label && o.title) el.setAttribute("aria-label", o.title);
    if (o.pressed != null) el.setAttribute("aria-pressed", String(!!o.pressed));
    if (o.expanded != null) el.setAttribute("aria-expanded", String(!!o.expanded));
    if (o.on) el.addEventListener("click", o.on);
    if (o.dataset) Object.assign(el.dataset, o.dataset);
    if (o.disabled) el.disabled = true;
    return el;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /** Safe view-transition name for an arbitrary media id. */
  function transitionName(id) {
    return "tile-" + String(id).replace(/[^a-zA-Z0-9_-]/g, "-");
  }

  /**
   * Run `mutate` inside a view transition when the platform and the user's
   * motion preference both allow it. Falls back to a plain call.
   */
  function transition(mutate) {
    const reduced = root.M3E && root.M3E.reducedMotion && root.M3E.reducedMotion();
    if (reduced || typeof document.startViewTransition !== "function") { mutate(); return null; }
    try { return document.startViewTransition(mutate); } catch (_) { mutate(); return null; }
  }

  function avatarFor(item) {
    const post = item && item.post;
    return (post && (post.author_avatar || post.author_profile_image)) || "";
  }

  function postUrl(item) {
    const post = item && item.post;
    if (!post) return "";
    if (post.url) return post.url;
    if (post.author_username && post.tweet_id) {
      return "https://x.com/" + post.author_username + "/status/" + post.tweet_id;
    }
    return post.tweet_id ? "https://x.com/i/status/" + post.tweet_id : "";
  }

  /** Best still image for an item, at the requested twimg size bucket. */
  function still(item, size) {
    const media = item && item.media;
    if (!media) return "";
    const url = media.poster || media.url || media.thumb || "";
    return root.M3EMedia ? root.M3EMedia.sizedImage(url, size || "small") : url;
  }

  function typeLabel(type) {
    if (type === "video") return "Video";
    if (type === "animated_gif") return "GIF";
    return "Photo";
  }

  root.XBUI = {
    icon, PATHS, esc, num, compact, bytes, date, dateLong, ago, duration, remaining,
    h, button, clear, transitionName, transition, avatarFor, postUrl, still, typeLabel,
  };
})(window);
