/* =============================================================================
   settings — the twelve decisions that are actually yours.

   The previous build persisted forty-eight preferences. Most were things the
   product should simply have decided; every one of them was another row to read
   and another way for the app to end up in a state nobody chose. What is left
   here is what genuinely varies between people: how it looks, how video behaves,
   and what is private.
   ============================================================================= */

import { h, icon } from "../ui/dom.js";
import { overlay, confirm, toast } from "../ui/feedback.js";
import { state, setPrefs, resetPrefs } from "../core/state.js";
import { stats } from "../core/query.js";
import { fmtCount } from "../ui/media.js";

export function openSettings(section = "appearance") {
  const sheet = overlay({ title: "Settings", size: "sm" });

  const groups = [
    { id: "appearance", label: "Appearance", icon: "sun", build: appearance },
    { id: "playback", label: "Playback", icon: "play", build: playback },
    { id: "privacy", label: "Privacy", icon: "lock", build: privacy },
    { id: "data", label: "Your data", icon: "database", build: data },
  ];

  /* Tabs across the top — one sheet, not four destinations. */
  const tabs = h("div.seg.settings__tabs", { role: "tablist" });
  const body = h("div.settings__body");

  for (const group of groups) {
    tabs.append(h("button.seg__item", {
      type: "button", role: "tab",
      "aria-selected": group.id === section ? "true" : "false",
      text: group.label,
      onclick: () => show(group.id),
    }));
  }

  function show(id) {
    for (const tab of tabs.children) {
      const on = tab.textContent === groups.find((g) => g.id === id)?.label;
      tab.setAttribute("aria-selected", on ? "true" : "false");
    }
    body.replaceChildren(groups.find((g) => g.id === id).build());
  }

  sheet.content.append(tabs, body);
  show(section);
  return sheet;
}

/* ------------------------------------------------------------------ rows -- */

function row(label, hint, control) {
  return h("div.set-row",
    h("div.set-row__text",
      h("b", { text: label }),
      hint ? h("small", { text: hint }) : null,
    ),
    control,
  );
}

function toggle(key, hint) {
  const el = h("button.switch", {
    type: "button", role: "switch",
    "aria-checked": state.prefs[key] ? "true" : "false",
    "aria-label": hint || key,
    onclick: (e) => {
      const next = !state.prefs[key];
      setPrefs({ [key]: next });
      e.currentTarget.setAttribute("aria-checked", next ? "true" : "false");
    },
  });
  return el;
}

function segmented(key, options) {
  const seg = h("div.seg");
  for (const { value, label } of options) {
    seg.append(h("button.seg__item", {
      type: "button", role: "radio",
      "aria-checked": state.prefs[key] === value ? "true" : "false",
      text: label,
      onclick: (e) => {
        setPrefs({ [key]: value });
        for (const sibling of seg.children) sibling.setAttribute("aria-checked", "false");
        e.currentTarget.setAttribute("aria-checked", "true");
      },
    }));
  }
  return seg;
}

/* ---------------------------------------------------------------- groups -- */

function appearance() {
  const wrap = h("div.settings__group");
  wrap.append(
    row("Theme", "Follow your system, or pin one.",
      segmented("themeMode", [
        { value: "system", label: "System" },
        { value: "dark", label: "Dark" },
        { value: "light", label: "Light" },
      ])),
    row("Grid density", "How many tiles fit on a screen.",
      segmented("density", [
        { value: "compact", label: "Dense" },
        { value: "cozy", label: "Cozy" },
        { value: "roomy", label: "Roomy" },
      ])),
  );

  /* Motion is a tri-state in the data model (so it can mean "follow the OS"),
     which a plain boolean toggle cannot express. It gets its own control. */
  const motionToggle = h("button.switch", {
    type: "button", role: "switch",
    "aria-checked": state.prefs.motion === "reduced" ? "true" : "false",
    "aria-label": "Reduce motion",
    onclick: (e) => {
      const next = state.prefs.motion === "reduced" ? "auto" : "reduced";
      setPrefs({ motion: next });
      e.currentTarget.setAttribute("aria-checked", next === "reduced" ? "true" : "false");
    },
  });
  wrap.append(row("Reduce motion", "Removes transitions and automatic previews. Also follows your operating system.", motionToggle));

  wrap.append(h("button.btn.btn--block", {
    type: "button", text: "Reset all settings to default",
    onclick: async () => {
      if (await confirm({ title: "Reset settings", message: "Every preference returns to its default. Your archive and stars are untouched.", confirmLabel: "Reset" })) {
        resetPrefs();
        toast("Settings reset");
      }
    },
  }));
  return wrap;
}

