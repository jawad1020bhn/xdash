/* =============================================================================
   Capture

   The dashboard reads what the content script writes; it cannot start a run.
   So this surface answers three questions and nothing more:
   is capture healthy, what did the last run do, and what went wrong.

   In the top bar it's one word behind a dot. Here it's the full story.
   ============================================================================= */
(function (root) {
  "use strict";

  const { h, icon, num, ago, dateLong } = root.XBUI;
  const St = root.XBState;

  const STOP_REASONS = {
    "end-of-feed": "Reached the end of your bookmarks",
    "incremental-complete": "Incremental pass complete — everything new was already saved",
    "max-runtime": "Stopped at the safety time limit",
    "max-batches": "Stopped at the safety scroll limit",
    "no-responses-seen": "No timeline responses were intercepted",
    "schema-mismatch": "X changed its response shape",
    "too-many-errors": "Too many consecutive failures",
    "rate-limited": "X rate limited the session",
    "auth-error": "Authentication failed — sign in to X again",
  };

  const HEADLINES = {
    idle: "Capture is ready",
    capturing: "Capturing now",
    stopped_by_error: "Capture stopped early",
    complete: "Last capture finished cleanly",
    stopped: "Capture stopped",
  };

  /** `idle` with a run behind it isn't "ready", it's "done". */
  function headline(info, capture) {
    if (info.status === "idle" && capture && capture.updatedAt) return "Last capture finished";
    return HEADLINES[info.status] || "Capture";
  }

  /** Shared with the top-bar chip so both read the same status vocabulary. */
  function summarize(capture) {
    const status = (capture && capture.status) || "idle";
    const st = (capture && capture.stats) || {};
    const captured = Number(st.captured) || 0;
    let label = "Capture ready";
    if (status === "capturing") label = captured ? "Capturing · " + num(captured) + " items" : "Capturing";
    else if (status === "stopped_by_error") label = "Capture issue";
    else if (captured) label = num(captured) + " captured";
    return { status, stats: st, label, reason: capture && capture.lastStopReason
      ? STOP_REASONS[capture.lastStopReason] || capture.lastStopReason : "" };
  }

  function render(mount, app) {
    const capture = St.state.capture;
    const info = summarize(capture);
    const st = info.stats;
    const page = h(".cap");

    /* --- hero ------------------------------------------------------------ */
    const hero = h(".cap__hero", { "data-status": info.status });
    hero.appendChild(h(".cap__badge", h("i"), h("span", { text: info.label })));
    hero.appendChild(h("h2", { text: headline(info, capture) }));
    hero.appendChild(h("p", { text: heroBody(info, capture) }));

    if (Object.keys(st).length) {
      const facts = h(".cap__facts");
      fact(facts, st.captured, "Posts captured");
      fact(facts, st.newItems, "New this run");
      fact(facts, st.duplicates, "Already had");
      fact(facts, st.failed, "Failed");
      hero.appendChild(facts);
    }
    page.appendChild(hero);

    /* --- how to run one -------------------------------------------------- */
    page.appendChild(h(".panel",
      h("h3.t-title", { text: "Run a capture" }),
      h("p.dim.t-body-s", { text: "Capture happens on x.com, not here. Open your bookmarks, then click the extension icon and press Capture. This page updates live while it runs." }),
      h(".empty__actions",
        link("Open X bookmarks", "https://x.com/i/bookmarks", "ctl--accent"),
        refresh(app))
    ));

    /* --- diagnostics ----------------------------------------------------- */
    const detail = [];
    if (capture && capture.startedAt) detail.push(["Last run started", dateLong(capture.startedAt) + " · " + ago(capture.startedAt)]);
    if (capture && capture.updatedAt) detail.push(["Last update", ago(capture.updatedAt)]);
    if (info.reason) detail.push(["Stop reason", info.reason]);
    if (st.responses) detail.push(["Timeline responses seen", num(st.responses)]);
    if (st.emptyScrolls) detail.push(["Quiet scrolls before stopping", num(st.emptyScrolls)]);
    if (st.rateLimits) detail.push(["Rate limits hit", num(st.rateLimits)]);
    if (st.authErrors) detail.push(["Authentication errors", num(st.authErrors)]);

    if (detail.length) {
      const list = h(".cap__list");
      detail.forEach(([k, v]) => list.appendChild(h(".cap__item", h("b", { text: k }), h("span", { text: v }))));
      page.appendChild(h("section",
        h("h3.t-title", { style: { margin: "0 0 10px" }, text: "Run detail" }), list));
    }

    /* --- failures -------------------------------------------------------- */
    const dead = St.state.dead || [];
    if (dead.length) {
      const list = h(".cap__list");
      dead.slice(-25).reverse().forEach((entry) => {
        list.appendChild(h(".cap__item",
          h("b", { text: entry.tweet_id ? "Post " + entry.tweet_id : "Unidentified post" }),
          h("span", { text: (entry.error || "Unknown error") + (entry.at ? " · " + ago(entry.at) : "") })
        ));
      });

      const clear = h("button.ctl.ctl--bordered", { type: "button", text: "Discard failure log" });
      clear.addEventListener("click", () => app.confirm({
        title: "Discard the failure log?",
        body: num(dead.length) + " failed posts will be forgotten. The posts themselves were never saved, so nothing else changes.",
        confirm: "Discard",
        onConfirm: async () => {
          await root.XBStore.remove([root.XBStore.KEYS.dead]);
          St.state.dead = [];
          St.bump();
          St.notify("data");
          app.toast("Failure log discarded");
        },
      }));

      page.appendChild(h("section",
        h(".sechead",
          h("h3.t-title", { text: num(dead.length) + " posts failed to save" }),
          h("span.spacer"), clear),
        h("p.dim.t-body-s", { style: { margin: "0 0 10px" }, text: "Usually a post whose media X no longer serves, or a shape the normalizer didn't recognise. Showing the 25 most recent." }),
        list
      ));
    }

    mount.appendChild(page);
  }

  function heroBody(info, capture) {
    if (info.status === "capturing") return "The content script is scrolling your bookmarks and saving posts as it goes. You can leave this page open — it updates itself.";
    if (info.status === "stopped_by_error") return info.reason || "Something interrupted the run before it reached the end of your bookmarks. Try again from the extension popup.";
    if (!capture || !capture.updatedAt) return "No capture has run in this browser yet. Open your bookmarks on X and start one from the extension popup.";
    const reason = info.reason ? info.reason.replace(/\.?$/, ".") : "The run completed.";
    return reason + " Everything it found is in your library.";
  }

  function fact(parent, value, label) {
    const n = Number(value) || 0;
    if (!n) return;
    parent.appendChild(h(".cap__fact", h("b", { text: num(n) }), h("span", { text: label })));
  }

  function link(text, href, cls) {
    return h("a.ctl" + (cls ? "." + cls : ""), { href, target: "_blank", rel: "noopener", text });
  }

  function refresh(app) {
    const b = h("button.ctl.ctl--bordered", { type: "button", text: "Refresh from storage" });
    b.addEventListener("click", async () => {
      await St.reloadFromStorage();
      app.toast("Reloaded");
    });
    return b;
  }

  root.XBCapture = { render, summarize, STOP_REASONS };
})(window);
