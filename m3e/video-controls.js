/* AUTO-GENERATED — do not edit.
   Mirrored from dashboard/m3e/video-controls.js by tools/sync-shared.mjs.
   Edit the original and re-run:  node tools/sync-shared.mjs
*/
/* =============================================================================
   M3E · Theater video controls

   A thin, custom control layer over the native <video> element, built for the
   theater's one-video-at-a-time architecture rather than for a generic
   embedded player. Native controls are deliberately replaced here (createVideo
   is called with `controls: false`) because the theater needs its own rules:
   controls that feel like part of the slide, hide while playing, scrub without
   paging the carousel, and remember where you left off.

   The layer is intentionally small and app-shaped:

     · play / pause          · mute / unmute
     · seek + time           · loop toggle
     · playback rate         · picture-in-picture
     · resume position       · auto-hide chrome
     · buffering state       · reduced-motion respect

   Persistence is not this module's job: it asks for `{ get, set, clear }` per
   entry and calls them at the right moments. The dashboard decides what
   "save progress" means (and where), which keeps the controller reusable and
   testable without a storage backend.

   Exposed as window.M3EVideoControls.bind(video, options) → cleanup.
   ============================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.M3EVideoControls = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ICONS = {
    play: '<path d="M8 5v14l11-7L8 5Z"/>',
    pause: '<path d="M6 5h4v14H6V5Zm8 0h4v14h-4V5Z"/>',
    volume: '<path d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12ZM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77Z"/>',
    muted: '<path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.42.05-.63Zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71ZM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3ZM12 4 9.91 6.09 12 8.18V4Z"/>',
    loop: '<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7Zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4Z"/>',
    pip: '<path d="M19 11h-8v6h8v-6Zm4 8V4.98C23 3.88 22.1 3 21 3H3C1.9 3 1 3.88 1 4.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2Zm-2 .02H3V4.97h18v14.05Z"/>',
    fullscreen: '<path d="M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm16 0h2v6h-6v-2h4v-4Z"/>',
  };

  const svg = (name, size) =>
    '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
    '" aria-hidden="true" fill="currentColor">' + (ICONS[name] || "") + "</svg>";

  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const HIDE_DELAY = 2500;
  const SAVE_INTERVAL = 1000; // ms between throttled progress saves
  const RESUME_MIN = 3;       // seconds watched before a position is worth keeping
  const RESUME_MAX = 0.95;    // fraction of the way through before we give up

  /* Host surfaces (the Viewer's stage swipe handler) ask this while deciding
     whether a pointer sequence belongs to the media or to navigation. */
  const activeGestures = new Set();

  function formatTime(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {object} options
   * @param {HTMLElement} options.container   the stage the controls overlay
   * @param {string} [options.entryId]        media entry id for resume
   * @param {{get,set,clear}} [options.progress] resume persistence
   * @returns {Function} cleanup — save progress, drop listeners, remove DOM
   */
  function bind(video, options) {
    const opts = options || {};
    const container = opts.container;
    if (!video || !container) return function () {};

    const entryId = opts.entryId || null;
    const progress = opts.progress || null;

    /* ---- DOM ---------------------------------------------------------------- */
    const bar = document.createElement("div");
    bar.className = "slide__controls";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Video controls");

    const seek = document.createElement("input");
    seek.type = "range";
    seek.className = "slide__seek";
    seek.min = "0";
    seek.max = "0";
    seek.step = "0.1";
    seek.value = "0";
    seek.disabled = true;
    seek.setAttribute("aria-label", "Seek");

    const row = document.createElement("div");
    row.className = "slide__controls-row";

    const playBtn = makeButton("play", "Pause", "play");

    const time = document.createElement("span");
    time.className = "slide__time m3e-label-medium";
    const cur = document.createElement("span");
    cur.textContent = "0:00";
    const dur = document.createElement("span");
    dur.textContent = "0:00";
    time.appendChild(cur);
    time.appendChild(document.createTextNode(" / "));
    time.appendChild(dur);

    const spacer = document.createElement("span");
    spacer.className = "slide__controls-spacer";

    const muteBtn = makeButton("mute", "Mute", "muted");
    const loopBtn = makeButton("loop", "Loop", "loop");
    const rateBtn = makeButton("rate", "Playback speed", null);
    rateBtn.classList.add("slide__rate");
    rateBtn.textContent = "1×";
    const pipBtn = makeButton("pip", "Enter picture-in-picture", "pip");
    const fsBtn = makeButton("fullscreen", "Fullscreen", "fullscreen");

    row.appendChild(playBtn);
    row.appendChild(time);
    row.appendChild(spacer);
    row.appendChild(muteBtn);
    row.appendChild(loopBtn);
    row.appendChild(rateBtn);
    row.appendChild(pipBtn);
    row.appendChild(fsBtn);
    bar.appendChild(seek);
    bar.appendChild(row);

    const spinner = document.createElement("div");
    spinner.className = "slide__buffering";
    spinner.hidden = true;

    const resume = document.createElement("div");
    resume.className = "slide__resume";
    resume.hidden = true;
    const resumeText = document.createElement("span");
    const resumeRestart = document.createElement("button");
    resumeRestart.type = "button";
    resumeRestart.className = "m3e-button m3e-button--text m3e-button--s m3e-state";
    resumeRestart.textContent = "Start over";
    resume.appendChild(resumeText);
    resume.appendChild(resumeRestart);

    /* Scrub preview bubble: floats over the seek bar while dragging. */
    const scrubBubble = document.createElement("div");
    scrubBubble.className = "scrub-bubble";
    scrubBubble.hidden = true;

    /* Centre HUD pill for the volume / speed gestures. */
    const hud = document.createElement("div");
    hud.className = "gesture-hud";
    hud.hidden = true;

    /* Stats-for-nerds panel (toggle: hold the time readout). */
    const statsPanel = document.createElement("div");
    statsPanel.className = "stats-panel";
    statsPanel.hidden = true;
    const statsClose = document.createElement("button");
    statsClose.type = "button";
    statsClose.textContent = "×";
    statsClose.setAttribute("aria-label", "Close stats");
    const statsBody = document.createElement("div");
    statsPanel.appendChild(statsBody);
    statsPanel.appendChild(statsClose);
    let statsTimer = 0;

    container.appendChild(spinner);
    container.appendChild(bar);
    container.appendChild(resume);
    container.appendChild(scrubBubble);
    container.appendChild(hud);
    container.appendChild(statsPanel);

    const pipSupported =
      typeof document !== "undefined" && document.pictureInPictureEnabled &&
      typeof video.requestPictureInPicture === "function";
    if (!pipSupported) pipBtn.hidden = true;
    /* Hide fullscreen only when no flavour of it exists at all. */
    const fsSupported = typeof container.requestFullscreen === "function" ||
      typeof container.webkitRequestFullscreen === "function" ||
      typeof video.webkitEnterFullscreen === "function";
    if (!fsSupported) fsBtn.hidden = true;

    /* ---- state -------------------------------------------------------------- */
    let visible = false;
    let scrubbing = false;
    let buffering = false;
    let hideTimer = null;
    let resumeTimer = null;
    let lastSave = 0;

    const duration = () => (Number.isFinite(video.duration) ? video.duration : 0);
    const isMuted = () => video.muted || video.volume === 0;

    function makeButton(action, label, icon) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "m3e-icon-button m3e-state slide__control";
      b.setAttribute("data-action", action);
      b.setAttribute("aria-label", label);
      if (icon) b.innerHTML = svg(icon, 20);
      return b;
    }

    /* ---- sync ---------------------------------------------------------------- */
    function syncTime() {
      const d = duration();
      seek.disabled = !d;
      if (d) seek.max = String(d);
      if (!scrubbing) seek.value = String(video.currentTime || 0);
      cur.textContent = formatTime(video.currentTime);
      dur.textContent = d ? formatTime(d) : "--:--";
      const pos = scrubbing ? Number(seek.value) : video.currentTime;
      seek.style.setProperty("--_played", d ? String((pos / d) * 100) : "0");
      if (!scrubbing) cur.textContent = formatTime(video.currentTime);
    }

    function syncPlay() {
      const playing = !video.paused && !video.ended;
      playBtn.innerHTML = svg(playing ? "pause" : "play", 20);
      playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    }

    function syncMute() {
      const muted = isMuted();
      muteBtn.innerHTML = svg(muted ? "muted" : "volume", 20);
      muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
      muteBtn.setAttribute("aria-pressed", String(muted));
    }

    function syncRate() {
      rateBtn.textContent = video.playbackRate === 1 ? "1×" : video.playbackRate + "×";
    }

    function syncPiP() {
      const on = document.pictureInPictureElement === video;
      pipBtn.setAttribute("aria-label", on ? "Exit picture-in-picture" : "Enter picture-in-picture");
      pipBtn.setAttribute("aria-pressed", String(on));
    }

    /* ---- visibility ---------------------------------------------------------- */
    function show() {
      bar.classList.add("is-visible");
      visible = true;
      scheduleHide();
    }

    function hide() {
      // Never vanish while the reader still needs it.
      if (scrubbing || buffering || video.paused || video.ended) return;
      if (bar.contains(document.activeElement)) return;
      bar.classList.remove("is-visible");
      visible = false;
    }

    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, HIDE_DELAY);
    }

    function setBuffering(on) {
      buffering = on;
      spinner.hidden = !on;
      if (on) { clearTimeout(hideTimer); show(); }
      else scheduleHide();
    }

    /* ---- resume persistence -------------------------------------------------- */
    function saveProgress(force) {
      if (!progress || !entryId) return;
      const d = duration();
      const t = video.currentTime;
      if (!d || !Number.isFinite(t)) return;
      const now = Date.now();
      if (!force && now - lastSave < SAVE_INTERVAL) return;
      lastSave = now;
      // Under three seconds in, or essentially finished: nothing worth keeping.
      if (t < RESUME_MIN || t > d * RESUME_MAX) { progress.clear(entryId); return; }
      progress.set(entryId, { t, d, at: now });
    }

    function clearProgress() {
      if (progress && entryId) progress.clear(entryId);
    }

    function tryResume() {
      if (!progress || !entryId) return;
      const saved = progress.get(entryId);
      if (!saved) return;
      /* Strict numeric validation: a corrupt or legacy entry (a string, an
         array, an object…) would slip through the < / > guards below —
         comparisons against NaN are false both ways — and then throw
         "non-finite" the moment it is assigned to currentTime, killing
         playback for that item every single time. Validate, purge, clamp. */
      const t = Number(saved.t);
      const d = duration();
      if (!Number.isFinite(t)) { progress.clear(entryId); return; }
      if (!d || t < RESUME_MIN || t > d * RESUME_MAX) return;
      video.currentTime = Math.min(t, d);
      resumeText.textContent = "Resumed from " + formatTime(t);
      resume.hidden = false;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => { resume.hidden = true; }, 4000);
    }

    /* ---- events -------------------------------------------------------------- */
    /* Drag-to-scrub with time travel: while the finger/mouse is down the UI
       previews the target time (label + played fill + bubble) WITHOUT
       hammering currentTime; the seek commits once, on release.

       Scrub thumbnails: a hidden twin <video> is seeked (throttled) to the
       preview timestamp, so the browser paints that exact frame into the
       bubble — sprite-sheet quality without any preprocessing infra. Any
       failure degrades silently to the time-only bubble. */
    let previewVideo = null;
    let previewPendingT = null;
    let previewTimer = 0;

    function ensurePreview() {
      if (previewVideo) return previewVideo;
      const src = video.currentSrc || video.src;
      if (!src) return null;
      previewVideo = document.createElement("video");
      previewVideo.className = "scrub-thumb";
      previewVideo.muted = true;
      previewVideo.preload = "metadata";
      previewVideo.setAttribute("aria-hidden", "true");
      previewVideo.tabIndex = -1;
      previewVideo.src = src;
      previewVideo.addEventListener("loadedmetadata", () => {
        if (previewPendingT != null) {
          const t = previewPendingT;
          previewPendingT = null;
          seekPreviewTo(t);
        }
      });
      scrubBubble.insertBefore(previewVideo, scrubBubble.firstChild);
      return previewVideo;
    }

    function seekPreviewTo(t) {
      const pv = previewVideo;
      if (!pv || pv.readyState < 1 || !Number.isFinite(pv.duration)) {
        previewPendingT = t;
        return;
      }
      const target = Math.min(Math.max(0, t), Math.max(0, pv.duration - 0.05));
      try {
        if (typeof pv.fastSeek === "function") pv.fastSeek(target);
        else pv.currentTime = target;
      } catch (_) {}
    }

    function requestPreview(t) {
      ensurePreview();
      previewPendingT = t;
      if (previewTimer) return;
      previewTimer = setTimeout(() => {
        previewTimer = 0;
        if (previewPendingT == null) return;
        const target = previewPendingT;
        previewPendingT = null;
        seekPreviewTo(target);
      }, 120);
    }

    function positionBubble(pct) {
      scrubBubble.style.left = `calc(${pct}% + ${(50 - pct) / 25}px)`; // keep thumb-anchored
    }

    function showTimeBubble(t) {
      const d = duration();
      if (!d) return false;
      /* Clear everything EXCEPT the twin preview <video>, which must persist. */
      Array.from(scrubBubble.childNodes).forEach((node) => {
        if (node !== previewVideo) scrubBubble.removeChild(node);
      });
      scrubBubble.hidden = false;
      const pct = (Math.min(d, Math.max(0, t)) / d) * 100;
      positionBubble(pct);
      scrubBubble.appendChild(Object.assign(document.createElement("span"), { textContent: formatTime(t) }));
      return true;
    }

    function previewScrub() {
      const d = duration();
      if (!d) return;
      const t = Math.min(d, Math.max(0, Number(seek.value) || 0));
      cur.textContent = formatTime(t);
      seek.style.setProperty("--_played", String((t / d) * 100));
      showTimeBubble(t);
      requestPreview(t);
    }

    seek.addEventListener("input", () => {
      if (!duration()) return;
      previewScrub();
    });

    /* Hover preview (pointer devices): the bar answers before any click. */
    seek.addEventListener("pointermove", (event) => {
      if (scrubbing) return;
      const d = duration();
      if (!d) return;
      const rect = seek.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      showTimeBubble(ratio * d);
      requestPreview(ratio * d);
    });
    seek.addEventListener("pointerleave", () => {
      if (!scrubbing) scrubBubble.hidden = true;
    });
    function commitScrub() {
      scrubBubble.hidden = true;
      const d = duration();
      if (!d) return;
      const t = Number(seek.value);
      if (!Number.isFinite(t)) return;
      video.currentTime = Math.min(Math.max(0, t), d); // ONE seek per gesture
      cur.textContent = formatTime(video.currentTime);
    }
    seek.addEventListener("change", commitScrub);
    ["pointerup", "pointercancel"].forEach((evName) =>
      seek.addEventListener(evName, () => setTimeout(commitScrub, 0))
    );
    seek.addEventListener("pointerdown", () => { scrubbing = true; clearTimeout(hideTimer); });
    ["pointerup", "pointercancel", "change"].forEach((evName) =>
      seek.addEventListener(evName, () => { scrubbing = false; scheduleHide(); })
    );

    playBtn.addEventListener("click", () => {
      if (video.paused) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
      else video.pause();
    });

    muteBtn.addEventListener("click", () => {
      video.muted = !video.muted;
      if (video.muted) video.volume = Math.max(0.01, video.volume || 1); // keep a sensible level to restore
      syncMute();
    });

    loopBtn.addEventListener("click", () => {
      video.loop = !video.loop;
      loopBtn.setAttribute("aria-pressed", String(video.loop));
    });

    rateBtn.addEventListener("click", () => {
      const i = RATES.indexOf(video.playbackRate);
      video.playbackRate = RATES[(i + 1) % RATES.length];
      syncRate();
    });

    pipBtn.addEventListener("click", () => {
      if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
      else video.requestPictureInPicture().catch(() => {});
    });

    /* Fullscreen takes the whole container (video + controls), so the custom
       chrome keeps working inside it. iOS Safari has no element fullscreen:
       there, fall back to the video's native controller.

       Orientation-aware: a landscape video rotates the screen to landscape,
       a portrait one stays upright — the whole point of fullscreen on a
       phone is not watching a 16:9 file letterboxed inside a portrait
       lock. Best-effort everywhere: most desktops ignore the lock API and
       iOS Safari never fires element-fullscreen at all. */
    const naturalAspect = () => {
      if (video.videoWidth && video.videoHeight) return video.videoWidth / video.videoHeight;
      const css = parseFloat(video.style.aspectRatio);   // set by M3EMedia.createVideo
      return Number.isFinite(css) ? css : 0;
    };
    async function lockOrientationFor() {
      try {
        const aspect = naturalAspect();
        if (!aspect || !screen.orientation || typeof screen.orientation.lock !== "function") return;
        await screen.orientation.lock(aspect >= 1 ? "landscape" : "portrait");
      } catch (_) { /* unsupported, denied, or not yet fullscreen */ }
    }
    function unlockOrientation() {
      try {
        if (screen.orientation && typeof screen.orientation.unlock === "function") {
          screen.orientation.unlock();
        }
      } catch (_) {}
    }

    const isFs = () => document.fullscreenElement === container;
    fsBtn.addEventListener("click", () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
        return;
      }
      const request = container.requestFullscreen || container.webkitRequestFullscreen;
      if (request) {
        const p = request.call(container);
        if (p && p.then) {
          p.then(() => lockOrientationFor(video)).catch(() => {});
        } else {
          lockOrientationFor(video);
        }
      } else if (typeof video.webkitEnterFullscreen === "function") {
        video.webkitEnterFullscreen();                 // iOS: native player owns orientation itself
      }
    });
    const syncFullscreen = () => {
      const on = isFs();
      fsBtn.setAttribute("aria-pressed", String(on));
      fsBtn.setAttribute("aria-label", on ? "Exit fullscreen" : "Fullscreen");
      /* The media should fill the screen, not sit inside a letterboxed box. */
      container.classList.toggle("is-fullscreen", on);
      if (!on) unlockOrientation();                    // leaving fullscreen restores rotation
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    syncFullscreen();

    resumeRestart.addEventListener("click", () => {
      clearProgress();
      resume.hidden = true;
      video.currentTime = 0;
      const p = video.play();
      if (p && p.catch) p.catch(() => {});
    });

    /* ---------------------------------------------------------------- gestures --
       Premium-player input model, layered so nothing fights:

         double-tap left/right third → skip ∓10s, accumulating within a short
                                       window (+20s, +30s…) with a ripple
         vertical drag, left half    → volume  (HUD pill)
         vertical drag, right half   → speed    (snaps to a rate on release)

       The volume/speed drags are opt-in per surface (`opts.gestures`) because
       in the Watch feed a vertical drag must stay owned by scroll-snap. The
       module exposes isGestureActive() so host surfaces can defer their own
       swipe handling while a media gesture is in flight. */
    let gestureActive = false;
    const SKIP_SECONDS = 10;
    const SKIP_WINDOW = 900;
    const gestureToken = {};
    const setGestureActive = (on) => {
      gestureActive = on;
      if (on) activeGestures.add(gestureToken);
      else activeGestures.delete(gestureToken);
    };

    let lastTap = { t: 0, side: 0 };
    let pendingSkip = 0;
    let pendingTimer = 0;

    function showSkipRipple(deltaSeconds, side) {
      const ripple = document.createElement("div");
      ripple.className = "skip-ripple" + (side < 0 ? " skip-ripple--left" : " skip-ripple--right");
      ripple.textContent = (deltaSeconds > 0 ? "+" : "−") + Math.abs(deltaSeconds) + "s";
      container.appendChild(ripple);
      setTimeout(() => ripple.remove(), 700);
    }

    function applySkip(delta) {
      if (!Number.isFinite(video.currentTime)) return;
      const d = duration();
      const target = Math.min(d || Infinity, Math.max(0, video.currentTime + delta));
      video.currentTime = target;
      showSkipRipple(delta, delta > 0 ? 1 : -1);
      if (root.navigator && root.navigator.vibrate) root.navigator.vibrate(6);
    }

    function hudShow(iconName, text) {
      hud.innerHTML = iconName ? svg(iconName, 18) : "";
      hud.appendChild(Object.assign(document.createElement("span"), { textContent: text }));
      hud.hidden = false;
    }
    function hudHide() { hud.hidden = true; }

    /* ---- stats for nerds --------------------------------------------------- */
    function paintStats() {
      const q = typeof video.getVideoPlaybackQuality === "function"
        ? video.getVideoPlaybackQuality() : null;
      const ahead = video.buffered.length
        ? Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime)
        : 0;
      const rows = [
        ["Resolution", video.videoWidth + " × " + video.videoHeight],
        ["Buffer health", ahead.toFixed(1) + "s"],
        ["Stream", video.dataset.kind === "hls" ? "HLS" : "MP4"],
        ["Speed", video.playbackRate + "×"],
        ["Volume", Math.round((video.muted ? 0 : video.volume) * 100) + "%"],
        ["Frames dropped", q ? q.droppedVideoFrames : "—"],
        ["Network", ["empty", "idle", "loading", "no source"][video.networkState] || String(video.networkState)],
        ["Served by", VERSION],
      ];
      statsBody.innerHTML = rows.map(([k, v]) =>
        `<div class="stats-panel__row"><span>${k}</span><b>${v}</b></div>`
      ).join("");
    }
    function toggleStats(force) {
      const on = force != null ? force : statsPanel.hidden;
      statsPanel.hidden = !on;
      clearInterval(statsTimer);
      if (on) {
        paintStats();
        statsTimer = setInterval(paintStats, 500);
      }
    }
    statsClose.addEventListener("click", () => toggleStats(false));

    /* Hold the time readout ~600ms to open/close the panel. */
    let statsPress = 0;
    time.addEventListener("pointerdown", () => {
      clearTimeout(statsPress);
      statsPress = setTimeout(() => toggleStats(), 600);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((n) =>
      time.addEventListener(n, () => clearTimeout(statsPress))
    );

    /* ---- stall recovery ------------------------------------------------------ */
    /* A stalled stream gets two chances to step down a quality rung (the host
       supplies `opts.onStallDowngrade`), then one plain reload of the current
       source. Counters reset as soon as playback flows again. */
    let stallTimer = 0;
    let stallAttempts = 0;
    const STALL_TIMEOUT = 4000;

    function clearStall() {
      clearTimeout(stallTimer);
      stallTimer = 0;
    }
    function armStall() {
      clearStall();
      if (!duration()) return;                       // metadata never arrived: error path owns it
      stallTimer = setTimeout(async () => {
        if (video.ended || video.paused) return;
        const t = video.currentTime;
        const wasPlaying = !video.paused;
        stallAttempts++;
        let recovered = false;
        if (stallAttempts <= 2 && typeof opts.onStallDowngrade === "function") {
          recovered = await opts.onStallDowngrade(video, stallAttempts) === true;
        }
        if (!recovered) {
          video.load();
          try { video.currentTime = t; } catch (_) {}
        }
        if (wasPlaying) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
      }, STALL_TIMEOUT);
    }

    /* ---- wiring -------------------------------------------------------------- */
    container.addEventListener("pointerup", (event) => {
      if (gestureActive) return;
      if (event.target.closest(".slide__controls, .slide__resume, .slide__buffering, .stats-panel")) return;
      const now = Date.now();
      const rect = container.getBoundingClientRect();
      const rel = (event.clientX - rect.left) / rect.width;
      const side = rel < 0.34 ? -1 : rel > 0.66 ? 1 : 0;

      if (side !== 0 && now - lastTap.t < 320 && lastTap.side === side) {
        /* Accumulate: taps inside the window stack up (∓20s, ∓30s…). */
        pendingSkip += SKIP_SECONDS * side;
        applySkip(pendingSkip);
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => { pendingSkip = 0; }, SKIP_WINDOW);
        lastTap.t = 0;
      } else if (side !== 0) {
        lastTap = { t: now, side };
        pendingSkip = SKIP_SECONDS * side;
        pendingTimer = setTimeout(() => { pendingSkip = 0; }, SKIP_WINDOW);
      }
    });

    let gStartX = 0;
    let gStartY = 0;
    let gMode = "";           // "" | "volume" | "rate"
    let gStartVol = 1;
    let gStartRate = 1;

    container.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".slide__controls, .slide__resume, .slide__buffering, .stats-panel")) return;
      if (!opts.gestures) return;
      gStartX = event.clientX;
      gStartY = event.clientY;
      gMode = "";
    });

    container.addEventListener("pointermove", (event) => {
      if (!opts.gestures) return;
      const rect = container.getBoundingClientRect();

      if (!gestureActive) {
        const dx = event.clientX - gStartX;
        const dy = event.clientY - gStartY;
        /* Vertical intent beats horizontal: steep, deliberate movement only.
           Touch keeps this OFF unless the host surface explicitly opted in
           (Viewer does; Watch must keep vertical drags for scroll-snap). */
        const touchOk = event.pointerType !== "touch" || !!opts.gesturesTouch;
        if (!touchOk) return;
        if (Math.abs(dy) < 18 || Math.abs(dx) > 14) return;
        gMode = gStartX - rect.left < rect.width / 2 ? "volume" : "rate";
        setGestureActive(true);
        gStartVol = video.muted ? 0 : video.volume;
        gStartRate = video.playbackRate || 1;
        show();
      }

      const dy = gStartY - event.clientY;            // up positive
      if (gMode === "volume") {
        const v = Math.min(1, Math.max(0, gStartVol + dy / 200));
        if (v > 0 && video.muted) video.muted = false;
        if (v === 0) video.muted = true;
        video.volume = Math.max(0.01, v);
        syncMute();
        hudShow(video.muted ? "muted" : "volume", Math.round((video.muted ? 0 : v) * 100) + "%");
      } else if (gMode === "rate") {
        const raw = gStartRate * Math.pow(2, dy / 250);
        const r = Math.min(4, Math.max(0.25, raw));
        hudShow(null, r.toFixed(2).replace(/\.?0+$/, "") + "×");
        hud.__previewRate = r;
      }
    });

    function endGesture() {
      if (gestureActive && gMode === "rate" && hud.__previewRate != null) {
        /* Snap to the nearest offered rate — continuous speed feels broken. */
        const target = hud.__previewRate;
        let best = RATES[0];
        RATES.forEach((r) => { if (Math.abs(r - target) < Math.abs(best - target)) best = r; });
        video.playbackRate = best;
        syncRate();
        delete hud.__previewRate;
      }
      hudHide();
      setGestureActive(false);
      gMode = "";
    }
    container.addEventListener("pointerup", endGesture);
    container.addEventListener("pointercancel", endGesture);

    video.addEventListener("waiting", () => setBuffering(true));
    video.addEventListener("stalled", () => { setBuffering(true); armStall(); });
    ["playing", "canplay", "ended"].forEach((n) => video.addEventListener(n, () => {
      setBuffering(false);
      clearStall();
      stallAttempts = 0;
    }));
    video.addEventListener("error", () => { clearStall(); });
    let downX = 0;
    let downY = 0;
    const onPointerDown = (event) => {
      if (event.target.closest(".slide__controls, .slide__resume, .slide__buffering")) return;
      downX = event.clientX;
      downY = event.clientY;
    };
    const onClick = (event) => {
      if (event.target.closest(".slide__controls, .slide__resume, .slide__buffering")) return;
      const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
      if (moved > 6) return;
      if (!visible) { show(); return; }
      if (video.paused) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
      else video.pause();
    };
    const onPointerMove = () => { if (!video.paused) show(); };
    const onPointerLeave = () => hide();

    /* Isolate every pointer phase that begins on the control chrome.
       pointerdown alone is not enough: the dashboard's stage-level swipe
       listener still sees the matching pointerup (and would treat a Play
       click as a horizontal swipe when its start coords were never recorded).
       Stopping the whole pointer lifecycle on the bar keeps play/seek/mute
       from paging the theater. */
    const stopChromeGesture = (event) => event.stopPropagation();
    const CHROME_POINTER_EVENTS = ["pointerdown", "pointerup", "pointercancel", "pointermove", "click"];

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("click", onClick);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerleave", onPointerLeave);
    CHROME_POINTER_EVENTS.forEach((name) => {
      bar.addEventListener(name, stopChromeGesture);
      resume.addEventListener(name, stopChromeGesture);
    });

    bar.addEventListener("focusin", () => { clearTimeout(hideTimer); show(); });
    bar.addEventListener("focusout", () => scheduleHide());

    video.addEventListener("loadedmetadata", () => { syncTime(); tryResume(); });
    video.addEventListener("durationchange", syncTime);
    video.addEventListener("timeupdate", () => { syncTime(); saveProgress(); });
    video.addEventListener("progress", () => {
      const d = duration();
      if (!d || !video.buffered.length) return;
      const end = video.buffered.end(video.buffered.length - 1);
      seek.style.setProperty("--_buffered", String(Math.min(1, end / d) * 100));
    });
    video.addEventListener("play", () => { syncPlay(); scheduleHide(); });
    video.addEventListener("pause", () => { syncPlay(); saveProgress(true); show(); });
    video.addEventListener("ended", () => { syncPlay(); saveProgress(true); show(); });
    video.addEventListener("waiting", () => setBuffering(true));
    video.addEventListener("playing", () => setBuffering(false));
    video.addEventListener("canplay", () => setBuffering(false));
    video.addEventListener("ratechange", syncRate);
    video.addEventListener("volumechange", syncMute);
    video.addEventListener("enterpictureinpicture", syncPiP);
    video.addEventListener("leavepictureinpicture", syncPiP);

    const onPageHide = () => saveProgress(true);
    if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide);

    /* ---- initial state ------------------------------------------------------- */
    syncTime();
    syncPlay();
    syncMute();
    syncRate();
    loopBtn.setAttribute("aria-pressed", String(video.loop));
    show();

    /* ---- cleanup ------------------------------------------------------------- */
    let done = false;
    return function cleanup() {
      if (done) return;
      done = true;
      clearTimeout(hideTimer);
      clearTimeout(resumeTimer);
      clearTimeout(statsPress);
      clearInterval(statsTimer);
      clearTimeout(previewTimer);
      clearStall();
      activeGestures.delete(gestureToken);
      saveProgress(true);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("click", onClick);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      CHROME_POINTER_EVENTS.forEach((name) => {
        bar.removeEventListener(name, stopChromeGesture);
        resume.removeEventListener(name, stopChromeGesture);
      });
      if (typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("fullscreenchange", syncFullscreen);
      [spinner, bar, resume, scrubBubble, hud, statsPanel].forEach((el) => el.remove());
    };
  }

  return { bind, isGestureActive: () => gestureActiveCount > 0 };
});

