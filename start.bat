@echo off
setlocal
chcp 65001 >nul

echo AVVIO AMBIENTE DI LAVORO
echo.

:: Controllo Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERRORE: Node.js non trovato. Scaricalo da https://nodejs.org/
    pause
    exit /b 1
)
echo Node.js trovato
echo.

:: Controllo npm
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo ERRORE: npm non trovato.
    pause
    exit /b 1
)
echo npm trovato.
echo.

:: Installazione moduli se mancanti
if not exist "node_modules\" (
    echo INFO: Moduli mancanti - installazione in corso...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo ERRORE: npm install fallito.
        pause
        exit /b 1
    )
    echo Moduli installati.
) else (
    echo Moduli gia' presenti.
)

echo.

echo Avvio frontend...
start "Frontend" /min cmd /k "npm start"

timeout /t 3 >nul
start "" "http://localhost:5500"

echo.
echo Tutto avviato.
echo.
pause