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

// Esegue setup_whisper.ps1 e riporta l'output riga per riga; risolve con
// {success, code} quando il processo termina.
function runSetup() {
  const emitter = new EventEmitter();
  const proc = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SETUP_SCRIPT],
    { cwd: WHISPER_DIR, stdio: ["ignore", "pipe", "pipe"] }
  );

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

module.exports = { whisperEnvironmentExists, setupScriptExists, runSetup, SETUP_SCRIPT };
