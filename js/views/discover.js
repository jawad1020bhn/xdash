/* =============================================================================
   Discover — a recommendation engine with memory

   The shape of the page is a magazine, not a dashboard:

     1. a greeting and ONE typographic line of state
     2. ONE major story — the thing you were in the middle of
     3. a handful of sections that each answer a different question

   The content is produced by the discovery engine (XBLibrary.discover), which
   ranks with a shared score and remembers what it surfaced. Every dashboard
   load is a new "cycle" — the dynamic sections (Fresh discoveries, Rediscover,
   Underrated, etc.) change, while the stable ones (Continue, New) barely move.
   Opening the viewer or toggling UI elsewhere never reshuffles the page: a
   cycle only advances on a fresh load or an explicit Refresh.

   Adaptive: a 40-item library shows ~4 sections, a 400-item library shows
   ~9, a 1000+ library shows 10-11. The engine decides which rails actually
   appear based on candidate quality and library size.
   ============================================================================= */
(function (root) {
  "use strict";

  const { h, icon, esc, compact, num, still, remaining, ago } = root.XBUI;
  const St = root.XBState;

  const SUBTITLE = {
    continue: "Pick up where you left off",
    "fresh-discoveries": "Things you probably forgot existed",
    "top-picks": "Probably worth your attention",
    "new-in-archive": "Added in the last week",
    underrated: "Low buzz, high quality — easy to miss",
    rediscover: "Things you haven't looked at in a while",
    "one-from-each": "A strong pick from many different creators",
    "unseen-lately": "Creators you haven't seen in a while",
    "worth-a-minute": "Medium-length, unusually good",
    "photo-stories": "Multi-image posts, kept together",
    "different-format": "A change of pace",
    "quick-watch": "A minute or less",
    "favorite-creators": "People who keep showing up",
    "different-from-usual": "Outside your usual creators and formats",
    all: "",
  };

  /* Editorial order — priority for adaptive selection. The engine pre-filters
     to tierMax (4/6/9/10/11) based on library size, but this order is the
     display order. Each entry declares its shape and its "see all" destination. */
  const SECTIONS = [
    { key: "continue", layout: "rail", wide: true, seeAll: "continue" },
    { key: "freshDiscoveries", layout: "rail", refresh: true, seeAll: "forgotten" },
    { key: "topPicks", layout: "editorial", seeAll: "top-picks" },
    { key: "newInArchive", layout: "rail", seeAll: "recent" },
    { key: "underrated", layout: "rail", seeAll: "hidden-gems" },
    { key: "rediscover", layout: "masonry", seeAll: "forgotten" },
    { key: "oneFromEachWorld", layout: "rail", seeAll: "favorite-creators" },
    { key: "unseenLately", layout: "rail", seeAll: "favorite-creators" },
    { key: "worthAMinute", layout: "rail", wide: true, seeAll: "deep-dives" },
    { key: "photoStories", layout: "masonry", seeAll: "photo-stories" },
    { key: "differentFormat", layout: "rail", seeAll: "shuffle" },
    { key: "quickWatch", layout: "rail", wide: true, seeAll: "quick-watch" },
    { key: "favoriteCreators", layout: "rail", seeAll: "favorite-creators" },
    { key: "differentFromUsual", layout: "rail", seeAll: "shuffle" },
  ];

  /* Collections that exist route to a focused Library view; discovery-only
     sections route to the closest deterministic browse. */
  function seeAll(app, dest) {
    if (dest === "forgotten") app.go("library", { sort: "forgotten" });
    else if (dest === "shuffle") app.go("library", { sort: "shuffle" });
    else if (dest === "recent" || dest === "top-picks" || dest === "quick-watch" ||
             dest === "deep-dives" || dest === "photo-stories" || dest === "favorite-creators" ||
             dest === "hidden-gems" || dest === "continue" || dest === "popular") {
      app.openCollection(dest);
    } else {
      app.openCollection(dest);
    }
  }

  function render(mount, app) {
    const d = St.derived;
    const stats = d.stats;

    if (!stats.media) { mount.appendChild(emptyArchive(app)); return; }

    const disc = d.discovery;
    const page = h(".discover");
    page.appendChild(greeting(stats, d, app));

    const totalUsable = d.all.filter((i) => !i.archived).length;
    const tierMax = totalUsable < 40 ? 4 : totalUsable < 120 ? 6 : totalUsable < 400 ? 9 : totalUsable < 1000 ? 10 : 11;
    const minFresh = totalUsable < 40 ? 2 : totalUsable < 120 ? 3 : 4;

    /* --- the one story ------------------------------------------------------ */
    const heroCol = disc.continue || disc.freshDiscoveries || disc.topPicks || disc.underrated;
    const usedIds = new Set();
    if (heroCol && heroCol.items.length) {
      const item = heroCol.items[0];
      usedIds.add(item.id);
      page.appendChild(hero(item, heroCol, app));
    }

    /* --- sections -------------------------------------------------------------
       Items don't repeat across sections: each drops anything already on the
       page, and is skipped if it can't field enough fresh cards (adaptive
       threshold so a thin archive doesn't show empty-ish rails). */
    const seen = new Set(usedIds);
    let budget = tierMax;

    /* Mobile rhythm: rails alternate with 2-column editorial blocks so a phone
       never becomes an endless horizontal strip. Desktop composition is
       untouched — this only re-maps layouts on compact windows. */
    const mobileRhythm = root.XBMobile && root.XBMobile.isCompact();
    let railCount = 0;

    for (const spec of SECTIONS) {
      if (budget <= 0) break;
      const col = disc[spec.key];
      if (!col || !col.items || !col.items.length) continue;

      const fresh = col.items.filter((i) => !seen.has(i.id));
      if (fresh.length < minFresh) continue;
      fresh.forEach((i) => seen.add(i.id));

      let layout = spec.layout;
      let limit = layout === "editorial" ? 8 : layout === "masonry" ? 14 : 18;
      if (mobileRhythm && layout === "rail") {
        railCount++;
        if (railCount % 2 === 0) { layout = "masonry"; limit = Math.min(limit, 8); }
      }
      if (mobileRhythm && layout === "editorial") { layout = "masonry"; limit = 8; }

      const items = fresh.slice(0, limit);
      page.appendChild(section(col, items, app, {
        layout,
        wide: spec.wide,
        refresh: spec.refresh,
        onSeeAll: () => seeAll(app, spec.seeAll),
      }));
      budget--;
    }

    /* Nothing surfaced (very small library) — fall back to a plain grid. */
    if (!page.querySelector(".section")) {
      const recent = d.all.slice().sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0)).slice(0, 18);
      if (recent.length) page.appendChild(section({ id: "all", title: "Everything you've saved", reasons: recent.map(() => "") }, recent, app, { layout: "rail" }));
    }

    mount.appendChild(page);
  }

  /* ------------------------------------------------------------- greeting -- */
  function greeting(stats, d, app) {
    const hour = new Date().getHours();
    const salutation = hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

    const unseen = d.all.filter((i) => i.unseen && !i.archived).length;
    const resumable = (d.collection("continue") || { items: [] }).items.length;

    const line = h("p.greet__stats");
    line.appendChild(h("b", { text: num(stats.media) }));
    line.appendChild(document.createTextNode(" items from " + num(stats.posts) + " posts"));
    if (unseen) {
      line.appendChild(document.createTextNode(" · "));
      line.appendChild(link(num(unseen) + " unseen", () => app.go("library", { filters: { seen: "unseen" } })));
    }
    if (resumable) {
      line.appendChild(document.createTextNode(" · "));
      line.appendChild(link(num(resumable) + " to finish", () => app.openCollection("continue")));
    }
    if (stats.videos) {
      line.appendChild(document.createTextNode(" · "));
      line.appendChild(link(num(stats.videos) + " videos", () => app.go("watch")));
    }

    const head = h(".discover__head",
      h(".greet",
        h("h1", { text: salutation + "." }),
        line,
        weekRecap(app)
      ),
      h("button.discover__refresh", {
        type: "button",
        "aria-label": "Refresh discoveries",
        title: "Refresh discoveries",
        html: icon("refresh", 18) + "<span>Refresh</span>",
      })
    );
    return head;
  }

  /* A quiet typographic recap of the last seven days, derived entirely from
     data the library already keeps (lastOpened / archived / progress stamps).
     Hidden when the week was quiet — an empty recap is noise, not insight. */
  function weekRecap(app) {
    const lib = St.state.library || {};
    const since = Date.now() - 7 * 864e5;

    let watched = 0;
    Object.values(lib.lastOpened || {}).forEach((ts) => { if (ts >= since) watched++; });

    let archivedCount = 0;
    Object.values(lib.archived || {}).forEach((ts) => { if (ts >= since) archivedCount++; });

    /* Progress entries carry {t, d} only — no timestamp is stored with them
       (see XBState.progress), so they cannot be dated to this week. Instead,
       count videos still mid-flight as evidence of watching; a finished video
       has its position cleared. */
    let seconds = 0;
    Object.entries(lib.progress || {}).forEach(([id, p]) => {
      if (p && Number(p.t) > 0 && lib.lastOpened && lib.lastOpened[id] >= since) {
        seconds += Number(p.t);
      }
    });
    const minutes = Math.round(seconds / 60);

    if (!watched && !archivedCount && !minutes) return null;

    const parts = [];
    if (watched) parts.push("opened " + num(watched) + (watched === 1 ? " item" : " items"));
    if (minutes >= 1) parts.push(num(minutes) + " min of video");
    if (archivedCount) parts.push("archived " + num(archivedCount));

    const line = h("p.greet__recap", "This week you " + parts.join(" · ") + ".");
    return line;
  }

  function link(text, fn) {
    const a = h("a", { href: "#", text });
    a.addEventListener("click", (e) => { e.preventDefault(); fn(); });
    return a;
  }

  function bindRefresh() {
    const btn = document.querySelector(".discover__refresh");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      btn.disabled = true;
      btn.classList.add("is-spinning");
      St.newDiscoveryCycle();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        btn.disabled = false;
        btn.classList.remove("is-spinning");
      }));
    });
  }

  /* ----------------------------------------------------------------- hero -- */
  function hero(item, col, app) {
    const resuming = col.id === "continue" && item.progress && item.progress.d;
    const pct = resuming ? Math.min(100, (item.progress.t / item.progress.d) * 100) : 0;

    const media = h(".hero__media");
    const img = h("img", { src: still(item, "medium"), alt: "", loading: "eager", decoding: "async" });
    media.appendChild(img);

    const play = h("button.hero__play", {
      type: "button",
      "aria-label": (resuming ? "Resume " : "Open ") + root.XBCard.describe(item),
      html: "<span>" + icon("play", 26) + "</span>",
    });
    play.addEventListener("click", () => app.openItem(item, col.items));
    media.appendChild(play);
    if (pct) media.appendChild(h(".hero__bar", h("i", { style: { width: pct + "%" } })));
    media.style.viewTransitionName = root.XBUI.transitionName(item.id);

    const body = h(".hero__body");
    body.appendChild(h(".hero__eyebrow", {
      html: icon(resuming ? "play" : "star", 14) +
        "<span>" + esc(resuming ? "Resume watching" : col.title || "Featured") + "</span>",
    }));
    body.appendChild(h("h2.hero__title", { text: headline(item) }));

    const by = h(".hero__by");
    const avatar = root.XBUI.avatarFor(item);
    if (avatar) by.appendChild(h("img", { src: avatar, alt: "", loading: "lazy" }));
    by.appendChild(h("span", { text: item.authorName ? item.authorName + " · @" + item.author : "@" + item.author }));
    body.appendChild(by);

    const leftText = resuming
      ? remaining(item.progress) + " · " + Math.round(pct) + "% watched"
      : [root.XBUI.typeLabel(item.type), item.duration ? root.XBUI.duration(item.duration) : "",
         item.postedAt ? "posted " + ago(item.postedAt) + " ago" : ""].filter(Boolean).join(" · ");
    body.appendChild(h("p.hero__left", { text: leftText }));

    const actions = h(".hero__actions");
    const primary = h("button.ctl.ctl--accent", {
      type: "button", html: icon("play", 16) + "<span>" + (resuming ? "Resume" : "Open") + "</span>",
    });
    primary.addEventListener("click", () => app.openItem(item, col.items));
    actions.appendChild(primary);

    if (col.items.length > 1) {
      const more = h("button.ctl.ctl--bordered", { type: "button", text: "See all " + col.items.length });
      more.addEventListener("click", () => app.openCollection(col.id));
      actions.appendChild(more);
    }
    body.appendChild(actions);

    return h(".hero", media, body);
  }

  function headline(item) {
    const text = String(item.text || "").replace(/https?:\/\/\S+/g, "").trim();
    if (text) return text.length > 150 ? text.slice(0, 147).trimEnd() + "…" : text;
    return (item.authorName || "@" + item.author) + " · " + root.XBUI.typeLabel(item.type);
  }

  /* -------------------------------------------------------------- section -- */
  function section(col, items, app, opts) {
    const o = opts || {};
    const layout = o.layout || "rail";
    if (layout === "editorial") return editorialSection(col, items, app, o);
    if (layout === "masonry") return masonrySection(col, items, app, o);
    return railSection(col, items, app, o);
  }

  function sectionHead(col, items, app, opts) {
    const o = opts || {};
    const el = h(".section__head");

    el.appendChild(h(".section__titles",
      h("h2", { text: col.title }),
      SUBTITLE[col.id] || col.subtitle ? h("p", { text: SUBTITLE[col.id] || col.subtitle }) : null
    ));

    const right = h(".section__head-right");

    if (o.refresh) {
      const refresh = h("button.section__refresh", {
        type: "button",
        "aria-label": "Refresh these discoveries",
        title: "Refresh",
        html: icon("refresh", 16) + "<span>Refresh</span>",
      });
      refresh.addEventListener("click", () => {
        refresh.disabled = true;
        refresh.classList.add("is-spinning");
        St.newDiscoveryCycle();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          refresh.disabled = false;
          refresh.classList.remove("is-spinning");
        }));
      });
      right.appendChild(refresh);
    }

    if (o.seeAll && col.total > items.length) {
      const more = h("button.section__more", { type: "button", text: "See all " + num(col.total) });
      more.addEventListener("click", o.seeAll);
      right.appendChild(more);
    }

    if (o.nav) {
      const prev = h("button.iconctl", { type: "button", "aria-label": "Scroll left", html: icon("chevronLeft", 18) });
      const next = h("button.iconctl", { type: "button", "aria-label": "Scroll right", html: icon("chevronRight", 18) });
      el.__nav = { prev, next };
      right.appendChild(h(".section__nav", prev, next));
    }

    if (right.childElementCount) el.appendChild(right);
    return el;
  }

  function railSection(col, items, app, opts) {
    const o = opts || {};
    const el = h(".section" + (o.wide ? ".section--wide" : ""));

    const head = sectionHead(col, items, app, Object.assign({ nav: true }, o));
    el.appendChild(head);

    const scroller = h(".rail-scroll", { role: "list", "aria-label": col.title });
    items.forEach((item, i) => {
      const wrap = h("div", { role: "listitem" });
      wrap.appendChild(root.XBCard.card(item, {
        fixed: true,
        size: "small",
        why: shortReason(col.reasons && col.reasons[col.items.indexOf(item)]),
        onOpen: () => app.openItem(item, items),
      }));
      scroller.appendChild(wrap);
    });
    el.appendChild(scroller);

    if (head.__nav) {
      const { prev, next } = head.__nav;
      const page = () => Math.max(240, scroller.clientWidth * 0.82);
      prev.addEventListener("click", () => scroller.scrollBy({ left: -page(), behavior: "smooth" }));
      next.addEventListener("click", () => scroller.scrollBy({ left: page(), behavior: "smooth" }));
      const navEl = head.querySelector(".section__nav");
      const sync = () => {
        const max = scroller.scrollWidth - scroller.clientWidth - 2;
        prev.disabled = scroller.scrollLeft <= 2;
        next.disabled = scroller.scrollLeft >= max;
        if (navEl) navEl.hidden = max <= 0;
      };
      scroller.addEventListener("scroll", sync, { passive: true });
      requestAnimationFrame(sync);
    }

    return el;
  }

  function editorialSection(col, items, app, opts) {
    const el = h(".section.section--editorial");
    el.appendChild(sectionHead(col, items, app, opts || {}));

    const grid = h(".editorial", { role: "list", "aria-label": col.title });
    items.forEach((item, i) => {
      const cls = i === 0 ? "editorial__lead" : "editorial__cell";
      const wrap = h("div." + cls, { role: "listitem" });
      wrap.appendChild(root.XBCard.card(item, {
        fixed: true,
        size: "medium",
        why: shortReason(col.reasons && col.reasons[col.items.indexOf(item)]),
        onOpen: () => app.openItem(item, items),
      }));
      grid.appendChild(wrap);
    });
    el.appendChild(grid);
    return el;
  }

  function masonrySection(col, items, app, opts) {
    const el = h(".section.section--masonry");
    el.appendChild(sectionHead(col, items, app, opts || {}));

    const grid = h(".masonry", { role: "list", "aria-label": col.title });
    items.forEach((item, i) => {
      const wrap = h("div.masonry__item", { role: "listitem" });
      wrap.appendChild(root.XBCard.card(item, {
        fixed: false,
        size: "small",
        why: shortReason(col.reasons && col.reasons[col.items.indexOf(item)]),
        onOpen: () => app.openItem(item, items),
      }));
      grid.appendChild(wrap);
    });
    el.appendChild(grid);
    return el;
  }

  function shortReason(reason) {
    const r = String(reason || "");
    if (!r) return "";
    if (r.length > 18) return "";
    return r;
  }

  function emptyArchive(app) {
    const actions = h(".empty__actions");
    const importBtn = h("button.ctl.ctl--accent", {
      type: "button", html: icon("upload", 16) + "<span>Import bookmarks</span>",
    });
    importBtn.addEventListener("click", () => app.importPrompt());
    actions.appendChild(importBtn);

    const hasDemo = typeof window !== "undefined" && window.XB_DEMO && Array.isArray(window.XB_DEMO.bookmarks) && window.XB_DEMO.bookmarks.length;
    if (hasDemo) {
      const sample = h("button.ctl.ctl--bordered", { type: "button", text: "Browse pasted library" });
      sample.addEventListener("click", () => app.loadSample());
      actions.appendChild(sample);
    }

    return h(".empty",
      h(".empty__glyph", { html: icon("mark", 24) }),
      h("h2", { text: "Your archive starts here" }),
      h("p", { text: "Nothing has been captured yet. Paste JSON into js/demo.js or POSTS.json, or import a previous export — everything you save becomes searchable, sortable and watchable here." }),
      actions
    );
  }

  const origRender = render;
  function renderAndBind(mount, app) {
    origRender(mount, app);
    requestAnimationFrame(bindRefresh);
  }

  root.XBDiscover = { render: renderAndBind };
})(window);
