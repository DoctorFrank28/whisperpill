"""
stt_service.py - servizio persistente di registrazione + trascrizione per WhisperBar.

Comunica su stdin/stdout con righe JSON (una per riga), pensato per essere
lanciato come sottoprocesso dall'app Electron.

Comandi in ingresso (stdin):
    {"cmd": "config", "language": "it", "model": "small", "device": null}
    {"cmd": "start"}
    {"cmd": "stop"}
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
"""

import json
import sys
import threading
import time

import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel

SAMPLE_RATE = 16000


def emit(event: dict):
    sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.stdout.flush()


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
            emit({"event": "model_loading", "model": self.model_size})
            self.model = WhisperModel(self.model_size, device="cpu", compute_type="int8")
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
        elif cmd == "start":
            self.start_recording()
        elif cmd == "stop":
            self.stop_recording()
        elif cmd == "shutdown":
            sys.exit(0)
        else:
            emit({"event": "error", "message": f"Comando sconosciuto: {cmd}"})


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
