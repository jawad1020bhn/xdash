/* =============================================================================
   Media library model

   One captured post with N attachments becomes N independent media entries.
   Filters, sorts, and smart collections operate on those entries — never on
   post-level bags of mixed media.
   ============================================================================= */
(function (root) {
  "use strict";

  const DAY = 86400000;
  const RECENT_MS = 7 * DAY;
  const FORGOTTEN_MS = 30 * DAY;
  const LONG_VIDEO_MS = 30000;
  const PORTRAIT_MAX = 0.85;
  const WIDE_MIN = 1.4;

  function parseDate(value) {
    if (!value) return 0;
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }

  function mediaId(tweetId, position) {
    return String(tweetId) + ":" + String(position);
  }

  function isMotion(type) {
    return type === "video" || type === "animated_gif";
  }

  function playable(media) {
    if (!media) return false;
    if (media.type === "photo") return !!(media.url || media.poster);
    return !!(media.mp4 || (media.mp4_variants && media.mp4_variants.length) || media.hls);
  }

  function engagement(post) {
    const likes = Number(post.like_count_at_capture) || 0;
    const rts = Number(post.retweet_count_at_capture) || 0;
    const replies = Number(post.reply_count_at_capture) || 0;
    const views = Number(post.view_count_at_capture) || 0;
    const reactions = likes + rts + replies;
    const rate = views > 0 ? reactions / views : reactions > 0 ? 1 : 0;
    return { likes, rts, replies, views, reactions, rate };
  }

  function flatten(bookmarks, library) {
    const lib = library || { viewed: {}, archived: {}, progress: {}, lastOpened: {} };
    const items = [];
    (bookmarks || []).forEach((post, postIndex) => {
      if (!post) return;
      const mediaList = Array.isArray(post.media_items) ? post.media_items : [];
      if (!mediaList.length) return;
      const eng = engagement(post);
      mediaList.forEach((media, i) => {
        if (!media) return;
        const position = Number(media.position) || i + 1;
        const id = mediaId(post.tweet_id, position);
        const type = media.type || "photo";
        const aspect = Number(media.aspect) || (media.width && media.height ? media.width / media.height : 0);
        const viewedAt = lib.viewed[id] || 0;
        const lastOpened = lib.lastOpened[id] || viewedAt || 0;
        const archived = !!lib.archived[id];
        const progress = lib.progress[id] || null;
        items.push({
          id,
          post,
          media,
          position,
          type,
          aspect,
          duration: Number(media.duration) || 0,
          alt: media.alt || "",
          playable: playable(media),
          postedAt: parseDate(post.tweet_created_at),
          capturedAt: parseDate(post.captured_at || post.first_seen_at),
          captureOrder: Number(post.capture_order) || postIndex + 1,
          viewedAt,
          lastOpened,
          archived,
          progress,
          unseen: !viewedAt,
          author: post.author_username || "",
          authorName: post.author_name || "",
          text: post.text || "",
          state: post.state || "available",
          eng,
        });
      });
    });
    return items;
  }

  function matchesSearch(item, q) {
    if (!q) return true;
    const hay = (item.text + " " + item.author + " " + item.authorName + " " + item.alt).toLowerCase();
    return hay.includes(q);
  }

  /* A filter value may be a single string or an array. Within one key the
     values are OR'd (Photo OR Video); across keys they are AND'd. This keeps
     the common multi-select case natural without exposing boolean controls. */
  function valueList(v) {
    if (Array.isArray(v)) return v;
    return v == null || v === "" || v === false ? [] : [v];
  }

  function shapeOf(item) {
    if (item.aspect > 0 && item.aspect < 0.85) return "portrait";
    if (item.aspect < 1.2) return "square";
    return "wide";
  }

  function applyFilters(items, filters, search) {
    const f = filters || {};
    const q = (search || "").trim().toLowerCase();
    const kinds = valueList(f.kind);
    const shapes = valueList(f.shape);
    return items.filter((item) => {
      if (!matchesSearch(item, q)) return false;
      if (kinds.length) {
        const t = item.type === "animated_gif" ? "gif" : item.type;
        if (!kinds.includes(t)) return false;
      }
      if (shapes.length && !shapes.includes(shapeOf(item))) return false;
      if (f.author && item.author.toLowerCase() !== String(f.author).toLowerCase().replace(/^@/, "")) return false;
      if (f.postedFrom && item.postedAt && item.postedAt < parseDate(f.postedFrom)) return false;
      if (f.postedTo && item.postedAt && item.postedAt > parseDate(f.postedTo) + DAY) return false;
      if (f.capturedFrom && item.capturedAt && item.capturedAt < parseDate(f.capturedFrom)) return false;
      if (f.capturedTo && item.capturedAt && item.capturedAt > parseDate(f.capturedTo) + DAY) return false;
      if (f.durationMin && item.duration < Number(f.durationMin) * 1000) return false;
      if (f.durationMax && item.duration > Number(f.durationMax) * 1000) return false;
      if (f.seen === "unseen" && !item.unseen) return false;
      if (f.seen === "viewed" && item.unseen) return false;
      if (f.archive === "archived" && !item.archived) return false;
      if (f.archive !== "archived" && item.archived) return false;
      if (f.alt === "yes" && !item.alt) return false;
      if (f.alt === "no" && item.alt) return false;
      if (f.playable === "yes" && !item.playable) return false;
      if (f.playable === "no" && item.playable) return false;
      if (f.progress === "yes" && !item.progress) return false;
      if (f.progress === "no" && item.progress) return false;
      return true;
    });
  }

  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashId(id) {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function sortItems(items, sort, seed, shuffleStrategy) {
    const list = items.slice();
    const cmpNum = (a, b) => (a === b ? 0 : a < b ? 1 : -1);
    switch (sort) {
      case "oldest_posted":
        list.sort((a, b) => a.postedAt - b.postedAt || a.captureOrder - b.captureOrder);
        break;
      case "capture_order":
        list.sort((a, b) => a.captureOrder - b.captureOrder || a.position - b.position);
        break;
      case "recently_viewed":
        list.sort((a, b) => (b.lastOpened || b.viewedAt || 0) - (a.lastOpened || a.viewedAt || 0) || b.postedAt - a.postedAt);
        break;
      case "most_liked":
        list.sort((a, b) => cmpNum(a.eng.likes, b.eng.likes) || b.postedAt - a.postedAt);
        break;
      case "most_reposted":
        list.sort((a, b) => cmpNum(a.eng.rts, b.eng.rts) || b.postedAt - a.postedAt);
        break;
      case "most_replied":
        list.sort((a, b) => cmpNum(a.eng.replies, b.eng.replies) || b.postedAt - a.postedAt);
        break;
      case "most_viewed":
        list.sort((a, b) => cmpNum(a.eng.views, b.eng.views) || b.postedAt - a.postedAt);
        break;
      case "engagement":
        list.sort((a, b) => cmpNum(a.eng.rate, b.eng.rate) || cmpNum(a.eng.reactions, b.eng.reactions));
        break;
      case "longest":
        list.sort((a, b) => b.duration - a.duration || b.postedAt - a.postedAt);
        break;
      case "shortest":
        list.sort((a, b) => a.duration - b.duration || b.postedAt - a.postedAt);
        break;
      case "shuffle":
        return shuffleByStrategy(list, seed, shuffleStrategy);
      case "forgotten":
        /* Deterministic: longest untouched first. No jitter — randomness
           belongs to Shuffle, which is its own intentional control. */
        list.sort((a, b) => (a.lastOpened || a.capturedAt) - (b.lastOpened || b.capturedAt));
        break;
      case "newest_posted":
      default:
        list.sort((a, b) => b.postedAt - a.postedAt || b.captureOrder - a.captureOrder);
        break;
    }
    return list;
  }

  /* Shuffle strategies. Each is deterministic given the seed (so a re-render
     stays stable) but yields a fresh order every time the seed rolls. */
  function shuffleByStrategy(list, seed, strategy) {
    const s = Number(seed) || 1;
    const rng = mulberry32(s ^ 0x9e3779b9);
    const jitter = () => rng() - 0.5;

    if (strategy === "unseen") {
      const unseen = list.filter((i) => i.unseen);
      const seen = list.filter((i) => !i.unseen);
      return hashShuffle(unseen, s).concat(hashShuffle(seen, s + 7));
    }
    if (strategy === "rediscover") {
      const now = Date.now();
      const scored = list.map((i) => ({
        i, w: Math.log1p((now - (i.capturedAt || now)) / DAY) + jitter(),
      }));
      scored.sort((a, b) => b.w - a.w);
      return scored.map((e) => e.i);
    }
    /* Random — balanced: a stable random order with light diversity protection.
       Hash-shuffle by the seed, then spread so the same creator, the same post,
       and the same media type don't cluster. No second shuffle — that would
       undo the spreading. */
    if (strategy === "balanced") {
      return diversify(hashShuffle(list, s), false);
    }
    if (strategy === "smart") {
      const now = Date.now();
      const scored = list.map((i) => {
        const eng = i.eng || {};
        return {
          i,
          w: jitter() * 2.6
            + (i.unseen ? 0.5 : 0)
            + Math.log1p((eng.likes || 0) + (eng.rts || 0) * 2.5) * 0.08
            + Math.log1p(Math.max(1, (now - (i.capturedAt || now)) / DAY)) * 0.05,
        };
      });
      scored.sort((a, b) => b.w - a.w);
      return scored.map((e) => e.i);
    }
    return hashShuffle(list, s);
  }

  /* Stable hash shuffle keyed on the seed. The seed is folded into the hashed
     material (not XOR'd onto the result) so rolling the seed reorders the whole
     list rather than nudging only the low bits of each hash. */
  function hashShuffle(list, seed) {
    const s = Number(seed) || 1;
    return list.slice().sort((a, b) => hashId(a.id + "@" + s) - hashId(b.id + "@" + s));
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function ageScore(date, now, halfLifeDays) {
    if (!date) return 0;
    const age = Math.max(0, now - date) / DAY;
    return Math.pow(0.5, age / halfLifeDays);
  }

  /* Engagement values on X follow a power law: a viral post can have a
     million likes while most saves have a few dozen. Log scaling stops one
     outlier from owning every rail. Rate is confidence-weighted so 1 like on
     1 view does not outrank a post with meaningful reach. */
  function engagementSignals(items) {
    let maxImpact = 0;
    let maxRate = 0;
    const raw = new Map();
    items.forEach((item) => {
      const impact = Math.log1p(item.eng.likes + item.eng.rts * 2.5 + item.eng.replies * 1.5);
      const confidence = item.eng.views / (item.eng.views + 1000);
      const rate = Math.log1p(item.eng.rate * 100) * confidence;
      maxImpact = Math.max(maxImpact, impact);
      maxRate = Math.max(maxRate, rate);
      raw.set(item.id, { impact, rate });
    });
    const scores = new Map();
    items.forEach((item) => {
      const value = raw.get(item.id);
      const impact = maxImpact ? value.impact / maxImpact : 0;
      const rate = maxRate ? value.rate / maxRate : 0;
      scores.set(item.id, impact * 0.76 + rate * 0.24);
    });
    return scores;
  }

  /* Spread a ranked list so a rail doesn't turn into four attachments from
     one post, a run from one creator, or a block of the same media type. We
     reorder within a small look-ahead window, preserving the ranking while
     adding useful variety — the same routine that powers "Random — balanced". */
  function diversify(list, groupPostMedia) {
    if (groupPostMedia) return list;
    const pending = list.slice();
    const result = [];
    while (pending.length) {
      const recent = result.slice(-3);
      const last = result.length ? result[result.length - 1] : null;
      let pick = -1;
      let fallback = 0;
      const lookAhead = Math.min(12, pending.length);
      for (let i = 0; i < lookAhead; i++) {
        const candidate = pending[i];
        const samePost = recent.some((x) => x.post.tweet_id === candidate.post.tweet_id);
        const sameAuthor = recent.some((x) => x.author && x.author === candidate.author);
        const sameType = last && candidate.type === last.type;
        if (!samePost && !sameAuthor && !sameType) { pick = i; break; }   // ideal: nothing repeated
        if (pick < 0 && !samePost && !sameAuthor) pick = i;               // relax type, keep post/author
        if (fallback === 0 && !samePost) fallback = i;                    // last resort: only avoid post
      }
      if (pick < 0) pick = fallback;
      result.push(pending.splice(pick, 1)[0]);
    }
    return result;
  }

  function ranked(items, score, options) {
    const opts = options || {};
    /* A rail renders 40 cards. Keeping a larger 120-item tail makes viewer
       navigation useful without doing quadratic diversity work on a library
       that may contain tens of thousands of media items. */
    if (opts.groupPostMedia) {
      const groups = new Map();
      items.forEach((item) => {
        const id = item.post.tweet_id;
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(item);
      });
      return Array.from(groups.values())
        .map((group) => ({
          group: group.sort((a, b) => a.position - b.position),
          score: Math.max(...group.map(score)),
          capturedAt: Math.max(...group.map((item) => item.capturedAt)),
        }))
        .sort((a, b) => b.score - a.score || b.capturedAt - a.capturedAt ||
          hashId(a.group[0].post.tweet_id) - hashId(b.group[0].post.tweet_id))
        .flatMap((entry) => entry.group)
        .slice(0, 120);
    }
    const list = items.slice().sort((a, b) =>
      score(b) - score(a) || b.capturedAt - a.capturedAt || hashId(a.id) - hashId(b.id)
    ).slice(0, 120);
    return diversify(list, false);
  }

  function durationLabel(item) {
    return (root.M3EMedia && root.M3EMedia.formatDuration(item.duration)) ||
      (item.duration ? Math.round(item.duration / 1000) + "s" : "Video");
  }

  function collections(items, now) {
    const n = now || Date.now();
    if (!items.length) return [];

    const engagementScore = engagementSignals(items);
    const quality = (item) => engagementScore.get(item.id) || 0;
    const fresh = (item) => ageScore(item.capturedAt, n, 14);
    const postFresh = (item) => ageScore(item.postedAt, n, 45);
    const complete = (item) => {
      if (!item.progress || !item.duration) return false;
      return item.progress.t * 1000 >= item.duration * 0.92;
    };
    const topPick = (item) =>
      quality(item) * 0.42 + fresh(item) * 0.24 + postFresh(item) * 0.08 +
      (item.unseen ? 0.16 : 0) + (item.playable ? 0.06 : 0) + (item.alt ? 0.04 : 0);

    const uniquePostsByAuthor = new Map();
    items.forEach((item) => {
      if (!item.author) return;
      if (!uniquePostsByAuthor.has(item.author)) uniquePostsByAuthor.set(item.author, new Set());
      uniquePostsByAuthor.get(item.author).add(item.post.tweet_id);
    });
    const authorCounts = new Map(Array.from(uniquePostsByAuthor, ([author, posts]) => [author, posts.size]));
    const creatorFloor = Math.max(2, Math.ceil(new Set(items.map((i) => i.post.tweet_id)).size * 0.03));

    const defs = [
      {
        id: "continue", title: "Continue watching",
        subtitle: "Pick up where you left off",
        hint: "Videos you started — most recent first",
        mood: "progress",
        pred: (i) => i.type === "video" && i.progress && i.progress.t >= 3 && !complete(i),
        score: (i) => i.lastOpened || i.viewedAt || 0,
        reason: (i) => "Resume · " + (root.M3EMedia ? root.M3EMedia.formatDuration(i.progress.t * 1000) : Math.round(i.progress.t) + "s"),
      },
      {
        id: "top-picks", title: "Top picks",
        subtitle: "Curated for you",
        hint: "Quality, freshness and what you haven’t opened yet — balanced",
        mood: "curated",
        pred: (i) => !i.archived && i.playable,
        score: topPick,
        reason: (i) => i.unseen ? "Pick · unseen" : "Top pick",
      },
      {
        id: "unseen", title: "Unseen",
        subtitle: "Things you saved but never opened",
        hint: "The best of your unopened saves",
        mood: "attention",
        pred: (i) => i.unseen && !i.archived,
        score: (i) => quality(i) * 0.55 + fresh(i) * 0.45,
        reason: (i) => fresh(i) > 0.7 ? "New and unopened" : "Saved, never opened",
      },
      {
        id: "recent", title: "Recently captured",
        subtitle: "Fresh saves from the last 7 days",
        hint: "Recent captures, newest and most promising first",
        mood: "fresh",
        pred: (i) => i.capturedAt && n - i.capturedAt <= RECENT_MS && !i.archived,
        score: (i) => fresh(i) * 0.72 + quality(i) * 0.28,
        reason: (i) => {
          const days = Math.max(0, Math.floor((n - i.capturedAt) / DAY));
          return days < 1 ? "Saved today" : days === 1 ? "Saved yesterday" : "Saved " + days + " days ago";
        },
      },
      {
        id: "popular", title: "Popular",
        subtitle: "Posts that stood out when you saved them",
        hint: "Strongest engagement, adjusted for reach",
        mood: "social",
        pred: (i) => quality(i) >= 0.48 && i.eng.reactions > 0,
        score: quality,
        min: Math.min(3, items.length),
        reason: (i) => i.eng.likes.toLocaleString() + " likes · " + i.eng.rts.toLocaleString() + " reposts",
      },
      {
        id: "quick-watch", title: "Quick watches",
        subtitle: "Short and loopable",
        hint: "Short videos and GIFs for when you only have a minute",
        mood: "quick",
        pred: (i) => isMotion(i.type) && i.playable && i.duration > 0 && i.duration <= 60000,
        score: (i) => quality(i) * 0.45 + fresh(i) * 0.35 + (i.unseen ? 0.2 : 0),
        reason: (i) => durationLabel(i) + " · quick watch",
      },
      {
        id: "deep-dives", title: "Longer watches",
        subtitle: "Set aside a little more time",
        hint: "Videos worth setting aside a little more time for",
        mood: "deep",
        pred: (i) => i.type === "video" && i.playable && i.duration > 60000,
        score: (i) => quality(i) * 0.52 + (i.unseen ? 0.3 : 0) + fresh(i) * 0.18,
        reason: (i) => durationLabel(i) + " video",
      },
      {
        id: "photo-stories", title: "Photo stories",
        subtitle: "Multi-image posts, kept together",
        hint: "Multi-image posts kept together in their original order",
        mood: "still",
        pred: (i) => i.type === "photo" && Array.isArray(i.post.media_items) && i.post.media_items.length > 1,
        score: (i) => quality(i) * 0.5 + fresh(i) * 0.3 + (i.unseen ? 0.2 : 0),
        groupPostMedia: true,
        reason: (i) => "Image " + i.position + " of " + i.post.media_items.length,
      },
      {
        id: "favorite-creators", title: "Favorite creators",
        subtitle: "People who keep showing up",
        hint: "More from the people who keep showing up in your library",
        mood: "creator",
        pred: (i) => (authorCounts.get(i.author) || 0) >= creatorFloor,
        score: (i) => (authorCounts.get(i.author) || 0) + quality(i) + fresh(i) * 0.5,
        min: 2,
        reason: (i) => (authorCounts.get(i.author) || 0) + " saves · @" + i.author,
      },
      {
        id: "hidden-gems", title: "Hidden gems",
        subtitle: "Older saves worth another look",
        hint: "Older unopened saves that are easy to miss",
        mood: "rediscover",
        pred: (i) => i.unseen && i.capturedAt && n - i.capturedAt > 14 * DAY,
        score: (i) => quality(i) * 0.62 + ageScore(i.capturedAt, n, 120) * 0.18 + (i.alt ? 0.2 : 0),
        reason: () => "Still waiting to be discovered",
      },
      {
        id: "forgotten", title: "Forgotten",
        subtitle: "Older captures worth another look",
        hint: "Things you enjoyed before but haven’t revisited lately",
        mood: "rediscover",
        pred: (i) => !i.unseen && i.lastOpened && n - i.lastOpened > FORGOTTEN_MS,
        score: (i) => quality(i) * 0.55 + clamp01((n - i.lastOpened) / (180 * DAY)) * 0.45,
        reason: (i) => "Last opened " + Math.max(1, Math.floor((n - i.lastOpened) / DAY)) + " days ago",
      },
      {
        id: "accessible", title: "Described media",
        subtitle: "With alt text",
        hint: "Photos and videos with creator-written alt text",
        mood: "accessible",
        pred: (i) => !!i.alt,
        score: (i) => quality(i) * 0.55 + fresh(i) * 0.45,
        min: 3,
        reason: () => "Includes alt text",
      },
      {
        id: "archived", title: "Archived",
        subtitle: "Kept, but out of sight",
        hint: "Keep the media, remove it from normal discovery",
        mood: "archived",
        pred: (i) => !!i.archived,
        score: (i) => i.lastOpened || i.capturedAt,
        reason: () => "Archived",
      },
    ];

    const rails = defs.map((d) => {
      const candidates = items.filter(d.pred);
      const list = ranked(candidates, d.score, { groupPostMedia: d.groupPostMedia });
      return {
        id: d.id,
        title: d.title,
        subtitle: d.subtitle || "",
        hint: d.hint,
        mood: d.mood || "default",
        items: list,
        total: candidates.length,
        reasons: list.map((item) => d.reason(item)),
        min: d.min || 1,
      };
    }).filter((rail) => rail.items.length >= rail.min);

    /* With a tiny library, several algorithms can return the exact same set.
       Keep useful specialist rails, but remove adjacent clones so the page
       feels curated rather than repetitive. */
    return rails.filter((rail, index, all) => {
      if (rail.id === "continue" || rail.id === "top-picks") return true;
      const signature = rail.items.slice(0, 12).map((i) => i.id).join("|");
      return !all.slice(0, index).some((earlier) =>
        earlier.items.length === rail.items.length &&
        earlier.items.slice(0, 12).map((i) => i.id).join("|") === signature
      );
    });
  }

  function authors(items) {
    const map = new Map();
    items.forEach((i) => {
      if (!i.author) return;
      map.set(i.author, (map.get(i.author) || 0) + 1);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }

  function stats(bookmarks, items, dead) {
    const posts = (bookmarks || []).length;
    const media = items.length;
    const videos = items.filter((i) => i.type === "video").length;
    const gifs = items.filter((i) => i.type === "animated_gif").length;
    const photos = items.filter((i) => i.type === "photo").length;
    const unavailable = items.filter((i) => i.state !== "available" || !i.playable).length;
    const failed = (dead || []).length;
    return { posts, media, videos, gifs, photos, unavailable, failed };
  }

  function groupItems(items, groupBy) {
    if (groupBy === "creator") {
      const map = new Map();
      items.forEach((i) => {
        const k = i.author || "unknown";
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(i);
      });
      return Array.from(map.entries())
        .sort((a, b) => b[1].length - a[1].length)
        .map(([key, list]) => ({ key: "@" + key, label: "@" + key, items: list }));
    }
    if (groupBy === "type") {
      const map = { photo: [], video: [], animated_gif: [] };
      items.forEach((i) => { const k = i.type === "animated_gif" ? "animated_gif" : i.type; if (map[k]) map[k].push(i); });
      return [
        { key: "video", label: "Video", items: map.video },
        { key: "photo", label: "Photo", items: map.photo },
        { key: "gif", label: "GIF", items: map.animated_gif },
      ].filter((g) => g.items.length);
    }
    if (groupBy === "date") {
      const buckets = new Map();
      items.forEach((i) => {
        const d = new Date(i.capturedAt);
        const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        const label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
        if (!buckets.has(key)) buckets.set(key, { key, label, items: [] });
        buckets.get(key).items.push(i);
      });
      return Array.from(buckets.values()).sort((a, b) => b.key.localeCompare(a.key));
    }
    return [{ key: "all", label: "", items }];
  }

  /* ===========================================================================
     Discovery engine — a recommendation system with memory.

     Distinct from the flat `collections()` rails (which Library uses for
     focused browsing). Discovery ranks with a SHARED score, then remembers what
     it surfaced so the page rotates instead of repeating.

       exposure  ≠  viewed
         Opening a card marks it viewed; merely surfacing it on Discover marks
         it "surfaced" instead. An item shown recently is suppressed (novelty
         penalty) and recovers over a few cycles — never permanently excluded.

       score = quality + freshness + unseen + rediscovery + novelty
               − recent exposure − repetition
         Each section re-weights these, plus a per-cycle seed so the dynamic
         sections change every load while the stable ones barely move.
     =========================================================================== */
  function discover(items, ctx) {
    const surfaced = (ctx && ctx.surfaced) || {};
    const cycle = (ctx && ctx.cycle) || 1;
    const seed = Number((ctx && ctx.seed) || 1) || 1;
    const n = (ctx && ctx.now) || Date.now();
    const empty = {
      continue: null, freshDiscoveries: null, topPicks: null, newInArchive: null,
      rediscover: null, quickWatch: null, favoriteCreators: null,
      underrated: null, unseenLately: null, differentFromUsual: null, differentFormat: null,
      oneFromEachWorld: null, worthAMinute: null, photoStories: null,
      surfacedIds: []
    };
    if (!items.length) return empty;

    const qualityMap = engagementSignals(items);
    const q = (it) => qualityMap.get(it.id) || 0;
    const fresh = (it) => ageScore(it.capturedAt, n, 14);
    const unseen = (it) => (it.unseen ? 1 : 0);
    const rediscovery = (it) => clamp01((n - (it.lastOpened || it.capturedAt || n)) / (180 * DAY));
    const playable = (it) => (it.playable ? 1 : 0);
    const alt = (it) => (it.alt ? 1 : 0);

    const exposure = (it) => {
      const rec = surfaced[it.id];
      if (!rec) return { penalty: 0, novelty: 1, ignored: 0, seen: false };
      const ago = cycle - (rec.last || 0);
      const decay = ago <= 0 ? 0
        : ago === 1 ? 0.70
        : ago === 2 ? 0.45
        : ago === 3 ? 0.25
        : ago <= 6 ? 0.12 : 0;
      const ignored = (!rec.engaged && rec.count >= 2) ? Math.min(0.3, rec.count * 0.07) : 0;
      return { penalty: decay, novelty: 1 - decay, ignored, seen: true };
    };

    const jitterOf = (it, weight) => ((hashId(it.id + "#" + seed) % 1000) / 1000 - 0.5) * (weight || 0);
    const complete = (it) => !!(it.progress && it.duration && it.progress.t * 1000 >= it.duration * 0.92);

    const continueItems = items
      .filter((it) => it.type === "video" && it.progress && it.progress.t >= 3 && !complete(it) && !it.archived)
      .sort((a, b) => (b.lastOpened || b.viewedAt || 0) - (a.lastOpened || a.viewedAt || 0));
    const continueIds = new Set(continueItems.map((i) => i.id));

    const newItems = items
      .filter((it) => it.capturedAt && n - it.capturedAt <= RECENT_MS && !it.archived)
      .sort((a, b) => b.capturedAt - a.capturedAt);

    /* ---- aggregate stats for diversity intents --------------------------- */
    const authorPosts = new Map();
    const authorCounts = new Map();
    const typeCounts = new Map();
    const shapeCounts = new Map();
    const idToAuthor = new Map();
    const likesList = [];
    items.forEach((it) => {
      if (!it.archived) {
        likesList.push(it.eng.likes);
        idToAuthor.set(it.id, it.author);
        if (it.author) {
          if (!authorPosts.has(it.author)) authorPosts.set(it.author, new Set());
          authorPosts.get(it.author).add(it.post.tweet_id);
          authorCounts.set(it.author, (authorCounts.get(it.author) || 0) + 1);
        }
        typeCounts.set(it.type, (typeCounts.get(it.type) || 0) + 1);
        shapeCounts.set(shapeOf(it), (shapeCounts.get(shapeOf(it)) || 0) + 1);
      }
    });
    likesList.sort((a, b) => a - b);
    const medianLikes = likesList.length ? likesList[Math.floor(likesList.length / 2)] : 0;
    const p75Likes = likesList.length ? likesList[Math.floor(likesList.length * 0.75)] : medianLikes;

    const creatorLastSurfaced = new Map();
    Object.entries(surfaced).forEach(([id, rec]) => {
      const author = idToAuthor.get(id) || "";
      if (!author) return;
      const prev = creatorLastSurfaced.get(author) || 0;
      if ((rec.last || 0) > prev) creatorLastSurfaced.set(author, rec.last || 0);
    });

    const dominantAuthors = Array.from(authorCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
    const dominantAuthorsSet = new Set(dominantAuthors);
    const dominantType = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "photo";
    const dominantShape = Array.from(shapeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "wide";

    const creatorFloor = Math.max(2, Math.ceil(new Set(items.filter((i) => !i.archived).map((i) => i.post.tweet_id)).size * 0.03));

    const scoreFor = (w, jitter) => (it) => {
      const ex = exposure(it);
      return q(it) * (w.q || 0) + fresh(it) * (w.fresh || 0) + unseen(it) * (w.unseen || 0)
        + rediscovery(it) * (w.rediscovery || 0) + playable(it) * (w.playable || 0) + alt(it) * (w.alt || 0)
        + ex.novelty * (w.novelty || 0) - ex.penalty * (w.exposure || 1) - ex.ignored
        + jitterOf(it, jitter || 0);
    };

    /* --- Top picks ------------------------------------------------------- */
    const topPicks = selectDiverse(
      items.filter((it) => !it.archived && it.playable && !continueIds.has(it.id)),
      scoreFor({ q: 0.40, fresh: 0.08, unseen: 0.16, rediscovery: 0.10, playable: 0.06, alt: 0.04, novelty: 0.08, exposure: 0.5 }, 0.25),
      { limit: 40, firstN: 8, maxCreatorFirst: 2 }
    );

    /* --- Fresh discoveries ----------------------------------------------- */
    const freshCands = items.filter((it) =>
      !it.archived && !continueIds.has(it.id)
      && (rediscovery(it) > 0.25 || it.unseen || !surfaced[it.id])
    );
    const freshDiscoveries = selectDiverse(
      freshCands.filter((it) => q(it) > 0.03 || rediscovery(it) > 0.4 || it.unseen),
      scoreFor({ q: 0.20, fresh: 0.04, unseen: 0.14, rediscovery: 0.38, playable: 0.03, novelty: 0.22, exposure: 1.4 }, 0.5),
      { limit: 16, firstN: 8, maxCreatorFirst: 2 }
    );

    /* --- Rediscover ------------------------------------------------------ */
    const tierA = (it) => !it.unseen && it.lastOpened && n - it.lastOpened > FORGOTTEN_MS;
    const tierB = (it) => it.unseen && it.capturedAt && n - it.capturedAt > 14 * DAY;
    const tierC = (it) => rediscovery(it) > 0.8;
    const redisCands = items.filter((it) =>
      !it.archived && !continueIds.has(it.id) && (tierA(it) || tierB(it) || tierC(it))
      && (q(it) > 0.05 || rediscovery(it) > 0.6)
    );
    const rediscover = selectDiverse(
      redisCands,
      scoreFor({ q: 0.28, fresh: 0.02, unseen: 0.07, rediscovery: 0.42, playable: 0.03, novelty: 0.16, exposure: 1.1 }, 0.45),
      { limit: 16, firstN: 8, maxCreatorFirst: 2 }
    );

    /* --- Quick watches --------------------------------------------------- */
    const quickCands = items.filter((it) => isMotion(it.type) && it.playable && it.duration > 0 && it.duration <= 60000 && !it.archived && !continueIds.has(it.id));
    const quickWatch = quickCands.length >= 4
      ? selectDiverse(quickCands, scoreFor({ q: 0.45, fresh: 0.30, unseen: 0.20, exposure: 0.3 }, 0.4), { limit: 40, firstN: 8, maxCreatorFirst: 2 })
      : [];

    /* --- Favorite creators ----------------------------------------------- */
    const creatorCands = items.filter((it) => !it.archived && !continueIds.has(it.id) && (authorPosts.get(it.author) || { size: 0 }).size >= creatorFloor);
    const favoriteCreators = creatorCands.length
      ? selectDiverse(creatorCands, (it) =>
          (authorPosts.get(it.author) || { size: 0 }).size * 0.04 + q(it) * 0.4 + fresh(it) * 0.3 + unseen(it) * 0.1 - exposure(it).penalty * 0.3 + jitterOf(it, 0.3),
        { limit: 40, firstN: 8, maxCreatorFirst: 2 })
      : [];

    /* === NEW INTENTS ===================================================== */

    /* 7. Underrated — low/medium engagement but strong media/quality signals. */
    const underratedCands = items.filter((it) =>
      !it.archived && !continueIds.has(it.id)
      && (it.alt || it.playable)
      && q(it) >= 0.03 && q(it) <= 0.60
      && it.eng.likes <= Math.max(p75Likes, medianLikes * 2)
    );
    const underrated = underratedCands.length >= 3
      ? selectDiverse(underratedCands, (it) => {
          const ex = exposure(it);
          return (it.alt ? 0.38 : 0) + (it.playable ? 0.12 : 0) + unseen(it) * 0.18 + fresh(it) * 0.12
            + (1 - q(it)) * 0.18 + ex.novelty * 0.12 - ex.penalty * 0.5 + jitterOf(it, 0.35);
        }, { limit: 16, firstN: 8, maxCreatorFirst: 2 })
      : [];

    /* 8. From people you haven't seen lately — creator diversity via exposure memory */
    const recentCreatorSet = new Set();
    creatorLastSurfaced.forEach((last, author) => { if (cycle - last <= 1) recentCreatorSet.add(author); });
    const unseenLatelyCands = items.filter((it) =>
      !it.archived && !continueIds.has(it.id) && it.author && !recentCreatorSet.has(it.author)
    );
    const unseenLately = unseenLatelyCands.length >= 3
      ? selectDiverse(unseenLatelyCands, (it) => {
          const last = creatorLastSurfaced.get(it.author) || 0;
          const recencyBonus = last === 0 ? 1 : clamp01((cycle - last) / 6);
          const ex = exposure(it);
          return recencyBonus * 0.52 + q(it) * 0.28 + fresh(it) * 0.10 + ex.novelty * 0.10 + jitterOf(it, 0.4);
        }, { limit: 16, firstN: 8, maxCreatorFirst: 1 })
      : [];

    /* 9. Different from your usual — controlled serendipity outside dominant creators/types */
    const differentUsualCands = items.filter((it) =>
      !it.archived && !continueIds.has(it.id)
      && it.author && !dominantAuthorsSet.has(it.author)
    );
    const differentFromUsual = differentUsualCands.length >= 3
      ? selectDiverse(differentUsualCands, (it) => {
          const ex = exposure(it);
          const typeBonus = it.type !== dominantType ? 0.32 : 0;
          const authorRarity = 1 - clamp01((authorCounts.get(it.author) || 0) / Math.max(10, authorCounts.size));
          return authorRarity * 0.42 + typeBonus + q(it) * 0.18 + ex.novelty * 0.12 + jitterOf(it, 0.5);
        }, { limit: 16, firstN: 8, maxCreatorFirst: 1 })
      : [];

    /* 10. A different format — if user mostly sees photos, surface videos/GIFs, etc. */
    const differentFormatCands = items.filter((it) =>
      !it.archived && !continueIds.has(it.id)
      && (it.type !== dominantType || shapeOf(it) !== dominantShape)
    );
    const differentFormat = differentFormatCands.length >= 4
      ? selectDiverse(differentFormatCands, (it) => {
          const ex = exposure(it);
          const typeBonus = it.type !== dominantType ? 0.42 : 0;
          const shapeBonus = shapeOf(it) !== dominantShape ? 0.28 : 0;
          return typeBonus + shapeBonus + q(it) * 0.20 + ex.novelty * 0.10 + jitterOf(it, 0.35);
        }, { limit: 40, firstN: 8, maxCreatorFirst: 2 })
      : [];

    /* 11. One from each world — highly curated diversity: one strong item per creator cluster */
    const bestPerAuthor = new Map();
    items.forEach((it) => {
      if (it.archived || continueIds.has(it.id) || !it.author) return;
      const cur = bestPerAuthor.get(it.author);
      const score = q(it) * 0.6 + fresh(it) * 0.2 + unseen(it) * 0.12 + (it.alt ? 0.08 : 0);
      if (!cur || score > cur._score) {
        it._score = score;
        bestPerAuthor.set(it.author, it);
      }
    });
    bestPerAuthor.forEach((it) => delete it._score);
    const oneWorldPool = Array.from(bestPerAuthor.values());
    const oneFromEachWorld = oneWorldPool.length >= 4
      ? selectDiverse(oneWorldPool, (it) => {
          const ex = exposure(it);
          return q(it) * 0.55 + fresh(it) * 0.18 + unseen(it) * 0.10 + ex.novelty * 0.12 + jitterOf(it, 0.35);
        }, { limit: 16, firstN: 8, maxCreatorFirst: 1 })
      : [];

    /* 14. Worth a minute — medium length (45s-3m) with high quality/engagement */
    const worthCands = items.filter((it) =>
      !it.archived && !continueIds.has(it.id)
      && it.type === "video" && it.playable && it.duration >= 45000 && it.duration <= 180000
    );
    const worthAMinute = worthCands.length >= 3
      ? selectDiverse(worthCands, (it) => {
          const ex = exposure(it);
          return q(it) * 0.48 + fresh(it) * 0.14 + unseen(it) * 0.12 + (it.alt ? 0.08 : 0) + ex.novelty * 0.10 + jitterOf(it, 0.35);
        }, { limit: 40, firstN: 8, maxCreatorFirst: 2 })
      : [];

    /* 15. Photo stories — genuinely different structure, multi-image posts */
    const photoStoryCands = items.filter((it) =>
      !it.archived && !continueIds.has(it.id)
      && it.type === "photo" && Array.isArray(it.post.media_items) && it.post.media_items.length > 1
    );
    const photoStoriesRanked = photoStoryCands.length >= 2
      ? ranked(photoStoryCands, (it) => q(it) * 0.52 + fresh(it) * 0.28 + unseen(it) * 0.20, { groupPostMedia: true })
      : [];
    const photoStories = photoStoriesRanked.length >= 2
      ? selectDiverse(photoStoriesRanked, (it) => q(it) * 0.5 + fresh(it) * 0.3 + unseen(it) * 0.2 + jitterOf(it, 0.25), { limit: 16, firstN: 8, maxCreatorFirst: 2 })
      : [];

    const section = (id, title, subtitle, list, total, reason) => list && list.length
      ? { id, title, subtitle: subtitle || "", items: list, total: total == null ? list.length : total, reasons: list.map(reason || (() => "")) }
      : null;

    const built = {
      continue: section("continue", "Continue watching", "Pick up where you left off", continueItems.slice(0, 40), continueItems.length,
        (it) => "Resume · " + (root.M3EMedia ? root.M3EMedia.formatDuration(it.progress.t * 1000) : Math.round(it.progress.t) + "s")),
      freshDiscoveries: section("fresh-discoveries", "Fresh discoveries", "Things you probably forgot existed", freshDiscoveries, freshCands.length,
        (it) => exposure(it).seen ? "Back in rotation" : (it.unseen ? "Saved, never opened" : "Worth another look")),
      topPicks: section("top-picks", "Top picks", "Probably worth your attention", topPicks, items.filter((i) => !i.archived && i.playable).length,
        (it) => it.unseen ? "Pick · unseen" : "Top pick"),
      newInArchive: section("new-in-archive", "New in your archive", "Added in the last week", newItems.slice(0, 40), newItems.length,
        (it) => {
          const days = Math.max(0, Math.floor((n - it.capturedAt) / DAY));
          return days < 1 ? "Saved today" : days === 1 ? "Saved yesterday" : "Saved " + days + " days ago";
        }),
      underrated: section("underrated", "Underrated", "Low buzz, high quality — easy to miss", underrated, underratedCands.length,
        (it) => it.alt ? "Alt text · hidden gem" : "Underrated pick"),
      rediscover: section("rediscover", "Rediscover", "Things you haven't looked at in a while", rediscover, redisCands.length,
        (it) => tierA(it) ? "Forgotten favorite" : tierB(it) ? "Never opened" : "From deep in the archive"),
      oneFromEachWorld: section("one-from-each", "One from each world", "A strong pick from many different creators", oneFromEachWorld, oneWorldPool.length,
        (it) => "@" + it.author + " · curated"),
      unseenLately: section("unseen-lately", "From people you haven't seen lately", "Creators you haven't seen in a while", unseenLately, unseenLatelyCands.length,
        (it) => {
          const last = creatorLastSurfaced.get(it.author) || 0;
          return last === 0 ? "Never surfaced before" : "Not seen for " + (cycle - last) + " cycles";
        }),
      worthAMinute: section("worth-a-minute", "Worth a minute", "Medium-length, unusually good", worthAMinute, worthCands.length,
        (it) => durationLabel(it) + " · worth your time"),
      photoStories: section("photo-stories", "Photo stories", "Multi-image posts, kept together", photoStories, photoStoryCands.length,
        (it) => "Image " + it.position + " of " + it.post.media_items.length),
      differentFormat: section("different-format", "A different format", dominantType === "photo" ? "You save a lot of photos — try these videos" : "A change of pace", differentFormat, differentFormatCands.length,
        (it) => it.type !== dominantType ? "Different format · " + it.type : "Different shape · " + shapeOf(it)),
      quickWatch: section("quick-watch", "Quick watches", "A minute or less", quickWatch, quickCands.length,
        (it) => durationLabel(it) + " · quick watch"),
      favoriteCreators: section("favorite-creators", "Favorite creators", "People who keep showing up", favoriteCreators, creatorCands.length,
        (it) => (authorPosts.get(it.author) || { size: 0 }).size + " posts · @" + it.author),
      differentFromUsual: section("different-from-usual", "Different from your usual", "Outside your usual creators and formats", differentFromUsual, differentUsualCands.length,
        (it) => "Serendipity · @" + it.author),
    };

    /* ---- Adaptive selection: which 9–11 actually appear -------------------
       A 40-item library should not look like a 4,000-item library.
       Tier based on total non-archived items; filter low-quality rails;
       then pick top N by editorial priority + per-cycle jitter so the page
       rotates instead of always showing the same 9. */
    const totalUsable = items.filter((i) => !i.archived).length;
    const tierMax = totalUsable < 40 ? 4 : totalUsable < 120 ? 6 : totalUsable < 400 ? 9 : totalUsable < 1000 ? 10 : 11;

    const priority = [
      "continue", "freshDiscoveries", "topPicks", "newInArchive",
      "underrated", "rediscover", "oneFromEachWorld", "unseenLately",
      "worthAMinute", "photoStories", "differentFormat", "quickWatch",
      "favoriteCreators", "differentFromUsual"
    ];

    const coreKeys = new Set(["continue", "freshDiscoveries", "topPicks", "newInArchive", "rediscover"]);

    const avgQ = (sec) => {
      if (!sec || !sec.items.length) return 0;
      let s = 0; for (let i = 0; i < sec.items.length; i++) s += q(sec.items[i]);
      return s / sec.items.length;
    };

    const passesGate = (key, sec) => {
      if (!sec) return false;
      if (sec.items.length < 4) {
        if (key === "continue" && sec.items.length >= 1) return true;
        if ((key === "photoStories" || key === "worthAMinute" || key === "underrated" || key === "differentFromUsual" || key === "quickWatch") && sec.items.length >= 3) return true;
        return false;
      }
      if (key === "underrated") return avgQ(sec) >= 0.02;
      if (key === "differentFromUsual" || key === "differentFormat") return avgQ(sec) >= 0.03;
      if (key === "quickWatch" || key === "favoriteCreators") return avgQ(sec) >= 0.04;
      return avgQ(sec) >= 0.04 || key === "newInArchive";
    };

    const candidates = priority
      .map((k) => ({ key: k, sec: built[k], pri: priority.indexOf(k) }))
      .filter((e) => passesGate(e.key, e.sec));

    // Per-cycle jitter for optional rails so Discover rotates
    const railJitter = (key) => ((hashId(key + "#" + seed) % 1000) / 1000 - 0.5) * 0.9;

    const coreCands = candidates.filter((e) => coreKeys.has(e.key)).sort((a,b)=>a.pri-b.pri);
    const optionalCands = candidates.filter((e) => !coreKeys.has(e.key))
      .map((e) => ({ ...e, sortScore: e.pri * 0.15 + railJitter(e.key) * 1.6 - avgQ(e.sec) * 1.2 }))
      .sort((a,b) => a.sortScore - b.sortScore);

    const neededOptional = Math.max(0, tierMax - coreCands.length);
    const selectedOptional = optionalCands.slice(0, neededOptional);

    const selected = new Set([...coreCands.map(e=>e.key), ...selectedOptional.map(e=>e.key)]);
    if (built.continue) selected.add("continue");
    // Ensure we don't exceed tierMax too much due to continue always added
    // If over, trim lowest priority optional
    if (selected.size > tierMax + 1) {
      const toTrim = Array.from(selected).filter(k=>!coreKeys.has(k)).sort((a,b)=> priority.indexOf(b)-priority.indexOf(a));
      while (selected.size > tierMax + 1 && toTrim.length) {
        selected.delete(toTrim.shift());
      }
    }

    const result = {};
    Object.keys(built).forEach((k) => {
      result[k] = selected.has(k) ? built[k] : null;
    });

    result.surfacedIds = collect([
      result.freshDiscoveries?.items || [], result.rediscover?.items || [],
      result.underrated?.items || [], result.unseenLately?.items || [],
      result.differentFromUsual?.items || [], result.differentFormat?.items || [],
      result.oneFromEachWorld?.items || [], result.worthAMinute?.items || [],
      result.photoStories?.items || [], result.quickWatch?.items || []
    ]);

    return result;
  }


  /* Greedy diversity-aware selection. Within the first `firstN` cards: at most
     `maxCreatorFirst` per creator, at most one media per post, no three
     consecutive of the same type. Whole rail: no two consecutive from one
     creator. Falls back to the raw ranking when rules can't be satisfied. */
  function selectDiverse(candidates, scoreOf, opts) {
    const o = opts || {};
    const limit = o.limit || 40;
    const firstN = o.firstN || 8;
    const maxCreatorFirst = o.maxCreatorFirst || 2;
    if (!candidates.length) return [];
    const pool = candidates.slice().sort((a, b) => (scoreOf(b) - scoreOf(a)) || (hashId(a.id) - hashId(b.id)));

    const out = [];
    const creatorCount = new Map();
    const usedPosts = new Set();
    let prevType = "";
    let prevPrevType = "";

    const lastAuthor = () => (out.length ? out[out.length - 1].author : null);
    const take = (it) => {
      out.push(it);
      creatorCount.set(it.author, (creatorCount.get(it.author) || 0) + 1);
      usedPosts.add(it.post.tweet_id);
      prevPrevType = prevType;
      prevType = it.type;
    };

    for (const it of pool) {
      if (out.length >= limit) break;
      const inFirst = out.length < firstN;
      if (it.author && it.author === lastAuthor()) continue;            // no consecutive author
      if (inFirst && (creatorCount.get(it.author) || 0) >= maxCreatorFirst) continue;
      if (inFirst && usedPosts.has(it.post.tweet_id)) continue;         // max one media per post
      if (it.type === prevType && it.type === prevPrevType) continue;   // no triple same type
      take(it);
    }
    /* Relaxation: top up if diversity starved the rail (still no consecutive
       same author), so a small library fills its rail. */
    if (out.length < Math.min(limit, pool.length)) {
      for (const it of pool) {
        if (out.length >= limit) break;
        if (out.indexOf(it) >= 0) continue;
        if (it.author && it.author === lastAuthor()) continue;
        take(it);
      }
    }
    return out;
  }

  function collect(listOfLists) {
    const ids = new Set();
    listOfLists.forEach((list) => (list || []).forEach((it) => it && ids.add(it.id)));
    return Array.from(ids);
  }

  root.XBLibrary = {
    flatten,
    applyFilters,
    sortItems,
    collections,
    discover,
    authors,
    stats,
    mediaId,
    parseDate,
    groupItems,
    PORTRAIT_MAX,
    WIDE_MIN,
    LONG_VIDEO_MS,
  };
})(window);
