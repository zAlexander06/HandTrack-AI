import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";
//import { landmarks_canvas, info_panel_canvas, predizione_panel_canvas, topbar_canvas, conferma_overlay_canvas } from "./camera_canvas.js";
//import { isServerConnesso, getServer, verifica_server, salva_csv_backend } from "../api/backend.js";
import { caricaDizionarioItaliano, ottieniSuggerimenti } from "./dizionario.js";

// Stub canvas overlay functions — not used in call context
const landmarks_canvas = () => {};
const info_panel_canvas = () => {};
const predizione_panel_canvas = () => {};
const topbar_canvas = () => {};
const conferma_overlay_canvas = () => {};

// Costanti
const smooth_n = 8;
const n_landmarks = 21;
const DETECT_OGNI = 2;
const model_url = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";

export const etichette_modello = [
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
    "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
    "spazio", "del", "canc"
];

const alfabeto_it = new Set(etichette_modello.filter(e => e.length === 1));

const tasti_speciali = {
    " ": 'spazio',
    "Backspace": "del",
    "Delete": "canc"
}


// Variabili globali
let handLandmarker = null;
let ultimo_risultato = null;
let ultimo_video_time = -1;
let frame_count = 0;
let ultimo_fps = 0;
let ultimo_frame_time = performance.now();

let pred_buf = [];
let ultima_pred = { lettera: null, confidenza: 0, top3: [] };

let csv_row = [];
let csv_counter = 0;
let salvataggio_in_corso = false;
let isRecording = false;

let status = "fermo"; // fermo | conferma | registrazione
let cartella_dati = "";

let ia_model = null;
let label = [];

// parte dei sottotitoli
let fraseAttuale = "";
let ultimaLetteraRiconosciuta = "";
let ultima_frase_suggerita = "";
let cover_transform_cache = null;
let cover_transform_dirty = true;
let suggerimenti_in_coda = false;
let ultimi_suggerimenti_renderizzati = "";
let contatoreStabilita = 0;
const soglia_stabilita = 12;


async function initMediaPipe() {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );
    try {
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 2,
        });
        console.log("Mediapipe:\nGPU attiva");
    } catch {
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
                delegate: "CPU"
            },
            runningMode: "VIDEO",
            numHands: 2,
        });
        console.log("Mediapipe:\nFallback CPU");
    }
    console.log("Mediapipe:\nHandLandmarker pronto");
}

// Caricamento modello IA (ONNX)
async function carica_modello_ia() {
    const info = document.getElementById("info");

    try {
        const pathONNX = "./script/modello/modello_lis_italiano.onnx";
        const pathJSON = "./script/modello/labels.json";

        const check = await fetch(pathJSON);
        if (!check.ok) {
            console.warn("IA: Modello non trovato, modalità solo raccolta dati.");
            return;
        }

        [ia_model, label] = await Promise.all([
            ort.InferenceSession.create(pathONNX),
            check.json()
        ]);

        console.log("AI: Modello caricato con successo! Classi:", label);

        if (info) info.textContent = "Modello IA Pronto";
    } catch (e) {
        console.error("AI: Errore durante il caricamento:", e);
        if (info) info.textContent = "Modalità acquisizione";
    }
}

// Camera
window.startCamera = function (video) {
    if (!video) { console.warn("Oggetto 'video' non trovato"); return; }

    // Se il flusso è già impostato da WebRTC, usa quello
    if (video.srcObject) {
        video.addEventListener("loadeddata", () => loop_handTracker(), { once: true });
        if (video.readyState >= 2) loop_handTracker();
        return;
    }

    navigator.mediaDevices
        .getUserMedia({
            video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "user", }
        })
        .then(stream => {
            video.srcObject = stream;
            video.addEventListener("loadeddata", () => {
                console.log(`Risoluzione Camera: ${video.videoWidth}x${video.videoHeight}`);
                loop_handTracker();
            });
        })
        .catch(e => {
            const el = document.getElementById("info");
            if (el) el.textContent = "Errore camera: " + e.message;
            console.error("Errore camera:", e);
        });
};

// CSV
function csv_header() {
    return ["hand_index", "handedness", "lm_index", "x", "y", "z"].join(",");
}

