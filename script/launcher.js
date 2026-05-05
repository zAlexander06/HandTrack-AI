const { spawn } = require('child_process');
const path = require('path');
const express = require('express');

const app = express();
const PORT = 5500;
const cppServerPath = path.join(__dirname, 'api', 'server.exe');

let cppProcess = null;

function startCppBackend() {
    const fs = require('fs');
    if (!fs.existsSync(cppServerPath)) {
        console.warn("server.exe non trovato — salvataggio CSV solo via download");
        return;
    }

    console.log(`Avvio server C++ da: ${cppServerPath}`);

    cppProcess = spawn(cppServerPath, [], {
        cwd: path.join(__dirname, 'api'),
        stdio: 'inherit'
    });

    cppProcess.on('error', (err) => {
        console.error("Errore avvio:", err.message);
    });

    cppProcess.on('close', (code) => {
        console.log(`Server C++ chiuso (codice: ${code})`);
        cppProcess = null;
    });
}

function inviaAlBackend(dati) {
    if (cppProcess && cppProcess.stdin.writable) {
        const jsonString = JSON.stringify(dati);
        cppProcess.stdin.write(jsonString + "\n");
    }
}

function cleanup() {
    if (cppProcess) {
        console.log("\nChiusura server C++...");
        cppProcess.kill();
    }
    process.exit(0);
}

process.on('SIGINT', cleanup);   // Ctrl+C
// process.on('SIGTERM', cleanup);   // kill
process.on('exit', cleanup);

const rootPath = path.join(__dirname, '..');
const rootProject = path.basename(rootPath);
app.use(express.static(rootPath));

app.listen(PORT, (err) => {
    if (err) {
        console.error("[Server] Errore avvio:", err.message);
        process.exit(1);
    }

    console.log("========================================");
    console.log(`FRONTEND:  http://localhost:${PORT}`);
    console.log(`PROGETTO:  ${rootProject}`);
    console.log("========================================");

    startCppBackend();
});