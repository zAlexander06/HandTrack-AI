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
import threading
import numpy as np

MODEL_PATH = "hand_landmarker.task"
MODEL_URL  = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"

if not os.path.exists(MODEL_PATH):
    print("Download modello...")
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)

PUNTA_DITA = [4, 8, 12, 16, 20]
NOMI_DITA  = ["Pollice", "Indice", "Medio", "Anulare", "Mignolo"]

# Fast folder picker via PowerShell

import subprocess

_folder_result: list = []   # ["path"] or [""] when done, empty while waiting
_picker_running = False

def open_folder_async():
    global _picker_running
    if _picker_running: return
    _picker_running = True
    _folder_result.clear()

    def _run():
        global _picker_running
        ps = (
            "Add-Type -AssemblyName System.Windows.Forms;"
            "$d = New-Object System.Windows.Forms.FolderBrowserDialog;"
            "$d.Description = 'Scegli cartella per i CSV';"
            "$d.ShowNewFolderButton = $true;"
            "[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');"
            "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }"
        )

        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                capture_output=True, text=True, timeout=60,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            folder = result.stdout.strip()
        except Exception: folder = ""

        _folder_result.append(folder)
        _picker_running = False

    threading.Thread(target=_run, daemon=True).start()

# Salvataggio CSV

def count_csvs(folder: str) -> int:
    if not folder:
        return 0
    return len(glob.glob(os.path.join(folder, "*.csv")))


def save_landmarks_csv(folder: str, risultato) -> bool:
    if not folder or not risultato.hand_landmarks:
        return False

    timestamp = time.strftime("%Y%m%d_%H%M%S") + f"_{int(time.time()*1000)%1000:03d}"
    filename  = os.path.join(folder, f"hand_{timestamp}.csv")

    with open(filename, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["hand_index", "handedness", "lm_index", "x", "y", "z"])
        for i, hand_landmarks in enumerate(risultato.hand_landmarks):
            label = risultato.handedness[i][0].display_name
            for j, lm in enumerate(hand_landmarks):
                writer.writerow([i, label, j, f"{lm.x:.6f}", f"{lm.y:.6f}", f"{lm.z:.6f}"])
    return True

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
        (0,1),(1,2),(2,3),(3,4),
        (0,5),(5,6),(6,7),(7,8),
        (5,9),(9,10),(10,11),(11,12),
        (9,13),(13,14),(14,15),(15,16),
        (13,17),(17,18),(18,19),(19,20),
        (0,17)
    ]

    for a, b in connections:
        p1 = (int(landmarks[a].x * w), int(landmarks[a].y * h))
        p2 = (int(landmarks[b].x * w), int(landmarks[b].y * h))
        cv2.line(frame, p1, p2, (0, 200, 255), 2)


def draw_panel(frame, alzate, x, y, titolo):
    overlay = frame.copy()
    cv2.rectangle(overlay, (x, y), (x + 220, y + 160), (30,30,30), -1)
    cv2.addWeighted(overlay, 0.6, frame, 0.4, 0, frame)
    cv2.putText(frame, titolo, (x+10, y+25), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200,200,200), 2)
    for i, stato in enumerate(alzate):
        cv2.putText(frame, f"{NOMI_DITA[i]}: {'SU' if stato else 'GIU'}", (x+10, y+55 + i*20), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0,255,0) if stato else (0,0,255), 2)

# Overlay screens

