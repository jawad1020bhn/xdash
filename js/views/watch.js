/* =============================================================================
   Watch — immersive consumption

   A dark, full-bleed vertical feed. One item fills the viewport; scrolling
   snaps to the next. Chrome is near zero: an exit affordance, a side column of
   three actions, and a caption. Everything else is a keystroke away.

   Only the centred slide plays. Anything else is a battery bill.
   ============================================================================= */
(function (root) {
  "use strict";

  const { h, icon, esc, compact, still, postUrl, avatarFor } = root.XBUI;
  const St = root.XBState;

  const CAP = 80;
  const IDLE_MS = 2600;
  let observer = null;
  let scroller = null;
  let idleTimer = null;
  let progressEl = null;
  let progressRaf = 0;
  let wakeLock = null;

  /* Screen wake lock: a video feed that lets the phone dim mid-watch feels
     broken. The API is progressive (Chrome/Edge/Android); everywhere else
     this silently does nothing and the system timeout applies as usual. */
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
        /* Reacquire when the tab becomes visible again — the lock is released
           by the OS on visibility loss by design. */
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      }
    } catch (_) { /* denied or unsupported: not worth telling the user */ }
  }

  function releaseWakeLock() {
    try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (_) {}
  }

  document.addEventListener("visibilitychange", () => {
    /* Only reacquire while a watch session is actually live; teardown()
       already released the lock when leaving. */
    if (document.visibilityState === "visible" && scroller) {
      requestWakeLock();
    }
  });

  function teardown() {
    if (observer) { observer.disconnect(); observer = null; }
    root.M3EMedia.stopAll();
    clearTimeout(idleTimer);
    clearTimeout(watchPosTimer);
    cancelAnimationFrame(progressRaf);
    releaseWakeLock();
    document.body.classList.remove("is-watch-idle");
    scroller = null;
    progressEl = null;
  }

  /* Chrome fade: while watching, every overlay except playback/navigation
     fades out after a beat of stillness and returns on the slightest motion.
     The cursor goes with it, so the video reads as the whole surface. */
  function wake() {
    document.body.classList.remove("is-watch-idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      /* Keep chrome if something within it holds focus, or a control is open. */
      if (scroller && scroller.matches(":focus-within")) { wake(); return; }
      document.body.classList.add("is-watch-idle");
    }, IDLE_MS);
  }

  /* The one idle mark that survives the fade: a thin line for how far the
     centred video has played. Position is navigation, not chrome. */
  function startProgress() {
    cancelAnimationFrame(progressRaf);
    const tick = () => {
      const video = currentVideo();
      if (video && progressEl) {
        const d = Number.isFinite(video.duration) ? video.duration : 0;
        progressEl.hidden = false;
        progressEl.firstElementChild.style.width = d ? Math.min(100, (video.currentTime / d) * 100) + "%" : "0";
      } else if (progressEl) {
        progressEl.hidden = true;
      }
      progressRaf = requestAnimationFrame(tick);
    };
    progressRaf = requestAnimationFrame(tick);
  }

  function feedItems() {
    const base = St.derived.items.filter((i) => !i.archived);
    /* The feed carries everything playable — videos, GIFs *and* photos — so a
       swipe is always worth something. Motion-only pools starve the feed. */
    const playable = base.filter((i) => i.playable &&
      (root.M3EMedia.isMotion(i.media) || still(i, "medium")));
    return playable.slice(0, CAP);
  }

  /* ---- feed position memory ------------------------------------------------
     The feed resumes where you left it, as long as the underlying collection
     is the same one (signature = length + first/last ids). One slot in prefs:
     leaving at index 0 clears it. */
  function feedSig(items) {
    if (!items.length) return "";
    return items.length + ":" + items[0].id + ":" + items[items.length - 1].id;
  }

  let watchPosTimer = 0;
  function saveWatchIndex(sig, index) {
    const prefs = St.state.prefs;
    if (index <= 0) delete prefs.watchFeed;
    else prefs.watchFeed = { sig, index };
    clearTimeout(watchPosTimer);
    watchPosTimer = setTimeout(() => root.XBStore.savePrefs(prefs), 1500);
  }

  let activeSig = "";

  function render(mount, app) {
    teardown();
    const items = feedItems();

    if (!items.length) {
      mount.appendChild(h(".empty.empty--center",
        h(".empty__glyph", { html: icon("watch", 24) }),
        h("h2", { text: "Nothing to watch" }),
        h("p", { text: "Watch plays the videos and GIFs in your current search. Clear your filters or capture some motion media to fill the feed." }),
        h(".empty__actions",
          actionBtn("Back to Discover", () => app.go("discover"), "ctl--accent"),
          actionBtn("Open Library", () => app.go("library"), "ctl--bordered"))
      ));
      return;
    }

    scroller = h(".watch", { tabindex: "0", "aria-label": "Watch feed" });

    const exit = h("button.watch__exit.watch__chrome", {
      type: "button", "aria-label": "Leave watch mode",
      html: icon("close", 16) + "<span>Exit</span>",
    });
    exit.addEventListener("click", () => app.go(St.state.prefs.lastWorkspace || "discover"));

    const rail = h(".watch__rail.watch__chrome", { "aria-hidden": "true" });
    items.forEach(() => rail.appendChild(h(".watch__tick")));

    items.forEach((item, i) => scroller.appendChild(slide(item, i, items, app)));

    progressEl = h(".watch__progress", { hidden: true, "aria-hidden": "true" }, h("i"));

    mount.appendChild(scroller);
    mount.appendChild(exit);
    mount.appendChild(rail);
    mount.appendChild(progressEl);

    /* Chrome fade. Any pointer motion, key, or touch wakes the chrome; a beat
       of stillness fades it. Scroll wakes too, since paging is an interaction. */
    scroller.addEventListener("pointermove", wake, { passive: true });
    scroller.addEventListener("pointerdown", wake, { passive: true });
    scroller.addEventListener("scroll", wake, { passive: true });
    scroller.addEventListener("wheel", wake, { passive: true });
    exit.addEventListener("pointerenter", wake);
    wake();
    startProgress();
    requestWakeLock();

    /* Play only what is centred. Without the observer (very old engines, or a
       non-visual runtime) the feed still scrolls — it just hydrates eagerly. */
    if (typeof IntersectionObserver === "undefined") {
      scroller.querySelectorAll(".watch__slide").forEach((el, i) => hydrate(el, items[i]));
      scroller.addEventListener("keydown", onKey);
      return;
    }

    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const el = entry.target;
        const i = Number(el.dataset.index);
        if (entry.isIntersecting) {
          rail.querySelectorAll(".watch__tick").forEach((t, n) => t.classList.toggle("is-on", n === i));
          St.markViewed(items[i].id);
          saveWatchIndex(activeSig, i);
          /* Hydrate FIRST, then play: the poster is swapped for a real <video>
             on centre, so querying before hydration finds nothing and the
             first slide never autoplays until you scroll away and back. */
          hydrate(el, items[i]);
          const video = el.querySelector("video");
          if (video && !root.M3E.reducedMotion()) {
            const attempt = video.play();
            if (attempt && attempt.catch) attempt.catch(() => {});
          }
          [items[i + 1], items[i + 2]].forEach((n) => n && preload(n));
        } else {
          const video = el.querySelector("video");
          if (video) video.pause();
        }
      });
    }, { threshold: 0.7, root: scroller });

    scroller.querySelectorAll(".watch__slide").forEach((el) => observer.observe(el));
    scroller.addEventListener("keydown", onKey);
    bindGestures(scroller, items);

    /* Resume the feed if it's the same collection as last time. */
    activeSig = feedSig(items);
    const saved = St.state.prefs.watchFeed;
    if (saved && saved.sig === activeSig && saved.index > 0 && saved.index < items.length) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const el = scroller.querySelector(`.watch__slide[data-index="${saved.index}"]`);
        if (el) scroller.scrollTop = el.offsetTop;   // instant: a resume, not a journey
      }));
    }

    requestAnimationFrame(() => scroller.focus({ preventScroll: true }));
  }

  function actionBtn(label, on, cls) {
    const b = h("button.ctl" + (cls ? "." + cls : ""), { type: "button", text: label });
    b.addEventListener("click", on);
    return b;
  }

  /* ---------------------------------------------------------------- slide -- */
  function slide(item, index, items, app) {
    const el = h(".watch__slide", { "data-index": String(index), "data-id": item.id });
    const frame = h(".watch__frame");
    /* Poster first; the real element is attached when the slide is centred. */
    frame.appendChild(h("img", { src: still(item, "medium"), alt: "", loading: index < 2 ? "eager" : "lazy" }));
    el.appendChild(frame);

    const avatar = avatarFor(item);
    const who = h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
      avatar ? h("img", { src: avatar, alt: "", loading: "lazy",
        style: { width: "28px", height: "28px", borderRadius: "50%", objectFit: "cover" } }) : null,
      h("b", { text: item.authorName || "@" + item.author })
    );
    el.appendChild(h(".watch__meta.watch__chrome", who, captionOf(item)));

    const side = h(".watch__side.watch__chrome");
    side.appendChild(sideBtn(item.archived ? "unarchive" : "archive",
      item.archived ? "Unarchive" : "Archive",
      () => { St.setArchived([item.id], !item.archived); }));
    side.appendChild(sideBtn("info", "Open details", () => app.openItem(item, items, "context")));
    side.appendChild(sideBtn("external", "Open on X", () => root.open(postUrl(item), "_blank", "noopener")));
    el.appendChild(side);

    return el;
  }

  function captionOf(item) {
    const text = String(item.text || "").replace(/https?:\/\/\S+/g, "").trim();
    const p = h("p");
    if (text) p.textContent = text;
    else if (item.eng && item.eng.likes) p.textContent = compact(item.eng.likes) + " likes";
    return p;
  }

  function sideBtn(iconName, label, on) {
    const b = h("button", { type: "button", "aria-label": label, title: label, html: icon(iconName, 19) });
    b.addEventListener("click", on);
    return b;
  }

  /** Swap the poster for a real video the first time a slide becomes current. */
  function hydrate(el, item) {
    if (el.dataset.hydrated) return;
    el.dataset.hydrated = "1";
    if (!item.playable || !root.M3EMedia.isMotion(item.media)) return;

    const frame = el.querySelector(".watch__frame");
    const video = root.M3EMedia.createVideo(item.media, {
      width: 720,
      controls: false,
      muted: true,
      loop: true,
      autoplay: !root.M3E.reducedMotion(),
      preload: "auto",
      /* Every rung of the variant ladder failed: say so on the slide instead
         of leaving a dead poster that looks like it should play. */
      onFail: () => markUnavailable(frame, item, el),
    });
    if (!video) { markUnavailable(frame, item, el); return; }
    video.addEventListener("loadeddata", () => {
      const poster = frame.querySelector("img");
      if (poster) poster.remove();
    }, { once: true });
    video.addEventListener("click", () => { video.paused ? video.play() : video.pause(); });
    frame.appendChild(video);
  }

  function preload(item) {
    const url = still(item, "medium");
    if (url) { const img = new Image(); img.src = url; }
  }

  /* An honest dead slide: what happened, and the ways out — retry the ladder
     (transient network failures) or leave for the original post. */
  function markUnavailable(frame, item, el) {
    if (!el) el = frame.closest(".watch__slide");
    if (frame.querySelector(".watch__missing")) return;
    const poster = frame.querySelector("img");
    if (poster) poster.remove();
    const retry = h("button.ctl.ctl--accent", {
      type: "button",
      html: icon("refresh", 16) + "<span>Try again</span>",
    });
    retry.addEventListener("click", () => {
      frame.querySelector(".watch__missing") && frame.querySelector(".watch__missing").remove();
      delete el.dataset.hydrated;          // let hydrate run fresh
      hydrate(el, item);
    });
    frame.appendChild(h(".watch__missing",
      h("p", { text: "This media is no longer available on X." }),
      h(".empty__actions", retry,
        h("a.ctl.ctl--bordered", {
          href: postUrl(item), target: "_blank", rel: "noopener",
          html: icon("external", 16) + "<span>Open post</span>",
        })
      )
    ));
  }

  function onKey(e) {    if (!scroller) return;
    wake();
    const step = scroller.clientHeight;
    if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); scroller.scrollBy({ top: step, behavior: "smooth" }); }
    else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); scroller.scrollBy({ top: -step, behavior: "smooth" }); }
    else if (e.key === " ") {
      const video = currentVideo();
      if (video) { e.preventDefault(); video.paused ? video.play() : video.pause(); }
    } else if (e.key === "m") {
      const video = currentVideo();
      if (video) video.muted = !video.muted;
    }
  }

  /* ---------------------------------------------------------------- touch -- */
  /* Touch-first feed gestures (skipped on hover devices):
       tap left / right edge  → previous / next slide
       tap centre             → the video's own play/pause
       double-tap centre      → archive toggle (with haptic)
       long-press             → temporary 2× playback speed, restored on release
     Edge taps use the scroll container itself, so they can never fight the
     browser's own navigation gestures at the screen edges. */
  function bindGestures(scroller, items) {
    if (typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    let pressTimer = 0;
    let boosted = false;
    let downX = 0;
    let downY = 0;
    let downAt = 0;
    let lastCentreTap = 0;

    function boost(on) {
      const v = currentVideo();
      if (!v) return;
      if (on && !boosted) {
        boosted = true;
        v.__baseRate = v.playbackRate || 1;
        v.playbackRate = 2;
        if (root.navigator.vibrate) root.navigator.vibrate(8);
      } else if (!on && boosted) {
        boosted = false;
        v.playbackRate = v.__baseRate || 1;
        delete v.__baseRate;
      }
    }

    const cancelPress = () => { clearTimeout(pressTimer); boost(false); };

    scroller.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".watch__side, .watch__exit, button, a")) return;
      downX = e.clientX; downY = e.clientY; downAt = Date.now();
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => boost(true), 480);
    }, { passive: true });

    scroller.addEventListener("pointermove", (e) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 10) cancelPress();
    }, { passive: true });
    scroller.addEventListener("pointercancel", cancelPress, { passive: true });

    scroller.addEventListener("pointerup", (e) => {
      clearTimeout(pressTimer);
      const held = Date.now() - downAt;
      const wasBoosted = boosted;
      boost(false);
      if (wasBoosted || held > 450) return;                       // that was a hold, not a tap
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 10) return; // that was a swipe

      const rect = scroller.getBoundingClientRect();
      const rel = (e.clientX - rect.left) / rect.width;
      if (rel < 0.3) {
        wake();
        scroller.scrollBy({ top: -scroller.clientHeight, behavior: "smooth" });
        return;
      }
      if (rel > 0.7) {
        wake();
        scroller.scrollBy({ top: scroller.clientHeight, behavior: "smooth" });
        return;
      }

      /* Centre: double-tap toggles archive. Single taps over a video fall
         through to its own click handler (play/pause). */
      const now = Date.now();
      if (now - lastCentreTap < 320) {
        lastCentreTap = 0;
        const el = currentSlideEl();
        const item = el && items[Number(el.dataset.index)];
        if (item) {
          St.setArchived([item.id], !item.archived);
          root.XBApp.toast(item.archived ? "Unarchived" : "Archived");
          if (root.navigator.vibrate) root.navigator.vibrate(14);
        }
      } else {
        lastCentreTap = now;
      }
    }, { passive: true });
  }

  function currentSlideEl() {
    if (!scroller) return null;
    const mid = scroller.scrollTop + scroller.clientHeight / 2;
    const slides = Array.from(scroller.querySelectorAll(".watch__slide"));
    return slides.find((s) => s.offsetTop <= mid && s.offsetTop + s.offsetHeight > mid) || null;
  }

  function currentVideo() {
    const el = currentSlideEl();
    return el ? el.querySelector("video") : null;
  }

  root.XBWatch = { render, teardown };
})(window);
