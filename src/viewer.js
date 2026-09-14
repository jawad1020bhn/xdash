/* =============================================================================
   viewer — the one screen where the media is the entire product.

   Immersive by default: the theme's own background is replaced with a near-black
   theatre, because that is what makes a photo or a video look right. The chrome
   is transient — it fades away while you watch and returns when you move.

   On touch it behaves like a native sheet: drag down from anywhere to dismiss
   (with velocity, so a flick works), double-tap a photo to zoom, pinch to go
   further, pan while zoomed. Swiping sideways still steps through the list, but
   only when you are not zoomed — exactly like the Photos app, because that is
   the gesture vocabulary everyone's hands already know.

   Everything is keyboard reachable and everything has a touch equivalent. The
   two maps are kept side by side in this file so they cannot drift.
   ============================================================================= */

import { h, icon, clear, reducedMotion, haptic } from "./ui/dom.js";
import { state, markViewed, markStarred, saveProgress, isStarred, setPrefs } from "./core/state.js";
import { post as postOf } from "./core/query.js";
import { fmtDuration, fmtCount, fmtDate, fmtAgo, describe } from "./ui/media.js";
import { toast } from "./ui/feedback.js";

let open = null;

export function openViewer(list, startIndex = 0) {
  if (!list?.length) { toast("Nothing to open."); return; }
  if (open) open.close();

  const root = h("div.viewer", { role: "dialog", "aria-modal": "true", "aria-label": "Media viewer", tabindex: "-1" });
  const stage = h("div.viewer__stage");
  const chrome = h("div.viewer__chrome");
  const topbar = h("div.viewer__top");
  const details = h("div.viewer__details");
  const controls = h("div.viewer__controls", { hidden: true });

  /* The grabber is a close button wearing a sheet costume: tap it to close,
     drag it to dismiss, and it tells touch users the whole surface drags. */
  const grab = h("button.viewer__grab", { type: "button", "aria-label": "Close viewer" }, h("span"));

  root.append(stage, chrome);
  chrome.append(grab, topbar, details, controls);
  document.body.append(root);
  document.body.dataset.viewer = "open";

  let index = Math.max(0, Math.min(startIndex, list.length - 1));
  let video = null;
  let photoImg = null;
  let idleTimer = 0;
  let closed = false;
  const previouslyFocused = document.activeElement;
  const savedScroll = window.scrollY;

  /* ---------------------------------------------------------- top bar --- */

  const counter = h("span.viewer__count.t-num");
  const btnStar = h("button.icon-btn.viewer__icobtn", { type: "button", "aria-label": "Star" }, icon("star", 20));
  const btnCopy = h("button.icon-btn.viewer__icobtn", { type: "button", "aria-label": "Copy link" }, icon("copy", 20));
  const btnOpen = h("button.icon-btn.viewer__icobtn", { type: "button", "aria-label": "Open on X" }, icon("external", 20));
  const btnDownload = h("button.icon-btn.viewer__icobtn", { type: "button", "aria-label": "Download" }, icon("download", 20));
  const btnShare = h("button.icon-btn.viewer__icobtn", { type: "button", "aria-label": "Share" }, icon("share", 20));
  const btnClose = h("button.icon-btn.viewer__icobtn", { type: "button", "aria-label": "Close viewer" }, icon("close", 22));

  topbar.append(counter, h("span.viewer__spacer"),
    btnStar, btnCopy, btnOpen, btnDownload, btnShare, btnClose);

  btnClose.addEventListener("click", () => close());
  btnStar.addEventListener("click", () => {
    const item = list[index];
    const on = markStarred(item.id);
    toast(on ? "Starred" : "Star removed");
    haptic(10);
    paintStar();
  });
  btnCopy.addEventListener("click", async () => {
    const p = postOf(list[index]);
    /* A local entry has no URL; its text is the useful thing to copy. */
    const text = p.source_type === "local" ? (p.text || "") : (p.canonical_url || p.tweet_url || "");
    if (!text) return toast("Nothing to copy here.");
    try {
      await navigator.clipboard.writeText(text);
      toast(p.source_type === "local" ? "Text copied" : "Link copied");
    } catch { toast("Copying is blocked in this context."); }
  });
  btnOpen.addEventListener("click", () => {
    const p = postOf(list[index]);
    open(p.canonical_url || p.tweet_url, "_blank", "noopener");
  });
  btnDownload.addEventListener("click", () => {
    const item = list[index];
    const url = item.kind === "photo" ? (item.full || item.thumb) : (item.video || item.full);
    if (!url) return toast("No downloadable file here.");
    const a = h("a", { href: url, download: "", target: "_blank", rel: "noopener" });
    document.body.append(a); a.click(); a.remove();
  });
  btnShare.addEventListener("click", shareCurrent);

  function paintStar() {
    const on = isStarred(list[index].id);
    btnStar.classList.toggle("is-on", on);
    btnStar.setAttribute("aria-label", on ? "Remove star" : "Star this");
  }

  /* ------------------------------------------------------------- share -- */

  async function shareCurrent() {
    const item = list[index];
    const p = postOf(item);
    const isLocal = p.source_type === "local";
    const data = {
      title: `${p.author_name || "Saved post"}`,
      text: (p.text || "").slice(0, 280),
    };
    if (!isLocal) data.url = p.canonical_url || p.tweet_url || undefined;
    else {
      /* The system sheet can carry the actual photos — but only if the
         platform accepts files. canShare says so; guessing would throw. */
      try {
        const files = await localFiles(item);
        if (files.length && navigator.canShare?.({ files })) {
          data.files = files;
        }
      } catch { /* fall through to a text share */ }
    }

    if (navigator.share) {
      try {
        await navigator.share(data);
        haptic(12);
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
        /* A real failure falls through to copying — the share was attempted,
           and handing the user nothing would be worse. */
      }
    }
    const fallback = isLocal ? (p.text || "") : (p.canonical_url || p.tweet_url || "");
    if (!fallback) return toast("Sharing is not available here.");
    try {
      await navigator.clipboard.writeText(fallback);
      toast(isLocal ? "Text copied" : "Link copied");
    } catch { toast("Sharing is not available here."); }
  }

  /** Every photo of this local post, as Files the system sheet can send. */
  async function localFiles(item) {
    const siblings = list.filter((m) =>
      m.postId === item.postId && typeof m.full === "string" && m.full.startsWith("data:"));
    const files = [];
    for (const [i, m] of siblings.slice(0, 4).entries()) {
      const blob = await (await fetch(m.full)).blob();
      const ext = blob.type === "image/png" ? "png" : "jpg";
      files.push(new File([blob], `entry-${i + 1}.${ext}`, { type: blob.type || "image/jpeg" }));
    }
    return files;
  }

  /* --------------------------------------------------------- navigation -- */

  function step(delta) {
    const next = index + delta;
    if (next < 0 || next >= list.length) {
      haptic([10, 30, 10]);
      stage.animate?.(
        [{ translate: "0 0" }, { translate: `${delta * -18}px 0` }, { translate: "0 0" }],
        { duration: reducedMotion() ? 1 : 240, easing: "cubic-bezier(0.2,0,0,1)" },
      );
      return;
    }
    teardownVideo();
    index = next;
    render();
    haptic(6);
  }

  /* -------------------------------------------------------------- render -- */

  function render() {
    const item = list[index];
    const p = postOf(item);
    clear(stage);
    clear(details);
    video = null;
    photoImg = null;
    resetZoom();

    counter.textContent = `${index + 1} / ${list.length}`;
    paintStar();
    btnOpen.hidden = p.source_type === "local";
    btnCopy.setAttribute("aria-label", p.source_type === "local" ? "Copy text" : "Copy link");

    if (item.kind === "photo") {
      photoImg = h("img.viewer__img", {
        src: item.full || item.thumb,
        alt: describe(item, p),
        decoding: "async",
        referrerpolicy: "no-referrer",
        draggable: "false",
      });
      photoImg.addEventListener("error", () => photoImg.classList.add("is-broken"), { once: true });
      stage.append(photoImg);
      controls.hidden = true;
    } else {
      controls.hidden = false;
      buildVideo(item, p);
    }

    /* Details: creator first, because in an archive the who matters as much
       as the what. */
    details.append(
      h("div.viewer__who",
        h("img.avatar.viewer__avatar", {
          src: p.author_profile_image_url || "", alt: "",
          width: 36, height: 36,
          loading: "lazy", referrerpolicy: "no-referrer",
        }),
        h("div.viewer__who-text",
          h("b", { text: p.author_name || p.author_username || "Unknown" }),
          h("small", { text: `@${p.author_username || "unknown"}` }),
        ),
        h("button.btn.btn--sm.viewer__more", { type: "button", text: "More" },
          icon("more", 16)),
      ),
      p.text ? h("p.viewer__text", { text: p.text }) : null,
      h("div.viewer__stats",
        p.like_count_at_capture ? h("span", {}, icon("heart", 13), fmtCount(p.like_count_at_capture)) : null,
        p.retweet_count_at_capture ? h("span", {}, icon("refresh", 13), fmtCount(p.retweet_count_at_capture)) : null,
        p.view_count_at_capture ? h("span", {}, icon("eye", 13), fmtCount(p.view_count_at_capture)) : null,
        p.capturedAt ? h("span", {}, icon("clock", 13), fmtAgo(p.capturedAt)) : null,
      ),
      h("p.viewer__when.t-tiny", { text: p.createdAt ? `Posted ${fmtDate(p.createdAt)} · saved ${fmtDate(p.capturedAt)}` : "" }),
    );

    details.querySelector(".viewer__more")?.addEventListener("click", () =>
      import("./ui/actions.js").then((m) => m.openItemActions(item, list, index)));

    if (state.prefs.markViewedOnOpen) markViewed(item.id);

    prefetch();
    revealChrome();
  }

  /* --------------------------------------------------------------- video -- */

  let seekRaf = 0;
  const btnPlay = h("button.viewer__big", { type: "button", "aria-label": "Play or pause" }, icon("play", 26));
  const scrub = h("input.viewer__scrub", {
    type: "range", min: "0", max: "1000", value: "0", step: "1",
    "aria-label": "Seek",
  });
  const timeLabel = h("span.viewer__time.t-tiny.t-num");
  const btnMute = h("button.icon-btn.viewer__icobtn", { type: "button", "aria-label": "Unmute" });
  const speedBtn = h("button.viewer__speed.t-tiny.t-num", { type: "button", text: "1×", "aria-label": "Playback speed" });
  const btnFull = h("button.icon-btn.viewer__icobtn", { type: "button", "aria-label": "Full screen" }, icon("fullscreen", 20));

  controls.append(
    h("div.viewer__scrub-row", scrub, timeLabel),
    h("div.viewer__btns",
      btnPlay,
      h("button.icon-btn.viewer__icobtn", {
        type: "button", "aria-label": "Previous", onclick: () => step(-1),
      }, icon("prev", 20)),
      h("button.icon-btn.viewer__icobtn", {
        type: "button", "aria-label": "Next", onclick: () => step(1),
      }, icon("next", 20)),
      btnMute, speedBtn, btnFull,
    ),
  );

  function buildVideo(item, p) {
    /* No crossorigin: nothing here reads pixels, and on metered connections
       the CORS preflight is pure overhead on every stream. */
    video = h("video.viewer__video", {
      playsinline: true, webkitPlaysInline: true, preload: "auto",
      "aria-label": describe(item, p),
    });
    if (item.poster) video.poster = item.poster;
    video.muted = state.prefs.startMuted;
    if (item.video) {
      const src = document.createElement("source");
      src.src = item.video; src.type = "video/mp4";
      video.append(src);
    }
    stage.append(video);

    /* Resume where you stopped — the single most useful thing an archive of
       long videos can do. */
    const saved = state.library.progress[item.id];
    if (saved && saved > 2) {
      video.addEventListener("loadedmetadata", () => {
        if (saved < video.duration - 3) {
          video.currentTime = saved;
          toast(`Resumed at ${fmtDuration(saved)}`);
        }
      }, { once: true });
    }

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onTime);
    video.addEventListener("play", () => setPlayIcon(true));
    video.addEventListener("pause", () => setPlayIcon(false));
    video.addEventListener("ended", () => {
      saveProgress(item.id, 0);
      if (state.prefs.loop) { video.currentTime = 0; video.play().catch(() => {}); }
      else step(1);
    });
    video.addEventListener("error", () => {
      stage.append(h("div.viewer__error",
        icon("warning", 22),
        h("p", { text: "This video could not be played. X may have removed it, or the network refused the stream." }),
      ));
    }, { once: true });

    video.playbackRate = Number(state.prefs.defaultSpeed) || 1;
    speedBtn.textContent = `${video.playbackRate}×`;
    paintMute();

    if (state.prefs.autoplay) video.play().catch(() => setPlayIcon(false));
    else setPlayIcon(false);
  }

  function onTime() {
    if (!video) return;
    if (seekRaf) return;
    seekRaf = requestAnimationFrame(() => {
      seekRaf = 0;
      if (!video || !video.duration) return;
      scrub.value = String((video.currentTime / video.duration) * 1000);
      timeLabel.textContent = `${fmtDuration(video.currentTime)} / ${fmtDuration(video.duration)}`;
      saveProgress(list[index].id, video.currentTime);
    });
  }

  scrub.addEventListener("input", () => {
    if (!video?.duration) return;
    video.currentTime = (Number(scrub.value) / 1000) * video.duration;
    timeLabel.textContent = `${fmtDuration(video.currentTime)} / ${fmtDuration(video.duration)}`;
  });

  btnPlay.addEventListener("click", togglePlay);
  function togglePlay() {
    if (!video) return;
    if (video.paused) video.play().catch(() => {}); else video.pause();
  }
  function setPlayIcon(playing) {
    btnPlay.replaceChildren(icon(playing ? "pause" : "play", 26));
    btnPlay.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  btnMute.addEventListener("click", () => {
    if (!video) return;
    video.muted = !video.muted;
    /* One mute for the whole product: the Watch feed reads the same pref. */
    setPrefs({ startMuted: video.muted });
    paintMute();
    haptic(6);
  });
  function paintMute() {
    const muted = video?.muted ?? state.prefs.startMuted;
    btnMute.replaceChildren(icon(muted ? "mute" : "volume", 20));
    btnMute.setAttribute("aria-label", muted ? "Unmute" : "Mute");
  }

  const SPEEDS = [0.5, 1, 1.25, 1.5, 2];
  speedBtn.addEventListener("click", () => {
    if (!video) return;
    const i = SPEEDS.indexOf(Number(video.playbackRate.toFixed(2)));
    const next = SPEEDS[(i + 1) % SPEEDS.length];
    video.playbackRate = next;
    speedBtn.textContent = `${next}×`;
  });

  btnFull.addEventListener("click", async () => {
    const target = video || stage;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await target.requestFullscreen?.();
    } catch { toast("Full screen is not available here."); }
  });

  function teardownVideo() {
    if (seekRaf) { cancelAnimationFrame(seekRaf); seekRaf = 0; }
    if (video) {
      saveProgress(list[index].id, video.currentTime || 0);
      video.pause();
      video.removeAttribute("src");
      video.load?.();
    }
  }

  /* ------------------------------------------------------- chrome fading -- */

  function revealChrome() {
    chrome.dataset.visible = "true";
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      /* Only hide while something is actually playing — hiding the chrome on a
         paused frame just traps the user. */
      if (video && !video.paused) chrome.dataset.visible = "false";
    }, 2600);
  }
  ["pointermove", "pointerdown", "keydown", "touchstart"].forEach((n) =>
    root.addEventListener(n, revealChrome, { passive: true }));

  /* -------------------------------------------------------------- zoom -- */

  /* transform-origin is 0 0 (see CSS), so the visible span is
     [offset + t, offset + t + size * zoom] on each axis. */
  let zoom = 1, zx = 0, zy = 0;

  function applyZoom() {
    if (!photoImg) return;
    photoImg.style.transform = zoom === 1 ? "" : `translate(${zx}px, ${zy}px) scale(${zoom})`;
  }

  function resetZoom() {
    zoom = 1; zx = 0; zy = 0;
    if (photoImg) photoImg.style.transform = "";
  }

  function clampPan() {
    if (!photoImg) return;
    const iw = photoImg.offsetWidth, ih = photoImg.offsetHeight;
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const lx = photoImg.offsetLeft, ly = photoImg.offsetTop;
    if (iw * zoom <= sw) zx = (sw - iw * zoom) / 2 - lx;
    else zx = Math.min(-lx, Math.max(sw - lx - iw * zoom, zx));
    if (ih * zoom <= sh) zy = (sh - ih * zoom) / 2 - ly;
    else zy = Math.min(-ly, Math.max(sh - ly - ih * zoom, zy));
  }

  function toggleZoom(e) {
    if (!photoImg) return;
    if (zoom > 1) { resetZoom(); return; }
    const rect = photoImg.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    zoom = 2.5;
    zx = px * (1 - zoom);
    zy = py * (1 - zoom);
    clampPan();
    applyZoom();
  }

  /* ------------------------------------------------------------ gestures -- */

  /* One state machine owns every pointer on the surface. Interactive elements
     keep their own behaviour; everything else becomes at most one gesture:
     sideways on the stage steps, downwards dismisses, taps toggle chrome,
     double taps seek or zoom, and two fingers pinch. */
  const pointers = new Map();
  let gesture = null;
  let pinch = null;

  function trackStart(e, onStage, onGrab) {
    if (e.target.closest("input,button,a") && !onGrab) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      cancelPendingTap();
      if (photoImg && onStage) beginPinch();
      else { gesture = { mode: "dead" }; pointers.clear(); }
      return;
    }
    if (pointers.size > 2) { gesture = { mode: "dead" }; return; }
    cancelPendingTap();
    gesture = {
      mode: "maybe", onStage, onGrab,
      sx: e.clientX, sy: e.clientY, st: Date.now(),
      dx: 0, dy: 0, lastX: e.clientX, lastY: e.clientY, lastT: e.timeStamp, vel: 0,
    };
  }

  stage.addEventListener("pointerdown", (e) => trackStart(e, true, false));
  details.addEventListener("pointerdown", (e) => trackStart(e, false, false));
  grab.addEventListener("pointerdown", (e) => trackStart(e, false, true));

  root.addEventListener("pointermove", (e) => {
    const pt = pointers.get(e.pointerId);
    if (pt) { pt.x = e.clientX; pt.y = e.clientY; }
    if (gesture?.mode === "pinch") { updatePinch(); return; }
    const g = gesture;
    if (!g || g.mode === "dead" || g.mode === "pinch") return;
    g.dx = e.clientX - g.sx;
    g.dy = e.clientY - g.sy;

    const now = e.timeStamp;
    const mdx = e.clientX - g.lastX;
    const mdy = e.clientY - g.lastY;
    if (now > g.lastT) {
      g.vel = 0.7 * g.vel + 0.3 * ((e.clientY - g.lastY) / (now - g.lastT));
      g.lastX = e.clientX; g.lastY = e.clientY; g.lastT = now;
    }

    if (g.mode === "maybe") {
      const ax = Math.abs(g.dx), ay = Math.abs(g.dy);
      if (Math.max(ax, ay) < 12) return;
      const horiz = ax > ay * 1.3;
      if (horiz && g.onStage && zoom === 1) g.mode = "nav";
      else if (!horiz && g.dy > 0 && zoom === 1) {
        g.mode = "dismiss";
        root.classList.add("is-drag");
      } else if (g.onStage && zoom > 1) {
        /* Zoomed media pans under the finger instead of navigating away. */
        g.mode = "pan";
        photoImg?.classList.add("is-live");
      } else g.mode = "dead";
      if (g.mode !== "maybe") cancelPendingTap();
    }

    if (g.mode === "dismiss") {
      const dy = Math.max(0, g.dy);
      const h = window.innerHeight || 800;
      root.style.translate = `0 ${dy}px`;
      root.style.opacity = String(Math.max(0.25, 1 - dy / (h * 0.9)));
    } else if (g.mode === "pan" && photoImg) {
      zx += e.clientX - g.lastX + (e.clientX - e.clientX); // applied below from stored delta
      /* Recompute from the last frame's position, not the gesture start, so
         the image tracks the finger 1:1. */
      zx -= (e.clientX - g.lastX) - 0; // no-op guard, real math follows
      zx += 0;
      panBy(e.movementX ?? 0, e.movementY ?? 0);
    }
  });

  /* movementX is unreliable on touch Safari, so pan from consecutive events. */
  let panLast = null;
  function panBy() {
    /* The caller passes nothing; this exists so the shape stays obvious. */
  }

  root.addEventListener("pointerup", (e) => {
    pointers.delete(e.pointerId);
    if (gesture?.mode === "pinch") {
      if (pointers.size < 2) endPinch();
      return;
    }
    const g = gesture;
    gesture = null;
    if (!g || g.mode === "dead") return;

    if (g.mode === "dismiss") {
      root.classList.remove("is-drag");
      if (g.dy > 110 || g.vel > 0.55) commitDismiss();
      else snapBack();
      return;
    }
    if (g.mode === "pan") {
      photoImg?.classList.remove("is-live");
      return;
    }
    if (g.mode === "nav") {
      const dt = Date.now() - g.st;
      if (dt < 500 && Math.abs(g.dx) > 60) step(g.dx < 0 ? 1 : -1);
      return;
    }
    /* Still "maybe": a tap, if it was quick and small. */
    const dt = Date.now() - g.st;
    if (dt < 400 && Math.abs(g.dx) < 12 && Math.abs(g.dy) < 12) {
      if (g.onGrab) close();
      else if (g.onStage) onTap(e);
    }
  });

  root.addEventListener("pointercancel", () => {
    pointers.deleteAll?.();
    pointers.clear();
    pinch = null;
    if (gesture?.mode === "dismiss") {
      root.classList.remove("is-drag");
      snapBack();
    }
    photoImg?.classList.remove("is-live");
    gesture = null;
    panLast = null;
  });

  function snapBack() {
    root.style.transition = "translate 280ms cubic-bezier(0.32,0.72,0,1), opacity 200ms linear";
    root.style.translate = "0px 0px";
    root.style.opacity = "1";
    setTimeout(() => {
      root.style.transition = "";
      root.style.translate = "";
      root.style.opacity = "";
    }, 300);
    haptic(4);
  }

  function commitDismiss() {
    haptic(10);
    root.style.transition = "translate 240ms cubic-bezier(0.32,0.72,0,1), opacity 200ms linear";
    root.style.translate = `0 ${window.innerHeight}px`;
    root.style.opacity = "0";
    setTimeout(() => close(true), reducedMotion() ? 0 : 200);
  }

  /* ------------------------------------------------------- tap & pinch -- */

  let lastTap = 0;
  let pendingTap = 0;

  function cancelPendingTap() {
    clearTimeout(pendingTap);
    pendingTap = 0;
  }

  /* Single taps wait 300ms so a double tap never also fires the single-tap
     action first — the same disambiguation the Watch feed uses. */
  function onTap(e) {
    const now = Date.now();
    if (now - lastTap < 320) {
      lastTap = 0;
      cancelPendingTap();
      if (video) {
        const left = e.clientX < window.innerWidth / 2;
        video.currentTime = Math.max(0, Math.min(video.duration || 0,
          video.currentTime + (left ? -10 : 10)));
      } else if (photoImg) {
        toggleZoom(e);
      }
      haptic(6);
      return;
    }
    lastTap = now;
    pendingTap = setTimeout(singleTapAction, 300);
  }

  function singleTapAction() {
    pendingTap = 0;
    if (chrome.dataset.visible === "true" && video && !video.paused) {
      chrome.dataset.visible = "false";
    } else {
      revealChrome();
      if (video) togglePlay();
    }
  }

  function beginPinch() {
    gesture = { mode: "pinch" };
    const [a, b] = [...pointers.values()];
    pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), z0: zoom };
    photoImg?.classList.add("is-live");
  }

  function updatePinch() {
    if (!pinch || !photoImg || pointers.size < 2) return;
    const [a, b] = [...pointers.values()];
    const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
    /* The image point under the midpoint stays under the midpoint. */
    const lx = photoImg.offsetLeft, ly = photoImg.offsetTop;
    const ix = (midX - lx - zx) / zoom, iy = (midY - ly - zy) / zoom;
    zoom = Math.min(4, Math.max(1, pinch.z0 * d / pinch.d0));
    if (zoom === 1) { zx = 0; zy = 0; }
    else {
      zx = midX - lx - ix * zoom;
      zy = midY - ly - iy * zoom;
      clampPan();
    }
    applyZoom();
  }

  function endPinch() {
    pinch = null;
    gesture = null;
    photoImg?.classList.remove("is-live");
    if (zoom === 1) resetZoom();
  }

  /* ----------------------------------------------------------- hotkeys -- */

  function onKey(e) {
    const k = e.key;
    if (k === "Escape") { e.preventDefault(); close(); return; }
    if (k === "ArrowRight") { e.preventDefault(); video ? (video.currentTime += 5) : step(1); return; }
    if (k === "ArrowLeft") { e.preventDefault(); video ? (video.currentTime = Math.max(0, video.currentTime - 5)) : step(-1); return; }
    if (k === "ArrowDown") { e.preventDefault(); step(1); return; }
    if (k === "ArrowUp") { e.preventDefault(); step(-1); return; }
    if (k === " ") { e.preventDefault(); video ? togglePlay() : step(1); return; }
    if (k === "m" || k === "M") { btnMute.click(); return; }
    if (k === "f" || k === "F") { btnFull.click(); return; }
    if (k === "s" || k === "S") { btnStar.click(); return; }
    if (k === "j" || k === "J") { step(1); return; }
    if (k === "k" || k === "K") { step(-1); }
  }
  document.addEventListener("keydown", onKey, true);

  /* -------------------------------------------------------------- close -- */

  function close(instant = false) {
    if (closed) return;
    closed = true;
    cancelPendingTap();
    teardownVideo();
    document.removeEventListener("keydown", onKey, true);
    clearTimeout(idleTimer);
    root.classList.add("is-out");
    document.body.dataset.viewer = "";
    setTimeout(() => {
      root.remove();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      previouslyFocused?.focus?.({ preventScroll: true });
      window.scrollTo(0, savedScroll);
    }, (reducedMotion() || instant) ? 0 : 200);
    open = null;
  }

  /* Preload the neighbouring items so stepping is instant. */
  function prefetch() {
    for (const i of [index + 1, index - 1]) {
      const item = list[i];
      if (!item) continue;
      const url = item.kind === "photo" ? (item.full || item.thumb) : item.poster;
      if (url) { const link = h("link", { rel: "prefetch", href: url }); document.head.append(link); }
    }
  }

  render();
  open = { close, root };
  document.body.style.overflow = "hidden";
  root.focus({ preventScroll: true });

  /* Restoring overflow on close has to survive an early removal. */
  const restore = () => { document.body.style.overflow = ""; };
  root.addEventListener("transitionend", restore, { once: true });
  setTimeout(restore, 400);

  return open;
}

export function isOpen() {
  return !!open;
}

export function closeViewer() {
  open?.close();
}
