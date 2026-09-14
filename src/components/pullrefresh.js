/* =============================================================================
   pullrefresh — the iOS pull-to-refresh gesture.

   A downward drag at the very top of a view pulls the content along with
   resistance, reveals an activity indicator, and past a threshold refreshes
   the archive (re-fingerprint the data file; an unchanged file costs one HEAD
   and zero parsing). Release early and it springs home.

   Deliberately conservative: single touch only, only at scroll position zero,
   never while a sheet or the viewer owns the screen, and a horizontal or
   upward move aborts the gesture so rails and scrolling never fight it.
   ============================================================================= */

import { h } from "../ui/dom.js";

const THRESHOLD = 64;
const MAX_PULL = 120;

export function attachPullToRefresh(view, { onRefresh }) {
  const spinner = h("span.ptr__spin", { "aria-hidden": "true" });
  const control = h("div.ptr", { "aria-hidden": "true", dataset: { state: "idle" } }, spinner);
  const status = h("span.sr-only", { role: "status" });
  view.prepend(status, control);

  let tracking = false;
  let dead = false;
  let refreshing = false;
  let sx = 0, sy = 0, offset = 0;
  let snapTimer = 0;

  function onStart(e) {
    if (refreshing || e.touches.length !== 1) return;
    if (window.scrollY > 0) return;
    if (document.body.dataset.overlay || document.body.dataset.viewer === "open") return;
    tracking = true;
    dead = false;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }

  function onMove(e) {
    if (!tracking || dead || refreshing) return;
    const dx = e.touches[0].clientX - sx;
    const dy = e.touches[0].clientY - sy;

    if (dy < 0 || window.scrollY > 0) { abort(); return; }
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) { abort(); return; }
    if (dy < 8) return;

    e.preventDefault();
    offset = Math.min(dy * 0.45, MAX_PULL);
    view.style.transition = "none";
    view.style.translate = `0 ${offset}px`;
    control.dataset.state = offset >= THRESHOLD ? "armed" : "pulling";
    spinner.style.rotate = `${Math.round(offset * 2.2)}deg`;
  }

  async function onEnd() {
    if (!tracking) return;
    tracking = false;
    if (dead || refreshing) return;

    if (offset >= THRESHOLD) {
      refreshing = true;
      control.dataset.state = "refreshing";
      spinner.style.rotate = "";
      status.textContent = "Refreshing your archive";
      view.style.transition = "translate 260ms var(--spring)";
      view.style.translate = `0 ${THRESHOLD}px`;
      try {
        await onRefresh();
      } catch (err) {
        console.error("[ptr]", err);
      } finally {
        refreshing = false;
        springHome();
        status.textContent = "";
      }
    } else {
      springHome();
    }
  }

  function abort() {
    dead = true;
    tracking = false;
    springHome();
  }

  function springHome() {
    if (refreshing) return;
    offset = 0;
    view.style.transition = "translate 320ms var(--spring)";
    view.style.translate = "0px 0px";
    control.dataset.state = "idle";
    spinner.style.rotate = "";
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      if (!refreshing) { view.style.transition = ""; view.style.translate = ""; }
    }, 340);
  }

  const onCancel = () => { tracking = false; dead = true; springHome(); };

  view.addEventListener("touchstart", onStart, { passive: true });
  view.addEventListener("touchmove", onMove, { passive: false });
  view.addEventListener("touchend", onEnd, { passive: true });
  view.addEventListener("touchcancel", onCancel, { passive: true });

  return () => {
    clearTimeout(snapTimer);
    view.removeEventListener("touchstart", onStart);
    view.removeEventListener("touchmove", onMove);
    view.removeEventListener("touchend", onEnd);
    view.removeEventListener("touchcancel", onCancel);
    control.remove();
    status.remove();
  };
}
