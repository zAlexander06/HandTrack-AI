import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";
import { landmarks_canvas, info_panel_canvas, predizione_panel_canvas, topbar_canvas, conferma_overlay_canvas } from "./camera_canvas.js";
import { verifica_server, salva_csv_backend } from "./api/backend.js";

// Costanti
const smooth_n = 8;
const n_landmarks = 21;

// Variabili globali
let ultimo_video_time = -1;
let pred_buf = [];
let csv_row = [];
let csv_counter = 0;
let ultimo_fps = 0;
let ultimo_frame_time = performance.now();
let isRecording = false;
let status = "fermo";    // fermo | conferma | registrazione
let cartella_dati = "";
let ia_model = null;
let label = [];

const model_url = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";
let handLandmarker = null;
let frame_count = 0;
let ultimo_risultato = null;
const DETECT_OGNI = 2;

async function initMediaPipe() {
    const { HandLandmarker, FilesetResolver } = await import(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0"
    );
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

    console.log("Camera avviata");

    navigator.mediaDevices
        .getUserMedia({ video: { width: 640, height: 480 } })
        .then(stream => {
            video.srcObject = stream;
            video.addEventListener("loadeddata", loop_handTracker);
        })
        .catch(e => {
            const el = document.getElementById("info");
            if (el) el.textContent = "Errore camera: " + e.message;
        });
};

// CSV
function csv_header() {
    return ["hand_index", "handedness", "lm_index", "x", "y", "z"].join(",");
}

function raccogli_csv_files(ris) {
    ris.landmarks.forEach((lms, i) => {
        const handedness = ris.handedness?.[i]?.[0]?.displayName ?? "Unknown";
        lms.forEach((lm, j) => {
            csv_row.push([i, handedness, j,
                lm.x.toFixed(6), lm.y.toFixed(6), lm.z.toFixed(6)].join(","));
        });
    });
    csv_counter++;
}

function salva_csv() {
    if (!csv_row.length) return;
    const content = [csv_header(), ...csv_row].join("\n");
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hand_${Date.now()}.csv`;
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
    alzate.push(handedness === "Right"
        ? landmarks[4].x > landmarks[3].x
        : landmarks[4].x < landmarks[3].x);
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

    if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }

    ultimo_video_time = video.currentTime;
    frame_count++;

    if (frame_count % DETECT_OGNI === 0 && handLandmarker) {
        ultimo_risultato = handLandmarker.detectForVideo(video, performance.now());
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const ris = ultimo_risultato;
    let ditaTot = 0, manoSx = null, manoDx = null;

    if (ris?.landmarks?.length) {
        ris.landmarks.forEach((lms, i) => {
            const handedness = ris.handedness?.[i]?.[0]?.displayName ?? "Right";
            const nomeMano = handedness === "Left" ? "Destra" : "Sinistra";

            landmarks_canvas(canvas, ctx, lms);

            const alzate = ditaAlzate(lms, handedness);
            ditaTot += alzate.filter(Boolean).length;

            if (nomeMano === "Sinistra") manoSx = lms;
            else manoDx = lms;
        });

        if (status === "registrazione") {
            const salvato = await salva_csv_backend(cartella_dati, ris);
            if (!salvato) raccogli_csv_files(ris);
            else csv_counter++;
        }
    }

    if (manoSx) info_panel_canvas(ctx, ditaAlzate(manoSx, "Left"), 10, 60, "Mano Sinistra");
    if (manoDx) info_panel_canvas(ctx, ditaAlzate(manoDx, "Right"), canvas.width - 230, 60, "Mano Destra");

    const { lettera, confidenza, top3 } = await aggiorna_predizione(ris?.landmarks ?? []);
    predizione_panel_canvas(canvas, ctx, lettera, confidenza, top3, !!ia_model);

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

    document.addEventListener("keydown", e => {
        switch (e.key) {
            case "f": case "F": folderInput?.click(); break;
            case "s": case "S":
                if (status === "conferma") startRecording();
                else if (status === "registrazione") stopRecording();
                break;
            case "Escape":
                if (status === "conferma") status = "fermo";
                else if (status === "registrazione") stopRecording();
                break;
            case "r": case "R": carica_modello_ia(); break;
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
            cartella_dati = cartella_dati || "download";
            status = "conferma";
            if (recordBtn) recordBtn.textContent = "Conferma (S) / Annulla (Esc)";
        } else if (status === "conferma") {
            startRecording();
        } else if (status === "registrazione") {
            stopRecording();
        }
    });

    function startRecording() {
        csv_row = [];
        csv_counter = 0;
        isRecording = true;
        status = "registrazione";
        if (recordBtn) recordBtn.textContent = "STOP & Scarica CSV";
    }

    function stopRecording() {
        isRecording = false;
        status = "fermo";
        salva_csv();
        if (recordBtn) recordBtn.textContent = "Avvia Registrazione";
    }
};

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