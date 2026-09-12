const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { EventEmitter } = require("events");

const { WHISPER_DIR, PYTHON_EXE } = require("./sttBridge");

const SETUP_SCRIPT = path.join(WHISPER_DIR, "setup_whisper.ps1");

function whisperEnvironmentExists() {
  return fs.existsSync(PYTHON_EXE);
}

function setupScriptExists() {
  return fs.existsSync(SETUP_SCRIPT);
}

// Lancia un comando riportando l'output riga per riga via evento "line" e
// risolvendo con {success, code} via evento "done" alla fine del processo.
function runStreaming(command, args) {
  const emitter = new EventEmitter();
  const proc = spawn(command, args, { cwd: WHISPER_DIR, stdio: ["ignore", "pipe", "pipe"] });

  const forward = (chunk) => {
    chunk
      .toString("utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => emitter.emit("line", line));
  };

  proc.stdout.on("data", forward);
  proc.stderr.on("data", forward);
  proc.on("error", (err) => {
    emitter.emit("line", `Errore: ${err.message}`);
    emitter.emit("done", { success: false, code: null });
  });
  proc.on("exit", (code) => {
    emitter.emit("done", { success: code === 0, code });
  });

  return emitter;
}

// Esegue setup_whisper.ps1 e riporta l'output riga per riga.
function runSetup() {
  return runStreaming("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SETUP_SCRIPT]);
}

// Installa le librerie NVIDIA (cuBLAS/cuDNN) necessarie a ctranslate2 per
// usare davvero la GPU: senza queste il device "cuda" viene rilevato ma il
// caricamento del modello fallisce (vedi gpu_fallback in stt_service.py).
function installGpuSupport() {
  return runStreaming(PYTHON_EXE, ["-m", "pip", "install", "nvidia-cublas-cu12", "nvidia-cudnn-cu12"]);
}

module.exports = { whisperEnvironmentExists, setupScriptExists, runSetup, installGpuSupport, SETUP_SCRIPT };
