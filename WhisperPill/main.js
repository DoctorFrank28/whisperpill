const { app, BrowserWindow, Tray, Menu, ipcMain, screen, clipboard, nativeTheme, nativeImage, dialog, globalShortcut } = require("electron");
const path = require("path");
const { exec } = require("child_process");

const { store } = require("./config");
const { SttBridge, MODEL_SIZES, anyModelDownloaded } = require("./sttBridge");
const { HotkeyEngine } = require("./hotkeys");
const { whisperEnvironmentExists, setupScriptExists, runSetup, SETUP_SCRIPT } = require("./setupRunner");

const PILL_WIDTH = 560;
const PILL_HEIGHT = 340;
const PILL_BOTTOM_MARGIN = 48;

let pillWindow = null;
let settingsWindow = null;
let setupWindow = null;
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

// uiohook osserva i tasti ma non li "consuma": senza questo, la combinazione
// arriverebbe anche all'app in primo piano (es. inserendo uno spazio in un
// editor). Registrarla anche con globalShortcut la riserva a livello di
// sistema (RegisterHotKey su Windows), impedendole di raggiungere le altre
// finestre - il rilascio del tasto per il push-to-talk resta gestito da uiohook.
function updateHotkeyReservation() {
  globalShortcut.unregisterAll();
  const cfg = getConfig();
  if (cfg.activationMode === "trayOnly") return;
  try {
    const ok = globalShortcut.register(cfg.shortcut, () => {});
    if (!ok) console.warn(`[hotkeys] impossibile riservare "${cfg.shortcut}" (gia' in uso da un'altra app?)`);
  } catch (_) {
    // Combinazione non esprimibile come accelerator Electron (es. include un
    // tasto freccia): uiohook continua comunque a gestire l'attivazione,
    // solo senza la riserva a livello di sistema operativo.
  }
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
  if (process.env.WHISPERPILL_DEBUG_CONSOLE) {
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
  if (!pillWindow) return;
  // Ri-asserire alwaysOnTop e portarla in cima ad ogni comparsa: dopo un hide()
  // Windows a volte lascia la finestra dietro ad app che hanno preso il focus
  // nel frattempo, anche se il flag alwaysOnTop era gia' impostato.
  pillWindow.setAlwaysOnTop(true, "screen-saver");
  if (!pillWindow.isVisible()) {
    pillWindow.showInactive();
  }
  pillWindow.moveTop();
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

let hoverPaused = false;
let pendingHideMs = null;

function scheduleAutoHide(ms) {
  pendingHideMs = ms;
  clearHideTimer();
  if (hoverPaused) return;
  hideTimer = setTimeout(() => hidePill(), ms);
}

// Mentre il mouse e' sopra la pillola, il countdown resta in pausa: altrimenti
// il risultato rischia di sparire proprio mentre lo si sta leggendo o copiando.
ipcMain.on("pill:hoverEnter", () => {
  hoverPaused = true;
  clearHideTimer();
});

ipcMain.on("pill:hoverLeave", () => {
  hoverPaused = false;
  const kind = currentState.kind;
  const eligible = kind === "error" || kind === "flash" || (kind === "result" && !currentState.expanded);
  if (eligible && pendingHideMs != null) {
    scheduleAutoHide(pendingHideMs);
  }
});

// ---- recording / transcription flow ----

// Molti si fermano un attimo prima di aver davvero finito di parlare: un
// piccolo margine dopo il rilascio del tasto evita di tagliare l'ultima
// parola. Se si ripreme subito, la registrazione prosegue senza interruzioni.
const STOP_DELAY_MS = 450;
let stopDelayTimer = null;

function beginListening() {
  if (stopDelayTimer) {
    clearTimeout(stopDelayTimer);
    stopDelayTimer = null;
    return;
  }
  clearHideTimer();
  recordingStartedAt = Date.now();
  showPill();
  sendPillState({ kind: "listening", startedAt: recordingStartedAt, activationHint: activationHintText() });
  sttBridge.startRecording();
}

function endListening() {
  clearTimeout(stopDelayTimer);
  stopDelayTimer = setTimeout(() => {
    stopDelayTimer = null;
    sendPillState({ kind: "processing", model: getConfig().modelSize });
    sttBridge.stopRecording();
  }, STOP_DELAY_MS);
}

// Interrompe ascolto/elaborazione in corso: la registrazione viene scartata
// (o, se la trascrizione era gia' partita, il suo risultato verra' ignorato
// quando arriva) e la pillola torna subito a riposo.
function abortCurrent() {
  clearTimeout(stopDelayTimer);
  stopDelayTimer = null;
  if (hotkeys) hotkeys.forceStop();
  sttBridge.abort();
  hidePill();
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
      sendPillState({ kind: "processing", model: msg.model });
      break;
    case "result": {
      const text = (msg.text || "").trim();
      if (!text) {
        sendPillState({ kind: "error", message: "Nessun testo riconosciuto." });
        scheduleAutoHide(3000);
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
          model: msg.model,
          expanded: false,
          copied: didClipboard,
          typed: didAutotype,
        });
        scheduleAutoHide(9000);
      } else {
        sendPillState({ kind: "flash", copied: didClipboard, typed: didAutotype });
        scheduleAutoHide(1800);
      }
      break;
    }
    case "error":
      sendPillState({ kind: "error", message: msg.message });
      scheduleAutoHide(2500);
      break;
    case "aborted":
      // La UI e' gia' tornata a riposo lato Electron non appena l'utente ha
      // chiesto l'abort; questo e' solo l'ack del backend, nessuna azione.
      break;
    case "devices":
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send("devices", msg.list);
      }
      break;
    case "models":
      broadcastToManagers("models", msg.list);
      break;
    case "model_download_start":
      broadcastToManagers("models:progress", { model: msg.model, percent: 0 });
      if (currentState.kind === "processing") {
        sendPillState({ kind: "processing", downloading: msg.model, percent: 0 });
      }
      break;
    case "model_download_progress":
      broadcastToManagers("models:progress", { model: msg.model, percent: msg.percent });
      if (currentState.kind === "processing") {
        sendPillState({ kind: "processing", downloading: msg.model, percent: msg.percent });
      }
      break;
    case "model_download_done":
      broadcastToManagers("models:done", { model: msg.model, success: msg.success, message: msg.message });
      if (currentState.kind === "processing" && !msg.success) {
        sendPillState({ kind: "error", message: msg.message || "Impossibile scaricare il modello." });
        scheduleAutoHide(3000);
      }
      break;
    case "model_deleted":
      broadcastToManagers("models:deleted", { model: msg.model });
      break;
    default:
      break;
  }
});

