const logEl = document.getElementById("log");
const statusText = document.getElementById("status-text");
const statusSub = document.getElementById("status-sub");
const spinner = document.getElementById("status-spinner");
const closeBtn = document.getElementById("btn-close");

window.whisperBar.onSetupLog((line) => {
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
});

window.whisperBar.onSetupDone((result) => {
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

closeBtn.addEventListener("click", () => window.whisperBar.closeSetupWindow());