function playback() {
  const wrap = h("div.settings__group");
  wrap.append(
    row("Autoplay", "Play the centred video in the Watch feed.", toggle("autoplay")),
    row("Start muted", "Videos begin silent; unmute is one tap.", toggle("startMuted")),
    row("Loop", "Repeat a video instead of moving on.", toggle("loop")),
    row("Remember position", "Resume long videos where you stopped.", toggle("rememberProgress")),
    row("Mark as seen on open", "Opening an item counts as having seen it.", toggle("markViewedOnOpen")),
  );

  const speeds = [0.5, 1, 1.25, 1.5, 2];
  wrap.append(row("Default speed", "Applied to every video you open.",
    h("div.seg", speeds.map((s) => h("button.seg__item", {
      type: "button", role: "radio",
      "aria-checked": Number(state.prefs.defaultSpeed) === s ? "true" : "false",
      text: `${s}×`,
      onclick: (e) => {
        setPrefs({ defaultSpeed: s });
        for (const sibling of e.currentTarget.parentElement.children) {
          sibling.setAttribute("aria-checked", "false");
        }
        e.currentTarget.setAttribute("aria-checked", "true");
      },
    }))),
  ));
  return wrap;
}

function privacy() {
  const wrap = h("div.settings__group");

  wrap.append(row("Blur thumbnails", "Hides every thumbnail until you tap it. Useful on a shared screen.",
    toggle("blurMedia")));

  /* A PIN is a privacy curtain, not security: everything here ships to the
     browser, so anyone with the files can read the code. Saying so plainly is
     better than shipping a hard-coded password that implies otherwise. */
  const pinStatus = state.prefs.pin ? "On. This tab will ask for your PIN on reload." : "Off.";
  const pinRow = row("Screen lock", pinStatus,
    h("div.set-row__actions",
      h("button.btn.btn--sm", {
        type: "button", text: state.prefs.pin ? "Change" : "Set PIN",
        onclick: setPin,
      }),
      state.prefs.pin ? h("button.btn.btn--sm", {
        type: "button", text: "Remove",
        onclick: async () => {
          const ok = await confirm({
            title: "Remove screen lock",
            message: "Your archive will open without a PIN.",
            confirmLabel: "Remove", danger: true,
          });
          if (!ok) return;
          setPrefs({ pin: null });
          toast("Screen lock removed");
          openSettings("privacy");
        },
      }) : null,
    ),
  );
  wrap.append(pinRow);

  wrap.append(h("p.settings__note",
    icon("info", 15),
    h("span", { text: "A PIN stops a shoulder-surf, not an attacker: this app runs entirely in your browser, so its code is readable by anyone who has the files. It is not a substitute for locking your device." }),
  ));

  wrap.append(row("Dim things you have seen", "Fades tiles you have already opened.", toggle("showSeen")));
  return wrap;
}

async function setPin() {
  const sheet = overlay({ title: "Screen lock", size: "sm" });
  const input = h("input", {
    type: "password", inputmode: "numeric", autocomplete: "new-password",
    placeholder: "Choose a PIN", "aria-label": "New PIN", maxlength: "12",
  });
  const confirmInput = h("input", {
    type: "password", inputmode: "numeric", autocomplete: "new-password",
    placeholder: "Type it again", "aria-label": "Confirm PIN", maxlength: "12",
  });
  const error = h("p.settings__error", { role: "alert" });

  sheet.content.append(
    h("p.sheet__text", { text: "Pick a short code. It is stored only in this browser." }),
    h("div.field", { style: { marginTop: "12px" } }, icon("lock", 18), input),
    h("div.field", { style: { marginTop: "8px" } }, icon("lock", 18), confirmInput),
    error,
    h(".sheet__actions",
      h("button.btn", { type: "button", text: "Cancel", onclick: () => sheet.close() }),
      h("button.btn.btn--primary", {
        type: "button", text: "Save",
        onclick: () => {
          if (input.value.length < 3) { error.textContent = "Use at least three characters."; return; }
          if (input.value !== confirmInput.value) { error.textContent = "The two entries do not match."; return; }
          setPrefs({ pin: input.value });
          toast("Screen lock is on");
          sheet.close();
          openSettings("privacy");
        },
      }),
    ),
  );
  setTimeout(() => input.focus(), 60);
}

function data() {
  const s = stats();
  const wrap = h("div.settings__group");

  const facts = [
    ["Items", fmtCount(s.media)],
    ["Posts", fmtCount(s.posts)],
    ["Creators", fmtCount(s.creators)],
    ["Starred", fmtCount(s.starred)],
    ["Seen", `${s.pctSeen}%`],
    ["Source", state.source === "none" ? "—" : state.source],
  ];
  wrap.append(h("div.settings__facts",
    facts.map(([label, value]) => h("div.settings__fact",
      h("b.t-num", { text: value }), h("small", { text: label }),
    )),
  ));

  wrap.append(
    h("button.btn.btn--block", {
      type: "button",
      onclick: () => { import("./manage.js").then((m) => m.openManage()); },
    }, icon("database", 17), "Import and export"),
    h("button.btn.btn--block", {
      type: "button",
      onclick: async () => {
        const ok = await confirm({
          title: "Clear seen history",
          message: `${fmtCount(s.seen)} items will look unopened again. Nothing is deleted.`,
          confirmLabel: "Clear history", danger: true,
        });
        if (!ok) return;
        state.library.viewed = {};
        state.library.progress = {};
        import("../core/store.js").then(({ setMany, KEYS }) =>
          setMany({ [KEYS.library]: state.library }));
        toast("History cleared");
      },
    }, icon("refresh", 17), "Clear seen history"),
  );
  return wrap;
}