function broadcastToManagers(channel, payload) {
  [settingsWindow, setupWindow].forEach((win) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  });
}

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
  tray.setToolTip("WhisperPill");
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

// ---- ambiente whisper (setup al primo avvio) ----

function openSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 560,
    height: 480,
    frame: false,
    resizable: false,
    show: false,
    backgroundColor: "#17191D",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setupWindow._wbReady = false;
  setupWindow.setMenuBarVisibility(false);
  setupWindow.loadFile(path.join(__dirname, "renderer", "setup.html"));
  setupWindow.once("ready-to-show", () => setupWindow.show());
  setupWindow.webContents.once("did-finish-load", () => {
    if (setupWindow) setupWindow._wbReady = true;
  });
  if (process.env.WHISPERPILL_DEBUG_CONSOLE) {
    setupWindow.webContents.on("console-message", (_e, level, message) => console.log("[setup]", level, message));
  }
  setupWindow.on("closed", () => {
    setupWindow = null;
  });
  return setupWindow;
}

function sendToSetupWindow(channel, payload) {
  if (!setupWindow || setupWindow.isDestroyed()) return;
  if (setupWindow._wbReady) {
    setupWindow.webContents.send(channel, payload);
  } else {
    setupWindow.webContents.once("did-finish-load", () => {
      if (setupWindow && !setupWindow.isDestroyed()) setupWindow.webContents.send(channel, payload);
    });
  }
}

