import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";
import { landmarks_canvas, info_panel_canvas, predizione_panel_canvas, topbar_canvas, conferma_overlay_canvas } from "./camera_canvas.js";
import { isServerConnesso, getServer, verifica_server, salva_csv_backend } from "../api/backend.js";
import { caricaDizionarioItaliano, ottieniSuggerimenti } from "./dizionario.js";

// Costanti
const smooth_n = 8;
const n_landmarks = 21;
const DETECT_OGNI = 2;
const model_url = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";

const alfabeto_it = new Set([
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
    "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"
]);

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

    try {
        const salvato = await salva_csv_backend(cartella_dati, ris_filtrato);

        if (salvato) {
            csv_counter++;
        } else {
            raccogli_csv_files(ris_filtrato);
            csv_counter++;
        }
    } catch (e) {
        console.error("[CSV] Errore durante il salvataggio:", e.message);
        raccogli_csv_files(ris_filtrato);
        csv_counter++;
    }
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
    }

    if (contatoreStabilita === soglia_stabilita) {
        if (letteraPredetta === "spazio") fraseAttuale += " ";
        else if (letteraPredetta === "cancella") fraseAttuale = fraseAttuale.slice(0, -1);
        else fraseAttuale += letteraPredetta;

        elementoSottotitoli.textContent = fraseAttuale || "In Attesa di Segni...";

        elementoSottotitoli.parentElement.style.borderColor = "#00e676";
        setTimeout(() => {
            elementoSottotitoli.parentElement.style.borderColor = "transparent";
        }, 150);

        console.log("Frase aggiornata: ", fraseAttuale);

        const nuoviSuggeerimenti = ottieniSuggerimenti(fraseAttuale);
        mostraBottoniSuggerimento(nuoviSuggeerimenti);
    }
}

function mostraBottoniSuggerimento(suggerimenti) {
    const box = document.getElementById("suggerimenti-box");
    if (!box) return;

    box.innerHTML = "";

    suggerimenti.forEach(parola => {
        const btnParola = document.createElement("button");
        btnParola.textContent = parola;

        btnParola.classList.add("suggeriti-box");

        btnParola.addEventListener("click", () => {
            const parole = fraseAttuale.trim().split(" ");
            parole[parole.length - 1] = parola;
            fraseAttuale = parole.join(" ") + " ";

            document.getElementById("sottotitoli-testo").textContent = fraseAttuale;
            box.innerHTML = "";
        });

        box.appendChild(btnParola);
    });
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
    if (status === "conferma") conferma_overlay_canvas(canvas, ctx, cartella_dati, csv_counter);

    requestAnimationFrame(loop_handTracker);
}

// Entry point
window.handTracker = async function () {
    const info = document.getElementById("info");
    const video = document.getElementById("webcam");
    const recordBtn = document.getElementById("recordBtn");
    const folderInput = document.getElementById("folderInput");
    const folderLabel = document.getElementById("folderLabel");
    const btnTraining = document.getElementById("trainBtn");
    const btnResetFrase = document.getElementById("clearBtn");

    await verifica_server();
    await carica_modello_ia();
    await initMediaPipe();
    window.startCamera(video);
    await caricaDizionarioItaliano();

    window.addEventListener("keydown", (e) => {
        //if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

        const keyUpper = e.key.toUpperCase();
        //console.log(keyUpper);

        if (alfabeto_it.has(keyUpper)) {
            if (status === "registrazione") return;

            cartella_dati = keyUpper;
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
        if (status === "fermo") {
            cartella_dati = cartella_dati || (isServerConnesso() ? "Segni" : "Download");

            status = "conferma";
            recordBtn.textContent = "Conferma (Enter) / Annulla (Esc)";
            recordBtn.classList.add("btn-confirm");
        }
        else if (status === "conferma") {
            startRecording();
        }
        else if (status === "registrazione") {
            stopRecording();
        }
    });

    // bottone per il training
    btnTraining?.addEventListener("click", async () => {
        const btn = btnTraining;

        if (!confirm("L'addestramento userà i dati salvati nelle cartelle. Continuare?")) return;

        btn.disabled = true;
        btn.textContent = "Addestramento in corso...";
        btn.style.cursor = "not-allowed";

        try {
            const url_server = `${getServer()}/train`;
            const res = await fetch(url_server, { method: "POST" });

            if (res.ok) {
                console.log("Training avviato sul server...");

                const intervallo = setInterval(async () => {
                    try {
                        const url_status_train = `${getServer()}/status-train`;
                        const statusRes = await fetch(url_status_train);

                        if (statusRes.ok) {
                            const stato = await statusRes.text();

                            if (stato.trim() === "Completato") {
                                clearInterval(intervallo);

                                alert("Modello '.onnx' aggiornato e generato con successo\nVerrà ricaricata la pagina per apportare le modifiche");
                                window.location.reload();
                            }
                        }
                        else {
                            clearInterval(intervallo);

                            const messaggioErrore = await statusRes.text();
                            alert(`${messaggioErrore}\nAttendere prego!`);

                            btn.disabled = false;
                            btn.textContent = "Allena Modello IA";
                            btn.style.cursor = "pointer";
                        }
                    }
                    catch (err) {
                        console.error("Errore durante il controllo dello stato: ", err);
                        clearInterval(intervallo);
                    }
                }, 3000);
                alert("Il server ha avviato Python. Controlla la console del server per i progressi.");
            } else {
                alert("Errore nell'avvio dell'addestramento.");
                btn.disabled = false;
                btn.textContent = "Allena Modello IA";
                btn.style.cursor = "pointer";
            }
        } catch (e) {
            alert("Impossibile connettersi al server per avviare l'addestramento.");
            btn.disabled = false;
            btn.textContent = "Allena Modello IA";
            btn.style.cursor = "pointer";
        }
    });

    btnResetFrase?.addEventListener("click", () => {
        fraseAttuale = "";
        ultimaLetteraRiconosciuta = "";
        contatoreStabilita = 0;

        const testo = document.getElementById("sottotitoli-testo");
        if (testo) testo.textContent = "In attesa di Segni...";
    })

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

const resizeObserver = new ResizeObserver(() => {
    const canvas = document.getElementById("draw_canvas");
    if (!canvas) return;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
});
resizeObserver.observe(document.getElementById("draw_canvas"));

// Avvio
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", window.handTracker);
} else {
    window.handTracker();
}

//////////////////////////////////////////////////////

// funzioni per i get e set 'globali'
window.getCartellaCSV = () => cartella_dati;
window.getCounterCSV = () => csv_counter;
window.getRisultato = () => ultimo_risultato;
window.getStatus = () => status;

window.setCartellaCSV = (val) => { cartella_dati = val; };
window.setStatus = (val) => { status = val; };