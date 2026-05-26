#include "header/httplib.h"
#include <nlohmann/json.hpp>
#include <fstream>
#include <filesystem>
#include <iostream>
#include <mutex>
#include <vector>
#include <string>
#include <algorithm>

#ifdef _WIN32
#include <windows.h>
#include <process.h>
#endif

namespace fs = std::filesystem;
using json = nlohmann::json;

std::string root_dir = "";
std::string dataset_dir = "Segni";

static fs::file_time_type ora_inizio_train;
static bool training_in_corso = false;
static std::string errore_training = "";
static std::mutex training_mutex;

const std::vector<std::string> lettere_valide = {
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
    "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
    "spazio", "del", "canc"};

static fs::path get_executable_path(const char *argv0)
{
    fs::path p = argv0;
    if (p.is_relative())
        p = fs::current_path() / p;
    try
    {
        return fs::canonical(p);
    }
    catch (const std::exception &)
    {
        return fs::absolute(p);
    }
}

void configura_dataset(int argc, char *argv[])
{
    for (int i = 0; i < argc - 1; ++i)
    {
        std::string arg = argv[i];
        if (arg == "--root")
            root_dir = argv[i + 1];
        if (arg == "--dataset")
            dataset_dir = argv[i + 1];
    }

    if (root_dir.empty())
    {
        fs::path exe_path = get_executable_path(argv[0]);
        fs::path root_candidate = exe_path;
        for (int i = 0; i < 3 && !root_candidate.empty(); ++i)
            root_candidate = root_candidate.parent_path();
        root_dir = root_candidate.string();
    }

    std::cout << "[Config] Root: " << root_dir << "\n";
    std::cout << "[Config] Dataset: " << dataset_dir << "\n";
}

bool salva_dati_csv(const std::string &nome_cartella, const std::string &ts, const json &righe)
{
    try
    {
        fs::path root_path = root_dir.empty() ? fs::current_path() : fs::path(root_dir);
        fs::path dir_dest = root_path / dataset_dir / nome_cartella;

        if (!fs::exists(dir_dest))
            fs::create_directories(dir_dest);

        std::string file_path = (dir_dest / ("hand_" + ts + ".csv")).string();
        std::ofstream f(file_path);

        if (!f.is_open())
            return false;

        for (auto &riga : righe)
        {
            for (size_t i = 0; i < riga.size(); ++i)
            {
                if (riga[i].is_string())
                    f << riga[i].get<std::string>();
                else
                    f << riga[i].dump();
                if (i < riga.size() - 1)
                    f << ",";
            }
            f << "\n";
        }
        f.close();
        return true;
    }
    catch (const std::exception &e)
    {
        std::cerr << "Errore C++: " << e.what() << std::endl;
        return false;
    }
}

void setup_cors(httplib::Response &res)
{
    res.set_header("Access-Control-Allow-Origin", "*");
    res.set_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
    res.set_header("Access-Control-Allow-Headers", "Content-Type");
}

