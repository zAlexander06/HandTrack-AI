import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";
import { landmarks_canvas, info_panel_canvas, predizione_panel_canvas, topbar_canvas, conferma_overlay_canvas } from "./camera_canvas.js";
import { isServerConnesso, getServer, verifica_server, salva_csv_backend } from "../api/backend.js";

// Costanti
const smooth_n = 8;
const n_landmarks = 21;
const DETECT_OGNI = 2;
const model_url = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";

const alfabeto_it = new Set([
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'L',
    'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'Z'
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
    try {
        const [onnxRes, labelsRes] = await Promise.all([
            fetch("./model.onnx"),
            fetch("./labels.json"),
        ]);

        if (!onnxRes.ok || !labelsRes.ok) {
            console.warn("IA:\nFile modello non trovati, modalità solo raccolta dati");
            return;
        }

        [ia_model, label] = await Promise.all([
            ort.InferenceSession.create("./model.onnx"),
            fetch("./labels.json").then(r => r.json()),
        ]);

        console.log("AI:\nModello caricato — classi:", label);
    } catch (e) {
        console.warn("AI:\nErrore caricamento modello:", e);
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

    const raw = ris.handednesses ?? ris.handedness ?? [];

    const indici_visibili = ris.landmarks
        .map((_, i) => i)
        .filter(i => mano_visibile(ris.landmarks[i], video, canvas));

    if (!indici_visibili.length) return;

    const ris_filtrato = {
        landmarks: indici_visibili.map(i => ris.landmarks[i]),
        handednesses: indici_visibili.map(i => raw[i] ?? []),
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
        console.error("[CSV] Errore:", e.message);
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
function landmarks_to_feature_vector(handLandmarksList) {
    const feat = new Float32Array(n_landmarks * 3 * 2);
    handLandmarksList.slice(0, 2).forEach((lms, hi) => {
        const wx = lms[0].x, wy = lms[0].y, wz = lms[0].z;
        const off = hi * n_landmarks * 3;
        lms.forEach((pt, li) => {
            feat[off + li * 3] = pt.x - wx;
            feat[off + li * 3 + 1] = pt.y - wy;
            feat[off + li * 3 + 2] = pt.z - wz;
        });
    });
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
    if (!ia_model || !landmarks.length)
        return { lettera: null, confidenza: 0, top3: [] };

    const feat = landmarks_to_feature_vector(landmarks);
    const tensor = new ort.Tensor("float32", feat, [1, feat.length]);
    const output = await ia_model.run({ input: tensor });

    const proba = output["probabilities"].data;

    const top3idx = Array.from(proba)
        .map((prob, i) => ({ prob, i }))
        .sort((a, b) => b.prob - a.prob)
        .slice(0, 3);

    const top3 = top3idx.map(({ prob, i }) => [label[i], prob]);

    return { lettera: top3[0][0], confidenza: top3[0][1], top3 };
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
    const best_confidenza = let_smooth[best_lettera] / pred_buf.length;

    return { lettera: best_lettera, confidenza: best_confidenza, top3: conf_smooth[best_lettera] || [] };
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

// Loop principale
async function loop_handTracker() {
    const video = document.getElementById("webcam");
    const canvas = document.getElementById("draw_canvas");
    const ctx = canvas.getContext("2d");

    if (!video.videoWidth || !video.videoHeight) {
        requestAnimationFrame(loop_handTracker);
        return;
    }

    // Gestione dimensione Canvas
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
    }

    frame_count++;
    let ha_rilevato_ora = false;

    // Detection a intervalli
    if (frame_count % DETECT_OGNI === 0 && handLandmarker) {
        const ris = handLandmarker.detectForVideo(video, performance.now());
        ultimo_risultato = ris;
        ha_rilevato_ora = true;

        if (status === "registrazione" && !salvataggio_in_corso && ris?.landmarks?.length > 0) {
            salvataggio_in_corso = true;
            gestisci_salvataggio(ris, video, canvas)
                .finally(() => { salvataggio_in_corso = false; });
        }

        aggiorna_predizione(ris?.landmarks ?? []).then(
            pred => { ultima_pred = pred; }
        );
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const ris = ultimo_risultato;
    if (!ris) {
        requestAnimationFrame(loop_handTracker);
        return;
    }

    let ditaTot = 0, manoSx = null, manoDx = null;

    if (ris.landmarks?.length) {
        const infoMani = ris.handednesses ?? ris.handedness ?? [];

        ris.landmarks.forEach((lms, i) => {
            if (!mano_visibile(lms, video, canvas)) return;

            const info = infoMani?.[i]?.[0];
            const handedness = info?.displayName ?? "Right";
            const nomeMano = handedness === "Left" ? "Destra" : "Sinistra";

            landmarks_canvas(canvas, ctx, lms, video, get_cover_transform);

            const alzate = ditaAlzate(lms, handedness);
            ditaTot += alzate.filter(Boolean).length;

            if (nomeMano === "Sinistra") manoSx = lms;
            else manoDx = lms;
        });
    }

    // UI e Predizione
    if (manoSx) info_panel_canvas(ctx, ditaAlzate(manoSx, "Left"), 10, 60, "Mano Sinistra");
    if (manoDx) info_panel_canvas(ctx, ditaAlzate(manoDx, "Right"), canvas.width - 230, 60, "Mano Destra");

    // Predizione IA
    predizione_panel_canvas(canvas, ctx, ultima_pred.lettera, ultima_pred.confidenza, ultima_pred.top3, !!ia_model);

    // FPS e Topbar
    const now = performance.now();
    ultimo_fps = 1000 / Math.max(now - ultimo_frame_time, 1);
    ultimo_frame_time = now;

    topbar_canvas(canvas, ctx, ditaTot, ultimo_fps, status, cartella_dati, csv_counter, !!ia_model);
    if (status === "conferma") conferma_overlay_canvas(canvas, ctx, cartella_dati, csv_counter);

    requestAnimationFrame(loop_handTracker);
}

// Entry point
window.handTracker = async function () {
    const video = document.getElementById("webcam");
    const recordBtn = document.getElementById("recordBtn");
    const folderInput = document.getElementById("folderInput");
    const folderLabel = document.getElementById("folderLabel");

    await verifica_server();
    await carica_modello_ia();
    await initMediaPipe();
    window.startCamera(video);

    window.addEventListener("keydown", (e) => {
        const keyUpper = e.key.toUpperCase();

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

// bottone per il training
document.getElementById("trainBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("trainBtn");

    if (!confirm("L'addestramento userà i dati salvati nelle cartelle. Continuare?")) return;

    btn.disabled = true;
    btn.textContent = "Addestramento in corso...";

    try {
        const res = await fetch(getServer() + "/train", { method: "POST" });
        if (res.ok) {
            alert("Il server ha avviato Python. Controlla la console del server per i progressi.");
        } else {
            alert("Errore nell'avvio dell'addestramento.");
        }
    } catch (e) {
        alert("Impossibile comunicare con il server C++.");
    } finally {
        btn.disabled = false;
        btn.textContent = "Allena Modello IA";
    }
});

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