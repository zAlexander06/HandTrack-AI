const server = "http://127.0.0.1:5050";
let server_connesso = false;

export async function verifica_server() {
    const labelDlDir = document.getElementById("labelCartellaDownload");

    try {
        const risp = await fetch(server + "/ping", {
            signal: AbortSignal.timeout(2000)
        });

        server_connesso = (await risp.text()) === "pong";
        console.log(server_connesso ? "Server Connesso" : "Server Non Connesso");

        if (server_connesso && labelDlDir) {
            labelDlDir.style.display = "none";
        }
    }
    catch (e) {
        server_connesso = false;
        console.warn("Errore di connessione al server:" + e);

        labelDlDir.style.display = "inline-block";
    }

    return server_connesso;
}

export async function salva_csv_backend(cartella, ris) {
    if (!server_connesso || !ris?.landmarks?.length) return false;

    const righe_csv = ris.landmarks.flatMap((lms, i) => {
        const handedness = ris.handedness?.[i]?.[0]?.displayName ?? "Unknown";
        return Array.from(lms).map((lm, j) => [
            i,
            handedness,
            j,
            lm.x.toFixed(6),
            lm.y.toFixed(6),
            lm.z.toFixed(6)
        ]);
    });

    try {
        const response = await fetch(server + "/salva", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                // IMPORTANTE SE SI VUOLE CAMBIARE LA ROOT DEL SALVATAGGIO
                cartella: "../../" + cartella,
                timestamp: Date.now().toString(),
                righe: righe_csv
            })
        });
        return response.ok;
    } catch (e) {
        console.error("Errore invio:", e.message);
        server_connesso = false;
        return false;
    }
}