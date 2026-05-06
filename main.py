#!/usr/bin/env python3
import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
import time
import urllib.request
import os
import csv
import glob
import pickle
import subprocess
import threading
import numpy as np
from collections import defaultdict

MODEL_PATH = "hand_landmarker.task"
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"

if not os.path.exists(MODEL_PATH):
    print("Download modello...")
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)

PUNTA_DITA = [4, 8, 12, 16, 20]
NOMI_DITA  = ["Pollice", "Indice", "Medio", "Anulare", "Mignolo"]

# AI model (optional)

AI_MODEL_PATH  = "./model.pkl"
N_LANDMARKS = 21
FEATURE_SIZE = N_LANDMARKS * 3 * 2   # 126

ai_bundle = None   # continua se non trova il 'modello'

def load_ai_model():
    global ai_bundle
    if os.path.exists(AI_MODEL_PATH):
        try:
            with open(AI_MODEL_PATH, "rb") as f: ai_bundle = pickle.load(f)
            classes = list(ai_bundle["label_encoder"].classes_)
            print(f"[AI] Modello caricato — classi: {classes}")
        except Exception as e:
            print(f"[AI] Errore caricamento modello: {e}")

load_ai_model()

def landmarks_to_features(risultato) -> np.ndarray:
    """Convert mediapipe result to the same 126-feature vector used in training."""
    features = np.zeros(FEATURE_SIZE, dtype=np.float32)
    for hi, hand_landmarks in enumerate(risultato.hand_landmarks):
        if hi >= 2: break
        lms = hand_landmarks
        wx, wy, wz = lms[0].x, lms[0].y, lms[0].z
        offset = hi * N_LANDMARKS * 3
        for li in range(N_LANDMARKS):
            base = offset + li * 3
            features[base] = lms[li].x - wx
            features[base + 1] = lms[li].y - wy
            features[base + 2] = lms[li].z - wz
    return features


def predict_letter(risultato):
    """Returns (letter, confidence, top3) or (None, 0, [])."""
    if ai_bundle is None or not risultato.hand_landmarks:
        return None, 0.0, []
    feat = landmarks_to_features(risultato).reshape(1, -1)
    clf = ai_bundle["model"]
    le = ai_bundle["label_encoder"]
    proba = clf.predict_proba(feat)[0]
    top3_idx = np.argsort(proba)[::-1][:3]
    top3 = [(le.classes_[i], float(proba[i])) for i in top3_idx]
    return top3[0][0], top3[0][1], top3

############################

_folder_result: list = []
_picker_running = False

def open_folder_async():
    global _picker_running
    if _picker_running:
        return
    _picker_running = True
    _folder_result.clear()

    def _run():
        global _picker_running
        ps = (
            "Add-Type -AssemblyName System.Windows.Forms;"
            "$d = New-Object System.Windows.Forms.FolderBrowserDialog;"
            "$d.Description = 'Scegli cartella per i CSV';"
            "$d.ShowNewFolderButton = $true;"
            "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }"
        )
        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                capture_output=True, text=True, timeout=60,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            folder = result.stdout.strip()
        except Exception:
            folder = ""
        _folder_result.append(folder)
        _picker_running = False

    threading.Thread(target=_run, daemon=True).start()

# Salvataggio CSV

def count_csvs(folder):
    if not folder:
        return 0
    return len(glob.glob(os.path.join(folder, "*.csv")))


def save_landmarks_csv(folder, risultato):
    if not folder:
        return False
    
    if not risultato or not hasattr(risultato, "hand_landmarks") or not risultato.hand_landmarks:
        return False

    os.makedirs(folder, exist_ok=True)

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    milliseconds = int(time.time() * 1000) % 1000
    filename = os.path.join(folder, f"hand_{timestamp}_{milliseconds:03d}.csv")     # nome del file

    try:
        with open(filename, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["hand_index", "handedness", "lm_index", "x", "y", "z"])
            for i, hand_landmarks in enumerate(risultato.hand_landmarks):
                label = "Sconosciuto"
                if hasattr(risultato, "handedness") and i < len(risultato.handedness):
                    label = risultato.handedness[i][0].display_name
                for j, lm in enumerate(hand_landmarks):
                    writer.writerow([i, label, j, f"{lm.x:.6f}", f"{lm.y:.6f}", f"{lm.z:.6f}"])
        return True

    except Exception as e:
        print(f"Errore nel salvataggio CSV: {e}")
        return False

