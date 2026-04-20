#!/usr/bin/env python3
"""
train.py  —  Traina un classificatore di lettere dai CSV di landmark.

Struttura cartelle attesa:
    dataset/
        A/   hand_*.csv  hand_*.csv  ...
        B/   ...
        C/   ...

Uso:
    python train.py --dataset ./dataset --output model.pkl

Installa dipendenze al primo avvio automaticamente.
"""

import subprocess, sys

def pip_install(*pkgs):
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", *pkgs])

try:
    import numpy as np
except ImportError:
    print("Installo numpy..."); pip_install("numpy")
    import numpy as np

try:
    import sklearn
except ImportError:
    print("Installo scikit-learn..."); pip_install("scikit-learn")

from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report, confusion_matrix
import pickle, os, glob, csv, argparse

# ── Config ────────────────────────────────────────────────────────────────────

N_LANDMARKS  = 21
N_HANDS      = 2
FEATURE_SIZE = N_LANDMARKS * 3 * N_HANDS   # 126

# ── CSV → feature vector ──────────────────────────────────────────────────────

def csv_to_features(filepath: str):
    """
    Returns a flat numpy array of shape (126,).
    Hand 0 → indices 0..62, Hand 1 → indices 63..125.
    Missing hand → zeros.
    Coordinates are normalized relative to wrist (landmark 0) of each hand.
    """
    hands = {}   # hand_index -> list of (lm_index, x, y, z)

    with open(filepath, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            hi = int(row["hand_index"])
            li = int(row["lm_index"])
            x, y, z = float(row["x"]), float(row["y"]), float(row["z"])
            if hi not in hands:
                hands[hi] = {}
            hands[hi][li] = (x, y, z)

    features = np.zeros(FEATURE_SIZE, dtype=np.float32)

    for hi in range(N_HANDS):
        if hi not in hands or len(hands[hi]) != N_LANDMARKS:
            continue  # leave as zeros
        lms = hands[hi]
        # normalize: subtract wrist (lm 0)
        wx, wy, wz = lms[0]
        offset = hi * N_LANDMARKS * 3
        for li in range(N_LANDMARKS):
            x, y, z = lms[li]
            base = offset + li * 3
            features[base]     = x - wx
            features[base + 1] = y - wy
            features[base + 2] = z - wz

    return features

# ── Load dataset ──────────────────────────────────────────────────────────────

def load_dataset(dataset_dir: str):
    X, y = [], []
    label_dirs = sorted([
        d for d in os.listdir(dataset_dir)
        if os.path.isdir(os.path.join(dataset_dir, d))
    ])

    if not label_dirs:
        print(f"[ERRORE] Nessuna sottocartella trovata in: {dataset_dir}")
        sys.exit(1)

    print(f"\nCaricamento dataset da: {dataset_dir}")
    print(f"Classi trovate: {label_dirs}\n")

    for label in label_dirs:
        folder   = os.path.join(dataset_dir, label)
        csv_files = glob.glob(os.path.join(folder, "*.csv"))

        if not csv_files:
            print(f"  [{label}]  nessun CSV — salto")
            continue

        ok = 0
        for fp in csv_files:
            try:
                feat = csv_to_features(fp)
                if feat.sum() == 0:   # no landmarks detected in this frame
                    continue
                X.append(feat)
                y.append(label)
                ok += 1
            except Exception as e:
                pass  # skip malformed files

        print(f"  [{label}]  {ok}/{len(csv_files)} campioni caricati")

    return np.array(X, dtype=np.float32), np.array(y)

# ── Train ─────────────────────────────────────────────────────────────────────

def train(dataset_dir: str, output_path: str):
    X, y = load_dataset(dataset_dir)

    if len(X) == 0:
        print("\n[ERRORE] Nessun campione valido trovato.")
        sys.exit(1)

    print(f"\nTotale campioni: {len(X)}  —  classi: {sorted(set(y))}")

    le = LabelEncoder()
    y_enc = le.fit_transform(y)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y_enc, test_size=0.2, random_state=42, stratify=y_enc
    )

    # Random Forest: veloce, robusto, ottimo per landmark data
    clf = Pipeline([
        ("scaler", StandardScaler()),
        ("rf", RandomForestClassifier(
            n_estimators=300,
            max_depth=None,
            min_samples_leaf=2,
            n_jobs=-1,
            random_state=42
        ))
    ])

    print("\nTraining Random Forest...")
    clf.fit(X_train, y_train)

    # ── Evaluation ──
    y_pred = clf.predict(X_test)
    acc    = (y_pred == y_test).mean()
    print(f"\nAccuratezza sul test set: {acc*100:.1f}%")
    print("\nReport dettagliato:")
    print(classification_report(y_test, y_pred,
                                  target_names=le.classes_))

    # Cross-validation
    print("Cross-validation (5-fold)...")
    scores = cross_val_score(clf, X, y_enc, cv=5, n_jobs=-1)
    print(f"CV accuracy: {scores.mean()*100:.1f}% ± {scores.std()*100:.1f}%")

    # ── Save ──
    bundle = {
        "model":         clf,
        "label_encoder": le,
        "feature_size":  FEATURE_SIZE,
        "n_landmarks":   N_LANDMARKS,
    }
    with open(output_path, "wb") as f:
        pickle.dump(bundle, f)

    print(f"\nModello salvato in: {output_path}")
    print("Ora avvia hand_tracking.py — rileverà automaticamente il modello.")

# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Traina classificatore lettere")
    parser.add_argument("--dataset", default="./dataset",
                        help="Cartella radice con sottocartelle per lettera")
    parser.add_argument("--output",  default="model.pkl",
                        help="File dove salvare il modello")
    args = parser.parse_args()

    train(args.dataset, args.output)