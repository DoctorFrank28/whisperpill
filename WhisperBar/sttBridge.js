const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const { EventEmitter } = require("events");
const fs = require("fs");
const { app } = require("electron");

// In sviluppo, il backend Python vive nella cartella padre di WhisperBar/.
// Una volta impacchettata (electron-builder), __dirname finisce dentro
// resources/app.asar e quella cartella non esiste piu': l'app punta quindi
// alla cartella dove vive l'ambiente .venv, sovrascrivibile con la variabile
// d'ambiente WHISPERBAR_HOME se il backend non e' in quella di default.
const DEV_WHISPER_DIR = path.join(__dirname, "..");
const INSTALLED_WHISPER_DIR =
  process.env.WHISPERBAR_HOME || path.join(os.homedir(), "Documents", "claude", "whisper-ai");
const WHISPER_DIR = app.isPackaged ? INSTALLED_WHISPER_DIR : DEV_WHISPER_DIR;
const PYTHON_EXE = path.join(WHISPER_DIR, ".venv", "Scripts", "python.exe");
const SERVICE_SCRIPT = path.join(WHISPER_DIR, "stt_service.py");
const MODELS_DIR = path.join(WHISPER_DIR, "models");

// Tenute in sync con MODEL_REPOS in stt_service.py.
const MODEL_SIZES = ["tiny", "base", "small", "medium", "large-v3"];

function anyModelDownloaded() {
  return MODEL_SIZES.some((size) => fs.existsSync(path.join(MODELS_DIR, size, "model.bin")));
}

class SttBridge extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.buffer = "";
  }

  start() {
    if (this.proc) return;
    if (!fs.existsSync(PYTHON_EXE)) {
      this.emit("error", `Python virtualenv non trovato: ${PYTHON_EXE}`);
      return;
    }
    this.proc = spawn(PYTHON_EXE, [SERVICE_SCRIPT], {
      cwd: WHISPER_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout.on("data", (chunk) => this._onData(chunk));
    this.proc.stderr.on("data", (chunk) => {
      this.emit("stderr", chunk.toString("utf8"));
    });
    this.proc.on("exit", (code) => {
      this.proc = null;
      this.emit("exit", code);
    });
    this.proc.on("error", (err) => {
      this.emit("error", err.message);
    });
  }

  _onData(chunk) {
    this.buffer += chunk.toString("utf8");
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        this.emit("message", msg);
      } catch (_) {
        this.emit("stderr", `[stt_service] output non JSON: ${line}`);
      }
    }
  }

  _send(obj) {
    if (!this.proc) this.start();
    if (this.proc && this.proc.stdin.writable) {
      this.proc.stdin.write(JSON.stringify(obj) + "\n");
    }
  }

  setConfig({ language, model, device }) {
    this._send({ cmd: "config", language, model, device });
  }

  listDevices() {
    this._send({ cmd: "list_devices" });
  }

  listModels() {
    this._send({ cmd: "list_models" });
  }

  downloadModel(size) {
    this._send({ cmd: "download_model", model: size });
  }

  deleteModel(size) {
    this._send({ cmd: "delete_model", model: size });
  }

  startRecording() {
    this._send({ cmd: "start" });
  }

  stopRecording() {
    this._send({ cmd: "stop" });
  }

  abort() {
    this._send({ cmd: "abort" });
  }

  shutdown() {
    if (this.proc) {
      this._send({ cmd: "shutdown" });
      setTimeout(() => {
        if (this.proc) this.proc.kill();
      }, 500);
    }
  }
}

module.exports = { SttBridge, WHISPER_DIR, PYTHON_EXE, SERVICE_SCRIPT, MODEL_SIZES, anyModelDownloaded };
