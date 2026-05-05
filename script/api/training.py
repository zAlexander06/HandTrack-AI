import os
import pandas as pd
import numpy as np
import tensorflow as tf
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
import tf2onnx
import json

dataset_path = "../../Segni"
alfabeto_it = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'Z']

def carica_dataset():
    x_data = []
    y_labels = []

    for lettera in alfabeto_it:
        cartella_lettera = os.path.join(dataset_path, lettera)
        if not os.path.exists(cartella_lettera): continue

        print(f"Caricamento lettera: {lettera}...")

        for file_csv in os.listdir(cartella_lettera):
            try:
                path_completo = os.path.join(cartella_lettera, file_csv)
                file = pd.read_csv(path_completo, header=None)

                landmarks = file.iloc[:, 3:6].values.astype(np.float32)

                if len(landmarks) == 21:
                    polso = landmarks[0]
                    landmarks = landmarks - polso
                    
                    flat_landmarks = landmarks.flatten()
                    
                    x_data.append(flat_landmarks)
                    y_labels.append(lettera)
            except Exception as e:
                print(f"Errore nel file {file_csv}: {e}")

    return np.array(x_data), np.array(y_labels)

# Caricamento
x, y = carica_dataset()

if len(x) == 0:
    print("Errore: Nessun dato trovato! Controlla il percorso del dataset.")
    exit()

# Encoding etichette
label_encoder = LabelEncoder()
y_encoded = label_encoder.fit_transform(y)

# Divisione dati
x_train, x_test, y_train, y_test = train_test_split(x, y_encoded, test_size=0.2, random_state=42)

# Modello
model = tf.keras.Sequential([
    tf.keras.layers.Input(shape=(63,)),
    tf.keras.layers.Dense(128, activation='relu'),
    tf.keras.layers.Dropout(0.2),
    tf.keras.layers.Dense(64, activation='relu'),
    tf.keras.layers.Dense(len(alfabeto_it), activation='softmax')
])

model.compile(optimizer='adam', loss='sparse_categorical_crossentropy', metrics=['accuracy'])

# inizio addestramento
print("\nInizio addestramento...")
model.fit(x_train, y_train, epochs=60, batch_size=32, validation_data=(x_test, y_test))

# Esportazione in ONNX
print("\nEsportazione in ONNX...")
spec = (tf.TensorSpec((None, 63), tf.float32, name="float_input"),)
output_path = "modello_lis_italiano.onnx"

model_proto, _ = tf2onnx.convert.from_keras(model, input_signature=spec, opset=13)
with open(output_path, "wb") as f: f.write(model_proto.SerializeToString())

print(f"Successo! Modello salvato come: {output_path}")

# Salviamo le etichette
with open("labels.json", "w") as f:
    json.dump(list(label_encoder.classes_), f)