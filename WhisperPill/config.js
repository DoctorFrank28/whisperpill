const Store = require("electron-store");

const defaults = {
  shortcut: "Control+Alt+Space",
  activationMode: "hold", // "hold" | "toggle" | "trayOnly"
  outputs: {
    clipboard: true,
    autotype: true,
    showInBar: true,
  },
  language: "it", // lingua di trascrizione: "it" | "en" | "auto"
  uiLanguage: "auto", // lingua dell'interfaccia: "auto" | "it" | "en"
  modelSize: "small", // tiny | base | small | medium | large-v3
  computeDevice: "auto", // motore di calcolo: "auto" | "cpu" | "gpu"
  micDevice: null, // null = default device, otherwise sounddevice index
  launchAtStartup: false,
  theme: "auto", // "auto" | "light" | "dark"
  modelsPromptShown: false,
};

const store = new Store({ defaults });

module.exports = { store, defaults };
