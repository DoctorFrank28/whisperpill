let config = null;
let modelsState = [];

function modelDesc(size) {
  return t(`model.${size}.desc`);
}

function byId(id) {
  return document.getElementById(id);
}

async function init() {
  await window.i18nReady;
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
  renderSegPills("ui-language-select", config.uiLanguage);
  renderSegPills("compute-device", config.computeDevice);
  byId("models-desc").innerHTML = t("settings.models.desc", { path: '<span class="mono">whisper-ai/models</span>' });

  const version = await window.whisperPill.getVersion();
  byId("app-footer").innerHTML = `WhisperPill v${version}<br />faster-whisper`;

  computeStatus = await window.whisperPill.getComputeStatus();
  renderComputeStatus();

  window.whisperPill.listDevices();
  window.whisperPill.listModels();
}

let computeStatus = { gpuAvailable: null, lastActualDevice: null, fallbackMessage: null };

let gpuInstallRunning = false;
let computeChecking = false;

function renderComputeStatus() {
  const el = byId("compute-status-note");
  const installRow = byId("gpu-install-row");
  const checkBtn = byId("compute-check-btn");
  checkBtn.disabled = computeChecking || gpuInstallRunning;
  checkBtn.textContent = computeChecking ? t("settings.model.computeChecking") : t("settings.model.computeCheckBtn");

  if (!computeStatus) {
    el.textContent = "";
    installRow.style.display = "none";
    return;
  }
  if (computeStatus.fallbackMessage) {
    el.textContent = t("settings.model.computeFallback");
    installRow.style.display = gpuInstallRunning ? "none" : "block";
    return;
  }
  installRow.style.display = "none";
  if (computeStatus.lastActualDevice === "cuda") {
    el.textContent = t("settings.model.computeUsingGpu");
    return;
  }
  if (computeStatus.lastActualDevice === "cpu") {
    el.textContent = t("settings.model.computeUsingCpu");
    return;
  }
  if (computeStatus.gpuAvailable === false) {
    el.textContent = t("settings.model.computeNoGpu");
    return;
  }
  el.textContent = "";
}

window.whisperPill.onComputeStatus((status) => {
  computeStatus = status;
  computeChecking = false;
  renderComputeStatus();
});

byId("compute-check-btn").addEventListener("click", () => {
  if (computeChecking || gpuInstallRunning) return;
  computeChecking = true;
  renderComputeStatus();
  window.whisperPill.checkCompute();
});

byId("gpu-install-btn").addEventListener("click", () => {
  if (gpuInstallRunning) return;
  gpuInstallRunning = true;
  renderComputeStatus();
  const btn = byId("gpu-install-btn");
  btn.disabled = true;
  btn.textContent = t("settings.model.computeInstalling");
  const logEl = byId("gpu-install-log");
  logEl.textContent = "";
  logEl.style.display = "block";
  window.whisperPill.installGpuLibs();
});

window.whisperPill.onGpuInstallLog((line) => {
  const logEl = byId("gpu-install-log");
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
});

window.whisperPill.onGpuInstallDone((result) => {
  gpuInstallRunning = false;
  renderComputeStatus();
  const btn = byId("gpu-install-btn");
  btn.disabled = false;
  btn.textContent = t("settings.model.computeInstallBtn");
  if (!result.success) {
    byId("gpu-install-log").textContent += `\n${t("settings.model.computeInstallFailed")}\n`;
  }
});

window.onLanguageChanged = () => {
  if (!config) return;
  byId("models-desc").innerHTML = t("settings.models.desc", { path: '<span class="mono">whisper-ai/models</span>' });
  renderModelsManageList();
  renderComputeStatus();
  const defaultOpt = byId("mic-select").querySelector('option[value=""]');
  if (defaultOpt) defaultOpt.textContent = t("settings.mic.default");
};

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
  btn.textContent = t("settings.shortcuts.reassign");
  btn.style.marginLeft = "6px";
  btn.addEventListener("click", beginRebind);
  container.appendChild(btn);
}

function beginRebind() {
  const btn = byId("rebind-btn");
  btn.classList.add("capturing");
  btn.textContent = t("settings.shortcuts.pressCombo");
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

document.querySelectorAll("#compute-device .seg-pill").forEach((el) => {
  el.addEventListener("click", () => {
    renderSegPills("compute-device", el.dataset.value);
    patchConfig({ computeDevice: el.dataset.value });
  });
});

document.querySelectorAll("#theme-select .seg-pill").forEach((el) => {
  el.addEventListener("click", () => {
    renderSegPills("theme-select", el.dataset.value);
    patchConfig({ theme: el.dataset.value });
  });
});

document.querySelectorAll("#ui-language-select .seg-pill").forEach((el) => {
  el.addEventListener("click", () => {
    renderSegPills("ui-language-select", el.dataset.value);
    patchConfig({ uiLanguage: el.dataset.value });
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
  select.innerHTML = `<option value="">${t("settings.mic.default")}</option>`;
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
    const row = document.createElement("div");
    row.className = "model-row";

    const infoEl = document.createElement("div");
    infoEl.className = "model-info";
    infoEl.innerHTML = `<div class="model-name">${m.size}</div><div class="model-desc-small">${modelDesc(m.size)}</div>`;

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
      btn.textContent = t("settings.models.delete");
      btn.addEventListener("click", () => window.whisperPill.deleteModel(m.size));
      row.appendChild(btn);
    } else {
      const btn = document.createElement("button");
      btn.className = "model-action-btn download";
      btn.textContent = m._failed ? t("settings.models.retry") : t("settings.models.download");
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
