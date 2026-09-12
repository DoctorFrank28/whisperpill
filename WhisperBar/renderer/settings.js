let config = null;

function byId(id) {
  return document.getElementById(id);
}

async function init() {
  config = await window.whisperBar.getConfig();
  renderShortcutChips(config.shortcut);
  renderActivationMode(config.activationMode);
  renderToggle("outputs.clipboard", config.outputs.clipboard);
  renderToggle("outputs.autotype", config.outputs.autotype);
  renderToggle("outputs.showInBar", config.outputs.showInBar);
  renderToggle("launchAtStartup", config.launchAtStartup);
  byId("language-select").value = config.language;
  renderSegPills("model-size", config.modelSize);
  renderSegPills("theme-select", config.theme);

  window.whisperBar.listDevices();
}

function renderShortcutChips(accelerator) {
  const container = byId("shortcut-chips");
  container.innerHTML = "";
  const parts = accelerator.split("+");
  parts.forEach((part, i) => {
    if (i > 0) {
      const plus = document.createElement("div");
      plus.className = "key-plus";
      plus.textContent = "+";
      container.appendChild(plus);
    }
    const chip = document.createElement("div");
    chip.className = "key-chip";
    chip.textContent = part;
    container.appendChild(chip);
  });
  const btn = document.createElement("button");
  btn.className = "rebind-btn";
  btn.id = "rebind-btn";
  btn.textContent = "Riassegna";
  btn.style.marginLeft = "6px";
  btn.addEventListener("click", beginRebind);
  container.appendChild(btn);
}

function beginRebind() {
  const btn = byId("rebind-btn");
  btn.classList.add("capturing");
  btn.textContent = "Premi la combinazione…";
  window.whisperBar.beginShortcutCapture();
}

window.whisperBar.onShortcutCaptured((accelerator) => {
  config.shortcut = accelerator;
  renderShortcutChips(accelerator);
});

function renderActivationMode(value) {
  document.querySelectorAll("#activation-mode .seg-card").forEach((el) => {
    el.classList.toggle("selected", el.dataset.value === value);
  });
}

function renderSegPills(containerId, value) {
  document.querySelectorAll(`#${containerId} .seg-pill`).forEach((el) => {
    el.classList.toggle("selected", el.dataset.value === value);
  });
}

function getByPath(obj, path) {
  return path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
}

function renderToggle(path, value) {
  const el = document.querySelector(`.switch[data-toggle="${path}"]`);
  if (el) el.classList.toggle("on", !!value);
}

async function patchConfig(patch) {
  config = await window.whisperBar.setConfig(patch);
}

// ---- event wiring ----

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
    item.classList.add("active");
    byId(`section-${item.dataset.section}`).classList.add("active");
  });
});

document.querySelectorAll(".switch[data-toggle]").forEach((el) => {
  el.addEventListener("click", () => {
    const path = el.dataset.toggle;
    const next = !getByPath(config, path);
    el.classList.toggle("on", next);
    if (path.startsWith("outputs.")) {
      const key = path.split(".")[1];
      patchConfig({ outputs: { [key]: next } });
    } else {
      patchConfig({ [path]: next });
    }
  });
});

document.querySelectorAll("#activation-mode .seg-card").forEach((el) => {
  el.addEventListener("click", () => {
    renderActivationMode(el.dataset.value);
    patchConfig({ activationMode: el.dataset.value });
  });
});

document.querySelectorAll("#model-size .seg-pill").forEach((el) => {
  el.addEventListener("click", () => {
    renderSegPills("model-size", el.dataset.value);
    patchConfig({ modelSize: el.dataset.value });
  });
});

document.querySelectorAll("#theme-select .seg-pill").forEach((el) => {
  el.addEventListener("click", () => {
    renderSegPills("theme-select", el.dataset.value);
    patchConfig({ theme: el.dataset.value });
  });
});

byId("language-select").addEventListener("change", (e) => {
  patchConfig({ language: e.target.value });
});

byId("mic-select").addEventListener("change", (e) => {
  const value = e.target.value === "" ? null : Number(e.target.value);
  patchConfig({ micDevice: value });
});

window.whisperBar.onDevices((devices) => {
  const select = byId("mic-select");
  const current = config.micDevice;
  select.innerHTML = '<option value="">Predefinito</option>';
  devices.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = String(d.index);
    opt.textContent = d.name;
    select.appendChild(opt);
  });
  if (current != null) select.value = String(current);
});

byId("win-min").addEventListener("click", () => window.whisperBar.minimizeWindow());
byId("win-close").addEventListener("click", () => window.whisperBar.closeWindow());

init();
