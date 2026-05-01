@echo off
setlocal enabledelayedexpansion

:: Controllo se Python esiste
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Python non trovato. Installazione in corso...
    
    :: Scarica l'installer
    powershell -Command "Invoke-WebRequest -Uri https://python.org -OutFile python-installer.exe"
    
    echo Installazione silenziosa... attendere...
    start /wait python-installer.exe /quiet InstallAllUsers=1 PrependPath=1 Include_test=0
    
    del python-installer.exe
    
    :: Aggiorna il PATH per la sessione corrente senza riavviare il CMD
    for /f "tokens=*" %%i in ('where python 2^>nul') do set "PYTHON_PATH=%%i"
    if "!PYTHON_PATH!"=="" (
        echo Python installato ma non ancora visibile nel PATH. 
        echo Per favore, riavvia il terminale e lancia di nuovo lo script.
        pause
        exit /b 1
    )
    echo Python installato con successo.
) else (
    echo Python e gia installato.
)

:: Creazione ambiente virtuale
if not exist .venv (
    echo Creazione ambiente virtuale...
    python -m .venv .venv
) else (
    echo Ambiente virtuale gia esistente.
)

:: Attivazione e installazione dipendenze
echo Attivazione venv e aggiornamento pip...
call .venv\Scripts\activate

python -m pip install --upgrade pip

if exist requirements.txt (
    echo Installazione dipendenze da requirements.txt...
    pip install -r requirements.txt
) else (
    echo 'requirements.txt' non trovato, salto installazione librerie.
)

echo.
echo Procedura completata! L'ambiente e pronto.
pause
