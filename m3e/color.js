/* AUTO-GENERATED — do not edit.
   Mirrored from dashboard/m3e/color.js by tools/sync-shared.mjs.
   Edit the original and re-run:  node tools/sync-shared.mjs
*/
/* =============================================================================
   M3E · Dynamic Color Engine
   Material Design 3 Expressive — tonal palettes, scheme variants, contrast
   -----------------------------------------------------------------------------
   Traceability
   ------------
   · Tone == CIE L*.  M3 defines a tonal palette as 13+ tones of a single hue,
     where "tone" is the lightness of HCT, and HCT lightness IS CIELAB L*.
     Generating in CIE-LCh with per-tone chroma clipping therefore reproduces
     the M3 tone→contrast guarantees exactly (contrast is a function of L*),
     while staying dependency-free.  Deviation from CAM16-based HCT is limited
     to hue-appearance drift at very high chroma; documented in
     design/01-foundations.md §Color.
   · Scheme variants (tonalSpot / vibrant / expressive) follow the hue-rotation
     and chroma constants of Material Color Utilities' DynamicScheme family.
   · Role→tone maps follow the M3 colour-role specification, with medium/high
     contrast tables for the M3 contrast levels.

   Exposed as CommonJS (tests) and as window.M3EColor (browser / extension).
   ============================================================================= */
