# setup_whisper.ps1
# Installa faster-whisper (+ openai-whisper come opzione) in un ambiente virtuale Python
# dentro questa cartella. Pensato per trascrizione audio in italiano.
#
# Uso: apri PowerShell in questa cartella e lancia:
#   .\setup_whisper.ps1
#
# Se PowerShell blocca gli script, esegui prima (una volta sola):
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host "== Verifica Python ==" -ForegroundColor Cyan
$pythonCmd = $null
foreach ($cand in @("python", "py")) {
    try {
        $v = & $cand --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $pythonCmd = $cand
            Write-Host "Trovato: $cand ($v)"
            break
        }
    } catch {}
}
if (-not $pythonCmd) {
    Write-Host "Python non trovato nel PATH." -ForegroundColor Red
    Write-Host "Installalo da https://www.python.org/downloads/ (spunta 'Add python.exe to PATH') e rilancia questo script."
    exit 1
}

Write-Host "== Verifica ffmpeg ==" -ForegroundColor Cyan
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) {
    Write-Host "ffmpeg non trovato nel PATH." -ForegroundColor Yellow
    Write-Host "Whisper ne ha bisogno per leggere mp3/mp4/altri formati (i .wav a volte funzionano anche senza)."
    Write-Host "Installalo con: winget install ffmpeg   (oppure scaricalo da https://ffmpeg.org/download.html)"
    Write-Host "Puoi continuare l'installazione ora e aggiungere ffmpeg dopo."
}
else {
    Write-Host "Trovato: $($ffmpeg.Source)"
}

Write-Host "== Creazione ambiente virtuale (.venv) ==" -ForegroundColor Cyan
if (-not (Test-Path ".venv")) {
    & $pythonCmd -m venv .venv
}
else {
    Write-Host ".venv esiste gia', lo riuso."
}

$venvPython = Join-Path $here ".venv\Scripts\python.exe"

Write-Host "== Aggiornamento pip ==" -ForegroundColor Cyan
& $venvPython -m pip install --upgrade pip

Write-Host "== Installazione faster-whisper ==" -ForegroundColor Cyan
& $venvPython -m pip install faster-whisper

Write-Host ""
Write-Host "Fatto! faster-whisper e' installato in .venv" -ForegroundColor Green
Write-Host ""
Write-Host "Per trascrivere un file audio in italiano:"
Write-Host "  .\.venv\Scripts\python.exe trascrivi.py percorso\del\tuo\file.mp3"
Write-Host ""
Write-Host "La prima volta scarichera' il modello (qualche centinaio di MB, serve internet)."