function raccogli_csv_files(ris) {
    const infoMani = ris.handednesses ?? ris.handedness ?? [];

    ris.landmarks.forEach((lms, i) => {
        const info = infoMani?.[i]?.[0];
        const hand = info?.displayName ?? info?.categoryName ?? "Unknown";

        Array.from(lms).forEach((lm, j) => {
            csv_row.push([i, hand, j,
                lm.x.toFixed(6), lm.y.toFixed(6), lm.z.toFixed(6)].join(","));
        });
    });
}

async function gestisci_salvataggio(ris, video, canvas) {
    if (!isRecording || !ris?.landmarks?.length) return;

    if (!Array.isArray(ris.landmarks)) return;

    const raw_handedness = ris.handedness ?? ris.handednesses ?? [];

    const indici_visibili = ris.landmarks
        .map((_, i) => i)
        .filter(i => mano_visibile(ris.landmarks[i], video, canvas));

    if (!indici_visibili.length) return;

    const ris_filtrato = {
        landmarks: indici_visibili.map(i => ris.landmarks[i]),

        handedness: indici_visibili.map(i => {
            const info = raw_handedness[i]?.[0];
            if (!info) return [];

            const correctedInfo = { ...info };
            const labelRaw = info.displayName ?? info.categoryName;

            if (labelRaw === "Left") {
                correctedInfo.displayName = "Right";
                correctedInfo.categoryName = "Right";
            } else if (labelRaw === "Right") {
                correctedInfo.displayName = "Left";
                correctedInfo.categoryName = "Left";
            }

            return [correctedInfo];
        })
    };

    raccogli_csv_files(ris_filtrato);
    csv_counter++;
}

