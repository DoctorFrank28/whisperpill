let config = null;
const MODEL_INFO = {
  tiny: { desc: "Piu' veloce, meno preciso" },
  base: { desc: "Veloce" },
  small: { desc: "Bilanciato (consigliato)" },
  medium: { desc: "Preciso, piu' lento" },
  "large-v3": { desc: "Massima precisione, lento" },
};
let modelsState = [];

function byId(id) {
  return document.getElementById(id);
}

async function init() {
  config = await window.whisperPill.getConfig();
  renderShortcutChips(config.shortcut);
  renderActivationMode(config.activationMode);
  renderToggle("outputs.clipboard", config.outputs.clipboard);
  renderToggle("outputs.autotype", config.outputs.autotype);
  renderToggle("outputs.showInBar", config.outputs.showInBar);
  renderToggle("launchAtStartup", config.launchAtStartup);
  byId("language-select").value = config.language;
  renderSegPills("model-size", config.modelSize);
  renderSegPills("theme-select", config.theme);

  window.whisperPill.listDevices();
  window.whisperPill.listModels();
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
  window.whisperPill.beginShortcutCapture();
}

window.whisperPill.onShortcutCaptured((accelerator) => {
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
  config = await window.whisperPill.setConfig(patch);
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

window.whisperPill.onDevices((devices) => {
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

byId("win-min").addEventListener("click", () => window.whisperPill.minimizeWindow());
byId("win-close").addEventListener("click", () => window.whisperPill.closeWindow());

// ---- gestione modelli ----

function renderModelsManageList() {
  const container = byId("models-manage-list");
  container.innerHTML = "";
  modelsState.forEach((m) => {
    const info = MODEL_INFO[m.size] || { desc: "" };
    const row = document.createElement("div");
    row.className = "model-row";

    const infoEl = document.createElement("div");
    infoEl.className = "model-info";
    infoEl.innerHTML = `<div class="model-name">${m.size}</div><div class="model-desc-small">${info.desc}</div>`;

    const sizeEl = document.createElement("div");
    sizeEl.className = "model-size";
    sizeEl.textContent = m.approxMB >= 1000 ? `~${(m.approxMB / 1000).toFixed(1)} GB` : `~${m.approxMB} MB`;

    row.append(infoEl, sizeEl);

    if (m._progress != null) {
      const percentEl = document.createElement("div");
      percentEl.className = "model-percent";
      percentEl.textContent = `${m._progress}%`;
      const bar = document.createElement("div");
      bar.className = "model-progress";
      const fill = document.createElement("div");
      fill.style.width = `${m._progress}%`;
      bar.appendChild(fill);
      row.append(bar, percentEl);
    } else if (m.downloaded) {
      const btn = document.createElement("button");
      btn.className = "model-action-btn delete";
      btn.textContent = "Elimina";
      btn.addEventListener("click", () => window.whisperPill.deleteModel(m.size));
      row.appendChild(btn);
    } else {
      const btn = document.createElement("button");
      btn.className = "model-action-btn download";
      btn.textContent = m._failed ? "Riprova" : "Scarica";
      btn.addEventListener("click", () => {
        m._failed = false;
        window.whisperPill.downloadModel(m.size);
      });
      row.appendChild(btn);
    }

    container.appendChild(row);
  });
}

window.whisperPill.onModels((list) => {
  modelsState = list.map((m) => {
    const prev = modelsState.find((p) => p.size === m.size);
    return { ...m, _progress: prev?._progress ?? null, _failed: prev?._failed ?? false };
  });
  renderModelsManageList();
});

window.whisperPill.onModelProgress(({ model, percent }) => {
  const m = modelsState.find((x) => x.size === model);
  if (m) {
    m._progress = percent;
    renderModelsManageList();
  }
});

window.whisperPill.onModelDone(({ model, success }) => {
  const m = modelsState.find((x) => x.size === model);
  if (m) {
    m._progress = null;
    m._failed = !success;
    if (success) m.downloaded = true;
    renderModelsManageList();
  }
});

window.whisperPill.onModelDeleted(({ model }) => {
  const m = modelsState.find((x) => x.size === model);
  if (m) {
    m.downloaded = false;
    renderModelsManageList();
  }
});

init();
