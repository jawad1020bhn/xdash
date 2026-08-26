/* =============================================================================
   viewer — the one screen where the media is the entire product.

   Immersive by default: the theme's own background is replaced with a near-black
   theatre, because that is what makes a photo or a video look right. The chrome
   is transient — it fades away while you watch and returns when you move.

   Everything is keyboard reachable and everything has a touch equivalent. The
   two maps are kept side by side in this file so they cannot drift.
   ============================================================================= */

import { h, icon, clear, reducedMotion, haptic, useBreakpoint } from "./ui/dom.js";
import { state, markViewed, markStarred, saveProgress, isStarred } from "./core/state.js";
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

  root.append(stage, chrome);
  chrome.append(topbar, details, controls);
  document.body.append(root);
  document.body.dataset.viewer = "open";

  let index = Math.max(0, Math.min(startIndex, list.length - 1));
  let video = null;
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
  const btnClose = h("button.icon-btn.viewer__icobtn", { type: "button", "aria-label": "Close viewer" }, icon("close", 22));

  topbar.append(counter, h("span.viewer__spacer"),
    btnStar, btnCopy, btnOpen, btnDownload, btnClose);

  btnClose.addEventListener("click", close);
  btnStar.addEventListener("click", () => {
    const item = list[index];
    const on = markStarred(item.id);
    toast(on ? "Starred" : "Star removed");
    paintStar();
  });
  btnCopy.addEventListener("click", async () => {
    const p = postOf(list[index]);
    try { await navigator.clipboard.writeText(p.canonical_url || p.tweet_url || ""); toast("Link copied"); }
    catch { toast("Copying is blocked in this context."); }
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

  function paintStar() {
    const on = isStarred(list[index].id);
    btnStar.classList.toggle("is-on", on);
    btnStar.setAttribute("aria-label", on ? "Remove star" : "Star this");
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

    counter.textContent = `${index + 1} / ${list.length}`;
    paintStar();

    if (item.kind === "photo") {
      const img = h("img.viewer__img", {
        src: item.full || item.thumb,
        alt: describe(item, p),
        decoding: "async",
        referrerpolicy: "no-referrer",
        draggable: "false",
      });
      img.addEventListener("error", () => img.classList.add("is-broken"), { once: true });
      stage.append(img);
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
          src: p.author_profile_image_url || "", alt: "", width: 36, height: 36,
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
    video = h("video.viewer__video", {
      playsinline: true, webkitPlaysInline: true, preload: "auto",
      crossorigin: "anonymous", "aria-label": describe(item, p),
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

  /* ---------------------------------------------------------- gestures -- */

  let sx = 0, sy = 0, st = 0, tracking = false;
  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest("input,button")) return;
    tracking = true; sx = e.clientX; sy = e.clientY; st = Date.now();
  });
  stage.addEventListener("pointerup", (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - sx, dy = e.clientY - sy, dt = Date.now() - st;

    /* A quick swipe is navigation; a tap is chrome. Both on the same surface,
       distinguished by distance so a scroll never becomes a navigation. */
    if (dt < 500 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      step(dx < 0 ? 1 : -1);
      return;
    }
    if (dt < 400 && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      /* Tap: toggle chrome, and toggle playback on video. */
      if (chrome.dataset.visible === "true" && video && !video.paused) {
        chrome.dataset.visible = "false";
      } else {
        revealChrome();
        if (video) togglePlay();
      }
    }
  });
  stage.addEventListener("pointercancel", () => { tracking = false; });

  /* Double tap to seek ±10s — the gesture people bring from every other player. */
  let lastTap = 0;
  stage.addEventListener("pointerup", (e) => {
    if (!video) return;
    const now = Date.now();
    if (now - lastTap < 300) {
      const left = e.clientX < window.innerWidth / 2;
      video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + (left ? -10 : 10)));
      lastTap = 0;
    } else lastTap = now;
  });

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

  function close() {
    if (closed) return;
    closed = true;
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
    }, reducedMotion() ? 0 : 200);
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
  const originalRender = render;
  render = function () { originalRender(); prefetch(); };

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

void useBreakpoint;