function salva_csv() {
    if (!csv_row.length) return;

    const contenuto = [csv_header(), ...csv_row].join("\n");
    const blob = new Blob([contenuto], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = `${cartella_dati || "dataset"}_backup.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// Feature vector
function landmarks_to_feature_vector(handLandmarks) {
    if (!handLandmarks || handLandmarks.length < 21) return null;

    const feat = new Float32Array(63);

    const wx = handLandmarks[0].x ?? 0;
    const wy = handLandmarks[0].y ?? 0;
    const wz = handLandmarks[0].z ?? 0;

    let haDatiValidi = false;

    for (let i = 0; i < 21; i++) {
        const pt = handLandmarks[i];
        const off = i * 3;

        feat[off] = (pt.x ?? 0) - wx;
        feat[off + 1] = (pt.y ?? 0) - wy;
        feat[off + 2] = (pt.z ?? 0) - wz;

        if (feat[off] !== 0 || feat[off + 1] !== 0) haDatiValidi = true;
    }

    if (!haDatiValidi) {
        console.warn("[AI] Vettore nullo — tutti zeri");
        return feat;
    }

    if (feat[5 * 3] < 0) {
        for (let i = 0; i < 21; i++) {
            feat[i * 3] *= -1;
        }
    }

    let maxVal = 0;
    for (let i = 0; i < 63; i++) {
        const v = Math.abs(feat[i]);
        if (v > maxVal) maxVal = v;
    }

    if (maxVal > 0) {
        for (let i = 0; i < 63; i++) {
            feat[i] /= maxVal;
        }
    }

    return feat;
}

// transform
function get_cover_transform(video, canvas_el) {
    const vW = video.videoWidth, vH = video.videoHeight;
    const cW = canvas_el.clientWidth, cH = canvas_el.clientHeight;

    if (!vW || !vH || !cW || !cH) return { scale: 1, offsetX: 0, offsetY: 0 };

    const vRatio = vW / vH;
    const cRatio = cW / cH;
    let scale, offsetX, offsetY;

    if (vRatio > cRatio) {
        scale = cH / vH;
        offsetX = (cW - vW * scale) / 2;
        offsetY = 0;
    } else {
        scale = cW / vW;
        offsetX = 0;
        offsetY = (cH - vH * scale) / 2;
    }

    return { scale, offsetX, offsetY };
}

function landmark_visibile(lm, video, canvas) {
    const { scale, offsetX, offsetY } = get_cover_transform(video, canvas);
    const x = lm.x * video.videoWidth * scale + offsetX;
    const y = lm.y * video.videoHeight * scale + offsetY;
    return x >= 0 && x <= canvas.width && y >= 0 && y <= canvas.height;
}

function mano_visibile(landmarks, video, canvas) {
    if (!landmarks) return false;
    return Array.from(landmarks).every(lm => landmark_visibile(lm, video, canvas));
}

// Predizione AI
async function predici_lettera(landmarks) {
    if (!ia_model || !Array.isArray(landmarks) || !landmarks.length)
        return { lettera: null, confidenza: 0, top3: [] };

    const feat = landmarks_to_feature_vector(landmarks);

    if (!feat || feat.length !== 63) {
        console.error(`Errore Dimensioni: attesi 63, ottenuti ${feat.length}. Verificare landmarks_to_feature_vector.`);
        return { lettera: null, confidenza: 0, top3: [] };
    }

    try {
        const tensor = new ort.Tensor("float32", feat, [1, 63]);
        const output = await ia_model.run({ [ia_model.inputNames[0]]: tensor });
        const proba = output[ia_model.outputNames[0]].data;

        const top3idx = Array.from(proba)
            .map((prob, i) => ({ prob, i }))
            .sort((a, b) => b.prob - a.prob)
            .slice(0, 3);

        const top3 = top3idx.map(({ prob, i }) => [label[i], prob]);

        return { lettera: top3[0][0], confidenza: top3[0][1], top3 };
    } catch (e) {
        console.error("Errore durante l'esecuzione del modello:", e);
        return { lettera: null, confidenza: 0, top3: [] };
    }
}

async function aggiorna_predizione(landmarks) {
    const { lettera, confidenza, top3 } = await predici_lettera(landmarks);

    if (!lettera) {
        pred_buf = [];
        return { lettera: null, confidenza: 0, top3: [] };
    }

    pred_buf.push({ lettera, confidenza, top3 });
    if (pred_buf.length > smooth_n) pred_buf.shift();

    const let_smooth = {};
    const conf_smooth = {};
    pred_buf.forEach(({ lettera: l, confidenza: c, top3: t }) => {
        let_smooth[l] = (let_smooth[l] || 0) + c;
        conf_smooth[l] = t;
    });

    const best_lettera = Object.keys(let_smooth).reduce((a, b) =>
        let_smooth[a] > let_smooth[b] ? a : b
    );

    const conf_grezzo = let_smooth[best_lettera] ?? 0;
    const len = pred_buf.length || 1;

    return { lettera: best_lettera ?? null, confidenza: conf_grezzo / len, top3: conf_smooth[best_lettera] || [] };
}

// Dita alzate
function ditaAlzate(landmarks, handedness) {
    const alzate = [];
    alzate.push(handedness === "Right" ? landmarks[4].x > landmarks[3].x : landmarks[4].x < landmarks[3].x);
    [[8, 6], [12, 10], [16, 14], [20, 18]].forEach(([punta, pip]) => {
        alzate.push(landmarks[punta].y < landmarks[pip].y);
    });
    return alzate;
}

// Sottotitoli per le mani
function scheduleSuggerimenti(frase) {
    if (suggerimenti_in_coda) return;
    suggerimenti_in_coda = true;

    const callback = () => {
        suggerimenti_in_coda = false;
        const nuovi = ottieniSuggerimenti(frase);
        mostraBottoniSuggerimento(nuovi);
    };

    if ("requestIdleCallback" in window) requestIdleCallback(callback, { timeout: 150 });
    else setTimeout(callback, 0);
}

function gestisciNuovoSegnoPredetto(letteraPredetta, confidenza) {
    const elementoSottotitoli = document.getElementById("sottotitoli-testo");
    if (!elementoSottotitoli) return;

    if (!letteraPredetta || letteraPredetta === "Nessun Segno") {
        ultimaLetteraRiconosciuta = "";
        contatoreStabilita = 0;
        return;
    }

    if (letteraPredetta === ultimaLetteraRiconosciuta)
        contatoreStabilita++;
    else {
        ultimaLetteraRiconosciuta = letteraPredetta;
        contatoreStabilita = 0;
        return;
    }

    if (contatoreStabilita === soglia_stabilita) {
        let coloreFeedback = "#00e678";

        if (letteraPredetta === "spazio") fraseAttuale += " ";
        else if (letteraPredetta === "del") {
            fraseAttuale = fraseAttuale.slice(0, -1);
            coloreFeedback = "#ff9100";
        }
        else if (letteraPredetta === "canc") {
            fraseAttuale = "";
            coloreFeedback = "#ff5252";
            const boxSuggerimenti = document.getElementById("suggerimenti-box");
            if (boxSuggerimenti) boxSuggerimenti.innerHTML = "";
        }
        // Implementazione del tasto enter (inutile, ma semmai)
        // else if (letteraPredetta === "enter") {
        //     if (fraseAttuale.trim() !== "") {
        //         alert("Frase inviata: " + fraseAttuale);
        //         fraseAttuale = "";
        //         coloreFeedback = "#00b0ff";

        //         const boxSuggerimenti = document.getElementById("suggerimenti-box");
        //         if (boxSuggerimenti) boxSuggerimenti.innerHTML = "";
        //     }
        // }
        else fraseAttuale += letteraPredetta;

        elementoSottotitoli.textContent = (fraseAttuale !== "") ? fraseAttuale : "In Attesa di Segni...";
        if (typeof window.onSubtitleUpdate === 'function') {
            window.onSubtitleUpdate(fraseAttuale);
        }
        elementoSottotitoli.parentElement.style.borderColor = coloreFeedback;

        setTimeout(() => {
            elementoSottotitoli.parentElement.style.borderColor = "transparent";
        }, 150);

        console.log("Frase aggiornata: ", fraseAttuale);

        if (fraseAttuale !== "" && fraseAttuale !== ultima_frase_suggerita) {
            ultima_frase_suggerita = fraseAttuale;
            scheduleSuggerimenti(fraseAttuale);
        }
    }
}

function mostraBottoniSuggerimento(suggerimenti) {
    const box = document.getElementById("suggerimenti-box");
    if (!box) return;

    const chiave = suggerimenti.join("|");
    if (chiave === ultimi_suggerimenti_renderizzati) return;
    ultimi_suggerimenti_renderizzati = chiave;

    const frammento = document.createDocumentFragment();
    suggerimenti.forEach(parola => {
        const btn = document.createElement("button");

        btn.textContent = parola;
        btn.classList.add("suggeriti-box");

        btn.addEventListener("click", () => {
            const parole = fraseAttuale.trim().split(" ");
            parole[parole.length - 1] = parola;
            fraseAttuale = parole.join(" ") + " ";
            document.getElementById("sottotitoli-testo").textContent = fraseAttuale;
            box.innerHTML = "";
            ultimi_suggerimenti_renderizzati = "";
        });

        frammento.appendChild(btn);
    });

    box.innerHTML = "";
    box.appendChild(frammento);
}

// Loop principale
async function loop_handTracker() {
    const video = document.getElementById("webcam");
    const canvas = document.getElementById("draw_canvas");
    const ctx = canvas.getContext("2d");

    if (!video.videoWidth || !video.videoHeight) {
        requestAnimationFrame(loop_handTracker);
        return;
    }

    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
    }

    frame_count++;

    if (frame_count % DETECT_OGNI === 0 && handLandmarker) {
        const ris = handLandmarker.detectForVideo(video, performance.now());
        ultimo_risultato = ris;

        if (status === "registrazione" && !salvataggio_in_corso && ris?.landmarks?.length) {
            salvataggio_in_corso = true;
            gestisci_salvataggio(ris, video, canvas)
                .finally(() => { salvataggio_in_corso = false; });
        }

        if (ris?.landmarks?.length > 0) {
            aggiorna_predizione(ris.landmarks[0])
                .then(pred => {
                    if (pred) ultima_pred = pred;
                });
        } else {
            ultima_pred = { lettera: null, confidenza: 0, top3: [] };
        }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const ris = ultimo_risultato;
    if (!ris) {
        requestAnimationFrame(loop_handTracker);
        return;
    }

    let ditaTot = 0, manoSx = null, manoDx = null;

    if (ris.landmarks?.length) {
        const infoMani = ris.handedness ?? ris.handednesses ?? [];

        ris.landmarks.forEach((lms, i) => {
            if (!mano_visibile(lms, video, canvas)) return;

            const raw = infoMani[i]?.[0]?.displayName ?? "Right";

            const isLeftRaw = raw === "Left";
            const hand = isLeftRaw ? "Right" : "Left";
            const nome = isLeftRaw ? "Destra" : "Sinistra";

            landmarks_canvas(canvas, ctx, lms, video, get_cover_transform);

            const dita = ditaAlzate(lms, hand);
            const count = dita.filter(Boolean).length;
            ditaTot += count;

            if (nome === "Sinistra") manoSx = { lms, hand, dita };
            else manoDx = { lms, hand, dita };
        });
    }

    // UI Pannelli laterali: usiamo i dati estratti nel loop
    if (manoSx) info_panel_canvas(ctx, manoSx.dita, 10, 60, "Mano Sinistra");
    if (manoDx) info_panel_canvas(ctx, manoDx.dita, canvas.width - 230, 60, "Mano Destra");

    // Predizione IA, FPS e Topbar rimangono invariati
    predizione_panel_canvas(canvas, ctx, ultima_pred.lettera, ultima_pred.confidenza, ultima_pred.top3, !!ia_model);
    gestisciNuovoSegnoPredetto(ultima_pred.lettera, ultima_pred.confidenza);

    const now = performance.now();
    ultimo_fps = 1000 / Math.max(now - ultimo_frame_time, 1);
    ultimo_frame_time = now;

    topbar_canvas(canvas, ctx, ditaTot, ultimo_fps, status, cartella_dati, csv_counter, !!ia_model);
    if (status === "conferma") conferma_overlay_canvas(canvas, ctx, cartella_dati, csv_counter, "");

    requestAnimationFrame(loop_handTracker);
}

// Entry point
window.handTracker = async function () {
    const video = document.getElementById("webcam");
    const recordBtn = document.getElementById("recordBtn");
    const folderInput = document.getElementById("folderInput");
    const folderLabel = document.getElementById("folderLabel");
    const btnTraining = document.getElementById("trainBtn");
    const btnResetFrase = document.getElementById("clearBtn");
    const container_sottotitoli = document.getElementById("container-sottotitoli");

    await caricaDizionarioItaliano();
    //await verifica_server();
    await carica_modello_ia();
    await initMediaPipe();
    window.startCamera(video);

    window.addEventListener("keydown", (e) => {
        if (status === "registrazione" && e.key !== "Escape") return;

        console.log("Tasto premuto:", e.key, " | Codice:", e.code);

        if (e.key === " " & e.key === "Enter") e.preventDefault();

        const keyUpper = e.key.trim().toUpperCase();
        let targetFolder = "";

        console.log("Upper:", keyUpper);
        console.log("Esiste nel set?", alfabeto_it.has(keyUpper));

        if (alfabeto_it.has(keyUpper)) targetFolder = keyUpper;
        else if (tasti_speciali[e.key]) targetFolder = tasti_speciali[e.key];

        if (targetFolder && (status === "fermo" || status === "conferma")) {
            console.log("Cambio stato UI");

            cartella_dati = targetFolder;
            status = "conferma";

            if (recordBtn) {
                recordBtn.textContent = `Conferma [${cartella_dati}] (Enter) / Annulla (Esc)`;
                recordBtn.style.backgroundColor = "#ffc107";
            }
            return;
        }

        switch (e.key) {
            case "Enter":
                if (status === "conferma") startRecording();
                else if (status === "registrazione") stopRecording();
                break;

            case "Escape":
                if (status === "conferma" || status === "registrazione") {
                    if (status === "registrazione") stopRecording();

                    status = "fermo";
                    cartella_dati = "";

                    if (recordBtn) {
                        recordBtn.textContent = "Avvia Registrazione";
                        recordBtn.style.backgroundColor = "";
                    }
                }

                mostra_ui_principale();
                break;
        }
    });

    folderInput?.addEventListener("change", () => {
        const files = folderInput.files;
        if (!files.length) return;
        cartella_dati = files[0].webkitRelativePath.split("/")[0];
        csv_counter = [...files].filter(f => f.name.endsWith(".csv")).length;
        if (folderLabel) folderLabel.textContent = cartella_dati;
        status = "conferma";
    });

    recordBtn?.addEventListener("click", () => {
        nascondi_ui_principale();

        if (status === "fermo") {
            cartella_dati = cartella_dati || "Download";
            status = "conferma";

            if (recordBtn) {
                recordBtn.textContent = "Conferma (Enter) / Annulla (Esc)";
                recordBtn.classList.add("btn-confirm");
            }
        }
        else if (status === "conferma") {
            startRecording();
        }
        else if (status === "registrazione") {
            stopRecording();
            mostra_ui_principale();
        }
    });

    // bottone per il training
    btnTraining?.addEventListener("click", async () => {
        if (!confirm("Avviare l'addestramento con i dati salvati?")) return;

        btnTraining.disabled = true;
        btnTraining.textContent = "Addestramento in corso...";
        btnTraining.style.cursor = "not-allowed";

        try {
            const res = await fetch(`${getServer()}/train`, { method: "POST" });

            if (!res.ok) {
                alert("Errore nell'avvio dell'addestramento.");
                ripristina_btn_training();
                return;
            }

            console.log("[Training] Avviato - polling ogni 3s");

            const intervallo = setInterval(async () => {
                try {
                    const statusRes = await fetch(`${getServer()}/status-train`);

                    if (statusRes.ok) {
                        const stato = await statusRes.text();

                        if (stato.trim() === "Completato") {
                            clearInterval(intervallo);
                            alert("Modello aggiornato - la pagina verrà ricaricata");
                            window.location.reload();
                        }
                    } else {
                        clearInterval(intervallo);
                        const msg = await statusRes.text();
                        alert(`Errore training: ${msg}`);
                        ripristina_btn_training();
                    }
                } catch (err) {
                    console.error("[Training] Errore polling:", err);
                    clearInterval(intervallo);
                    ripristina_btn_training();
                }
            }, 3000);

        } catch (e) {
            alert("Impossibile connettersi al server.");
            ripristina_btn_training();
        }
    });

    btnResetFrase?.addEventListener("click", () => {
        fraseAttuale = "";
        ultimaLetteraRiconosciuta = "";
        contatoreStabilita = 0;

        const testo = document.getElementById("sottotitoli-testo");
        if (testo) testo.textContent = "In attesa di Segni...";

        const boxSuggerimenti = document.getElementById("suggerimenti-box");
        if (boxSuggerimenti) boxSuggerimenti.innerHTML = "";
    });

    function nascondi_ui_principale() {
        btnTraining.classList.add("hide");
        btnResetFrase.classList.add("hide");
        container_sottotitoli.classList.add("hide");
    }

    function mostra_ui_principale() {
        btnTraining.classList.remove("hide");
        btnResetFrase.classList.remove("hide");
        container_sottotitoli.classList.remove("hide");
    }

    function ripristina_btn_training() {
        btnTraining.disabled = false;
        btnTraining.textContent = "Allena Modello IA";
        btnTraining.style.cursor = "pointer";
    }

    function startRecording() {
        csv_row = [];
        csv_counter = 0;
        isRecording = true;
        status = "registrazione";
        if (recordBtn) recordBtn.textContent = "STOP (S)";
        console.log("Registrazione avviata...");
    }

    function stopRecording() {
        status = "fermo";
        isRecording = false;

        if (csv_row.length > 0) {
            console.log("Salvataggio server fallito o non configurato. Scarico manuale...");
            salva_csv();
        } else {
            console.log(`Registrazione terminata. Salvati ${csv_counter} frame sul server.`);
        }

        if (recordBtn) recordBtn.textContent = "Avvia Registrazione";
    }
};

window.stopHandTracker = function () {
    const video = document.getElementById("webcam");
    if (video?.srcObject) {
        // Non stoppare le tracce — appartengono a WebRTC
        // Scollega solo il riferimento per evitare doppio uso
        video.srcObject = null;
    }
    // Resetta stato interno
    ultimo_risultato = null;
    ultima_pred = { lettera: null, confidenza: 0, top3: [] };
    fraseAttuale = "";
    pred_buf = [];
};


const resizeObserver = new ResizeObserver(() => {
    const canvas = document.getElementById("draw_canvas");
    if (!canvas) return;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    cover_transform_dirty = true;
});
const _canvas = document.getElementById("draw_canvas");
if (_canvas) resizeObserver.observe(_canvas);

//////////////////////////////////////////////////////

// funzioni per i get e set 'globali'
window.getCartellaCSV = () => cartella_dati;
window.getCounterCSV = () => csv_counter;
window.getRisultato = () => ultimo_risultato;
window.getStatus = () => status;

window.setCartellaCSV = (val) => { cartella_dati = val; };
window.setStatus = (val) => { status = val; };

window.resetFraseAttuale = function () {
    fraseAttuale = "";
    ultimaLetteraRiconosciuta = "";
    contatoreStabilita = 0;
    const testo = document.getElementById("sottotitoli-testo");
    if (testo) testo.textContent = "In attesa di segni…";
    const box = document.getElementById("suggerimenti-box");
    if (box) box.innerHTML = "";
};