# Landmark / drawing helpers

def dita_alzate(landmarks, etichetta_mano):
    alzate = []
    if etichetta_mano == "Right":
        alzate.append(landmarks[4].x > landmarks[3].x)
    else:
        alzate.append(landmarks[4].x < landmarks[3].x)
    for punta, pip in zip(PUNTA_DITA[1:], [6, 10, 14, 18]):
        alzate.append(landmarks[punta].y < landmarks[pip].y)
    return alzate


def draw_landmarks(frame, landmarks):
    h, w = frame.shape[:2]
    for lm in landmarks:
        cv2.circle(frame, (int(lm.x * w), int(lm.y * h)), 4, (0, 255, 0), -1)
    connections = [
        (0,1),(1,2),(2,3),(3,4),(0,5),(5,6),(6,7),(7,8),
        (5,9),(9,10),(10,11),(11,12),(9,13),(13,14),(14,15),(15,16),
        (13,17),(17,18),(18,19),(19,20),(0,17)
    ]
    for a, b in connections:
        p1 = (int(landmarks[a].x * w), int(landmarks[a].y * h))
        p2 = (int(landmarks[b].x * w), int(landmarks[b].y * h))
        cv2.line(frame, p1, p2, (0, 200, 255), 2)


def draw_panel(frame, overlay, alzate, x, y, titolo):
    cv2.rectangle(overlay, (x, y), (x + 220, y + 160), (30,30,30), -1)
    cv2.addWeighted(overlay, 0.6, frame, 0.4, 0, frame)
    cv2.putText(frame, titolo, (x+10, y+25),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200,200,200), 2)
    for i, stato in enumerate(alzate):
        cv2.putText(frame,f"{NOMI_DITA[i]}: {'SU' if stato else 'GIU'}", (x+10, y+55 + i*20), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0,255,0) if stato else (0,0,255), 2)


# pannello delle predizioni IA

