@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

echo Avvio setup ambiente Completo
echo.

echo [PYTHON]

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Python non trovato. Installazione in corso...

    powershell -Command "Invoke-WebRequest -Uri https://www.python.org/ftp/python/3.11.0/python-3.11.0-amd64.exe -OutFile python-installer.exe"

    echo Installazione silenziosa...
    start /wait python-installer.exe /quiet InstallAllUsers=1 PrependPath=1 Include_test=0

    del python-installer.exe

    python --version >nul 2>&1
    if %errorlevel% neq 0 (
        echo ERRORE: Python installato ma non disponibile nel PATH.
        echo Riavvia il terminale e rilancia lo script.
        pause
        exit /b 1
    )

    echo Python installato con successo.
) else (
    echo Python gia installato.
)

echo.

if not exist ".venv" (
    echo Creazione ambiente virtuale con Python 3.11...

    py -3.11 -m venv .venv
    
    if %errorlevel% neq 0 (
        echo Tentativo alternativo...
        python -m venv .venv
    )
) else (
    echo Ambiente virtuale gia esistente.
)

call .venv\Scripts\activate

echo Aggiornamento pip...
python -m pip install --upgrade pip

if exist requirements.txt (
    echo Installazione dipendenze Python...
    pip install -r requirements.txt -qq
) else (
    echo requirements.txt non trovato.
)

echo.
echo Python pronto.
echo.

echo [NODE]

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERRORE: Node.js non trovato.
    echo Scaricalo da: https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js trovato.

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo ERRORE: npm non trovato.
    pause
    exit /b 1
)

echo npm trovato.
echo.

if not exist "node_modules\" (
    echo Installazione moduli Node...
    call npm install
    if %errorlevel% neq 0 (
        echo ERRORE: npm install fallito.
        pause
        exit /b 1
    )
    echo Moduli installati.
) else (
    echo Moduli gia presenti.
)

echo.

echo Avvio frontend...
start "Frontend" /min cmd /k "npm start"

timeout /t 3 >nul
start "" "http://localhost:5500"

echo.
echo TUTTO PRONTO
pause