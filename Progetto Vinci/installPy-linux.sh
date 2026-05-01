#!/bin/bash

# Controllo se Python è installato
if ! command -v python3 &> /dev/null; then
    echo "Python3 non trovato. Installazione in corso..."
    
    # Rileva il sistema operativo
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Esempio per sistemi basati su Debian/Ubuntu
        sudo apt-get update
        sudo apt-get install -y python3 python3-venv python3-pip
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # Esempio per macOS tramite Homebrew
        if ! command -v brew &> /dev/null; then
            echo "Homebrew non trovato. Installa Python manualmente o installa Homebrew."
            exit 1
        fi
        brew install python
    else
        echo "Sistema operativo non supportato per l'installazione automatica."
        exit 1
    fi
else
    echo "Python è già installato: $(python3 --version)"
fi

# Creazione ambiente virtuale
if [ ! -d "venv" ]; then
    echo "Creazione ambiente virtuale..."
    python3 -m venv venv
else
    echo "Ambiente virtuale già esistente."
fi

# Attivazione e installazione dipendenze
echo "Attivazione venv e aggiornamento pip..."
# Su Linux/macOS il comando è 'source' e il percorso è bin/activate
source venv/bin/activate

python3 -m pip install --upgrade pip

if [ -f "requirements.txt" ]; then
    echo "Installazione dipendenze da requirements.txt..."
    pip install -r requirements.txt
else
    echo "'requirements.txt' non trovato, salto installazione librerie."
fi

echo -e "\nProcedura completata! L'ambiente è pronto."
