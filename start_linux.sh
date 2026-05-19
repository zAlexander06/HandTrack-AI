set -e

echo "Avvio setup ambiente Completo (Linux/Codespaces)"
echo "=============================================="
echo ""

# Sezione Python
echo "[PYTHON]"

if ! command -v python3.11 &> /dev/null; then
    echo "Python 3.11 non trovato. Installazione in corso..."
    sudo apt update -y -q
    sudo apt install -y software-properties-common -q
    sudo add-apt-repository ppa:deadsnakes/ppa -y
    sudo apt update -y -q
    sudo apt install -y python3.11 python3.11-venv python3.11-dev -q
    echo "Python 3.11 installato con successo."
else
    echo "Python 3.11 trovato: $(python3.11 --version)"
fi

echo ""

# Ambiente virtuale
if [ ! -d ".venv" ]; then
    echo "Creazione ambiente virtuale..."
    python3 -m venv .venv
    if [ $? -ne 0 ]; then
        echo "ERRORE: Impossibile creare l'ambiente virtuale. Verifica che il pacchetto python3-venv sia installato."
        exit 1
    fi
else
    echo "Ambiente virtuale già esistente."
fi

# Attivazione venv
source .venv/bin/activate

echo "Aggiornamento pip..."
python3 -m pip install --upgrade pip -q

if [ -f "requirements.txt" ]; then
    echo "Installazione dipendenze Python..."
    pip install -r requirements.txt -q
else
    echo "requirements.txt non trovato."
fi

echo ""
echo "Python pronto."
echo ""

# Sezione Node.js
echo "[NODE]"

if ! command -v node &> /dev/null; then
    echo "ERRORE: Node.js non trovato."
    exit 1
fi
echo "Node.js trovato: $(node --version)"

if ! command -v npm &> /dev/null; then
    echo "ERRORE: npm non trovato."
    exit 1
fi
echo "npm trovato: $(npm --version)"
echo ""

if [ ! -d "node_modules" ]; then
    echo "Installazione moduli Node..."
    npm install
    if [ $? -ne 0 ]; then
        echo "ERRORE: npm install fallito."
        exit 1
    fi
    echo "Moduli installati."
else
    echo "Moduli già presenti."
fi

echo ""

echo "Avvio frontend..."
npm start &

echo ""
echo "=============================================="
echo "TUTTO PRONTO!"
echo "Il server è in esecuzione in background."
echo "Puoi accedere all'anteprima tramite la scheda 'Ports' di VS Code."
echo "=============================================="