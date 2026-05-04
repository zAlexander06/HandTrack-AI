const server = "http://127.0.0.1:5050";
let server_connesso = false;

export async function verifica_server() {
    try {
        const risp = await fetch(server + "/ping", {
            signal: AbortSignal.timeout(2000)
        });

        server_connesso = (await risp.text()) === "pong";
        console.log(server_connesso ? "Server Connesso" : "Server Non Connesso");
    }
    catch (e) {
        server_connesso = false;
        console.warn("Errore di connessione al server:" + e);
    }

    return server_connesso;
}

// In backend.js
export async function salva_csv_backend(cartella, ris) {
    if (!server_connesso || !ris?.landmarks?.length) return false;

    const righe = ris.landmarks.flatMap((lms, i) => {
        const handedness = ris.handedness?.[i]?.[0]?.displayName ?? "Unknown";
        return lms.map((lm, j) => [
            i, handedness, j,
            lm.x.toFixed(6), lm.y.toFixed(6), lm.z.toFixed(6)
        ]);
    });

    try {
        const response = await fetch('http://localhost:5050/salva', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                folder: cartella,
                landmarks: dati.landmarks,
                handedness: dati.handedness
            })
        });
        return response.ok;
    } catch (e) {
        console.error("Errore invio dati al server C++:", e);
        return false;
    }
}