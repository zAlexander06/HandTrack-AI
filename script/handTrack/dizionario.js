let dizionario_parole = {};

export async function caricaDizionarioItaliano() {
    const percorsoLocale = "./script/dizionario/dizionario_it.json";

    try {
        console.log("[DIZIONARIO] Caricamento del file JSON...");
        const ris = await fetch(percorsoLocale);

        if(!ris.ok){
            throw new Error("Errore nel caricamento del file JSON");
            return;
        }

        dizionario_parole = await ris.json();
        console.log(`[DIZIONARIO] Dizionario caricata con successo, ${Object.keys(dizionario_parole).length} parole in totale!`);

        const info = document.getElementById("info");
        if (info && info.textContent === "Carica modello...") info.textContent = "Modello e Dizionario pronti!";
    }
    catch (err) {
        console.error("Errore nel caricamento del file JSON", err);
    }
}

export function ottieniSuggerimenti(testoAttuale) {
    if (!testoAttuale) return [];

    const parole = testoAttuale.trim().split(" ");
    const ultimaParola = parole[parole.length - 1].toUpperCase();

    if (ultimaParola.length === 0) return [];

    const primaLettera = ultimaParola[0];

    if(!dizionario_parole[primaLettera]) return [];

    return dizionario_parole[primaLettera].filter(
        p => p.startsWith(ultimaParola) && p != ultimaParola
    ).slice(0, 3);
}