(function (root, factory) {
  // Always publish on the global (window / WorkerGlobalScope). Some hosts
  // expose a stub `module` object that would otherwise swallow the export and
  // leave window.M3EColor undefined for classic <script> consumers.
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.M3EColor = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------------------------------------------------------------------
     1 · Colour space primitives  (sRGB ⇄ linear ⇄ XYZ D65 ⇄ CIELAB ⇄ LCh)
     --------------------------------------------------------------------------- */
  const WHITE = [95.047, 100.0, 108.883]; // D65, 2° observer

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const mod360 = (h) => ((h % 360) + 360) % 360;

  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(c) {
    const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return clamp(Math.round(v * 255), 0, 255);
  }

  function parseHex(hex) {
    let h = String(hex || "").trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(h)) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function toHex(rgb) {
    return (
      "#" +
      rgb
        .map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  function rgbToXyz(rgb) {
    const r = srgbToLinear(rgb[0]);
    const g = srgbToLinear(rgb[1]);
    const b = srgbToLinear(rgb[2]);
    return [
      (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) * 100,
      (r * 0.2126729 + g * 0.7151522 + b * 0.072175) * 100,
      (r * 0.0193339 + g * 0.119192 + b * 0.9503041) * 100,
    ];
  }
  function xyzToLinearRgb(xyz) {
    const x = xyz[0] / 100, y = xyz[1] / 100, z = xyz[2] / 100;
    return [
      x * 3.2404542 + y * -1.5371385 + z * -0.4985314,
      x * -0.969266 + y * 1.8760108 + z * 0.041556,
      x * 0.0556434 + y * -0.2040259 + z * 1.0572252,
    ];
  }

  const fwd = (t) => (t > 0.008856451679 ? Math.cbrt(t) : t * 7.787037037 + 16 / 116);
  const inv = (t) => (t * t * t > 0.008856451679 ? t * t * t : (t - 16 / 116) / 7.787037037);

  function xyzToLab(xyz) {
    const fx = fwd(xyz[0] / WHITE[0]);
    const fy = fwd(xyz[1] / WHITE[1]);
    const fz = fwd(xyz[2] / WHITE[2]);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function labToXyz(lab) {
    const fy = (lab[0] + 16) / 116;
    const fx = fy + lab[1] / 500;
    const fz = fy - lab[2] / 200;
    return [inv(fx) * WHITE[0], inv(fy) * WHITE[1], inv(fz) * WHITE[2]];
  }

  function hexToLch(hex) {
    const rgb = parseHex(hex);
    if (!rgb) return { l: 50, c: 40, h: 250 };
    const lab = xyzToLab(rgbToXyz(rgb));
    return {
      l: clamp(lab[0], 0, 100),
      c: Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]),
      h: mod360((Math.atan2(lab[2], lab[1]) * 180) / Math.PI),
    };
  }

  function lchToLinearRgb(l, c, h) {
    const rad = (h * Math.PI) / 180;
    return xyzToLinearRgb(labToXyz([l, Math.cos(rad) * c, Math.sin(rad) * c]));
  }
  const inGamut = (lin) => lin.every((v) => v >= -0.0002 && v <= 1.0002);

  /** Largest chroma renderable in sRGB for a given tone + hue (binary search). */
  function maxChroma(l, h) {
    if (l <= 0 || l >= 100) return 0;
    let lo = 0, hi = 160;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(lchToLinearRgb(l, mid, h))) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Solve a colour at an exact tone, with chroma clipped into gamut. */
  function lchToHex(l, c, h) {
    const L = clamp(l, 0, 100);
    const C = Math.max(0, Math.min(c, maxChroma(L, h)));
    const lin = lchToLinearRgb(L, C, h);
    return toHex(lin.map(linearToSrgb));
  }

  /* ---------------------------------------------------------------------------
     2 · Tonal palettes
     --------------------------------------------------------------------------- */
  const TONES = [0, 4, 5, 6, 10, 12, 17, 20, 22, 24, 25, 30, 35, 40, 45, 50, 55,
    60, 70, 80, 85, 87, 90, 92, 94, 95, 96, 98, 99, 100];

  /**
   * A tonal palette: one hue, one target chroma, addressable by tone (0–100).
   * `tone(n)` is memoised because scheme building asks for the same tones a lot.
   */
  function TonalPalette(hue, chroma) {
    const cache = new Map();
    return {
      hue,
      chroma,
      tone(t) {
        if (!cache.has(t)) cache.set(t, lchToHex(t, chroma, hue));
        return cache.get(t);
      },
      /** Full ramp — used by the token inspector in the docs page. */
      ramp() {
        const out = {};
        for (const t of TONES) out[t] = this.tone(t);
        return out;
      },
    };
  }

  /* ---------------------------------------------------------------------------
     3 · Scheme variants  (MCU DynamicScheme constants)
     --------------------------------------------------------------------------- */
  const HUES = [0, 21, 51, 121, 151, 191, 271, 321, 360];

  function rotate(hue, rotations) {
    const h = mod360(hue);
    for (let i = 0; i < HUES.length - 1; i++) {
      if (h >= HUES[i] && h < HUES[i + 1]) return mod360(h + rotations[i]);
    }
    return h;
  }

  /* Chroma note
     -----------
     M3 states palette chroma in HCT, where chroma is a CAM16 colourfulness.
     We generate in CIE-LCh, whose chroma runs numerically much larger for the
     same perceived colourfulness — especially in near-white and near-black
     tones, where LAB over-states chroma badly. Neutral chroma is therefore
     deliberately small here: a literal port of HCT's neutral chroma 6 renders
     as an obviously tinted surface rather than the intended "barely there"
     wash. Values below were tuned against rendered surfaces at tones 4–99. */
  const VARIANTS = {
    /** Calm, brand-faithful. The M3 default. */
    tonalSpot: (h) => ({
      primary: TonalPalette(h, 36),
      secondary: TonalPalette(h, 16),
      tertiary: TonalPalette(mod360(h + 60), 24),
      neutral: TonalPalette(h, 1.5),
      neutralVariant: TonalPalette(h, 4),
    }),
    /** Saturated primary, analogous accents. Maximum brand punch. */
    vibrant: (h) => ({
      primary: TonalPalette(h, 200),
      secondary: TonalPalette(rotate(h, [18, 15, 10, 12, 15, 18, 15, 12, 12]), 24),
      tertiary: TonalPalette(rotate(h, [35, 30, 20, 25, 30, 35, 30, 25, 25]), 32),
      neutral: TonalPalette(h, 2.5),
      neutralVariant: TonalPalette(h, 6),
    }),
    /** Playful complementary shift — the personality setting of M3 Expressive.
        Surfaces carry the most tint of any variant; that tint is the point. */
    expressive: (h) => ({
      primary: TonalPalette(mod360(h + 240), 40),
      secondary: TonalPalette(rotate(h, [45, 95, 45, 20, 45, 90, 45, 45, 45]), 24),
      tertiary: TonalPalette(rotate(h, [120, 120, 20, 45, 20, 15, 20, 120, 120]), 32),
      neutral: TonalPalette(mod360(h + 15), 3.5),
      neutralVariant: TonalPalette(mod360(h + 15), 7),
    }),
    /** Chromatically neutral. Accessibility / focus mode. */
    neutral: (h) => ({
      primary: TonalPalette(h, 12),
      secondary: TonalPalette(h, 8),
      tertiary: TonalPalette(h, 16),
      neutral: TonalPalette(h, 0),
      neutralVariant: TonalPalette(h, 1),
    }),
  };

  const VARIANT_KEYS = Object.keys(VARIANTS);

  /* ---------------------------------------------------------------------------
     4 · Role → tone maps, per contrast level
         [paletteKey, lightTone, darkTone]
     --------------------------------------------------------------------------- */
  const accentRoles = (k, lp, dp) => ({
    [k]: [k, lp[0], dp[0]],
    ["on" + cap(k)]: [k, lp[1], dp[1]],
    [k + "Container"]: [k, lp[2], dp[2]],
    ["on" + cap(k) + "Container"]: [k, lp[3], dp[3]],
  });
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  function buildRoleMap(level) {
    const accent =
      level === "high"
        ? [[20, 100, 30, 100], [98, 0, 85, 0]]
        : level === "medium"
        ? [[30, 100, 85, 5], [90, 10, 35, 95]]
        : [[40, 100, 90, 10], [80, 20, 30, 90]];

    const surfaceText =
      level === "high"
        ? { onSurface: [0, 100], onSurfaceVariant: [10, 95], outline: [20, 90], outlineVariant: [40, 70] }
        : level === "medium"
        ? { onSurface: [5, 95], onSurfaceVariant: [25, 85], outline: [40, 70], outlineVariant: [65, 45] }
        : { onSurface: [10, 90], onSurfaceVariant: [30, 80], outline: [50, 60], outlineVariant: [80, 30] };

    const map = {
      ...accentRoles("primary", accent[0], accent[1]),
      ...accentRoles("secondary", accent[0], accent[1]),
      ...accentRoles("tertiary", accent[0], accent[1]),
      ...accentRoles("error", accent[0], accent[1]),

      // Fixed accent pair — identical in light and dark (M3 "fixed" roles).
      primaryFixed: ["primary", 90, 90],
      primaryFixedDim: ["primary", 80, 80],
      onPrimaryFixed: ["primary", 10, 10],
      onPrimaryFixedVariant: ["primary", 30, 30],
      secondaryFixed: ["secondary", 90, 90],
      secondaryFixedDim: ["secondary", 80, 80],
      onSecondaryFixed: ["secondary", 10, 10],
      onSecondaryFixedVariant: ["secondary", 30, 30],
      tertiaryFixed: ["tertiary", 90, 90],
      tertiaryFixedDim: ["tertiary", 80, 80],
      onTertiaryFixed: ["tertiary", 10, 10],
      onTertiaryFixedVariant: ["tertiary", 30, 30],

      // Surfaces — the M3 container ladder replaces M2 elevation overlays.
      background: ["neutral", 98, 6],
      onBackground: ["neutral", surfaceText.onSurface[0], surfaceText.onSurface[1]],
      surface: ["neutral", 98, 6],
      surfaceDim: ["neutral", 87, 6],
      surfaceBright: ["neutral", 98, 24],
      surfaceContainerLowest: ["neutral", 100, 4],
      surfaceContainerLow: ["neutral", 96, 10],
      surfaceContainer: ["neutral", 94, 12],
      surfaceContainerHigh: ["neutral", 92, 17],
      surfaceContainerHighest: ["neutral", 90, 22],
      onSurface: ["neutral", surfaceText.onSurface[0], surfaceText.onSurface[1]],
      onSurfaceVariant: ["neutralVariant", surfaceText.onSurfaceVariant[0], surfaceText.onSurfaceVariant[1]],
      surfaceVariant: ["neutralVariant", 90, 30],
      outline: ["neutralVariant", surfaceText.outline[0], surfaceText.outline[1]],
      outlineVariant: ["neutralVariant", surfaceText.outlineVariant[0], surfaceText.outlineVariant[1]],

      inverseSurface: ["neutral", 20, 90],
      inverseOnSurface: ["neutral", 95, 20],
      inversePrimary: ["primary", 80, 40],
      surfaceTint: ["primary", 40, 80],
      shadow: ["neutral", 0, 0],
      scrim: ["neutral", 0, 0],
    };
    return map;
  }

  const ROLE_MAPS = {
    standard: buildRoleMap("standard"),
    medium: buildRoleMap("medium"),
    high: buildRoleMap("high"),
  };

  /* ---------------------------------------------------------------------------
     5 · Scheme generation
     --------------------------------------------------------------------------- */
  const ERROR_HUE = 25;     // MCU error palette hue
  const ERROR_CHROMA = 84;

  /**
   * @param {string}  seed      source colour, hex
   * @param {object}  opts      { dark:boolean, variant:string, contrast:'standard'|'medium'|'high' }
   * @returns {{roles:Object<string,string>, palettes:Object, meta:Object}}
   */
  function scheme(seed, opts) {
    const o = opts || {};
    const dark = !!o.dark;
    const variant = VARIANTS[o.variant] ? o.variant : "tonalSpot";
    const contrast = ROLE_MAPS[o.contrast] ? o.contrast : "standard";

    const src = hexToLch(seed);
    const palettes = VARIANTS[variant](src.h);
    palettes.error = TonalPalette(ERROR_HUE, ERROR_CHROMA);

    const map = ROLE_MAPS[contrast];
    const roles = {};
    for (const role in map) {
      const [key, lightTone, darkTone] = map[role];
      roles[role] = palettes[key].tone(dark ? darkTone : lightTone);
    }
    return { roles, palettes, meta: { seed, hue: src.h, dark, variant, contrast } };
  }

  /* ---------------------------------------------------------------------------
     6 · Contrast utilities (WCAG 2.1 relative luminance)
     --------------------------------------------------------------------------- */
  function luminance(hex) {
    const rgb = parseHex(hex) || [0, 0, 0];
    const [r, g, b] = rgb.map(srgbToLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrastRatio(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /** Blend `over` onto `base` at `alpha` — used to precompute state layers. */
  function blend(base, over, alpha) {
    const A = parseHex(base) || [0, 0, 0];
    const B = parseHex(over) || [0, 0, 0];
    return toHex(A.map((c, i) => c + (B[i] - c) * alpha));
  }

  /* ---------------------------------------------------------------------------
     7 · Public surface
     --------------------------------------------------------------------------- */
  return {
    scheme,
    TonalPalette,
    VARIANTS: VARIANT_KEYS,
    CONTRAST_LEVELS: ["standard", "medium", "high"],
    /* Brand defaults live here, not in theme.js, because theme.js touches the
       DOM and so cannot be imported by the service worker — which still needs
       to know the brand colour to tint the toolbar badge. theme.js builds its
       own DEFAULTS on top of these. */
    DEFAULT_SEED: "#5B4CF5",
    DEFAULT_VARIANT: "vibrant",
    // primitives, exported for tests + the token inspector
    hexToLch,
    lchToHex,
    maxChroma,
    parseHex,
    toHex,
    luminance,
    contrastRatio,
    blend,
    TONES,
  };
});
