const MODEL_INFO = {
  tiny: { label: "tiny", desc: "Piu' veloce, meno preciso" },
  base: { label: "base", desc: "Veloce" },
  small: { label: "small", desc: "Bilanciato (consigliato)" },
  medium: { label: "medium", desc: "Preciso, piu' lento" },
  "large-v3": { label: "large", desc: "Massima precisione, lento" },
};
const DEFAULT_CHECKED = new Set(["small"]);

// ---- fase: installazione ambiente ----

const logEl = document.getElementById("log");
const statusText = document.getElementById("status-text");
const statusSub = document.getElementById("status-sub");
const spinner = document.getElementById("status-spinner");
const closeBtn = document.getElementById("btn-close");

window.whisperPill.onSetupLog((line) => {
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
});

window.whisperPill.onSetupDone((result) => {
  spinner.replaceWith(Object.assign(document.createElement("div"), {
    className: `status-icon ${result.success ? "ok" : "fail"}`,
  }));
  if (result.success) {
    statusText.textContent = "Installazione completata";
    statusSub.textContent = "L'ambiente e' pronto: ora puoi usare la scorciatoia per dettare.";
  } else {
    statusText.textContent = "Installazione non riuscita";
    statusSub.textContent = "Controlla il log qui sotto oppure esegui setup_whisper.ps1 manualmente.";
  }
  closeBtn.disabled = false;
});

closeBtn.addEventListener("click", () => window.whisperPill.closeSetupWindow());

// ---- fase: scelta modelli ----

const modelsListEl = document.getElementById("models-list");
const btnSkip = document.getElementById("btn-skip");
const btnDownload = document.getElementById("btn-download");
const titlebarName = document.getElementById("titlebar-name");

let modelsState = [];
let downloading = false;

function renderModels() {
  modelsListEl.innerHTML = "";
  modelsState.forEach((m) => {
    const info = MODEL_INFO[m.size] || { label: m.size, desc: "" };
    const row = document.createElement("div");
    row.className = "model-row";
    row.dataset.size = m.size;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = m.downloaded || (m._checked ?? DEFAULT_CHECKED.has(m.size));
    checkbox.disabled = m.downloaded || downloading;
    checkbox.addEventListener("change", () => {
      m._checked = checkbox.checked;
    });

    const infoEl = document.createElement("div");
    infoEl.className = "model-info";
    infoEl.innerHTML = `<div class="model-name">${info.label}</div><div class="model-desc">${info.desc}</div>`;

    const sizeEl = document.createElement("div");
    sizeEl.className = "model-size";
    sizeEl.textContent = m.approxMB >= 1000 ? `~${(m.approxMB / 1000).toFixed(1)} GB` : `~${m.approxMB} MB`;

    const statusEl = document.createElement("div");
    statusEl.className = "model-status";
    if (m.downloaded) {
      statusEl.textContent = "scaricato";
      statusEl.classList.add("ok");
    } else if (m._progress != null) {
      statusEl.textContent = `${m._progress}%`;
    } else if (m._failed) {
      statusEl.textContent = "errore";
      statusEl.classList.add("fail");
    }

    row.append(checkbox, infoEl, sizeEl, statusEl);

    if (m._progress != null && !m.downloaded) {
      const bar = document.createElement("div");
      bar.className = "model-progress";
      const fill = document.createElement("div");
      fill.style.width = `${m._progress}%`;
      bar.appendChild(fill);
      row.appendChild(bar);
    }

    modelsListEl.appendChild(row);
  });
}

async function loadModels() {
  modelsListEl.innerHTML = '<div style="padding:16px;color:var(--text-secondary);font-size:12.5px;">Carico elenco modelli…</div>';
  await window.whisperPill.listModels();
}

window.whisperPill.onModels((list) => {
  modelsState = list.map((m) => {
    const prev = modelsState.find((p) => p.size === m.size);
    return { ...m, _checked: prev?._checked, _progress: prev?._progress, _failed: prev?._failed };
  });
  renderModels();
});

window.whisperPill.onModelProgress(({ model, percent }) => {
  const m = modelsState.find((x) => x.size === model);
  if (m) {
    m._progress = percent;
    m._failed = false;
    renderModels();
  }
});

window.whisperPill.onModelDone(({ model, success }) => {
  const m = modelsState.find((x) => x.size === model);
  if (m) {
    m._progress = null;
    m._failed = !success;
    if (success) m.downloaded = true;
    renderModels();
  }
  downloadNext();
});

let downloadQueue = [];

function downloadNext() {
  if (downloadQueue.length === 0) {
    downloading = false;
    btnDownload.disabled = false;
    btnDownload.textContent = "Scarica selezionati";
    btnSkip.textContent = "Fine";
    renderModels();
    return;
  }
  const size = downloadQueue.shift();
  window.whisperPill.downloadModel(size);
}

btnDownload.addEventListener("click", () => {
  const selected = modelsState.filter((m) => !m.downloaded && (m._checked ?? DEFAULT_CHECKED.has(m.size)));
  if (selected.length === 0 || downloading) return;
  downloading = true;
  btnDownload.disabled = true;
  btnDownload.textContent = "Scaricamento…";
  downloadQueue = selected.map((m) => m.size);
  renderModels();
  downloadNext();
});

btnSkip.addEventListener("click", () => window.whisperPill.closeSetupWindow());

window.whisperPill.onSetupPhase((phase) => {
  if (phase !== "models") return;
  document.getElementById("phase-install").classList.remove("active");
  document.getElementById("phase-models").classList.add("active");
  titlebarName.textContent = "WhisperPill — Modelli";
  loadModels();
});
