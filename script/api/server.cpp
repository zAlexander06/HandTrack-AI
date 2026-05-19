#include "header/httplib.h"
#include <nlohmann/json.hpp>
#include <fstream>
#include <filesystem>
#include <iostream>

namespace fs = std::filesystem;
using json = nlohmann::json;

std::string root_dir = "";
std::string dataset_dir = "Segni";

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
        root_dir = fs::current_path().parent_path().parent_path().string();

    std::cout << "[Config] Root: " << root_dir << "\n";
    std::cout << "[Config] Dataset: " << dataset_dir << "\n";
}

bool salva_dati_csv(const std::string &nome_cartella, const std::string &ts, const json &righe)
{
    try
    {
        fs::path root_path = fs::current_path().parent_path().parent_path();
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

    server.set_pre_routing_handler([](const httplib::Request &, httplib::Response &res)
                                   {
        setup_cors(res);
        return httplib::Server::HandlerResponse::Unhandled; });

    server.Options(".*", [](const httplib::Request &, httplib::Response &res)
                   { res.status = 204; });

    // PARTE DEL SALVATAGGIO
    server.Post("/salva", [](const httplib::Request &req, httplib::Response &res)
                {
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

        const std::string lettere_valide = "ABCDEFGHILMNOPQRSTUVZ";
            if (cartella.size() != 1 || lettere_valide.find(cartella[0]) == std::string::npos) {
                res.status = 400;
                res.set_content("Lettera non valida", "text/plain");
                return;
            }

        if (salva_dati_csv(cartella, timestamp, righe)) {
            std::cout << "Salvato frame per lettera: " << cartella << "\n";
            res.set_content("ok", "text/plain");
        } else {
            res.status = 500;
            res.set_content("Errore disco", "text/plain");
        }
    } catch (const std::exception& e) {
        res.status = 400;
        res.set_content(e.what(), "text/plain");
    } });

    // PARTE DEL TRAINING
    server.Post("/train", [](const httplib::Request &, httplib::Response &res)
                {
    std::cout << "Avvio Addestramento IA (.venv)" << std::endl;

    // std::string python_path = "../../.venv/Scripts/python.exe";
    std::string python_path;
    std::string full_command;
    std::string script_path = "training.py";

#ifdef _WIN32
        pyrhon_path = "../../.venv/Scripts/python.exe";
        full_command = python_path + " " + script_path;
#else
        python_path = "../../.venv/bin/python";
        full_command = python_path + " " + script_path + " > /dev/null 2>&1 &";
#endif

    std::cout << "Esecuzione comando di sistema: " << full_command << "\n";

    int result = system(full_command.c_str());

    if (result == 0) {
        res.set_content("Training avviato in background", "text/plain");
    } else {
        res.status = 500;
        res.set_content("Errore nell'avvio dello script", "text/plain");
    } });

    server.Get("/ping", [](const httplib::Request &, httplib::Response &res)
               { res.set_content("pong", "text/plain"); });

    std::cout << "\nCartella di lavoro: " << fs::current_path() << "\n";
    std::cout << "Attivo su http://127.0.0.1:5050\n\n";

    server.listen("127.0.0.1", 5050);
    return 0;
}