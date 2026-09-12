"""
trascrivi.py - trascrive un file audio in italiano usando faster-whisper.

Uso:
    .venv\\Scripts\\python.exe trascrivi.py percorso\\al\\file.mp3 [modello]

Modelli disponibili (dal piu' leggero al piu' preciso):
    tiny, base, small, medium, large-v3
Default: "medium" (buon compromesso qualita'/velocita' per l'italiano su CPU).

Se hai una GPU NVIDIA con CUDA/cuDNN installati, modifica device="cuda" e
compute_type="float16" qui sotto per andare molto piu' veloce.
"""

import sys
from pathlib import Path

from faster_whisper import WhisperModel


def main():
    if len(sys.argv) < 2:
        print("Uso: python trascrivi.py <file_audio> [modello]")
        sys.exit(1)

    audio_path = Path(sys.argv[1])
    if not audio_path.exists():
        print(f"File non trovato: {audio_path}")
        sys.exit(1)

    model_size = sys.argv[2] if len(sys.argv) > 2 else "medium"

    print(f"Carico il modello '{model_size}' (la prima volta lo scarica, puo' volerci un po')...")
    # device="cpu" + compute_type="int8" funziona ovunque senza GPU.
    # Se hai una GPU NVIDIA con CUDA: device="cuda", compute_type="float16".
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    print(f"Trascrivo: {audio_path}")
    segments, info = model.transcribe(str(audio_path), language="it")

    print(f"\nLingua rilevata: {info.language} (probabilita' {info.language_probability:.2f})\n")

    testo_completo = []
    for segment in segments:
        riga = f"[{segment.start:6.1f}s -> {segment.end:6.1f}s] {segment.text.strip()}"
        print(riga)
        testo_completo.append(segment.text.strip())

    out_path = audio_path.with_suffix(".txt")
    out_path.write_text(" ".join(testo_completo), encoding="utf-8")
    print(f"\nTrascrizione salvata in: {out_path}")


if __name__ == "__main__":
    main()
