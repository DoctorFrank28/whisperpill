const { app, BrowserWindow, Tray, Menu, ipcMain, screen, clipboard, nativeTheme, nativeImage } = require("electron");
const path = require("path");
const { exec } = require("child_process");

const { store } = require("./config");
const { SttBridge } = require("./sttBridge");
const { HotkeyEngine } = require("./hotkeys");

const PILL_WIDTH = 560;
const PILL_HEIGHT = 340;
const PILL_BOTTOM_MARGIN = 48;

let pillWindow = null;
let settingsWindow = null;
let tray = null;
let hotkeys = null;
const sttBridge = new SttBridge();

let currentState = { kind: "idle" };
let hideTimer = null;
let recordingStartedAt = null;

function getConfig() {
  return store.store;
}

function applySttConfig() {
  const cfg = getConfig();
  sttBridge.setConfig({
    language: cfg.language,
    model: cfg.modelSize,
    device: cfg.micDevice,
  });
}

function applyThemeSource() {
  const cfg = getConfig();
  nativeTheme.themeSource = cfg.theme === "auto" ? "system" : cfg.theme;
}

function applyLoginItem() {
  const cfg = getConfig();
  app.setLoginItemSettings({ openAtLogin: !!cfg.launchAtStartup });
}

function createPillWindow() {
  pillWindow = new BrowserWindow({
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  pillWindow.setAlwaysOnTop(true, "screen-saver");
  pillWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  positionPillWindow();
  pillWindow.loadFile(path.join(__dirname, "renderer", "pill.html"));
  if (process.env.WHISPERBAR_DEBUG_CONSOLE) {
    pillWindow.webContents.on("console-message", (_e, level, message) => console.log("[pill]", level, message));
  }

  screen.on("display-metrics-changed", positionPillWindow);
}

function positionPillWindow() {
  if (!pillWindow) return;
  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.round(workArea.x + (workArea.width - PILL_WIDTH) / 2);
  const y = Math.round(workArea.y + workArea.height - PILL_HEIGHT - PILL_BOTTOM_MARGIN);
  pillWindow.setBounds({ x, y, width: PILL_WIDTH, height: PILL_HEIGHT });
}

function sendPillState(state) {
  currentState = state;
  if (pillWindow && !pillWindow.isDestroyed()) {
    pillWindow.webContents.send("state", state);
  }
}

function showPill() {
  if (pillWindow && !pillWindow.isVisible()) {
    pillWindow.showInactive();
  }
}

function hidePill() {
  clearHideTimer();
  sendPillState({ kind: "idle" });
  if (pillWindow && pillWindow.isVisible()) {
    pillWindow.hide();
  }
}

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function scheduleAutoHide(ms) {
  clearHideTimer();
  hideTimer = setTimeout(() => hidePill(), ms);
}

// ---- recording / transcription flow ----

function beginListening() {
  clearHideTimer();
  recordingStartedAt = Date.now();
  showPill();
  sendPillState({ kind: "listening", startedAt: recordingStartedAt, activationHint: activationHintText() });
  sttBridge.startRecording();
}

function endListening() {
  sendPillState({ kind: "processing" });
  sttBridge.stopRecording();
}

function activationHintText() {
  const cfg = getConfig();
  if (cfg.activationMode === "hold") return `${cfg.shortcut} tenuto premuto`;
  if (cfg.activationMode === "toggle") return `${cfg.shortcut} per fermare`;
  return "Click sull'icona in tray per fermare";
}

sttBridge.on("message", (msg) => {
  const cfg = getConfig();
  switch (msg.event) {
    case "recording_stopped":
      break;
    case "transcribing":
      sendPillState({ kind: "processing" });
      break;
    case "result": {
      const text = (msg.text || "").trim();
      if (!text) {
        sendPillState({ kind: "error", message: "Nessun testo riconosciuto." });
        scheduleAutoHide(2200);
        break;
      }
      const didClipboard = !!cfg.outputs.clipboard;
      const didAutotype = !!cfg.outputs.autotype;
      if (didClipboard || didAutotype) {
        clipboard.writeText(text);
      }
      if (didAutotype) {
        simulatePaste();
      }
      if (cfg.outputs.showInBar) {
        sendPillState({
          kind: "result",
          text,
          words: msg.words,
          duration: msg.duration,
          elapsed: msg.elapsed,
          expanded: false,
          copied: didClipboard,
          typed: didAutotype,
        });
        scheduleAutoHide(6000);
      } else {
        sendPillState({ kind: "flash", copied: didClipboard, typed: didAutotype });
        scheduleAutoHide(1200);
      }
      break;
    }
    case "error":
      sendPillState({ kind: "error", message: msg.message });
      scheduleAutoHide(2500);
      break;
    case "devices":
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send("devices", msg.list);
      }
      break;
    default:
      break;
  }
});

sttBridge.on("error", (message) => {
  sendPillState({ kind: "error", message });
  scheduleAutoHide(3000);
});

function simulatePaste() {
  // Il pill non ruba mai il focus (focusable:false), quindi la finestra attiva
  // resta quella dell'utente: un Ctrl+V simulato incolla li' il testo appena copiato.
  const script = "Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 60; [System.Windows.Forms.SendKeys]::SendWait('^v')";
  exec(`powershell -NoProfile -WindowStyle Hidden -Command "${script}"`, () => {});
}

// ---- tray ----

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "assets", "icon.png"));
  tray = new Tray(icon);
  tray.setToolTip("WhisperBar");
  updateTrayMenu();
  tray.on("click", () => {
    const cfg = getConfig();
    if (cfg.activationMode !== "trayOnly") {
      openSettingsWindow();
      return;
    }
    if (currentState.kind === "listening") {
      endListening();
    } else if (currentState.kind === "idle" || currentState.kind === "result" || currentState.kind === "flash") {
      beginListening();
    }
  });
}

