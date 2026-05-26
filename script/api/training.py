import os
import sys
import json
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

dataset_dir = "../../Segni"
output_dir = "../modello"

epochs = 60
bat_size = 32
test_size = 0.2
valore_random = 42

def get_classi_dataset():
    if not os.path.exists(dataset_dir):
        print(f"Dataset non trovato: {dataset_dir}")
        return []

    classi =  sorted([
        nome
        for nome in os.listdir(dataset_dir)
        if os.path.isdir(os.path.join(dataset_dir, nome))
    ])

    return classi

def carica_dataset(classi_consentite):
    x_data = []
    y_labels = []

    totale_file = 0

    for classe in classi_consentite:
        cartella = os.path.join(dataset_dir, classe)
        if not os.path.exists(cartella): continue

        print(f"\nCaricamento classe: {classe}")
        count_classe = 0

        for file_csv in os.listdir(cartella):
            if not file_csv.endswith(".csv"): continue

            totale_file += 1

            try:
                path_completo = os.path.join(cartella, file_csv)

                # Supporta CSV con o senza header
                file = pd.read_csv(path_completo)

                colonne_attese = ["hand_index", "handedness", "lm_index", "x", "y", "z"]

                if all(c in file.columns for c in colonne_attese): landmarks = file[["x", "y", "z"]].values.astype(np.float32)

                else:
                    file = pd.read_csv(path_completo, header=None)
                    landmarks = file.iloc[:, 3:6].values.astype(np.float32)

                # Controllo validità
                if len(landmarks) != 21:
                    print(f"Landmarks non validi " f"in {file_csv}")
                    continue

                # Centro sul polso
                polso = landmarks[0]
                landmarks = landmarks - polso

                # Mirror automatico
                # per uniformare dx/sx
                if landmarks[5][0] < 0: landmarks[:, 0] *= -1

                # Normalizzazione scala
                max_val = np.max(np.abs(landmarks))

                if max_val > 0: landmarks = (landmarks / max_val)

                x_data.append(landmarks.flatten())
                y_labels.append(classe)

                count_classe += 1

            except Exception as e:
                print(f"Errore file " f"{file_csv}: {e}")

        print(f"Campioni caricati: " f"{count_classe}")

    print(f"\nTotale file letti: " f"{totale_file}")

    return np.array(x_data), np.array(y_labels)

def crea_modello(num_classi):
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(63,)),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.Dense(256, activation='relu'),
        tf.keras.layers.Dropout(0.35),
        tf.keras.layers.Dense(128, activation='relu'),
        tf.keras.layers.Dropout(0.25),
        tf.keras.layers.Dense(64, activation='relu'),
        tf.keras.layers.Dense(num_classi, activation='softmax')
    ])

    model.compile(optimizer='adam', loss='sparse_categorical_crossentropy', metrics=['accuracy'])

    return model

def esporta_modello_onnx(model, label_encoder):
    print("\nPreparazione esportazione ONNX...")
    os.makedirs(output_dir, exist_ok=True)

    onnx_path = os.path.join(output_dir, "modello_lis_italiano.onnx")
    json_labels_path = os.path.join(output_dir,"labels.json")
    temp_model_dir = ("temp_saved_model")

    try:
        model.export(temp_model_dir)
        cmd = [sys.executable, "-m", "tf2onnx.convert", "--saved-model", temp_model_dir, "--output", onnx_path, "--opset", "13"]
        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode == 0:
            print(f"\nModello creato:\n" f"{onnx_path}")
            with open(json_labels_path,"w",encoding="utf-8") as f:
                json.dump(list(label_encoder.classes_), f, ensure_ascii=False, indent=2)

            print(f"Labels salvate:\n" f"{json_labels_path}")

        else:
            print("\nErrore tf2onnx:\n" + result.stderr)

    finally:
        if os.path.exists(temp_model_dir):
            shutil.rmtree(temp_model_dir)
            print("\nCartella temporanea eliminata.")

def carica_addestra_modello():
    classi_consentite = (get_classi_dataset())

    if not classi_consentite:
        print("Nessuna classe trovata")
        return

    print("\nClassi trovate:\n" + str(classi_consentite))
    x, y_labels = carica_dataset(classi_consentite)

    if len(x) == 0:
        print("\nNessun dato trovato")
        return

    print(f"\nDataset totale: " f"{len(x)} campioni")

    # Encode labels
    label_encoder = (LabelEncoder())
    y = label_encoder.fit_transform(y_labels)

    # Split dataset
    x_train, x_test, y_train, y_test = (train_test_split(x, y, test_size=test_size, random_state=valore_random, stratify=y))

    print(f"Training: {len(x_train)}\n" f"Test: {len(x_test)}")

    # Modello
    model = crea_modello(len(label_encoder.classes_))

    # Early stopping
    early_stop = (tf.keras.callbacks.EarlyStopping(monitor="val_accuracy", patience=8, restore_best_weights=True))

    # Training
    print("\nInizio addestramento...")

    history = model.fit(x_train, y_train, epochs=epochs, batch_size=bat_size, validation_data=(x_test, y_test), callbacks=[early_stop], verbose=1)

    # Accuracy finale
    perdita, acc = (model.evaluate(x_test, y_test, verbose=0))

    print(f"\nAccuratezza "f"finale: "f"{acc:.4f}")

    esporta_modello_onnx(model, label_encoder)

if __name__ == "__main__":
    carica_addestra_modello()