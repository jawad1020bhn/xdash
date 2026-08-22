/* =============================================================================
   The media viewer

   One surface for every "look at this thing closely" moment in the product.
   Three states, switchable at any time and remembered between sessions:

     focus     media only — chrome fades unless the pointer moves
     standard  media + the minimum chrome (default)
     context   list-detail: media beside a supporting details pane

   Chrome budget: back, details toggle, position, prev/next, and a bottom strip
   with creator, caption and progress. Anything else belongs in the pane.

   The signature interaction — the card growing into the viewer — is a view
   transition keyed on the media id, so it survives a full re-render of the
   grid underneath.
   ============================================================================= */
(function (root) {
  "use strict";

  const { h, icon, esc, clear, still, postUrl, avatarFor, date, dateLong, duration, compact, typeLabel } = root.XBUI;
  const St = root.XBState;

  let el = null;          // root
  let refs = null;        // cached children
  let list = [];          // items being paged through
  let index = -1;
  let cleanupMedia = null;
  let hideTimer = null;
  let onClosed = null;

  /* Details pane can be dragged to taste, within a sensible band. The choice
     is remembered between sessions like every other viewer preference. */
  const PANE_MIN = 300;
  const PANE_MAX = 560;
  const PANE_KEYSTEP = 24;

  function paneWidth() {
    const saved = St.state.prefs.viewerPaneWidth;
    const v = Number(saved);
    return Number.isFinite(v) && v >= PANE_MIN && v <= PANE_MAX ? Math.round(v) : 372;
  }

  function applyPaneWidth(px) {
    el.style.setProperty("--viewer-pane-width", px + "px");
    refs.divider.setAttribute("aria-valuenow", String(px));
  }

  function persistPaneWidth(px) {
    St.setPrefs({ viewerPaneWidth: px });
  }

  /* Pointer-drag + keyboard adjust of the details pane. The drag tracks the
     viewport edge nearest the cursor (RTL aware) and clamps to the band. */
  function bindResize(divider) {
    const setFromClient = (clientX) => {
      const rect = el.getBoundingClientRect();
      const fromRight = root.getComputedStyle(el).direction !== "rtl";
      const px = fromRight ? clientX - rect.left : rect.right - clientX;
      applyPaneWidth(Math.max(PANE_MIN, Math.min(PANE_MAX, Math.round(px))));
    };

    /* On a phone the pane is a bottom sheet (see bindPaneSnap); the desktop
       width-drag contract yields entirely there. */
    if (root.XBMobile && root.XBMobile.isCompact()) { bindPaneSnap(divider); return; }

    let dragging = false;
    let moved = false;

    divider.addEventListener("pointerdown", (e) => {
      dragging = true; moved = false;
      el.classList.add("is-resizing");
      divider.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    divider.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      moved = true;
      setFromClient(e.clientX);
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("is-resizing");
      try { divider.releasePointerCapture(e.pointerId); } catch (_) {}
      if (moved) persistPaneWidth(paneWidth());
    };
    divider.addEventListener("pointerup", end);
    divider.addEventListener("pointercancel", end);

    divider.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      e.stopPropagation(); /* keep it from paging the viewer (← →) */
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const rtl = root.getComputedStyle(el).direction === "rtl";
      const next = Math.max(PANE_MIN, Math.min(PANE_MAX, paneWidth() + (rtl ? -dir : dir) * PANE_KEYSTEP));
      applyPaneWidth(next);
      persistPaneWidth(next);
    });

    divider.addEventListener("dblclick", () => {
      applyPaneWidth(372);
      persistPaneWidth(372);
    });
  }

  /* Bottom-sheet snap states for the details pane on phones: peek / half /
     full. The divider becomes the drag handle and the sheet tracks the finger
     continuously (height written inline), then settles to the nearest snap on
     release — with a little velocity assist so a quick flick expands. A tap
     without movement toggles half ↔ full. */
  const PANE_SNAPS = ["peek", "half", "full"];
  const PANE_RATIOS = [0.32, 0.62];

  function paneFullHeight() { return root.innerHeight - 64; }

  function snapHeight(i) {
    return i >= PANE_SNAPS.length - 1 ? paneFullHeight() : root.innerHeight * PANE_RATIOS[i];
  }

  function bindPaneSnap(divider) {
    let active = false;
    let moved = false;
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;

    divider.addEventListener("pointerdown", (e) => {
      if (St.state.viewerState !== "context") return;
      active = true; moved = false;
      startY = lastY = e.clientY;
      lastT = performance.now();
      velocity = 0;
      el.classList.add("is-resizing");
      try { divider.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    divider.addEventListener("pointermove", (e) => {
      if (!active) return;
      const dy = startY - e.clientY;                 // up = grow
      if (Math.abs(e.clientY - startY) > 6) moved = true;
      const now = performance.now();
      if (now > lastT) velocity = (lastY - e.clientY) / (now - lastT); // px/ms, up positive
      lastY = e.clientY;
      lastT = now;

      const h = Math.max(snapHeight(0), Math.min(paneFullHeight(), snapHeight(1) + dy));
      refs.pane.style.transition = "none";
      refs.pane.style.height = h + "px";
      divider.style.insetBlockEnd = (h - 26) + "px";
    });
    const end = () => {
      if (!active) return;
      active = false;
      el.classList.remove("is-resizing");

      if (!moved) {                                  // tap cycles half ↔ full
        refs.pane.style.height = "";
        divider.style.insetBlockEnd = "";
        el.dataset.pane = el.dataset.pane === "full" ? "half" : "full";
        return;
      }

      /* Flick assist: a fast upward drag rounds up to the next snap. */
      const h = parseFloat(refs.pane.style.height) || 0;
      let best = 0;
      let bestDist = Infinity;
      PANE_SNAPS.forEach((_, i) => {
        let d = Math.abs(snapHeight(i) - h);
        if (velocity > 0.5 && snapHeight(i) > h) d -= 80;   // flinging up
        if (velocity < -0.5 && snapHeight(i) < h) d -= 80;  // flinging down
        if (d < bestDist) { bestDist = d; best = i; }
      });

      requestAnimationFrame(() => {
        refs.pane.style.transition = "";
        refs.pane.style.height = "";
        divider.style.insetBlockEnd = "";
        el.dataset.pane = PANE_SNAPS[best];
      });
    };
    divider.addEventListener("pointerup", end);
    divider.addEventListener("pointercancel", end);
  }

  /* ------------------------------------------------------------- structure -- */
  function build() {
    if (el) return el;

    const stage = h(".viewer__stage", { id: "viewerStage" });
    const frame = h(".viewer__frame");
    stage.appendChild(frame);

    const back = h("button.vbtn.vbtn--back", {
      type: "button",
      /* The label is hidden on narrow windows, so name the button explicitly. */
      "aria-label": "Close viewer and return to the library",
      html: icon("arrowLeft", 16) + '<span class="vbtn__label">Library</span>',
    });
    back.addEventListener("click", close);

    const pos = h("span.vbtn__pos", { "aria-live": "polite" });

    const stripBtn = h("button.vbtn.vbtn--icon", {
      type: "button", title: "Filmstrip (F)", "aria-label": "Toggle filmstrip", html: icon("layers", 16),
    });
    const focusBtn = h("button.vbtn.vbtn--icon", {
      type: "button", title: "Focus mode (C)", "aria-label": "Toggle focus mode", html: icon("seen", 16),
    });
    const detailsBtn = h("button.vbtn", {
      type: "button", title: "Details (I)", "aria-label": "Details",
      html: icon("info", 16) + '<span class="vbtn__label">Details</span>',
    });

    const top = h(".viewer__top", back, h("span.spacer"), pos, stripBtn, focusBtn, detailsBtn);

    const by = h(".viewer__by");
    const cap = h("p.viewer__cap");
    const track = h(".viewer__track", h("i"));
    const foot = h(".viewer__foot", by, cap, track);

    const prev = h("button.viewer__step.viewer__step--prev", {
      type: "button", "aria-label": "Previous", html: "<span>" + icon("chevronLeft", 22) + "</span>",
    });
    const next = h("button.viewer__step.viewer__step--next", {
      type: "button", "aria-label": "Next", html: "<span>" + icon("chevronRight", 22) + "</span>",
    });

    const strip = h(".viewer__strip", { hidden: true });
    const gallery = h(".viewer__gallery", { hidden: true, "aria-label": "Photos and videos of this post" });
    const chrome = h(".viewer__chrome", top, foot, gallery, strip);
    const main = h(".viewer__main", stage, prev, next, chrome);
    const pane = h(".viewer__pane");

    /* Resizable divider — only meaningful in context (list-detail) state. */
    const divider = h("button.viewer__divider", {
      type: "button",
      "aria-label": "Resize details pane",
      "aria-orientation": "vertical",
      "aria-valuenow": "372",
      "aria-valuemin": String(PANE_MIN),
      "aria-valuemax": String(PANE_MAX),
      tabindex: "0",
    });
    bindResize(divider);

    el = h(".viewer", {
      id: "viewer",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Media viewer",
      tabindex: "-1",
      hidden: true,
    }, main, divider, pane);

    refs = { stage, frame, top, pos, by, cap, track, prev, next, strip, gallery, pane, chrome, stripBtn, focusBtn, detailsBtn, main, divider };

    prev.addEventListener("click", () => step(-1));
    next.addEventListener("click", () => step(1));
    stripBtn.addEventListener("click", () => toggleStrip());
    focusBtn.addEventListener("click", () => setState(St.state.viewerState === "focus" ? "standard" : "focus"));
    detailsBtn.addEventListener("click", () => setState(St.state.viewerState === "context" ? "standard" : "context"));

    /* Chrome auto-hide in focus mode; any pointer motion brings it back. */
    el.addEventListener("pointermove", wake);
    el.addEventListener("keydown", onKey);
    bindSwipe(stage);

    document.body.appendChild(el);
    if (root.M3E && root.M3E.bindRipple) root.M3E.bindRipple(el);
    return el;
  }

  /* ------------------------------------------------------------------ open -- */
  function open(items, startIndex, opts) {
    const o = opts || {};
    build();
    /* A private copy: post siblings spliced in below must not mutate the
       caller's array out from under the grid it was built from. */
    list = (items || []).slice();
    index = Math.max(0, Math.min(startIndex || 0, list.length - 1));
    ensurePostSiblings();
    onClosed = o.onClose || null;

    el.hidden = false;
    document.body.style.overflow = "hidden";
    applyPaneWidth(paneWidth());
    setState(St.state.viewerState || "standard", true);
    paint();
    el.focus({ preventScroll: true });
  }

  function close() {
    if (!el || el.hidden) return;
    teardownMedia();
    root.XBUI.transition(() => {
      el.hidden = true;
      document.body.style.overflow = "";
    });
    clearTimeout(hideTimer);
    const cb = onClosed;
    onClosed = null;
    if (cb) cb(current());
  }

  function isOpen() { return !!el && !el.hidden; }
  function current() { return list[index] || null; }

  /* ------------------------------------------------------------------ state -- */
  function setState(next, silent) {
    St.state.viewerState = next;
    el.dataset.state = next;
    refs.focusBtn.setAttribute("aria-pressed", String(next === "focus"));
    refs.detailsBtn.setAttribute("aria-pressed", String(next === "context"));
    if (next === "context") {
      /* Phones: the pane is a bottom sheet; default to half-open. */
      if (root.XBMobile && root.XBMobile.isCompact() && !el.dataset.pane) el.dataset.pane = "half";
      paintPane();
    }
    if (next === "focus") scheduleHide(); else wake();
    if (!silent) St.setPrefs({ viewerState: next });
  }

  function wake() {
    el.dataset.chrome = "visible";
    clearTimeout(hideTimer);
    if (St.state.viewerState === "focus") scheduleHide();
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { el.dataset.chrome = "hidden"; }, 2200);
  }

  function toggleStrip() {
    const on = refs.strip.hidden;
    refs.strip.hidden = !on;
    refs.stripBtn.setAttribute("aria-pressed", String(on));
    St.setPrefs({ viewerFilmstrip: on });
    if (on) paintStrip();
  }

  /* ------------------------------------------------------------------ paint -- */
  function teardownMedia() {
    if (cleanupMedia) { try { cleanupMedia(); } catch (_) {} cleanupMedia = null; }
    root.M3EMedia.stopAll();
    clear(refs.frame);
    refs.frame.classList.remove("is-zoomed");
    refs.frame.style.removeProperty("--viewer-zoom");
  }

  function paint() {
    /* First: whatever post we landed on, make its whole media set paged
       through here — photos included — before anything is measured. */
    ensurePostSiblings();
    const item = current();
    if (!item) { close(); return; }

    teardownMedia();
    St.markViewed(item.id);

    refs.frame.style.viewTransitionName = root.XBUI.transitionName(item.id);
    refs.pos.textContent = (index + 1) + " / " + list.length;
    refs.prev.disabled = index <= 0;
    refs.next.disabled = index >= list.length - 1;

    /* --- media -------------------------------------------------------------- */
    if (root.M3EMedia.isMotion(item.media) && item.playable) paintVideo(item);
    else if (item.playable !== false && still(item, "large")) paintPhoto(item);
    else paintMissing(item);

    /* --- foot --------------------------------------------------------------- */
    const avatar = avatarFor(item);
    clear(refs.by);
    if (avatar) refs.by.appendChild(h("img", { src: avatar, alt: "", loading: "lazy" }));
    refs.by.appendChild(h("b", { text: item.authorName || "@" + item.author }));
    if (item.authorName && item.author) refs.by.appendChild(h("span", { text: "@" + item.author }));
    if (item.postedAt) refs.by.appendChild(h("span", { text: "· " + date(item.postedAt) }));
    refs.cap.textContent = String(item.text || "").replace(/https?:\/\/\S+/g, "").trim();
    refs.cap.hidden = !refs.cap.textContent;

    const pct = item.progress && item.progress.d
      ? Math.min(100, (item.progress.t / item.progress.d) * 100) : 0;
    refs.track.hidden = !pct;
    refs.track.firstElementChild.style.width = pct + "%";

    if (St.state.viewerState === "context") paintPane();
    paintGallery();
    if (!refs.strip.hidden) paintStrip();
    preloadNeighbours();
  }

  function paintPhoto(item) {
    const img = h("img", {
      src: still(item, "large"),
      alt: item.alt || root.XBCard.describe(item),
      draggable: "false",
    });
    refs.frame.appendChild(img);

    /* Zoom: double-click steps, ctrl+wheel is continuous, and on touch a
       double-tap does the same — desktop never loses its existing gestures.
       All three write the same custom property so there is one source of
       truth for scale. */
    let zoom = 1;
    const apply = (z) => {
      zoom = Math.min(4, Math.max(1, z));
      refs.frame.style.setProperty("--viewer-zoom", String(zoom));
      refs.frame.classList.toggle("is-zoomed", zoom > 1);
    };
    img.addEventListener("dblclick", () => apply(zoom > 1 ? 1 : 2));
    let lastTapAt = 0;
    img.addEventListener("pointerup", (e) => {
      if (e.pointerType === "mouse") return;
      const now = Date.now();
      if (now - lastTapAt < 320) { apply(zoom > 1 ? 1 : 2); lastTapAt = 0; }
      else lastTapAt = now;
    });
    /* On the img, not the frame: the frame outlives every paint and the
       handler would otherwise stack one layer deeper per photo visited. */
    img.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      apply(zoom - e.deltaY / 400);
    }, { passive: false });
  }

  function paintVideo(item) {
    const video = root.M3EMedia.createVideo(item.media, {
      width: Math.min(root.innerWidth, 1280),
      controls: false,
      muted: St.state.prefs.alwaysMuted,
      loop: item.type === "animated_gif" ? St.state.prefs.loopGifs : St.state.prefs.loopVideos,
      autoplay: false, /* started by autoStart below, once attached */
      preload: "auto",
      onFail: () => paintMissing(item),
    });
    if (!video) { paintMissing(item); return; }
    video.playbackRate = Number(St.state.prefs.defaultSpeed) || 1;
    refs.frame.appendChild(video);

    /* Stall recovery ladder: when the stream stalls twice at the current
       quality, step one rung down the MP4 variant list (preserving position,
       rate and play state). Returns true only when a lower rung exists. */
    const ladder = root.M3EMedia.variantLadder(item.media);
    cleanupMedia = root.M3EVideoControls.bind(video, {
      container: refs.frame,
      entryId: item.id,
      progress: St.progress,
      gestures: true,
      gesturesTouch: true,          // the stage doesn't scroll; vertical is ours
      onStallDowngrade: (el) => {
        const i = ladder.findIndex((v) => v.url === el.currentSrc || v.url === el.src);
        const next = ladder[i + 1];
        if (!next) return false;
        const t = el.currentTime;
        const rate = el.playbackRate;
        const playing = !el.paused;
        el.src = next.url;
        el.load();
        const restore = () => {
          try { el.currentTime = t; } catch (_) {}
          el.playbackRate = rate;
          if (playing) { const p = el.play(); if (p && p.catch) p.catch(() => {}); }
          el.removeEventListener("loadedmetadata", restore);
        };
        el.addEventListener("loadedmetadata", restore);
        return true;
      },
    });
  }

  /* Autoplay that actually happens. Muted playback is permitted by every
     browser, so that is the floor: honour the "start unmuted" preference when
     audible autoplay is allowed, and fall back to a silent start instead of
     leaving a paused player nobody asked to press play on. Reduced motion
     still means nothing starts on its own. */
  function autoStart(video) {
    if (root.M3E && root.M3E.reducedMotion && root.M3E.reducedMotion()) return;
    const attempt = video.play();
    if (!attempt || !attempt.catch) return;
    if (St.state.prefs.alwaysMuted) { attempt.catch(() => {}); return; }
    attempt.catch(() => {
      /* Audible autoplay was refused — restart silently. */
      video.muted = true;
      video.defaultMuted = true;
      const retry = video.play();
      if (retry && retry.catch) retry.catch(() => {});
    });
  }

  function paintMissing(item) {
    clear(refs.frame);
    const row = h(".viewer__missing__row");
    const openBtn = h("a.vbtn", {
      href: postUrl(item), target: "_blank", rel: "noopener",
      html: icon("external", 16) + "<span>Open on X</span>",
    });
    const retry = h("button.vbtn", { type: "button", html: icon("refresh", 16) + "<span>Retry</span>" });
    retry.addEventListener("click", paint);
    row.appendChild(openBtn);
    row.appendChild(retry);
    refs.frame.appendChild(h(".viewer__missing",
      h("h3", { text: "This media isn't available" }),
      h("p", { text: item.state && item.state !== "available"
        ? "The post was marked " + item.state + " when it was captured."
        : "The file couldn't be loaded. It may have been removed from X, or the link has expired." }),
      row
    ));
  }

  /* ------------------------------------------------------------------- pane -- */
  function paintPane() {
    const item = current();
    if (!item) return;
    const pane = clear(refs.pane);
    const post = item.post || {};

    /* creator + text */
    const head = h(".pane__section");
    const who = h(".pane__by");
    const avatar = avatarFor(item);
    if (avatar) who.appendChild(h("img", { src: avatar, alt: "", loading: "lazy" }));
    who.appendChild(h("div",
      h("b", { text: item.authorName || "@" + item.author }),
      h("small", { text: "@" + item.author })
    ));
    head.appendChild(who);
    if (item.text) head.appendChild(h("p.pane__text", { text: item.text }));
    if (post.quoted_text) {
      head.appendChild(h(".pane__quote",
        h("b", { text: post.quoted_author ? "@" + post.quoted_author : "Quoted post" }),
        h("div", { text: post.quoted_text })
      ));
    }
    const links = Array.isArray(post.links) ? post.links : [];
    if (links.length) {
      const box = h(".pane__links");
      links.slice(0, 5).forEach((l) => {
        const href = typeof l === "string" ? l : (l && (l.expanded_url || l.url)) || "";
        if (href) box.appendChild(h("a", { href, target: "_blank", rel: "noopener", text: href }));
      });
      head.appendChild(box);
    }
    pane.appendChild(head);

    /* actions */
    const actions = h(".pane__actions");
    actions.appendChild(paneAction("external", "Open on X", () => root.open(postUrl(item), "_blank", "noopener")));
    actions.appendChild(paneAction("copy", "Copy link", () => {
      navigator.clipboard.writeText(postUrl(item));
      root.XBApp.toast("Link copied");
    }));
    actions.appendChild(paneAction("download", "Save media", () => {
      const a = document.createElement("a");
      a.href = still(item, "orig") || (item.media && item.media.url) || "";
      a.download = "";
      a.target = "_blank";
      a.rel = "noopener";
      a.click();
    }));
    actions.appendChild(paneAction(item.archived ? "unarchive" : "archive",
      item.archived ? "Unarchive" : "Archive", () => {
        St.setArchived([item.id], !item.archived);
        root.XBApp.toast(item.archived ? "Unarchived" : "Archived");
      }));
    actions.appendChild(paneAction(item.unseen ? "seen" : "unseen",
      item.unseen ? "Mark seen" : "Mark unseen", () => {
        St.setSeen([item.id], item.unseen);
      }, "vbtn--wide"));
    pane.appendChild(h(".pane__section", h("h4", { text: "Actions" }), actions));

    /* engagement */
    if (item.eng) {
      const stats = h(".pane__stats");
      [["Likes", item.eng.likes], ["Reposts", item.eng.rts], ["Replies", item.eng.replies], ["Views", item.eng.views]]
        .filter(([, v]) => v)
        .forEach(([label, value]) => {
          stats.appendChild(h(".pane__stat", h("b", { text: compact(value) }), h("span", { text: label })));
        });
      if (stats.childElementCount) {
        pane.appendChild(h(".pane__section", h("h4", { text: "Engagement at capture" }), stats));
      }
    }

    /* details */
    const rows = h(".pane__rows");
    const add = (label, value) => {
      if (!value) return;
      rows.appendChild(h(".pane__row", h("span", { text: label }), h("b", { text: value })));
    };
    add("Type", typeLabel(item.type));
    add("Posted", item.postedAt ? dateLong(item.postedAt) : "");
    add("Captured", item.capturedAt ? dateLong(item.capturedAt) : "");
    add("Dimensions", item.media && item.media.width ? item.media.width + " × " + item.media.height : "");
    add("Duration", item.duration ? duration(item.duration) : "");
    add("In post", item.position + " of " + ((item.post.media_items || []).length || 1));
    add("Status", item.state !== "available" ? item.state : "");
    pane.appendChild(h(".pane__section", h("h4", { text: "Details" }), rows));

    if (item.alt) {
      pane.appendChild(h(".pane__section", h("h4", { text: "Alt text" }), h("p.pane__alt", { text: item.alt })));
    }
  }

  function paneAction(iconName, label, fn, extra) {
    const b = h("button.vbtn" + (extra ? "." + extra : ""), {
      type: "button", html: icon(iconName, 15) + "<span>" + esc(label) + "</span>",
    });
    b.addEventListener("click", fn);
    return b;
  }

  /* -------------------------------------------------------------- filmstrip -- */
  function paintStrip() {
    const strip = clear(refs.strip);
    const from = Math.max(0, index - 24);
    const to = Math.min(list.length, index + 25);
    for (let i = from; i < to; i++) {
      const item = list[i];
      const b = h("button", {
        type: "button",
        "aria-current": String(i === index),
        "aria-label": "Go to item " + (i + 1),
      }, h("img", { src: still(item, "thumb"), alt: "", loading: "lazy" }));
      b.addEventListener("click", () => go(i));
      strip.appendChild(b);
    }
    const active = strip.children[index - from];
    if (active) active.scrollIntoView({ inline: "center", block: "nearest" });
  }

  /* --------------------------------------------------------- post siblings --
     One captured post can carry several attachments, and the lists callers
     hand over (rails, grid pages, the watch feed) routinely contain a single
     card per post — or none of its neighbours at all. The viewer pages through
     ALL media of whatever post is open, so any missing siblings are spliced in
     beside the rest of their post's run, in attachment order. */
  function ensurePostSiblings() {
    const item = list[index];
    const post = item && item.post;
    const mediaList = post && Array.isArray(post.media_items) ? post.media_items : [];
    if (!item || !post || mediaList.length < 2) return;

    let known = 0;
    let lastAt = -1;
    const present = new Set();
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (it && it.post && it.post.tweet_id === post.tweet_id) {
        present.add(it.id);
        known++;
        lastAt = i;
      }
    }
    if (known >= mediaList.length) return;

    const flat = root.XBLibrary.flatten([post], St.state.library);
    const byId = new Map(flat.map((it) => [it.id, it]));
    const missing = [];
    mediaList.forEach((m, n) => {
      const id = root.XBLibrary.mediaId(post.tweet_id, Number(m && m.position) || n + 1);
      if (!present.has(id) && byId.has(id)) missing.push(byId.get(id));
    });
    if (!missing.length) return;

    const at = lastAt >= 0 ? lastAt + 1 : index + 1;
    list.splice(at, 0, ...missing);
    if (index >= at) index += missing.length;
  }

  /* Every photo and video of the same post, inside the player: one tile per
     attachment, tap to switch without leaving the viewer. */
  function paintGallery() {
    const item = current();
    const post = item && item.post;
    const mediaList = post && Array.isArray(post.media_items) ? post.media_items : [];
    const strip = clear(refs.gallery);
    if (mediaList.length < 2) { refs.gallery.hidden = true; return; }
    refs.gallery.hidden = false;

    const postId = post.tweet_id;
    const indexOfId = new Map();
    list.forEach((it, i) => {
      if (it && it.post && it.post.tweet_id === postId) indexOfId.set(it.id, i);
    });

    mediaList.forEach((m, n) => {
      const id = root.XBLibrary.mediaId(postId, Number(m && m.position) || n + 1);
      const target = indexOfId.get(id);
      const label = "Media " + (n + 1) + " of " + mediaList.length;
      const b = h("button.viewer__dot", {
        type: "button",
        "aria-label": label,
        title: label,
        "aria-current": String(target === index),
      });
      const src = root.M3EMedia.sizedImage(m && (m.poster || m.url), "thumb");
      if (src) b.appendChild(h("img", { src: src, alt: "", loading: "lazy", draggable: "false" }));
      else b.appendChild(h("span.viewer__dot-fallback", { html: icon("photo", 18) }));
      if (target == null) b.disabled = true;
      else b.addEventListener("click", () => go(target));
      strip.appendChild(b);
    });
  }

  /* ----------------------------------------------------------- navigation -- */
  function step(delta) { go(index + delta); }

  function go(next) {
    if (next < 0 || next >= list.length || next === index) return;
    index = next;
    root.XBUI.transition(paint);
  }

  function preloadNeighbours() {
    [list[index + 1], list[index - 1]].forEach((item) => {
      if (!item || root.M3EMedia.isMotion(item.media)) return;
      const url = still(item, "large");
      if (url) { const img = new Image(); img.src = url; }
    });
  }

  /* ------------------------------------------------------------------ input -- */
  function onKey(e) {
    if (e.target.matches("input, textarea, select")) return;
    const k = e.key;
    if (k === "Escape") { e.preventDefault(); close(); }
    else if (k === "ArrowRight" || k === "ArrowDown") { e.preventDefault(); step(1); }
    else if (k === "ArrowLeft" || k === "ArrowUp") { e.preventDefault(); step(-1); }
    else if (k === "Home") { e.preventDefault(); go(0); }
    else if (k === "End") { e.preventDefault(); go(list.length - 1); }
    else if (k === " ") {
      const v = refs.frame.querySelector("video");
      if (v) { e.preventDefault(); v.paused ? v.play() : v.pause(); }
    }
    else if (k === "i" || k === "I") setState(St.state.viewerState === "context" ? "standard" : "context");
    else if (k === "c" || k === "C") setState(St.state.viewerState === "focus" ? "standard" : "focus");
    else if (k === "f" || k === "F") toggleStrip();
    else if (k === "o" || k === "O") root.open(postUrl(current()), "_blank", "noopener");
    else if (k === "a" || k === "A") { const it = current(); if (it) St.setArchived([it.id], !it.archived); }
  }

  const IGNORE = ".slide__controls,.slide__resume,.slide__buffering,.viewer__missing,button,a,input,select,textarea,label";

  function bindSwipe(stage) {
    let sx = 0, sy = 0, tracking = false;
    stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest(IGNORE)) return;
      tracking = true; sx = e.clientX; sy = e.clientY;
    });
    stage.addEventListener("pointerup", (e) => {
      /* A vertical volume/speed drag belongs to the media, not navigation. */
      if (root.M3EVideoControls && root.M3EVideoControls.isGestureActive()) return;
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (dy > 90 && Math.abs(dy) > Math.abs(dx)) close();
      else if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
    });
    stage.addEventListener("pointercancel", () => { tracking = false; });
  }

  root.XBViewer = { open, close, isOpen, current, step, repaint: paint };
})(window);