function updateTrayMenu() {
  const menu = Menu.buildFromTemplate([
    { label: "Impostazioni", click: () => openSettingsWindow() },
    { type: "separator" },
    { label: "Esci", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// ---- settings window ----

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 940,
    height: 700,
    minWidth: 760,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: "#17191D",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, "renderer", "settings.html"));
  settingsWindow.once("ready-to-show", () => settingsWindow.show());
  if (process.env.WHISPERBAR_DEBUG_CONSOLE) {
    settingsWindow.webContents.on("console-message", (_e, level, message) => console.log("[settings]", level, message));
  }
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

// ---- IPC ----

ipcMain.on("pill:close", () => hidePill());

ipcMain.on("pill:expand", () => {
  if (currentState.kind === "result") {
    clearHideTimer();
    sendPillState({ ...currentState, expanded: true });
  }
});

ipcMain.on("pill:collapse", () => {
  if (currentState.kind === "result") {
    sendPillState({ ...currentState, expanded: false });
    scheduleAutoHide(4000);
  }
});

ipcMain.on("pill:copy", (_e, text) => {
  if (text) clipboard.writeText(text);
});

ipcMain.on("pill:setIgnoreMouseEvents", (_e, ignore) => {
  if (pillWindow) pillWindow.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.handle("config:get", () => getConfig());

ipcMain.handle("config:set", (_e, patch) => {
  const prev = getConfig();
  const next = { ...prev, ...patch };
  if (patch.outputs) next.outputs = { ...prev.outputs, ...patch.outputs };
  store.set(next);

  if (patch.theme) applyThemeSource();
  if ("launchAtStartup" in patch) applyLoginItem();
  if (patch.language || patch.modelSize || "micDevice" in patch) applySttConfig();

  return getConfig();
});

ipcMain.handle("devices:list", () => {
  sttBridge.listDevices();
  return true;
});

ipcMain.on("shortcut:beginCapture", (event) => {
  hotkeys.captureNextCombo((accelerator) => {
    store.set("shortcut", accelerator);
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send("shortcut:captured", accelerator);
    }
  });
});

ipcMain.on("win:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});
ipcMain.on("win:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

// ---- app lifecycle ----

app.whenReady().then(() => {
  applyThemeSource();
  applyLoginItem();

  createPillWindow();
  createTray();
  if (process.env.WHISPERBAR_DEBUG_OPEN_SETTINGS) openSettingsWindow();

  sttBridge.start();
  applySttConfig();

  hotkeys = new HotkeyEngine({
    getConfig,
    onStart: beginListening,
    onStop: endListening,
    onEscape: () => {
      if (pillWindow && pillWindow.isVisible()) hidePill();
    },
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createPillWindow();
  });
});

app.on("window-all-closed", (e) => {
  // WhisperBar vive nella tray: non chiudere l'app quando si chiude una finestra.
  e.preventDefault?.();
});

app.on("before-quit", () => {
  if (hotkeys) hotkeys.destroy();
  sttBridge.shutdown();
});
