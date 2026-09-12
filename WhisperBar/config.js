const Store = require("electron-store");

const defaults = {
  shortcut: "Control+Shift+Space",
  activationMode: "hold", // "hold" | "toggle" | "trayOnly"
  outputs: {
    clipboard: true,
    autotype: true,
    showInBar: true,
  },
  language: "it", // "it" | "en" | "auto"
  modelSize: "small", // tiny | base | small | medium | large-v3
  micDevice: null, // null = default device, otherwise sounddevice index
  launchAtStartup: false,
  theme: "auto", // "auto" | "light" | "dark"
  modelsPromptShown: false,
};

const store = new Store({ defaults });

module.exports = { store, defaults };
