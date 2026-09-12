# WhisperBar

Una pillola flottante per dettare testo in qualsiasi applicazione Windows, con trascrizione locale (nessun audio inviato a servizi esterni) tramite [faster-whisper](https://github.com/SYSTRAN/faster-whisper).

Tieni premuta una scorciatoia, parla, rilascia: il testo trascritto viene copiato negli appunti e/o digitato automaticamente dove stai scrivendo.

## Funzionalità

- **Pillola flottante** sempre in primo piano, con stati per ascolto, elaborazione, risultato (compatto/espanso) ed errore
- **Tre modalità di attivazione**: tieni premuto (push-to-talk), tocca per avviare/fermare, o solo dalla system tray
- **Output configurabile**: copia negli appunti, digitazione automatica nella finestra attiva, o solo visualizzazione nella pillola
- **Gestione modelli integrata**: scarica/elimina i modelli Whisper (tiny → large-v3) dalle Impostazioni, con avanzamento in tempo reale; nessuna cache nascosta, tutto in una cartella `models/` dedicata
- **Setup automatico al primo avvio**: se l'ambiente Python non è pronto, propone di installarlo mostrando il log in diretta
- **Annulla in qualsiasi momento**: Esc o la X sulla pillola interrompono ascolto o elaborazione in corso
- Tema chiaro/scuro automatico, scorciatoia riassegnabile, selezione lingua e microfono

## Requisiti

- Windows 10/11
- Per l'uso quotidiano: nessuno, l'installer configura tutto
- Per build/sviluppo: [Node.js](https://nodejs.org/) 18+ e [Python](https://www.python.org/) 3.10+

## Installazione

Scarica ed esegui `WhisperBar Setup <versione>.exe` da [`WhisperBar/dist`](WhisperBar/dist) (generato con `npm run dist`, vedi [Sviluppo](#sviluppo)), oppure usa la versione portable `WhisperBar-<versione>-portable.exe` senza installare nulla.

> L'eseguibile non è firmato digitalmente: Windows SmartScreen potrebbe avvisare al primo avvio. Scegli **Ulteriori informazioni → Esegui comunque**.

Al primo avvio, se l'ambiente di trascrizione non è ancora installato, WhisperBar propone di configurarlo automaticamente (crea un virtualenv Python e installa `faster-whisper`), poi chiede quali modelli scaricare.

## Utilizzo

- Scorciatoia di default: `Control+Shift+Space`, modalità "tieni premuto"
- Cambia scorciatoia, modalità, lingua, modello e output da **Impostazioni** (icona nella system tray)
- `Esc` o la X sulla pillola annullano ascolto/elaborazione in corso

## Sviluppo

Il progetto ha due parti:

```
whisper-ai/
├── stt_service.py       # backend Python: registrazione + trascrizione + gestione modelli
├── setup_whisper.ps1     # script di setup dell'ambiente Python (venv + faster-whisper)
├── trascrivi.py          # utility da riga di comando per trascrivere un file audio
└── WhisperBar/           # app Electron (pillola + impostazioni)
    ├── main.js            # processo principale: finestre, hotkey, IPC, stato
    ├── preload.js         # bridge sicuro tra main e renderer
    ├── sttBridge.js       # gestisce il sottoprocesso Python (protocollo JSON su stdin/stdout)
    ├── hotkeys.js         # motore scorciatoie globali (uiohook-napi)
    ├── setupRunner.js     # esegue setup_whisper.ps1 e ne trasmette l'output
    ├── config.js          # impostazioni persistenti (electron-store)
    └── renderer/          # HTML/CSS/JS di pillola, impostazioni e setup
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
cd WhisperBar
npm install
npm start
```

Per impostazione predefinita, in modalità sviluppo l'app cerca il backend Python nella cartella padre (`..`, cioè `whisper-ai/`). Una volta impacchettata, punta invece a `~/Documents/claude/whisper-ai` — sovrascrivibile con la variabile d'ambiente `WHISPERBAR_HOME` se il tuo backend vive altrove.

### Creare l'installer

```bash
cd WhisperBar
npm run dist
```

Genera sia l'installer NSIS che la versione portable in `WhisperBar/dist`.

## Note tecniche

- I modelli Whisper vengono scaricati in `whisper-ai/models/<taglia>/` invece della cache di Hugging Face, così l'app sa sempre con certezza cosa è già scaricato.
- La scorciatoia di attivazione viene riservata anche tramite l'API `globalShortcut` di Electron, per evitare che raggiunga anche l'applicazione in primo piano.
- Se una trascrizione viene annullata mentre è già in corso, il backend la invalida tramite un numero di generazione: il risultato, se arriva comunque, viene scartato in silenzio.

## Licenza

[MIT](LICENSE)
