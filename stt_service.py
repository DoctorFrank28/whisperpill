"""
stt_service.py - servizio persistente di registrazione + trascrizione per WhisperBar.

Comunica su stdin/stdout con righe JSON (una per riga), pensato per essere
lanciato come sottoprocesso dall'app Electron.

Comandi in ingresso (stdin):
    {"cmd": "config", "language": "it", "model": "small", "device": null}
    {"cmd": "start"}
    {"cmd": "stop"}
    {"cmd": "list_devices"}
    {"cmd": "list_models"}
    {"cmd": "download_model", "model": "small"}
    {"cmd": "delete_model", "model": "small"}
    {"cmd": "shutdown"}

Eventi in uscita (stdout):
    {"event": "ready"}
    {"event": "model_loading", "model": "small"}
    {"event": "model_ready", "model": "small"}
    {"event": "recording_started"}
    {"event": "recording_stopped", "duration": 7.2}
    {"event": "transcribing"}
    {"event": "result", "text": "...", "words": 32, "duration": 7.2, "elapsed": 1.1, "language": "it"}
    {"event": "error", "message": "..."}
    {"event": "devices", "list": [{"index": 0, "name": "Microfono (Realtek Audio)"}]}
    {"event": "models", "list": [{"size": "small", "downloaded": true, "approxMB": 480}, ...]}
    {"event": "model_download_start", "model": "small"}
    {"event": "model_download_progress", "model": "small", "percent": 42}
    {"event": "model_download_done", "model": "small", "success": true}
    {"event": "model_deleted", "model": "small"}
"""

import json
import os
import shutil
import sys
import threading
import time

import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel
from huggingface_hub import snapshot_download
from tqdm.auto import tqdm as _base_tqdm

SAMPLE_RATE = 16000

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")

# Solo le taglie esposte nell'interfaccia di WhisperBar.
MODEL_REPOS = {
    "tiny": "Systran/faster-whisper-tiny",
    "base": "Systran/faster-whisper-base",
    "small": "Systran/faster-whisper-small",
    "medium": "Systran/faster-whisper-medium",
    "large-v3": "Systran/faster-whisper-large-v3",
}
MODEL_APPROX_MB = {
    "tiny": 75,
    "base": 145,
    "small": 480,
    "medium": 1530,
    "large-v3": 3060,
}
MODEL_ALLOW_PATTERNS = [
    "config.json",
    "preprocessor_config.json",
    "model.bin",
    "tokenizer.json",
    "vocabulary.*",
]


def emit(event: dict):
    sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def model_dir(size: str) -> str:
    return os.path.join(MODELS_DIR, size)


def is_model_downloaded(size: str) -> bool:
    return os.path.isfile(os.path.join(model_dir(size), "model.bin"))


def list_models():
    models = [
        {"size": size, "downloaded": is_model_downloaded(size), "approxMB": MODEL_APPROX_MB[size]}
        for size in MODEL_REPOS
    ]
    emit({"event": "models", "list": models})


def delete_model(size: str):
    d = model_dir(size)
    if os.path.isdir(d):
        shutil.rmtree(d, ignore_errors=True)
    emit({"event": "model_deleted", "model": size})


# Stato condiviso con la sottoclasse di tqdm usata da huggingface_hub durante
# lo scaricamento, per convertire i suoi progressi in eventi JSON per Electron.
_download_state = {"model": None, "last_emit": 0.0}


class _ProgressTqdm(_base_tqdm):
    def __init__(self, *args, **kwargs):
        kwargs["disable"] = False
        super().__init__(*args, **kwargs)

    def update(self, n=1):
        super().update(n)
        total = self.total
        # Ignora la barra "Fetching N files" (totale piccolo, conta i file non i byte):
        # ci interessa solo la barra di download del file piu' pesante (model.bin).
        if not total or total < 1_000_000:
            return
        now = time.time()
        model = _download_state["model"]
        if model is None:
            return
        if now - _download_state["last_emit"] < 0.15 and self.n < total:
            return
        _download_state["last_emit"] = now
        percent = max(0, min(100, int(self.n * 100 / total)))
        emit({"event": "model_download_progress", "model": model, "percent": percent})


