const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const PORT = 5500;

const rootPath = path.join(__dirname, '..');
const rootProject = path.basename(rootPath);

const isWin = process.platform === 'win32';
const nomeProgramma = isWin ? 'server_win.exe' : 'server_linux';
const cppServerPath = path.join(__dirname, 'api', nomeProgramma);

let cppProcess = null;

function startCppBackend() {
    if (!fs.existsSync(cppServerPath)) {
        console.warn(`${cppServerPath} non trovato — solo download CSV`);
        return;
    }

    console.log(`Avvio da: ${cppServerPath}\n`);
    console.log(`Sistema Rilevato: ${isWin ? 'Windows' : 'Linux/Codespaces'}\n`)

    if (!isWin) {
        try {
            console.log("Assegnazione permessi di esecuzione a server_linux...");
            execSync(`chmod +x "${cppServerPath}"`);
        } catch (chmodErr) {
            console.warn("Errore durante il chmod: ", chmodErr.message);
        }
    }

    const args = [`--root "${rootPath}"`, `--dataset "Segni"`];

    if (isWin) {
        cppProcess = spawn(cppServerPath, ["--root", rootPath, "--dataset", "Segni"], {
            cwd: path.join(__dirname, 'api'),
            stdio: 'inherit'
        });
    }
    else {
        cppProcess = spawn(`./${nomeProgramma} ${args.join(' ')}`, {
            cwd: path.join(__dirname, 'api'),
            stdio: 'inherit',
            shell: true
        });
    }

    cppProcess.on('error', (err) => {
        console.error("Errore avvio:", err.message);
        cppProcess = null;
    });

    cppProcess.on('close', (code) => {
        console.log(`Chiuso (codice: ${code})`);
        cppProcess = null;
    });
}

function cleanup() {
    if (cppProcess) {
        console.log("\nChiusura server C++...");
        cppProcess.kill();
        cppProcess = null;
    }
    process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

app.use(express.static(rootPath));

app.listen(PORT, (err) => {
    if (err) {
        console.error("Errore avvio:", err.message);
        process.exit(1);
    }

    console.log("========================================");
    console.log(`FRONTEND:  http://localhost:${PORT}`);
    console.log(`PROGETTO:  ${rootProject}`);
    console.log("========================================\n");

    startCppBackend();
});