def draw_prediction_panel(frame, overlay, w, h, letter, confidence, top3):
    """Big centred letter + confidence bar + top-3 list."""
    pw, ph = 320, 220
    px = (w - pw) // 2
    py = h - ph - 10

    cv2.rectangle(overlay, (px, py), (px + pw, py + ph), (15, 15, 40), -1)
    cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)
    cv2.rectangle(frame, (px, py), (px + pw, py + ph), (60, 60, 120), 1)

    if letter is None:
        msg = "Nessuna mano" if ai_bundle else "Nessun modello"
        ts  = cv2.getTextSize(msg, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1)[0]
        cv2.putText(frame, msg, (px + (pw - ts[0]) // 2, py + ph // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (120,120,120), 1)
        return

    ls = cv2.getTextSize(letter, cv2.FONT_HERSHEY_SIMPLEX, 3.5, 6)[0]
    cv2.putText(frame, letter, (px + (pw - ls[0]) // 2, py + 90), cv2.FONT_HERSHEY_SIMPLEX, 3.5, (255, 255, 255), 6)

    bar_x, bar_y, bar_w, bar_h = px + 20, py + 105, pw - 40, 18
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_w, bar_y + bar_h), (50, 50, 50), -1)
    fill = int(bar_w * confidence)
    
    r = int(255 * (1 - confidence))
    g = int(255 * confidence)
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + fill, bar_y + bar_h), (0, g, r), -1)
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_w, bar_y + bar_h), (100, 100, 100), 1)
    conf_txt = f"{confidence*100:.0f}%"
    ct = cv2.getTextSize(conf_txt, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)[0]
    cv2.putText(frame, conf_txt, (bar_x + (bar_w - ct[0]) // 2, bar_y + 14), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255,255,255), 1)

    for rank, (lbl, prob) in enumerate(top3):
        col = (255,255,255) if rank == 0 else (150,150,150)
        scale = 0.55 if rank == 0 else 0.48
        txt = f"{rank+1}. {lbl}  {prob*100:.0f}%"
        cv2.putText(frame, txt, (px + 20, py + 145 + rank * 24), cv2.FONT_HERSHEY_SIMPLEX, scale, col, 1)


# Schermo Overlays

def draw_loading_overlay(frame, overlay, w, h):
    """Semi-transparent 'Caricamento...' screen while picker is open."""
    cv2.rectangle(overlay, (0, 0), (w, h), (15, 15, 15), -1)
    cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)

    msg = "Caricamento..."
    ts  = cv2.getTextSize(msg, cv2.FONT_HERSHEY_SIMPLEX, 1.4, 3)[0]
    cv2.putText(frame, msg, ((w - ts[0]) // 2, h // 2), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (255, 255, 255), 3)

    sub = "Scegli la cartella nel dialogo"
    ss  = cv2.getTextSize(sub, cv2.FONT_HERSHEY_SIMPLEX, 0.65, 1)[0]
    cv2.putText(frame, sub, ((w - ss[0]) // 2, h // 2 + 50), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (160, 160, 160), 1)


def draw_confirm_overlay(frame, overlay, w, h, folder_name, csv_count):
    """Overlay shown after folder chosen, before recording starts."""
    cv2.rectangle(overlay, (0, 0), (w, h), (10, 30, 10), -1)
    cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)

    lines = [
        ("Cartella selezionata:", (180, 180, 180), 0.7, 1),
        (folder_name, (80, 255, 120),  0.9, 2),
        (f"CSV presenti: {csv_count}", (180, 180, 180), 0.65, 1),
        ("", (0,0,0), 0.4, 1),
        ("[S]  Inizia a registrare", (0, 220, 100), 1.0, 2),
        ("[Q]  Annulla", (100, 100, 255), 0.7, 1),
    ]
    y = h // 2 - 80
    for text, color, scale, thick in lines:
        if text == "":
            y += 15
            continue
        ts = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thick)[0]
        cv2.putText(frame, text, ((w - ts[0]) // 2, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, thick)
        y += int(ts[1] * 2.2) + 8


# Top-bar

def draw_topbar(frame, w, dita_totali, fps, save_folder, csv_count, recording):
    cv2.rectangle(frame, (0, 0), (w, 55), (20, 20, 20), -1)
    cv2.putText(frame, f"Dita: {dita_totali}",
                (20, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255,255,255), 2)
    cv2.putText(frame, f"FPS: {int(fps)}",
                (w - 120, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (100,255,100), 2)

    # AI badge
    if ai_bundle:
        classes = ai_bundle["label_encoder"].classes_
        badge = f"AI: {len(classes)} lettere"
        bcolor = (0, 200, 255)
    else:
        badge = "AI: nessun modello  (train.py)"
        bcolor = (80, 80, 80)
    cv2.putText(frame, badge, (20, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, bcolor, 1)

    if recording and save_folder:
        folder_name = os.path.basename(save_folder) or save_folder
        info = f"  REC  {folder_name}  |  CSV: {csv_count}"
        color = (0, 80, 255)
    elif save_folder:
        folder_name = os.path.basename(save_folder) or save_folder
        info = f"[F] cartella  [S] avvia  —  {folder_name}  |  CSV: {csv_count}"
        color = (80, 200, 255)
    else:
        info = "[F] scegli cartella di salvataggio"
        color = (160, 160, 160)

    ts = cv2.getTextSize(info, cv2.FONT_HERSHEY_SIMPLEX, 0.48, 1)[0]
    tx = (w - ts[0]) // 2
    cv2.putText(frame, info, (tx, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.48, color, 1)

    if recording and int(time.time() * 2) % 2 == 0: cv2.circle(frame, (tx - 12, 17), 6, (0, 0, 255), -1)

# Setup Programma

def setup_detector():
    try:
        print("[INFO] Tentativo di avvio con accelerazione GPU...")
        base_options = mp_python.BaseOptions(
            model_asset_path=MODEL_PATH,
            delegate=mp_python.BaseOptions.Delegate.GPU
        )
        options = mp_vision.HandLandmarkerOptions(
            base_options=base_options,
            num_hands=2,
            running_mode=mp_vision.RunningMode.VIDEO
        )
        detector = mp_vision.HandLandmarker.create_from_options(options)
        print("[OK] MediaPipe sta usando la GPU.")
        return detector
    
    except Exception as e:
        print(f"[WARNING] GPU non disponibile o errore driver: {e}")
        print("[INFO] Passaggio alla CPU in corso...")
        
        base_options = mp_python.BaseOptions(
            model_asset_path=MODEL_PATH,
            delegate=mp_python.BaseOptions.Delegate.CPU
        )
        options = mp_vision.HandLandmarkerOptions(
            base_options=base_options,
            num_hands=2,
            running_mode=mp_vision.RunningMode.VIDEO
        )
        detector = mp_vision.HandLandmarker.create_from_options(options)
        print("[OK] MediaPipe sta usando la CPU.")
        return detector


# Model setup

# base_options = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
# options = mp_vision.HandLandmarkerOptions(base_options=base_options, num_hands=2)

IDLE, PICKING, CONFIRM, RECORDING = "IDLE", "PICKING", "CONFIRM", "RECORDING"

# Main

def main():
    cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
    if not cap.isOpened(): cap = cv2.VideoCapture(0)

    win_name = "Hand Tracking"
    cv2.namedWindow(win_name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(win_name, 640, 480)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_FPS, 30)

    detector = setup_detector()
    tempo_prec = time.time()

    state = IDLE
    save_folder = ""
    csv_count = 0

    # smoothing: keep last N predictions and pick majority
    SMOOTH_N = 8
    pred_buf = []   # list of (letter, confidence)

    while True:
        ok, frame = cap.read()
        if not ok:
            continue

        frame = cv2.flip(frame, 1)
        h, w = frame.shape[:2]

        overlay = frame.copy()

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        timestamp_ms = int(time.time() * 1000)
        risultato = detector.detect_for_video(mp_image, timestamp_ms)

        # auto-save
        if state == RECORDING and risultato.hand_landmarks:
            if save_landmarks_csv(save_folder, risultato):
                csv_count += 1

        dita_totali = 0
        mano_sx = mano_dx = None

        if risultato.hand_landmarks:
            for i, hand_landmarks in enumerate(risultato.hand_landmarks):
                etichetta = risultato.handedness[i][0].display_name
                nome_mano = "Destra" if etichetta == "Left" else "Sinistra"
                draw_landmarks(frame, hand_landmarks)
                alzate = dita_alzate(hand_landmarks, etichetta)
                dita_totali += sum(alzate)
                if nome_mano == "Sinistra":
                    mano_sx = alzate
                else:
                    mano_dx = alzate

        if mano_sx: draw_panel(frame, overlay, mano_sx, 10, 80, "Mano Sinistra")
        if mano_dx: draw_panel(frame, overlay, mano_dx, w - 230, 80, "Mano Destra")

        # AI prediction
        letter, confidence, top3 = predict_letter(risultato)

        # smooth predictions over last SMOOTH_N frames
        if letter is not None:
            pred_buf.append((letter, confidence, top3))
            if len(pred_buf) > SMOOTH_N: pred_buf.pop(0)

            # pick letter with highest average confidence in buffer
            scores = defaultdict(float)
            tops = {}
            for l, c, t in pred_buf:
                scores[l] += c
                tops[l] = t
                
            best_letter = max(scores, key=scores.__getitem__)
            best_conf = scores[best_letter] / len(pred_buf)
            best_top3 = tops[best_letter]
        else:
            pred_buf.clear()
            best_letter, best_conf, best_top3 = None, 0.0, []

        draw_prediction_panel(frame, overlay, w, h, best_letter, best_conf, best_top3)

        tempo_corr = time.time()
        fps = 1 / max(tempo_corr - tempo_prec, 1e-9)
        tempo_prec = tempo_corr

        draw_topbar(frame, w, dita_totali, fps, save_folder, csv_count, state == RECORDING)

        # stati della Overlay
        if state == PICKING:
            draw_loading_overlay(frame, overlay, w, h)
            if _folder_result:
                chosen = _folder_result.pop(0)
                if chosen:
                    save_folder = chosen
                    csv_count = count_csvs(save_folder)
                    state = CONFIRM
                else:
                    state = IDLE

        elif state == CONFIRM:
            folder_name = os.path.basename(save_folder) or save_folder
            draw_confirm_overlay(frame, overlay, w, h, folder_name, csv_count)

        cv2.imshow(win_name, frame)
        key = cv2.waitKey(1) & 0xFF

        # Chiusura globale
        if key == ord('q'):
            if state == RECORDING:
                state = IDLE
            break
        
        # F → Apre finestra per scegliere il salvataggio del training
        elif key == ord('f') and state != PICKING:
            open_folder_async()
            state = PICKING
        
        # S → Start / STOP training
        elif key == ord('s'):
            if state == CONFIRM:
                state = RECORDING
            elif state == RECORDING:
                state = IDLE

        elif key == ord('r'):
            load_ai_model()

    cap.release()
    detector.close()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()