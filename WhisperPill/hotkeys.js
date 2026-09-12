const { uIOhook, UiohookKey } = require("uiohook-napi");

const MODIFIER_ALIASES = {
  control: ["Ctrl", "CtrlRight"],
  ctrl: ["Ctrl", "CtrlRight"],
  commandorcontrol: ["Ctrl", "CtrlRight"],
  cmdorctrl: ["Ctrl", "CtrlRight"],
  shift: ["Shift", "ShiftRight"],
  alt: ["Alt", "AltRight"],
  option: ["Alt", "AltRight"],
  altgr: ["AltRight"],
  super: ["Meta", "MetaRight"],
  meta: ["Meta", "MetaRight"],
  command: ["Meta", "MetaRight"],
  cmd: ["Meta", "MetaRight"],
};

const KEY_ALIASES = {
  space: "Space",
  esc: "Escape",
  escape: "Escape",
  return: "Enter",
  enter: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};

// Canonical modifier name for a given keycode (either side), used when
// rendering a captured combo back into an accelerator string.
const CODE_TO_MODIFIER_NAME = {};
for (const [name, codes] of Object.entries(MODIFIER_ALIASES)) {
  // only take the "nice" aliases (control/shift/alt/super), skip synonyms
}
CODE_TO_MODIFIER_NAME[UiohookKey.Ctrl] = "Control";
CODE_TO_MODIFIER_NAME[UiohookKey.CtrlRight] = "Control";
CODE_TO_MODIFIER_NAME[UiohookKey.Shift] = "Shift";
CODE_TO_MODIFIER_NAME[UiohookKey.ShiftRight] = "Shift";
CODE_TO_MODIFIER_NAME[UiohookKey.Alt] = "Alt";
CODE_TO_MODIFIER_NAME[UiohookKey.AltRight] = "Alt";
CODE_TO_MODIFIER_NAME[UiohookKey.Meta] = "Super";
CODE_TO_MODIFIER_NAME[UiohookKey.MetaRight] = "Super";

const MODIFIER_CODES = new Set(Object.keys(CODE_TO_MODIFIER_NAME).map(Number));

// Reverse map code -> friendly main-key name (skip Numpad*/modifier duplicates).
const CODE_TO_KEY_NAME = {};
for (const [name, code] of Object.entries(UiohookKey)) {
  if (MODIFIER_CODES.has(code)) continue;
  if (name.startsWith("Numpad")) continue;
  if (CODE_TO_KEY_NAME[code]) continue;
  CODE_TO_KEY_NAME[code] = name;
}

function parseAccelerator(accelerator) {
  const parts = String(accelerator || "")
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  const modifierGroups = [];
  let mainKeyCode = null;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (MODIFIER_ALIASES[lower]) {
      modifierGroups.push(MODIFIER_ALIASES[lower].map((n) => UiohookKey[n]));
      continue;
    }
    let keyName = KEY_ALIASES[lower];
    if (!keyName) {
      keyName = /^[0-9]$/.test(part) ? part : part.toUpperCase();
    }
    if (UiohookKey[keyName] !== undefined) {
      mainKeyCode = UiohookKey[keyName];
    }
  }
  return { modifierGroups, mainKeyCode };
}

function comboToAccelerator(pressedSet) {
  const modifierNames = [];
  let mainKeyName = null;
  const seenModifiers = new Set();
  for (const code of pressedSet) {
    if (MODIFIER_CODES.has(code)) {
      const name = CODE_TO_MODIFIER_NAME[code];
      if (!seenModifiers.has(name)) {
        seenModifiers.add(name);
        modifierNames.push(name);
      }
    } else if (CODE_TO_KEY_NAME[code]) {
      mainKeyName = CODE_TO_KEY_NAME[code];
    }
  }
  if (!mainKeyName) return null;
  return [...modifierNames, mainKeyName].join("+");
}

class HotkeyEngine {
  constructor({ onStart, onStop, onEscape, getConfig }) {
    this.onStart = onStart;
    this.onStop = onStop;
    this.onEscape = onEscape;
    this.getConfig = getConfig;
    this.pressed = new Set();
    this.recording = false;
    this.toggleArmed = true;
    this.capturing = null; // callback while capturing a new shortcut

    uIOhook.on("keydown", (e) => this._onKeyDown(e.keycode));
    uIOhook.on("keyup", (e) => this._onKeyUp(e.keycode));
    uIOhook.start();
  }

  destroy() {
    try {
      uIOhook.stop();
    } catch (_) {
      /* noop */
    }
  }

  captureNextCombo(callback) {
    this.capturing = callback;
  }

  // Da chiamare quando la registrazione viene interrotta da un'azione esterna
  // (Escape, click sulla X) mentre il tasto di attivazione e' ancora fisicamente
  // premuto: senza questo, al rilascio l'engine chiamerebbe di nuovo onStop
  // pur non essendo piu' in ascolto dal punto di vista dell'app.
  forceStop() {
    this.recording = false;
    this.toggleArmed = true;
  }

  cancelCapture() {
    this.capturing = null;
  }

  _isComboActive(parsed) {
    if (parsed.mainKeyCode === null) return false;
    if (!this.pressed.has(parsed.mainKeyCode)) return false;
    return parsed.modifierGroups.every((group) => group.some((c) => this.pressed.has(c)));
  }

  _onKeyDown(keycode) {
    this.pressed.add(keycode);

    if (this.capturing) {
      if (!MODIFIER_CODES.has(keycode)) {
        const accelerator = comboToAccelerator(this.pressed);
        const cb = this.capturing;
        this.capturing = null;
        if (accelerator) cb(accelerator);
      }
      return;
    }

    if (keycode === UiohookKey.Escape && this.onEscape) {
      this.onEscape();
    }

    const config = this.getConfig();
    if (!config || config.activationMode === "trayOnly") return;
    const parsed = parseAccelerator(config.shortcut);
    if (!this._isComboActive(parsed)) return;

    if (config.activationMode === "hold") {
      if (!this.recording) {
        this.recording = true;
        this.onStart();
      }
    } else if (config.activationMode === "toggle") {
      if (this.toggleArmed) {
        this.toggleArmed = false;
        if (this.recording) {
          this.recording = false;
          this.onStop();
        } else {
          this.recording = true;
          this.onStart();
        }
      }
    }
  }

  _onKeyUp(keycode) {
    this.pressed.delete(keycode);

    const config = this.getConfig();
    if (!config || config.activationMode === "trayOnly") return;
    const parsed = parseAccelerator(config.shortcut);

    if (config.activationMode === "hold") {
      if (this.recording && !this._isComboActive(parsed)) {
        this.recording = false;
        this.onStop();
      }
    } else if (config.activationMode === "toggle") {
      if (!this._isComboActive(parsed)) {
        this.toggleArmed = true;
      }
    }
  }
}

module.exports = { HotkeyEngine, parseAccelerator, comboToAccelerator };
