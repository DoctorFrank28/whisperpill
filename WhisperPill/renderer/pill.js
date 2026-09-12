const WAVE_BARS = 16;
const waveEl = document.getElementById("wave");
for (let i = 0; i < WAVE_BARS; i++) {
  const bar = document.createElement("span");
  const duration = (0.85 + Math.random() * 0.45).toFixed(2);
  const delay = (i * 0.08).toFixed(2);
  bar.style.animationDuration = `${duration}s`;
  bar.style.animationDelay = `${delay}s`;
  waveEl.appendChild(bar);
}

const cards = {
  listening: document.getElementById("pill-listening"),
  processing: document.getElementById("pill-processing"),
  resultCollapsed: document.getElementById("pill-result-collapsed"),
  resultExpanded: document.getElementById("pill-result-expanded"),
  error: document.getElementById("pill-error"),
  flash: document.getElementById("pill-flash"),
};

let timerInterval = null;
let lastResult = null;
let lastState = null;

function hideAllCards() {
  Object.values(cards).forEach((el) => el.classList.remove("visible"));
}

function showCard(el) {
  hideAllCards();
  el.classList.add("visible");
}

function formatTimer(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function render(state) {
  lastState = state;
  stopTimer();

  switch (state.kind) {
    case "idle":
      hideAllCards();
      break;

    case "listening": {
      document.getElementById("listening-hint").textContent = state.activationHint || "";
      showCard(cards.listening);
      const timerEl = document.getElementById("timer");
      const update = () => {
        timerEl.textContent = formatTimer(Date.now() - state.startedAt);
      };
      update();
      timerInterval = setInterval(update, 250);
      break;
    }

    case "processing":
      document.getElementById("processing-meta").textContent = state.model || "";
      showCard(cards.processing);
      break;

    case "result": {
      lastResult = state;
      if (state.expanded) {
        const modelLabel = state.model ? ` · ${state.model.toUpperCase()}` : "";
        document.getElementById("expanded-title").textContent =
          `${t("pill.transcriptionLabel")} · ${state.words || 0} ${t("pill.words").toUpperCase()}${modelLabel}`;
        document.getElementById("expanded-text").textContent = state.text;
        document.getElementById("expanded-hint").innerHTML = hintsMarkup(state, true);
        showCard(cards.resultExpanded);
      } else {
        document.getElementById("result-preview").textContent = state.text;
        document.getElementById("result-hints").innerHTML = hintsMarkup(state, false);
        showCard(cards.resultCollapsed);
      }
      break;
    }

    case "flash":
      document.getElementById("flash-text").innerHTML = hintsMarkup(state, false, true);
      showCard(cards.flash);
      break;

    case "error":
      document.getElementById("error-text").textContent = state.message || t("pill.noSpeechDetected");
      showCard(cards.error);
      break;

    default:
      hideAllCards();
  }
}

function hintsMarkup(state, expanded, standalone) {
  const parts = [];
  if (state.copied) parts.push(`<span class="ok">✓ ${t("pill.copied")}</span>`);
  if (state.typed) parts.push(`<span class="ok">✓ ${t("pill.typed")}</span>`);
  if (!standalone && state.words != null) {
    const model = state.model ? ` · ${state.model}` : "";
    const elapsed = state.elapsed != null ? ` · ${state.elapsed}s` : "";
    parts.push(`<span>${state.words} ${t("pill.words")}${model}${elapsed}</span>`);
  }
  if (standalone && !parts.length) parts.push(`<span>${t("pill.done")}</span>`);
  return parts.join(" · ");
}

window.whisperPill.onState(render);

window.onLanguageChanged = () => {
  if (lastState) render(lastState);
};

document.getElementById("btn-copy").addEventListener("click", () => {
  if (lastResult) window.whisperPill.copyText(lastResult.text);
});
document.getElementById("btn-copy-2").addEventListener("click", () => {
  if (lastResult) window.whisperPill.copyText(lastResult.text);
});
document.getElementById("btn-expand").addEventListener("click", () => window.whisperPill.requestExpand());
document.getElementById("result-preview").addEventListener("click", () => window.whisperPill.requestExpand());
document.getElementById("btn-collapse").addEventListener("click", () => window.whisperPill.requestCollapse());
document.getElementById("btn-close").addEventListener("click", () => window.whisperPill.requestClose());
document.querySelectorAll(".btn-dismiss").forEach((btn) => {
  btn.addEventListener("click", () => window.whisperPill.requestClose());
});
document.querySelectorAll(".btn-abort").forEach((btn) => {
  btn.addEventListener("click", () => window.whisperPill.requestAbort());
});

// Il BrowserWindow copre un'area trasparente piu' grande della pillola visibile:
// ignoriamo i click fuori dalla card cosi' i clic raggiungono le finestre sottostanti.
// Mentre il mouse e' sopra la card, mettiamo in pausa la sparizione automatica
// (altrimenti la pillola col risultato rischia di chiudersi mentre la si legge).
let wasOverCard = false;
document.addEventListener("mousemove", (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const overCard = !!(el && el.closest(".pill-card"));
  window.whisperPill.setIgnoreMouseEvents(!overCard);
  if (overCard !== wasOverCard) {
    wasOverCard = overCard;
    if (overCard) window.whisperPill.pillHoverEnter();
    else window.whisperPill.pillHoverLeave();
  }
});