def draw_loading_overlay(frame, w, h):
    """Semi-transparent 'Caricamento...' screen while picker is open."""
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, h), (15, 15, 15), -1)
    cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)

    msg = "Caricamento..."
    ts  = cv2.getTextSize(msg, cv2.FONT_HERSHEY_SIMPLEX, 1.4, 3)[0]
    cv2.putText(frame, msg, ((w - ts[0]) // 2, h // 2), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (255, 255, 255), 3)

    sub = "Scegli la cartella nel dialogo"
    ss  = cv2.getTextSize(sub, cv2.FONT_HERSHEY_SIMPLEX, 0.65, 1)[0]
    cv2.putText(frame, sub, ((w - ss[0]) // 2, h // 2 + 50), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (160, 160, 160), 1)


def draw_confirm_overlay(frame, w, h, folder_name, csv_count):
    """Overlay shown after folder chosen, before recording starts."""
    overlay = frame.copy()
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
    cv2.putText(frame, f"Dita: {dita_totali}", (20, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255,255,255), 2)
    cv2.putText(frame, f"FPS: {int(fps)}", (w - 120, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (100,255,100), 2)

    if recording and save_folder:
        folder_name = os.path.basename(save_folder) or save_folder
        info  = f"  REC  {folder_name}  |  CSV: {csv_count}"
        color = (0, 80, 255)
    elif save_folder:
        folder_name = os.path.basename(save_folder) or save_folder
        info  = f"[F] cambia cartella   [S] avvia rec  —  {folder_name}  |  CSV: {csv_count}"
        color = (80, 200, 255)
    else:
        info  = "[F] scegli cartella"
        color = (160, 160, 160)

    ts = cv2.getTextSize(info, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)[0]
    tx = (w - ts[0]) // 2
    cv2.putText(frame, info, (tx, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

    if recording and int(time.time() * 2) % 2 == 0:
        cv2.circle(frame, (tx - 12, 17), 6, (0, 0, 255), -1)

# Model setup

base_options = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
options = mp_vision.HandLandmarkerOptions(base_options=base_options, num_hands=2)

# States
# IDLE        → no folder set, [F] to pick
# PICKING     → folder dialog is open (show "Caricamento...")
# CONFIRM     → folder chosen, waiting for [S] to start
# RECORDING   → saving every frame, [S] to stop

IDLE, PICKING, CONFIRM, RECORDING = "IDLE", "PICKING", "CONFIRM", "RECORDING"

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap = cv2.VideoCapture(0)

    win_name = "Hand Tracking"
    cv2.namedWindow(win_name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(win_name, 1280, 720)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    detector   = mp_vision.HandLandmarker.create_from_options(options)
    tempo_prec = time.time()

    state       = IDLE
    save_folder = ""
    csv_count   = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            continue

        frame = cv2.flip(frame, 1)
        h, w  = frame.shape[:2]

        rgb       = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image  = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        risultato = detector.detect(mp_image)

        # ── auto-save every frame while recording ──
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

        if mano_sx:
            draw_panel(frame, mano_sx, 10, 80, "Mano Sinistra")
        if mano_dx:
            draw_panel(frame, mano_dx, w - 230, 80, "Mano Destra")

        tempo_corr = time.time()
        fps        = 1 / max(tempo_corr - tempo_prec, 1e-9)
        tempo_prec = tempo_corr

        draw_topbar(frame, w, dita_totali, fps,
                    save_folder, csv_count, state == RECORDING)

        # ── state-specific overlays ──
        if state == PICKING:
            draw_loading_overlay(frame, w, h)
            # check if picker finished
            if _folder_result:
                chosen = _folder_result.pop(0)
                if chosen:
                    save_folder = chosen
                    csv_count   = count_csvs(save_folder)
                    state       = CONFIRM
                else:
                    state = IDLE   # cancelled

        elif state == CONFIRM:
            folder_name = os.path.basename(save_folder) or save_folder
            draw_confirm_overlay(frame, w, h, folder_name, csv_count)

        cv2.imshow(win_name, frame)
        key = cv2.waitKey(1) & 0xFF

        # ── global quit ──
        if key == ord('q'):
            if state == RECORDING:
                state = IDLE       # stop recording before quit
            break

        # ── F → open folder picker (any state except while already picking) ──
        elif key == ord('f') and state != PICKING:
            open_folder_async()
            state = PICKING

        # ── S → start / stop recording ──
        elif key == ord('s'):
            if state == CONFIRM:
                state = RECORDING
            elif state == RECORDING:
                state = IDLE

    cap.release()
    detector.close()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()

################################################################