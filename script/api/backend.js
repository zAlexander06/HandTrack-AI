const server = `${window.location.protocol}//${window.location.hostname}:5050`;
let server_connesso = false;

export async function verifica_server() {
    const labelDlDir = document.getElementById("labelCartellaDownload");

    try {
        const risp = await fetch(`${server}/ping`, {
            signal: AbortSignal.timeout(2000)
        });

        server_connesso = (await risp.text()) === "pong";
        console.log(server_connesso ? "Server Connesso" : "Server Non connesso");

        if (labelDlDir)
            labelDlDir.style.display = server_connesso ? "none" : "inline-block";

    } catch (e) {
        server_connesso = false;
        console.warn("Errore connessione:", e.message);

        if (labelDlDir) labelDlDir.style.display = "inline-block";
    }

    return server_connesso;
}

export async function salva_csv_backend(cartella, ris) {
    if (!server_connesso || !ris?.landmarks?.length) return false;

    const infoMani = ris.handednesses ?? ris.handedness ?? [];

    const righe_csv = [];

    for (let i = 0; i < ris.landmarks.length; i++) {
        const lms = ris.landmarks[i];
        const info = infoMani?.[i]?.[0];

        let label = info?.displayName ?? info?.categoryName ?? "Unknown";

        for (let j = 0; j < lms.length; j++) {
            const lm = lms[j];

            righe_csv.push([
                i, label, j,
                lm.x.toFixed(6),
                lm.y.toFixed(6),
                lm.z.toFixed(6)
            ]);
        }
    }

    try {
        const response = await fetch(`${server}/salva`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                cartella,
                timestamp: Date.now().toString(),
                righe: righe_csv,
            }),
        });
        return response.ok;
    } catch (e) {
        console.error("Errore invio:", e.message);
        server_connesso = false;
        return false;
    }
}

export const isServerConnesso = () => { return server_connesso; }
export const getServer = () => { return server; }