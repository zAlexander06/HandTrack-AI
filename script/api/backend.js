const server = "http://localhost:5050";
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
        const response = await fetch(server + "/salva", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                cartella: cartella,
                righe: righe,
                timestamp: Date.now().toString()
            }),
        });
        return response.ok;
    } catch (e) {
        console.warn("Errore invio server:", e);
        return false;
    }
}