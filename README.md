# WhisperPill

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D6)
![Electron](https://img.shields.io/badge/Electron-31-47848F)
![faster--whisper](https://img.shields.io/badge/faster--whisper-local%20%26%20offline-63C7D6)

**WhisperPill** è un'app di dettatura vocale per Windows (**voice typing / speech-to-text**) sotto forma di una piccola pillola flottante: tieni premuta una scorciatoia, parla, rilascia — il testo trascritto finisce negli appunti e/o digitato automaticamente in qualsiasi programma. La trascrizione avviene **interamente in locale** tramite [faster-whisper](https://github.com/SYSTRAN/faster-whisper): nessun audio lascia il tuo PC.

> A floating push-to-talk dictation bar for Windows, powered by a fully local/offline `faster-whisper` speech-to-text backend — no cloud, no API keys, no audio ever leaves your machine.

## Indice

- [Funzionalità](#funzionalità)
- [Perché WhisperPill](#perché-whisperpill)
- [Requisiti](#requisiti)
- [Installazione](#installazione)
- [Quale modello scegliere](#quale-modello-scegliere)
- [Utilizzo](#utilizzo)
- [Sviluppo](#sviluppo)
- [Domande frequenti](#domande-frequenti)
- [Note tecniche](#note-tecniche)
- [Licenza](#licenza)

## Funzionalità

- **Pillola flottante** sempre in primo piano, con stati per ascolto, elaborazione, risultato (compatto/espanso) ed errore
- **Tre modalità di attivazione**: tieni premuto (push-to-talk), tocca per avviare/fermare, o solo dalla system tray
- **Output configurabile**: copia negli appunti, digitazione automatica nella finestra attiva (auto-type), o solo visualizzazione nella pillola
- **Gestione modelli integrata**: scarica/elimina i modelli Whisper (tiny → large-v3) dalle Impostazioni, con avanzamento in tempo reale; nessuna cache nascosta, tutto in una cartella `models/` dedicata
- **Setup automatico al primo avvio**: se l'ambiente Python non è pronto, propone di installarlo mostrando il log in diretta
- **Annulla in qualsiasi momento**: `Esc` o la X sulla pillola interrompono ascolto o elaborazione in corso
- Tema chiaro/scuro automatico, scorciatoia riassegnabile, selezione lingua e microfono
- 100% locale e privato: **zero cloud, zero API key, zero telemetria**

## Perché WhisperPill

La maggior parte degli strumenti di dettatura vocale per Windows (incluso il riconoscimento vocale nativo) invia l'audio a un servizio cloud, richiede un abbonamento, o entrambe le cose. WhisperPill nasce come alternativa **locale, gratuita e open source**: usa lo stesso modello Whisper di OpenAI (via `faster-whisper`, un runtime ottimizzato per CPU) eseguito interamente sul tuo PC.

## Requisiti

- Windows 10/11
- Per l'uso quotidiano: nessuno, l'installer configura tutto
- Per build/sviluppo: [Node.js](https://nodejs.org/) 18+ e [Python](https://www.python.org/) 3.10+

## Installazione

Scarica ed esegui `WhisperPill Setup <versione>.exe` da [`WhisperPill/dist`](WhisperPill/dist) (generato con `npm run dist`, vedi [Sviluppo](#sviluppo)), oppure usa la versione portable `WhisperPill-<versione>-portable.exe` senza installare nulla.

> L'eseguibile non è firmato digitalmente: Windows SmartScreen potrebbe avvisare al primo avvio. Scegli **Ulteriori informazioni → Esegui comunque**.

Al primo avvio, se l'ambiente di trascrizione non è ancora installato, WhisperPill propone di configurarlo automaticamente (crea un virtualenv Python e installa `faster-whisper`), poi chiede quali modelli scaricare.

## Quale modello scegliere

Whisper offre diverse taglie di modello: più sono grandi, più sono precisi ma più lenti. Su CPU (senza GPU dedicata) le trascrizioni girano in `int8`, un buon compromesso velocità/qualità già di default. Come regola generale:

| Modello | Dimensione | RAM consigliata | CPU consigliata | Quando usarlo |
|---|---|---|---|---|
| `tiny` | ~75 MB | 4 GB+ | Qualsiasi, anche PC datati | Note veloci e appunti dove la velocità conta più della precisione |
| `base` | ~145 MB | 4 GB+ | Dual-core o superiore | Come `tiny`, leggermente più accurato |
| `small` | ~480 MB | 8 GB+ | Quad-core recente (Intel i5/Ryzen 5 o superiori) | **Consigliato per la maggior parte degli utenti**: buon equilibrio tra velocità e precisione |
| `medium` | ~1,5 GB | 8–16 GB | 6+ core | Dettatura professionale, testi lunghi o con terminologia specifica |
| `large-v3` | ~3 GB | 16 GB+ | 8+ core, o GPU NVIDIA | Massima precisione; su sola CPU può richiedere diversi secondi a frase |

Se hai una **GPU NVIDIA** con CUDA/cuDNN installati, puoi ottenere trascrizioni molto più veloci anche con i modelli più grandi modificando `device="cpu"` in `device="cuda"` (e `compute_type="int8"` in `"float16"`) in [`stt_service.py`](stt_service.py).

Puoi scaricare più modelli e cambiarli in qualsiasi momento da Impostazioni → Lingua e modello, senza reinstallare nulla.

## Utilizzo

- Scorciatoia di default: `Control+Alt+Space`, modalità "tieni premuto" (push-to-talk)
- Cambia scorciatoia, modalità, lingua, modello e output da **Impostazioni** (icona nella system tray)
- `Esc` o la X sulla pillola annullano ascolto/elaborazione in corso

## Sviluppo

Il progetto ha due parti: un backend Python che gestisce microfono e trascrizione, e un'app Electron per interfaccia e scorciatoie globali.

```
whisper-ai/
├── stt_service.py        # backend Python: registrazione + trascrizione + gestione modelli
├── setup_whisper.ps1      # script di setup dell'ambiente Python (venv + faster-whisper)
├── trascrivi.py           # utility da riga di comando per trascrivere un file audio
└── WhisperPill/            # app Electron (pillola + impostazioni)
    ├── main.js              # processo principale: finestre, hotkey, IPC, stato
    ├── preload.js           # bridge sicuro tra main e renderer
    ├── sttBridge.js         # gestisce il sottoprocesso Python (protocollo JSON su stdin/stdout)
    ├── hotkeys.js           # motore scorciatoie globali (uiohook-napi)
    ├── setupRunner.js       # esegue setup_whisper.ps1 e ne trasmette l'output
    ├── config.js            # impostazioni persistenti (electron-store)
    └── renderer/            # HTML/CSS/JS di pillola, impostazioni e setup
```

### Backend Python

```bash
python -m venv .venv
.venv\Scripts\python.exe -m pip install faster-whisper sounddevice huggingface_hub
```

(oppure semplicemente esegui `setup_whisper.ps1`, usato anche dall'app stessa).

`stt_service.py` comunica tramite righe JSON su stdin/stdout: comandi come `{"cmd": "start"}` in ingresso, eventi come `{"event": "result", "text": "..."}` in uscita. Vedi l'intestazione del file per il protocollo completo.

### App Electron

```bash
cd WhisperPill
npm install
npm start
```

Per impostazione predefinita, in modalità sviluppo l'app cerca il backend Python nella cartella padre (`..`, cioè `whisper-ai/`). Una volta impacchettata, punta invece a `~/Documents/claude/whisper-ai` — sovrascrivibile con la variabile d'ambiente `WHISPERPILL_HOME` se il tuo backend vive altrove.

### Creare l'installer

```bash
cd WhisperPill
npm run dist
```

Genera sia l'installer NSIS che la versione portable in `WhisperPill/dist`.

## Domande frequenti

**È gratis?** Sì, codice aperto sotto licenza MIT.

**Serve una connessione internet?** Solo per l'installazione iniziale e per scaricare i modelli la prima volta. La trascrizione vera e propria funziona **offline**.

**L'audio viene inviato a qualche server?** No. Tutto — registrazione e trascrizione — avviene sul tuo PC.

**Funziona su macOS o Linux?** No, al momento è pensato solo per Windows (scorciatoie globali, auto-type e installer sono specifici per Windows).

**Quanto è precisa la trascrizione?** Dipende dal modello scelto: vedi [Quale modello scegliere](#quale-modello-scegliere). Con `small` o superiore, l'italiano parlato chiaramente viene trascritto con buona accuratezza.

## Note tecniche

- I modelli Whisper vengono scaricati in `whisper-ai/models/<taglia>/` invece della cache di Hugging Face, così l'app sa sempre con certezza cosa è già scaricato.
- La scorciatoia di attivazione viene riservata anche tramite l'API `globalShortcut` di Electron, per evitare che raggiunga anche l'applicazione in primo piano.
- Se una trascrizione viene annullata mentre è già in corso, il backend la invalida tramite un numero di generazione: il risultato, se arriva comunque, viene scartato in silenzio.

## Licenza

[MIT](LICENSE) — vedi il file per il testo completo.

---

*Parole chiave: dettatura vocale Windows, speech-to-text locale, trascrizione vocale offline, voice typing app, Whisper AI dictation, push-to-talk transcription, alternativa gratuita a Dragon NaturallySpeaking.*
