const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("whisperBar", {
  onState: (callback) => {
    ipcRenderer.on("state", (_event, payload) => callback(payload));
  },
  requestClose: () => ipcRenderer.send("pill:close"),
  requestExpand: () => ipcRenderer.send("pill:expand"),
  requestCollapse: () => ipcRenderer.send("pill:collapse"),
  copyText: (text) => ipcRenderer.send("pill:copy", text),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send("pill:setIgnoreMouseEvents", ignore),

  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (patch) => ipcRenderer.invoke("config:set", patch),
  listDevices: () => ipcRenderer.invoke("devices:list"),
  onDevices: (callback) => {
    ipcRenderer.on("devices", (_event, payload) => callback(payload));
  },
  beginShortcutCapture: () => ipcRenderer.send("shortcut:beginCapture"),
  onShortcutCaptured: (callback) => {
    ipcRenderer.on("shortcut:captured", (_event, accelerator) => callback(accelerator));
  },

  minimizeWindow: () => ipcRenderer.send("win:minimize"),
  closeWindow: () => ipcRenderer.send("win:close"),

  onSetupLog: (callback) => {
    ipcRenderer.on("setup:log", (_event, line) => callback(line));
  },
  onSetupDone: (callback) => {
    ipcRenderer.on("setup:done", (_event, result) => callback(result));
  },
  closeSetupWindow: () => ipcRenderer.send("setup:close"),
});