int main(int argc, char *argv[])
{
    configura_dataset(argc, argv);

    httplib::Server server;

    // Routing (anche in locale)
    server.set_pre_routing_handler([](const httplib::Request &, httplib::Response &res)
                                   {
        setup_cors(res);
        return httplib::Server::HandlerResponse::Unhandled; });

    server.Options(".*", [](const httplib::Request &, httplib::Response &res)
                   { res.status = 204; });

    // Parte del salvataggio file csv
    server.Post("/salva", [](const httplib::Request &req, httplib::Response &res)
                {
                
        static std::mutex mtx;
        static std::string ultima_lettera = "";
        static int contatore_frame = 0;
    try {
        auto body = json::parse(req.body);
        
        if (!body.contains("cartella") || !body.contains("righe")) {
            res.status = 400;
            res.set_content("Missing fields", "text/plain");
            return;
        }

        std::string cartella = body["cartella"];
        std::string timestamp = body.value("timestamp", "0");
        auto righe = body["righe"];

        auto it = std::find(lettere_valide.begin(), lettere_valide.end(), cartella);
        if (it == lettere_valide.end()) {
            res.status = 400;
            res.set_content("Lettera non valida", "text/plain");
            return;
        }

        if (salva_dati_csv(cartella, timestamp, righe)) {
            std::lock_guard<std::mutex> lock(mtx);

            if (cartella != ultima_lettera) {
                if (!ultima_lettera.empty()) std::cout << "\n"; // Va a capo solo quando cambi lettera
                ultima_lettera  = cartella;
                contatore_frame = 0;
            }
            contatore_frame++;

            std::cout << "\rSalvato frame per lettera: '" << cartella << "' | Frame salvati: " << contatore_frame << std::flush;
            res.set_content("ok", "text/plain");
        } else {
            res.status = 500;
            res.set_content("Errore disco", "text/plain");
        }
    } catch (const std::exception& e) {
        res.status = 400;
        res.set_content(e.what(), "text/plain");
    } });

    // Chiamata bottone HTML per il Training a Python
    server.Post("/train", [&](const httplib::Request &req, httplib::Response &res)
                {
        std::cout << "Richiesta di addestramento ricevuta." << std::endl;

        {
            std::lock_guard<std::mutex> lock(training_mutex);
            ora_inizio_train = fs::file_time_type::clock::now();
            training_in_corso = true;
            errore_training.clear();
        }

        fs::path root_path = root_dir.empty() ? fs::current_path() : fs::path(root_dir);
        fs::path script_py = root_path / "script" / "api" / "training.py";
        fs::path python_path;

#ifdef _WIN32
            python_path = fs::absolute(root_path / ".venv" / "Scripts" / "python.exe");
#else
            python_path = fs::absolute(root_path / ".venv" / "bin" / "python");
#endif

        if(!fs::exists(script_py)) {
            std::cerr << "Script non trovato: " << script_py << "\n";
            {
                std::lock_guard<std::mutex> lock(training_mutex);
                training_in_corso = false;
                errore_training = "Script 'training.py' non trovato nel percorso indicato.";
            }
            res.status = 500;
            res.set_content("Script training non trovato", "text/plain");
            return;
        }
    
        std::string cmd_python = python_path.make_preferred().string();
        std::string cmd_script = script_py.make_preferred().string();
        std::string full_command;

#ifdef _WIN32
            full_command = "\"" + (std::string)"\"" + cmd_python + "\" \"" + cmd_script + "\"" + "\"";
#else
            full_command = "\"" + cmd_python + "\" \"" + cmd_script + "\"";
#endif

        std::thread([full_command]() {
            std::cout << "Avvio dello script Python...\n" << std::flush;

            int ris = std::system(full_command.c_str());
            std::lock_guard<std::mutex> lock(training_mutex);

            if(ris != 0) {
                std::cerr << "Lo script Python è fallito con codice: " << ris << "\n";
                training_in_corso = false;
                errore_training = "Errore interno Python con Codice: '" + std::to_string(ris) + "'";
            }
            else {
                std::cout << "\nScript Python terminato con successo.\n" << std::flush;
            }
        }).detach();

        res.status = 200;
        res.set_content("Training avviato", "text/plain"); });

    // Status del training (alert per il javascript)
    server.Get("/status-train", [&](const httplib::Request &req, httplib::Response &res)
               {
        
        if (!errore_training.empty()) {
            res.status = 500;
            res.set_content(errore_training, "text/plain");
            return;
        }

        fs::path root_path = root_dir.empty() ? fs::current_path() : fs::path(root_dir);
        fs::path onnx_path = fs::absolute(root_path / "modello" / "modello_lis_italiano.onnx");

        if (fs::exists(onnx_path)) {
            auto ultima_modifica = fs::last_write_time(onnx_path);

            std::lock_guard<std::mutex> lock(training_mutex);
            if (ultima_modifica > ora_inizio_train && training_in_corso) {
                training_in_corso = false;
                res.set_content("Completato", "text/plain");
                return;
            }
        }

        res.set_content("Ancora in corso...", "text/plain"); });

    // Ping al javascript
    server.Get("/ping", [](const httplib::Request &, httplib::Response &res)
               { res.set_content("pong", "text/plain"); });

    std::cout << "\nCartella di lavoro: " << fs::current_path() << "\n";
    std::cout << "Attivo su http://127.0.0.1:5050\n\n";

    server.listen("127.0.0.1", 5050);
    return 0;
}