def download_model_blocking(size: str) -> bool:
    """Scarica il modello se manca. Ritorna True se al termine e' disponibile."""
    if is_model_downloaded(size):
        return True
    repo_id = MODEL_REPOS.get(size)
    if repo_id is None:
        emit({"event": "error", "message": f"Modello sconosciuto: {size}"})
        return False

    _download_state["model"] = size
    _download_state["last_emit"] = 0.0
    emit({"event": "model_download_start", "model": size})
    try:
        snapshot_download(
            repo_id,
            local_dir=model_dir(size),
            allow_patterns=MODEL_ALLOW_PATTERNS,
            tqdm_class=_ProgressTqdm,
        )
        emit({"event": "model_download_done", "model": size, "success": True})
        return True
    except Exception as exc:  # noqa: BLE001
        emit({"event": "model_download_done", "model": size, "success": False, "message": str(exc)})
        return False
    finally:
        _download_state["model"] = None


class Service:
    def __init__(self):
        self.language = "it"
        self.model_size = "small"
        self.device = None
        self.model = None
        self.loaded_model_size = None

        self.recording = False
        self.frames = []
        self.stream = None
        self.lock = threading.Lock()

    def ensure_model(self):
        if self.model is None or self.loaded_model_size != self.model_size:
            if not download_model_blocking(self.model_size):
                raise RuntimeError(f"Impossibile scaricare il modello '{self.model_size}'")
            emit({"event": "model_loading", "model": self.model_size})
            self.model = WhisperModel(model_dir(self.model_size), device="cpu", compute_type="int8")
            self.loaded_model_size = self.model_size
            emit({"event": "model_ready", "model": self.model_size})

    def list_devices(self):
        devices = []
        for idx, d in enumerate(sd.query_devices()):
            if d.get("max_input_channels", 0) > 0:
                devices.append({"index": idx, "name": d["name"]})
        emit({"event": "devices", "list": devices})

    def _callback(self, indata, frame_count, time_info, status):
        if self.recording:
            with self.lock:
                self.frames.append(indata.copy())

    def start_recording(self):
        if self.recording:
            return
        self.frames = []
        self.recording = True
        self.stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="float32",
            device=self.device,
            callback=self._callback,
        )
        self.stream.start()
        emit({"event": "recording_started"})

    def stop_recording(self):
        if not self.recording:
            return
        self.recording = False
        if self.stream is not None:
            self.stream.stop()
            self.stream.close()
            self.stream = None

        with self.lock:
            if self.frames:
                audio = np.concatenate(self.frames, axis=0).flatten()
            else:
                audio = np.zeros(0, dtype=np.float32)
            self.frames = []

        duration = len(audio) / SAMPLE_RATE
        emit({"event": "recording_stopped", "duration": round(duration, 2)})

        if duration < 0.2:
            emit({"event": "error", "message": "Registrazione troppo breve."})
            return

        threading.Thread(target=self._transcribe, args=(audio, duration), daemon=True).start()

    def _transcribe(self, audio: np.ndarray, duration: float):
        try:
            self.ensure_model()
            emit({"event": "transcribing"})
            t0 = time.time()
            lang = None if self.language == "auto" else self.language
            segments, info = self.model.transcribe(audio, language=lang)
            text = " ".join(seg.text.strip() for seg in segments).strip()
            elapsed = time.time() - t0
            emit({
                "event": "result",
                "text": text,
                "words": len(text.split()) if text else 0,
                "duration": round(duration, 2),
                "elapsed": round(elapsed, 2),
                "language": info.language,
            })
        except Exception as exc:  # noqa: BLE001
            emit({"event": "error", "message": str(exc)})

    def handle(self, msg: dict):
        cmd = msg.get("cmd")
        if cmd == "config":
            if "language" in msg:
                self.language = msg["language"]
            if "model" in msg:
                self.model_size = msg["model"]
            if "device" in msg:
                self.device = msg["device"]
        elif cmd == "list_devices":
            self.list_devices()
        elif cmd == "list_models":
            list_models()
        elif cmd == "download_model":
            size = msg.get("model")
            threading.Thread(target=self._download_and_report, args=(size,), daemon=True).start()
        elif cmd == "delete_model":
            size = msg.get("model")
            if size:
                if self.loaded_model_size == size:
                    self.model = None
                    self.loaded_model_size = None
                delete_model(size)
        elif cmd == "start":
            self.start_recording()
        elif cmd == "stop":
            self.stop_recording()
        elif cmd == "shutdown":
            sys.exit(0)
        else:
            emit({"event": "error", "message": f"Comando sconosciuto: {cmd}"})

    def _download_and_report(self, size):
        if not size:
            emit({"event": "error", "message": "Nessun modello specificato"})
            return
        download_model_blocking(size)
        list_models()


def main():
    service = Service()
    emit({"event": "ready"})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            emit({"event": "error", "message": f"JSON non valido: {line}"})
            continue
        try:
            service.handle(msg)
        except Exception as exc:  # noqa: BLE001
            emit({"event": "error", "message": str(exc)})


if __name__ == "__main__":
    main()
