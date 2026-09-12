"""
stt_service.py - servizio persistente di registrazione + trascrizione per WhisperPill.

Comunica su stdin/stdout con righe JSON (una per riga), pensato per essere
lanciato come sottoprocesso dall'app Electron.

Comandi in ingresso (stdin):
    {"cmd": "config", "language": "it", "model": "small", "device": null, "computeDevice": "auto"}
    {"cmd": "start"}
    {"cmd": "stop"}
    {"cmd": "abort"}
    {"cmd": "list_devices"}
    {"cmd": "list_models"}
    {"cmd": "download_model", "model": "small"}
    {"cmd": "delete_model", "model": "small"}
    {"cmd": "reload_model"}
    {"cmd": "shutdown"}

Eventi in uscita (stdout):
    {"event": "ready", "gpuAvailable": true}
    {"event": "model_loading", "model": "small"}
    {"event": "model_ready", "model": "small", "device": "cpu"}
    {"event": "gpu_fallback", "message": "..."}
    {"event": "recording_started"}
    {"event": "recording_stopped", "duration": 7.2}
    {"event": "transcribing", "model": "small", "device": "cpu"}
    {"event": "result", "text": "...", "words": 32, "duration": 7.2, "elapsed": 1.1, "language": "it", "model": "small", "device": "cpu"}
    {"event": "aborted"}
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

# Su Windows, quando lo stdout/stdin di Python e' una pipe (non una console),
# la codifica di default e' quella ANSI di sistema (es. cp1252) e non UTF-8:
# le lettere accentate finivano corrotte nel JSON letto da Electron.
sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")

SAMPLE_RATE = 16000

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")

# Solo le taglie esposte nell'interfaccia di WhisperPill.
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


def detect_gpu() -> bool:
    """Rileva se ctranslate2 (il motore dietro faster-whisper) vede una GPU
    CUDA utilizzabile. Puo' dare un falso positivo se manca cuBLAS/cuDNN
    (che servono solo al momento di caricare davvero il modello): quel caso
    e' gestito a parte dal fallback in Service.ensure_model()."""
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:  # noqa: BLE001
        return False


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
        self.compute_device = "auto"  # "auto" | "cpu" | "gpu"
        self.model = None
        self.loaded_model_size = None
        self.loaded_device = None  # device effettivamente usato dal modello caricato

        self.recording = False
        self.frames = []
        self.stream = None
        self.lock = threading.Lock()
        # Incrementato ad ogni stop/abort: una _transcribe() in corso il cui
        # numero non corrisponde piu' a questo e' stata invalidata (abortita
        # o superata da una registrazione successiva) e non emette risultati.
        self.generation = 0

    def _resolve_device(self):
        """Ritorna (device, compute_type) in base alla preferenza dell'utente."""
        if self.compute_device == "cpu":
            return "cpu", "int8"
        if self.compute_device == "gpu":
            return "cuda", "float16"
        # "auto": usa la GPU solo se effettivamente rilevata
        if detect_gpu():
            return "cuda", "float16"
        return "cpu", "int8"

    def ensure_model(self):
        resolved_device, compute_type = self._resolve_device()
        if self.model is None or self.loaded_model_size != self.model_size or self.loaded_device != resolved_device:
            if not download_model_blocking(self.model_size):
                raise RuntimeError(f"Impossibile scaricare il modello '{self.model_size}'")
            emit({"event": "model_loading", "model": self.model_size})
            try:
                self.model = WhisperModel(model_dir(self.model_size), device=resolved_device, compute_type=compute_type)
                self.loaded_device = resolved_device
            except Exception as exc:  # noqa: BLE001
                if resolved_device == "cpu":
                    raise
                # GPU rilevata ma non realmente utilizzabile (es. cuBLAS/cuDNN
                # mancanti): non blocchiamo la trascrizione, torniamo alla CPU.
                emit({"event": "gpu_fallback", "message": str(exc)})
                self.model = WhisperModel(model_dir(self.model_size), device="cpu", compute_type="int8")
                self.loaded_device = "cpu"
            self.loaded_model_size = self.model_size
            emit({"event": "model_ready", "model": self.model_size, "device": self.loaded_device})

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

        self.generation += 1
        gen = self.generation
        threading.Thread(target=self._transcribe, args=(audio, duration, gen), daemon=True).start()

    def abort(self):
        """Interrompe la registrazione in corso (senza trascrivere) e invalida
        qualunque trascrizione gia' avviata: se completa, il suo risultato
        verra' scartato in silenzio invece di comparire in ritardo."""
        if self.recording:
            self.recording = False
            if self.stream is not None:
                self.stream.stop()
                self.stream.close()
                self.stream = None
            with self.lock:
                self.frames = []
        self.generation += 1
        emit({"event": "aborted"})

    def _run_transcribe(self, audio, lang):
        segments, info = self.model.transcribe(audio, language=lang)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return text, info

    def _transcribe(self, audio: np.ndarray, duration: float, gen: int):
        try:
            self.ensure_model()
            if gen != self.generation:
                return
            emit({"event": "transcribing", "model": self.loaded_model_size, "device": self.loaded_device})
            t0 = time.time()
            lang = None if self.language == "auto" else self.language
            try:
                text, info = self._run_transcribe(audio, lang)
            except Exception as exc:  # noqa: BLE001
                if self.loaded_device != "cuda":
                    raise
                # Il modello si e' "caricato" ma il kernel CUDA fallisce solo
                # al primo uso reale (es. cuBLAS scoperto mancante solo ora,
                # non al caricamento): non mostriamo l'errore, ricadiamo
                # sulla CPU e ritentiamo una volta.
                emit({"event": "gpu_fallback", "message": str(exc)})
                self.model = WhisperModel(model_dir(self.model_size), device="cpu", compute_type="int8")
                self.loaded_device = "cpu"
                emit({"event": "model_ready", "model": self.loaded_model_size, "device": "cpu"})
                text, info = self._run_transcribe(audio, lang)
            model_used = self.loaded_model_size
            device_used = self.loaded_device
            elapsed = time.time() - t0
            if gen != self.generation:
                return
            emit({
                "event": "result",
                "text": text,
                "words": len(text.split()) if text else 0,
                "duration": round(duration, 2),
                "elapsed": round(elapsed, 2),
                "language": info.language,
                "model": model_used,
                "device": device_used,
            })
        except Exception as exc:  # noqa: BLE001
            if gen == self.generation:
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
            if "computeDevice" in msg:
                self.compute_device = msg["computeDevice"]
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
        elif cmd == "abort":
            self.abort()
        elif cmd == "reload_model":
            threading.Thread(target=self._reload_model_and_report, daemon=True).start()
        elif cmd == "shutdown":
            sys.exit(0)
        else:
            emit({"event": "error", "message": f"Comando sconosciuto: {cmd}"})

    def _reload_model_and_report(self):
        """Forza un nuovo tentativo di caricamento (es. dopo aver installato
        le librerie CUDA mancanti), invece di aspettare la prossima dettatura."""
        self.model = None
        self.loaded_model_size = None
        self.loaded_device = None
        try:
            self.ensure_model()
        except Exception as exc:  # noqa: BLE001
            emit({"event": "error", "message": str(exc)})

    def _download_and_report(self, size):
        if not size:
            emit({"event": "error", "message": "Nessun modello specificato"})
            return
        download_model_blocking(size)
        list_models()


def main():
    service = Service()
    emit({"event": "ready", "gpuAvailable": detect_gpu()})
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
