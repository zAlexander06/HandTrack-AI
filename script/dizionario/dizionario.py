import json
import os

def converti_dizionario_in_json(file_input_txt, file_output_json):
    dizionario_json = {chr(i): [] for i in range(65, 91)}

    print(f"Inizio elaborazione del file di testo..." f"\nApertura file: {file_input_txt}")
    count_parole = 0

    try:
        with open(file_input_txt, 'r', encoding='utf-8') as f:

            for linea in f:
                parti = linea.split()

                if not parti: continue

                parola = parti[-1].strip().upper()

                if not parola: continue

                prima_lettera = parola[0]

                if prima_lettera in dizionario_json:
                    dizionario_json[prima_lettera].append(parola)
                    count_parole += 1

        # Rimuove lettere vuote
        dizionario_json = {
            k: sorted(set(v))
            for k, v in dizionario_json.items()
            if v
        }

        print(f"\nElaborate {count_parole} parole totali.")
        print(f"Salvataggio nel file JSON: {file_output_json}")

        with open(file_output_json, 'w', encoding='utf-8') as f_json:
            json.dump(dizionario_json, f_json, ensure_ascii=False)

        print("\nConversione completata con successo!")

    except FileNotFoundError:
        print(f"File non trovato: {file_input_txt}")

    except Exception as e:
        print(f"Errore durante l'elaborazione: {e}")


if __name__ == "__main__":
    cartella_corrente = os.path.dirname(os.path.abspath(__file__))
    path_input = os.path.join(cartella_corrente, "dizionario_ita.txt")
    path_output = os.path.join(cartella_corrente, "dizionario_it.json")
    converti_dizionario_in_json(path_input, path_output)