/* AUTO-GENERATED — do not edit.
   Mirrored from dashboard/m3e/theme.js by tools/sync-shared.mjs.
   Edit the original and re-run:  node tools/sync-shared.mjs
*/
/* =============================================================================
   M3E · Theme Runtime
   Applies a dynamic colour scheme to --md-sys-color-* custom properties and
   owns the personalisation surface (seed / variant / contrast / scheme /
   density / motion).

   Personalisation is the point of M3 Expressive: the user's choices are the
   theme, and every component reads only system tokens, so one repaint here
   restyles the entire product.
   ============================================================================= */
(function (root, factory) {
  var color =
    root && root.M3EColor
      ? root.M3EColor
      : typeof module === "object" && module.exports
      ? require("./color.js")
      : null;
  var api = factory(color);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.M3ETheme = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (M3EColor) {
  "use strict";

  const KEBAB = (s) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

  const DEFAULTS = {
    seed: M3EColor.DEFAULT_SEED,   // "Ultraviolet" — see design/01-foundations.md
    /* Default is `vibrant`, not `expressive`.
       Both are M3 scheme variants; the difference is where primary lands.
       `expressive` rotates the primary hue +240°, so a user who picks violet
       gets a teal UI — a deliberate, delightful surprise on a phone home
       screen, but wrong as the default for a tool where the swatch you pick
       should be the colour you get. `expressive` stays one tap away in
       Settings for people who want it. */
    variant: M3EColor.DEFAULT_VARIANT,
    contrast: "standard",
    scheme: "system",     // 'system' | 'light' | 'dark'
    density: "comfortable",
    reducedMotion: false,
  };

  /**
   * Curated seeds. Named, because personalisation should feel authored.
   *
   * Chosen for HUE SEPARATION, not for the prettiness of the swatch. Every
   * scheme variant re-chromas the seed to a fixed target (this is what M3 does
   * — `tonalSpot` pins primary to chroma 36 regardless of input), so only the
   * hue survives. Two seeds that differ in saturation but share a hue produce
   * byte-identical schemes: a near-grey "Graphite" at hue 268 was rendering
   * exactly the same UI as "Signal" blue at hue 268, which made the picker
   * look broken. The six below are spread around the wheel:
   *   303 violet · 268 blue · 180 teal · 142 green · 45 orange · 334 magenta
   *
   * A desaturated UI is still available — it is the "Neutral" colour style,
   * which is where that choice belongs, since it applies to any hue.
   */
  const SEEDS = [
    { name: "Ultraviolet", hex: "#5B4CF5" }, // 303
    { name: "Signal", hex: "#1D9BF0" },      // 268
    { name: "Kelp", hex: "#0F7B6C" },        // 180
    { name: "Fern", hex: "#2E7D46" },        // 142
    { name: "Ember", hex: "#D2542B" },       // 45
    { name: "Orchid", hex: "#B0399B" },      // 334
  ];

  /**
   * The colour a seed will actually produce as `primary` under the current
   * settings. Swatches paint with this rather than the raw seed so the picker
   * can never show one colour and apply another.
   */
  function seedPreview(seedHex, settings) {
    const s = Object.assign({}, DEFAULTS, settings || {});
    const built = M3EColor.scheme(seedHex, {
      dark: resolveDark(s),
      variant: s.variant,
      contrast: s.contrast,
    });
    return { primary: built.roles.primary, onPrimary: built.roles.onPrimary };
  }

  function prefersDark() {
    return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function prefersReducedMotion() {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function prefersMoreContrast() {
    return typeof matchMedia === "function" && matchMedia("(prefers-contrast: more)").matches;
  }

  function resolveDark(settings) {
    if (settings.scheme === "dark") return true;
    if (settings.scheme === "light") return false;
    return prefersDark();
  }

  /**
   * Paint a scheme onto an element (default :root).
   * Emits, in addition to the M3 colour roles:
   *   --md-sys-color-*-rgb   channel triplets, for colour-mix-free alpha use
   *   --m3e-state-*          precomposed state-layer colours
   */
  function apply(settings, target) {
    const s = Object.assign({}, DEFAULTS, settings || {});
    const el = target || (typeof document !== "undefined" ? document.documentElement : null);
    if (!el) return null;

    const dark = resolveDark(s);
    const contrast = s.contrast === "standard" && prefersMoreContrast() ? "medium" : s.contrast;

    const built = M3EColor.scheme(s.seed, { dark, variant: s.variant, contrast });

    for (const role in built.roles) {
      const hex = built.roles[role];
      el.style.setProperty("--md-sys-color-" + KEBAB(role), hex);
      const rgb = M3EColor.parseHex(hex);
      if (rgb) el.style.setProperty("--md-sys-color-" + KEBAB(role) + "-rgb", rgb.join(" "));
    }

    // Scrim is spec'd as neutral-0 at opacity; expose the composited value too.
    el.style.setProperty("--md-sys-color-scrim-overlay", dark ? "rgb(0 0 0 / 0.60)" : "rgb(0 0 0 / 0.40)");

    el.dataset.scheme = dark ? "dark" : "light";
    el.dataset.contrast = contrast;
    el.dataset.variant = s.variant;
    el.dataset.density = s.density;
    el.dataset.motion = s.reducedMotion || prefersReducedMotion() ? "reduced" : "full";
    el.style.colorScheme = dark ? "dark" : "light";

    return built;
  }

  /**
   * Wire a settings object to the DOM and keep it in sync with OS preferences.
   * Returns a controller: { settings, set(patch), subscribe(fn), current }.
   */
  function createController(initial, onChange) {
    let settings = Object.assign({}, DEFAULTS, initial || {});
    let built = apply(settings);
    const listeners = new Set();
    if (onChange) listeners.add(onChange);

    const repaint = () => {
      built = apply(settings);
      listeners.forEach((fn) => fn(settings, built));
    };

    if (typeof matchMedia === "function") {
      const bind = (query, guard) => {
        const mq = matchMedia(query);
        const handler = () => { if (guard()) repaint(); };
        if (mq.addEventListener) mq.addEventListener("change", handler);
        else if (mq.addListener) mq.addListener(handler);
      };
      bind("(prefers-color-scheme: dark)", () => settings.scheme === "system");
      bind("(prefers-reduced-motion: reduce)", () => true);
      bind("(prefers-contrast: more)", () => settings.contrast === "standard");
    }

    return {
      get settings() { return Object.assign({}, settings); },
      get current() { return built; },
      set(patch) {
        settings = Object.assign({}, settings, patch);
        repaint();
        return settings;
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      repaint,
    };
  }

  return { apply, createController, DEFAULTS, SEEDS, seedPreview, resolveDark, prefersDark, prefersReducedMotion };
});
