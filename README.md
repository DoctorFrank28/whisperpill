# WhisperPill

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D6)
![Electron](https://img.shields.io/badge/Electron-31-47848F)
![faster--whisper](https://img.shields.io/badge/faster--whisper-local%20%26%20offline-63C7D6)

**WhisperPill** is a voice dictation app for Windows (**voice typing / speech-to-text**) in the form of a small floating pill: hold a shortcut, speak, release — the transcribed text is copied to the clipboard and/or typed automatically into whatever app you're using. Transcription runs **entirely locally** via [faster-whisper](https://github.com/SYSTRAN/faster-whisper): no audio ever leaves your PC.

> A floating push-to-talk dictation bar for Windows, powered by a fully local/offline `faster-whisper` speech-to-text backend — no cloud, no API keys, no audio ever leaves your machine.

## Table of contents

- [Features](#features)
- [Why WhisperPill](#why-whisperpill)
- [Requirements](#requirements)
- [Installation](#installation)
- [Which model should I use](#which-model-should-i-use)
- [Usage](#usage)
- [Development](#development)
- [FAQ](#faq)
- [Technical notes](#technical-notes)
- [License](#license)

## Features

- **Floating pill** always on top, with distinct states for listening, processing, result (compact/expanded), and error
- **Three activation modes**: hold-to-talk (push-to-talk), tap to start/stop, or tray-icon only
- **Configurable output**: copy to clipboard, auto-type into the active window, or just display in the pill
- **Built-in model manager**: download/delete Whisper models (tiny → large-v3) from Settings, with live progress; no hidden cache, everything lives in a dedicated `models/` folder
- **Automatic first-run setup**: if the Python environment isn't ready yet, it offers to install it and streams the log live
- **Cancel anytime**: `Esc` or the X on the pill interrupts listening or processing in progress
- Automatic light/dark theme, reassignable shortcut, language and microphone selection
- Interface available in **Italian and English** (auto-detected from your system, or set manually)
- 100% local and private: **zero cloud, zero API keys, zero telemetry**

## Why WhisperPill

Most Windows dictation tools (including built-in speech recognition) send your audio to a cloud service, require a subscription, or both. WhisperPill is a **local, free, and open-source** alternative: it runs the same Whisper model from OpenAI (via `faster-whisper`, a CPU-optimized runtime) entirely on your own machine.

## Requirements

- Windows 10/11
- For everyday use: nothing else, the installer sets everything up
- For building/development: [Node.js](https://nodejs.org/) 18+ and [Python](https://www.python.org/) 3.10+

## Installation

Download the latest release from the [Releases page](https://github.com/DoctorFrank28/whisperpill/releases): either `WhisperPill-Setup-<version>.exe` (installer) or `WhisperPill-<version>-portable.exe` (no installation required).

> The executable isn't code-signed: Windows SmartScreen may warn on first launch. Choose **More info → Run anyway**.

On first launch, if the transcription environment isn't installed yet, WhisperPill offers to set it up automatically (creates a Python virtualenv and installs `faster-whisper`), then asks which models you'd like to download.

## Which model should I use

Whisper comes in several model sizes: bigger means more accurate but slower. On CPU (without a dedicated GPU), transcription runs in `int8` by default, already a good speed/quality tradeoff. As a general rule:

| Model | Size | Recommended RAM | Recommended CPU | When to use it |
|---|---|---|---|---|
| `tiny` | ~75 MB | 4 GB+ | Any, even older PCs | Quick notes and drafts where speed matters more than accuracy |
| `base` | ~145 MB | 4 GB+ | Dual-core or better | Like `tiny`, slightly more accurate |
| `small` | ~480 MB | 8 GB+ | Recent quad-core (Intel i5/Ryzen 5 or better) | **Recommended for most users**: good balance of speed and accuracy |
| `medium` | ~1.5 GB | 8–16 GB | 6+ cores | Professional dictation, long texts, or specific terminology |
| `large-v3` | ~3 GB | 16 GB+ | 8+ cores, or an NVIDIA GPU | Maximum accuracy; on CPU alone it can take several seconds per sentence |

If you have an **NVIDIA GPU** with CUDA/cuDNN installed, you can get much faster transcription even with the larger models by changing `device="cpu"` to `device="cuda"` (and `compute_type="int8"` to `"float16"`) in [`stt_service.py`](stt_service.py).

You can download multiple models and switch between them anytime from Settings → Language and model, no reinstall needed.

## Usage

- Default shortcut: `Control+Alt+Space`, hold-to-talk mode (push-to-talk)
- Change the shortcut, activation mode, language, model, and output from **Settings** (tray icon)
- `Esc` or the X on the pill cancels listening/processing in progress

## Development

The project has two parts: a Python backend that handles the microphone and transcription, and an Electron app for the UI and global shortcuts.

```
whisper-ai/
├── stt_service.py        # Python backend: recording + transcription + model management
├── setup_whisper.ps1      # Python environment setup script (venv + faster-whisper)
├── trascrivi.py           # command-line utility to transcribe an audio file
└── WhisperPill/            # Electron app (pill + settings)
    ├── main.js              # main process: windows, hotkeys, IPC, state
    ├── preload.js           # secure bridge between main and renderer
    ├── sttBridge.js         # manages the Python subprocess (JSON protocol over stdin/stdout)
    ├── hotkeys.js           # global shortcut engine (uiohook-napi)
    ├── setupRunner.js       # runs setup_whisper.ps1 and streams its output
    ├── config.js            # persisted settings (electron-store)
    ├── i18n.js              # UI translation dictionaries (Italian/English)
    └── renderer/            # HTML/CSS/JS for the pill, settings, and setup windows
```

### Python backend

```bash
python -m venv .venv
.venv\Scripts\python.exe -m pip install faster-whisper sounddevice huggingface_hub
```

(or simply run `setup_whisper.ps1`, which the app itself also uses).

`stt_service.py` communicates over JSON lines on stdin/stdout: commands like `{"cmd": "start"}` in, events like `{"event": "result", "text": "..."}` out. See the file's header comment for the full protocol.

### Electron app

```bash
cd WhisperPill
npm install
npm start
```

By default, in development the app looks for the Python backend in the parent folder (`..`, i.e. `whisper-ai/`). Once packaged, it instead looks in `~/Documents/claude/whisper-ai` — overridable with the `WHISPERPILL_HOME` environment variable if your backend lives elsewhere.

### Building the installer

```bash
cd WhisperPill
npm run dist
```

Produces both the NSIS installer and the portable build in `WhisperPill/dist`.

## FAQ

**Is it free?** Yes, open source under the MIT license.

**Do I need an internet connection?** Only for the initial setup and to download models the first time. Actual transcription works **offline**.

**Is my audio sent to any server?** No. Everything — recording and transcription — happens on your PC.

**Does it work on macOS or Linux?** No, it's currently Windows-only (global shortcuts, auto-type, and the installer are all Windows-specific).

**How accurate is the transcription?** It depends on the model you pick: see [Which model should I use](#which-model-should-i-use). With `small` or larger, clearly spoken audio is transcribed with good accuracy.

**Can I use it in a language other than Italian or English?** The interface (menus, settings) is available in Italian and English. Transcription language is separate and configurable independently — Whisper supports dozens of languages, including auto-detection.

## Technical notes

- Whisper models are downloaded into `whisper-ai/models/<size>/` instead of the Hugging Face cache, so the app always knows with certainty what's already downloaded.
- The activation shortcut is also reserved through Electron's `globalShortcut` API, to prevent it from also reaching the foreground application.
- If a transcription is cancelled while already in progress, the backend invalidates it via a generation counter: if the result arrives anyway, it's silently discarded.

## License

[MIT](LICENSE) — see the file for the full text.

---

*Keywords: Windows voice dictation, local speech-to-text, offline voice transcription, voice typing app, Whisper AI dictation, push-to-talk transcription, free alternative to Dragon NaturallySpeaking.*
