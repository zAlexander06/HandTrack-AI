let dizionario_parole = {};
let tutte_le_parole = [];

export async function caricaDizionarioItaliano() {
    const percorsoLocale = "./script/dizionario/dizionario_it.json";

    try {
        console.log("[Dizionario] Caricamento...");
        const ris = await fetch(percorsoLocale);
        if (!ris.ok) throw new Error(`HTTP ${ris.status}`);

        dizionario_parole = await ris.json();

        const set_parole = new Set(
            Object.values(dizionario_parole)
                .flat()
                .map(p => String(p).toLowerCase())
        );
        tutte_le_parole = [...set_parole];

        console.log(`[Dizionario] ${tutte_le_parole.length} parole caricate`);

        const info = document.getElementById("info");
        if (info) info.textContent = "Modello e Dizionario pronti!";

    } catch (err) {
        console.error("[Dizionario] Errore:", err.message);
    }
}

function calcolaDistanzaLevenshtein(a, b) {
    const strA = a.toLowerCase();
    const strB = b.toLowerCase();
    const righe = strA.length + 1;
    const cols = strB.length + 1;

    const mat = Array.from({ length: righe }, () => new Array(cols).fill(0));
    for (let i = 0; i < righe; i++) mat[i][0] = i;
    for (let j = 0; j < cols; j++) mat[0][j] = j;

    for (let i = 1; i < righe; i++) {
        for (let j = 1; j < cols; j++) {
            if (strA[i - 1] === strB[j - 1]) {
                mat[i][j] = mat[i - 1][j - 1];
            } else {
                mat[i][j] = 1 + Math.min(
                    mat[i - 1][j - 1],
                    mat[i][j - 1],
                    mat[i - 1][j]
                );
            }
        }
    }

    return mat[righe - 1][cols - 1];
}

export function ottieniSuggerimenti(fraseCompleta, limite = 3) {
    if (!fraseCompleta?.trim() || !tutte_le_parole.length) return [];

    const parole = fraseCompleta.trim().split(/\s+/);
    const ultimaParola = parole[parole.length - 1].toLowerCase();

    if (ultimaParola.length < 2) return [];

    const perPrefisso = tutte_le_parole
        .filter(p => p.startsWith(ultimaParola) && p !== ultimaParola)
        .slice(0, limite);

    if (perPrefisso.length >= limite) return perPrefisso;

    const soglia = Math.max(1, Math.floor(ultimaParola.length / 4));
    const set_prefisso = new Set(perPrefisso);

    const perLevenshtein = tutte_le_parole
        .filter(p => !set_prefisso.has(p) && Math.abs(p.length - ultimaParola.length) <= soglia)
        .map(p => ({ p, d: calcolaDistanzaLevenshtein(ultimaParola, p) }))
        .filter(({ d }) => d <= soglia)
        .sort((a, b) => a.d - b.d)
        .slice(0, limite - perPrefisso.length)
        .map(({ p }) => p);

    return [...perPrefisso, ...perLevenshtein];
}