/* =============================================================================
   settings v3 — twelve decisions, not forty-eight.

   Everything here is a preference a person would genuinely miss. Anything the
   product can decide for itself, it does.
   ========================================================================== */

import { h, icon } from "../ui/dom.js";
import { state, setPrefs, resetPrefs } from "../core/state.js";
import { overlay, toast, confirmDialog } from "../ui/feedback.js";
import { backendName, estimateBytes } from "../core/store.js";
import { fmtBytes } from "../ui/media.js";
import { stats } from "../core/query.js";
import { openInsights } from "./insights.js";

export function openSettings() {
  const sheet = overlay({ title: "Settings", size: "" });
  const c = sheet.content;

  /* ---------------------------------------------------------- appearance -- */
  c.append(group("Appearance"));
  c.append(rowSeg("Theme", "Follow the OS, or pin one", ["system", "dark", "light"],
    () => state.prefs.themeMode, (v) => setPrefs({ themeMode: v })));
  c.append(rowSeg("Density", "How tightly the grid packs", ["compact", "cozy", "roomy"],
    () => state.prefs.density, (v) => setPrefs({ density: v })));
  c.append(rowSeg("Tile shape", "Fallback ratio for media with no dimensions", ["4/5", "1/1", "3/4", "16/10"],
    () => state.prefs.aspect, (v) => setPrefs({ aspect: v }), ["4:5", "1:1", "3:4", "16:10"]));
  c.append(rowSwitch("Reduce motion", "No springs, no fades", "motion",
    (on) => setPrefs({ motion: on ? "reduced" : "auto" }), () => state.prefs.motion === "reduced"));

  /* --------------------------------------------------------------- media -- */
  c.append(group("Media"));
  c.append(rowSwitch("Autoplay in Watch", "The centred video plays itself", "autoplay",
    (on) => setPrefs({ autoplay: on }), () => state.prefs.autoplay));
  c.append(rowSwitch("Start muted", "Sound only when you ask for it", "startMuted",
    (on) => setPrefs({ startMuted: on }), () => state.prefs.startMuted));
  c.append(rowSwitch("Fill the screen in Watch", "Crop clips to fill; off shows the whole frame with black bars", "watchFit",
    (on) => setPrefs({ watchFit: on ? "cover" : "contain" }), () => (state.prefs.watchFit || "cover") !== "contain"));
  c.append(rowSwitch("Remember progress", "Resume videos where you left them", "rememberProgress",
    (on) => setPrefs({ rememberProgress: on }), () => state.prefs.rememberProgress));
  c.append(rowSwitch("Dim what you have seen", "Opened tiles fade back", "dimSeen",
    (on) => setPrefs({ dimSeen: on }), () => state.prefs.dimSeen));
  c.append(rowSwitch("Privacy blur", "Thumbnails stay blurred until tapped", "blurMedia",
    (on) => setPrefs({ blurMedia: on }), () => state.prefs.blurMedia));

  /* ------------------------------------------------------------- privacy -- */
  c.append(group("Privacy"));
  c.append(h("div.row", { "aria-label": "PIN lock" },
    h("span.row__icon.hue", { style: { "--hue": "var(--hue-a)" } }, icon("lock", 18)),
    h("span.row__text",
      h("b", { text: "PIN lock" }),
      h("small", { text: "The archive always opens with the fixed PIN 2055 — a shoulder-surf guard, not encryption" }),
    ),
  ));

  /* ------------------------------------------------------------ insights -- */
  c.append(group("Insights"));
  c.append(h("button.row", { type: "button", onclick: () => { sheet.close(); openInsights(); } },
    h("span.row__icon.hue", { style: { "--hue": "var(--hue-c)" } }, icon("chart", 18)),
    h("span.row__text",
      h("b", { text: "Insights" }),
      h("small", { text: "Counts, activity and top creators" }),
    ),
    icon("chevronRight", 16),
  ));

  /* ---------------------------------------------------------------- data -- */
  c.append(group("Data"));
  c.append(h("button.row", { type: "button", onclick: () => { sheet.close(); import("./manage.js").then((m) => m.openManage()); } },
    h("span.row__icon.hue", { style: { "--hue": "var(--hue-b)" } }, icon("database", 18)),
    h("span.row__text", h("b", { text: "Import & export" }), h("small", { text: "Move your archive in and out" })),
    icon("chevronRight", 16),
  ));
  c.append(h("button.row", { type: "button", onclick: async () => {
    const { invalidateIndex } = await import("../core/data.js");
    await invalidateIndex();
    toast("Projection cache cleared — next load re-indexes");
  } },
    h("span.row__icon.hue", { style: { "--hue": "var(--hue-c)" } }, icon("refresh", 18)),
    h("span.row__text", h("b", { text: "Rebuild the index cache" }), h("small", { text: "The projection is regenerated from the source file" })),
    icon("chevronRight", 16),
  ));
  c.append(h("button.row", { type: "button", onclick: async () => {
    if (!(await confirmDialog({ title: "Reset preferences?", message: "Theme, density, playback and privacy choices return to defaults. Your archive and stars are untouched.", confirmLabel: "Reset" }))) return;
    resetPrefs();
    toast("Preferences reset");
  } },
    h("span.row__icon.hue", { style: { "--hue": "var(--hue-e)" } }, icon("trash", 18)),
    h("span.row__text", h("b", { text: "Reset preferences" }), h("small", { text: "Leaves the archive itself alone" })),
    icon("chevronRight", 16),
  ));

  /* --------------------------------------------------------------- about -- */
  storageLine(c);
}

/* ----------------------------------------------------------------- bits -- */

function group(label) {
  return h("div.sheet__group", h("span.t-label", { text: label }));
}

function rowSwitch(label, hint, key, onToggle, read) {
  const sw = h("button.switch", {
    type: "button", role: "switch",
    "aria-checked": read() ? "true" : "false",
    "aria-label": label,
  });
  sw.addEventListener("click", () => {
    const on = sw.getAttribute("aria-checked") !== "true";
    sw.setAttribute("aria-checked", on ? "true" : "false");
    onToggle(on);
  });
  return h("div.row",
    h("span.row__text", h("b", { text: label }), h("small", { text: hint })),
    sw,
  );
}

function rowSeg(label, hint, options, read, onPick, labels) {
  const seg = h("div.seg", { role: "group", "aria-label": label });
  const paint = () => {
    seg.replaceChildren(...options.map((opt, i) => h("button.seg__item", {
      type: "button",
      class: read() === opt ? "is-on" : "",
      text: labels?.[i] || opt.charAt(0).toUpperCase() + opt.slice(1),
      onclick: () => { onPick(opt); paint(); },
    })));
  };
  paint();
  return h("div.row", { style: { alignItems: "center" } },
    h("span.row__text", h("b", { text: label }), h("small", { text: hint })),
    h("span.row__end", { style: { width: "min(240px, 46%)" } }, seg),
  );
}

function storageLine(c) {
  const line = h("div.row",
    h("span.row__icon.hue", { style: { "--hue": "var(--hue-f)" } }, icon("info", 18)),
    h("span.row__text",
      h("b", { text: "Storage" }),
      h("small", { text: "measuring…" }),
    ),
  );
  c.append(group("About"), line);
  Promise.all([backendName(), estimateBytes()]).then(([backend, bytes]) => {
    const s = stats();
    line.querySelector("small").textContent =
      `${backend} · ${fmtBytes(bytes)} on this device · ${s.media} items indexed · v3.3`;
  }).catch(() => {
    line.querySelector("small").textContent = "v3.3";
  });
}