// Ritorna true se l'ambiente Python e' pronto all'uso (gia' presente o appena installato).
async function ensureWhisperEnvironment() {
  if (whisperEnvironmentExists()) return true;

  if (!setupScriptExists()) {
    dialog.showErrorBox(
      "Ambiente whisper non trovato",
      `Non trovo ne' l'ambiente Python ne' lo script di setup in:\n${SETUP_SCRIPT}\n\nReinstalla whisper-ai manualmente prima di usare WhisperPill.`
    );
    return false;
  }

  const choice = dialog.showMessageBoxSync({
    type: "question",
    title: "WhisperPill",
    message: "L'ambiente di trascrizione non e' ancora installato.",
    detail: "Vuoi installarlo ora? Verranno scaricati alcuni pacchetti Python (serve una connessione internet).",
    buttons: ["Installa ora", "Piu' tardi"],
    defaultId: 0,
    cancelId: 1,
  });
  if (choice !== 0) return false;

  const win = openSetupWindow();
  const emitter = runSetup();
  emitter.on("line", (line) => {
    if (win && !win.isDestroyed()) win.webContents.send("setup:log", line);
  });

  const result = await new Promise((resolve) => {
    emitter.on("done", (r) => {
      if (win && !win.isDestroyed()) win.webContents.send("setup:done", r);
      resolve(r);
    });
  });
  return result.success;
}

// Al primo avvio con l'ambiente pronto ma nessun modello scaricato, chiede quali
// scaricare. Non blocca l'avvio dell'app: la finestra e' indipendente.
function maybePromptForModels() {
  if (store.get("modelsPromptShown")) return;
  if (!whisperEnvironmentExists()) return;
  store.set("modelsPromptShown", true);
  if (anyModelDownloaded()) return;

  if (!setupWindow || setupWindow.isDestroyed()) openSetupWindow();
  sendToSetupWindow("setup:phase", "models");
}

ipcMain.on("setup:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

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
  if (process.env.WHISPERPILL_DEBUG_CONSOLE) {
    settingsWindow.webContents.on("console-message", (_e, level, message) => console.log("[settings]", level, message));
  }
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

// ---- IPC ----

ipcMain.on("pill:close", () => hidePill());
ipcMain.on("pill:abort", () => abortCurrent());

ipcMain.on("pill:expand", () => {
  if (currentState.kind === "result") {
    clearHideTimer();
    sendPillState({ ...currentState, expanded: true });
  }
});

ipcMain.on("pill:collapse", () => {
  if (currentState.kind === "result") {
    sendPillState({ ...currentState, expanded: false });
    scheduleAutoHide(6000);
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
  if (patch.activationMode) updateHotkeyReservation();

  return getConfig();
});

ipcMain.handle("devices:list", () => {
  sttBridge.listDevices();
  return true;
});

ipcMain.handle("models:list", () => {
  sttBridge.listModels();
  return true;
});
ipcMain.on("models:download", (_e, size) => sttBridge.downloadModel(size));
ipcMain.on("models:delete", (_e, size) => sttBridge.deleteModel(size));

ipcMain.on("shortcut:beginCapture", (event) => {
  hotkeys.captureNextCombo((accelerator) => {
    store.set("shortcut", accelerator);
    updateHotkeyReservation();
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

app.whenReady().then(async () => {
  applyThemeSource();
  applyLoginItem();

  createPillWindow();
  createTray();
  if (process.env.WHISPERPILL_DEBUG_OPEN_SETTINGS) openSettingsWindow();

  const envReady = await ensureWhisperEnvironment();

  sttBridge.start();
  applySttConfig();

  if (envReady) maybePromptForModels();

  hotkeys = new HotkeyEngine({
    getConfig,
    onStart: beginListening,
    onStop: endListening,
    onEscape: () => {
      if (!pillWindow || !pillWindow.isVisible()) return;
      if (currentState.kind === "listening" || currentState.kind === "processing") {
        abortCurrent();
      } else {
        hidePill();
      }
    },
  });
  updateHotkeyReservation();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createPillWindow();
  });
});

app.on("window-all-closed", (e) => {
  // WhisperPill vive nella tray: non chiudere l'app quando si chiude una finestra.
  e.preventDefault?.();
});

app.on("before-quit", () => {
  if (hotkeys) hotkeys.destroy();
  globalShortcut.unregisterAll();
  sttBridge.shutdown();
});
