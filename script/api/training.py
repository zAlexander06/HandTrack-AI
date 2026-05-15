import os
import sys
import shutil
import subprocess

os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
os.environ['ABSL_MIN_LOG_LEVEL'] = '3'

import pandas as pd
import numpy as np
import tensorflow as tf

tf.get_logger().setLevel('ERROR')

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
import json

dataset_dir = "../../Segni"
alfabeto_it = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'Z']
output_dir = "../modello"

def carica_addestra_modello():
    x_data = []
    y_labels = []

    for lettera in alfabeto_it:
        cartella_lettera = os.path.join(dataset_dir, lettera)
        if not os.path.exists(cartella_lettera): continue

        print(f"Caricamento lettera: {lettera}...")

        for file_csv in os.listdir(cartella_lettera):

            if not file_csv.endswith(".csv"): continue

            try:
                path_completo = os.path.join(cartella_lettera, file_csv)
                file = pd.read_csv(path_completo, header=None)

                try:
                    float(file.iloc[0, 3])
                except (ValueError, TypeError):
                    file = file.iloc[1:].reset_index(drop=True)

                landmarks = file.iloc[:, 3:6].values.astype(np.float32)

                if len(landmarks) != 21:
                    print(f"Landmarks non validi in {file_csv}")
                    continue

                polso = landmarks[0]
                landmarks = landmarks - polso

                if landmarks[5][0] < 0:
                    landmarks[:, 0] *= -1

                max_val = np.max(np.abs(landmarks))
                if max_val > 0:
                    landmarks = landmarks / max_val

                x_data.append(landmarks.flatten())
                y_labels.append(lettera)

            except Exception as e:
                print(f"Errore nel file {file_csv}: {e}")
                continue

    if not x_data:
        print("Nessun dato trovato")
        return
    
    # Divisione dati
    x = np.array(x_data)
    label_encoder = LabelEncoder()
    y = label_encoder.fit_transform(y_labels)

    x_train, x_test, y_train, y_test = train_test_split(
        x, y,
        test_size=0.2,
        random_state=42,
        stratify=y
    )

    # Modello
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(63,)),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.Dense(128, activation='relu'),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(64, activation='relu'),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.Dense(len(alfabeto_it), activation='softmax')
    ])

    model.compile(
        optimizer='adam',
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy']
    )

    # inizio addestramento
    print("\nInizio addestramento...")
    model.fit(
        x_train, y_train,
        epochs=60,
        batch_size=32,
        validation_data=(x_test, y_test)
    )

    # Accuratezza finale
    perdita, acc = model.evaluate(x_test, y_test)
    print(f"\nAccuratezza finale: {acc:.4f}")

    # Esportazione in ONNX
    print("\nPreparazione esportazione ONNX...")

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"\nCartella creata: {output_dir}\n")

    onnx_path = os.path.join(output_dir, "modello_lis_italiano.onnx")
    json_labels_path = os.path.join(output_dir, "labels.json")
    temp_model_dir = "temp_saved_model"

    try:
        model.export(temp_model_dir)
        
        cmd = [
            sys.executable, "-m", "tf2onnx.convert",
            "--saved-model", temp_model_dir,
            "--output", onnx_path,
            "--opset", "13"
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            print(f"\nModello creato: {onnx_path}")

            with open(json_labels_path, "w") as f: json.dump(list(label_encoder.classes_), f)
            print(f"labels.json salvato.")

        else:
            print(f"\nErrore tf2onnx:\n{result.stderr}")
            
    finally:
        if os.path.exists(temp_model_dir):
            shutil.rmtree(temp_model_dir)
            print(f"\nCartella temporanea eliminata.")

if __name__ == "__main__":
    carica_addestra_modello()