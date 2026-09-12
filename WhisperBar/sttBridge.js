const { spawn } = require("child_process");
const path = require("path");
const { EventEmitter } = require("events");
const fs = require("fs");
const { app } = require("electron");

// In sviluppo, il backend Python vive nella cartella padre di WhisperBar/.
// Una volta impacchettata (electron-builder), __dirname finisce dentro
// resources/app.asar e quella cartella non esiste piu': l'app punta quindi
// al percorso fisso dove vive l'ambiente .venv su questa macchina.
const DEV_WHISPER_DIR = path.join(__dirname, "..");
const INSTALLED_WHISPER_DIR = "C:\\Users\\Frank\\Documents\\claude\\whisper-ai";
const WHISPER_DIR = app.isPackaged ? INSTALLED_WHISPER_DIR : DEV_WHISPER_DIR;
const PYTHON_EXE = path.join(WHISPER_DIR, ".venv", "Scripts", "python.exe");
const SERVICE_SCRIPT = path.join(WHISPER_DIR, "stt_service.py");

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

  startRecording() {
    this._send({ cmd: "start" });
  }

  stopRecording() {
    this._send({ cmd: "stop" });
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

module.exports = { SttBridge, WHISPER_DIR, PYTHON_EXE, SERVICE_SCRIPT };
