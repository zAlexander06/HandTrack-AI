#include "httplib.h"
#include <nlohmann/json.hpp>
#include <fstream>
#include <filesystem>
#include <iostream>

namespace fs = std::filesystem;
using json = nlohmann::json;

bool salva_dati_csv(const std::string &cartella, const std::string &timestamp, const json &righe)
{
    try
    {
        fs::path dir_destinazione;

        if (fs::path(cartella).is_absolute())
        {
            dir_destinazione = cartella;
        }
        else
        {
            dir_destinazione = fs::current_path() / cartella;
        }

        fs::create_directories(dir_destinazione);

        fs::path path_file = dir_destinazione / ("hand_" + timestamp + ".csv");
        std::ofstream f(path_file);
        if (!f.is_open())
        {
            std::cerr << "[X] Impossibile aprire: " << path_file << "\n";
            return false;
        }

        for (const auto &riga : righe)
        {
            for (size_t i = 0; i < riga.size(); ++i)
            {
                f << (riga[i].is_string() ? riga[i].get<std::string>() : riga[i].dump());
                if (i < riga.size() - 1)
                    f << ",";
            }
            f << "\n";
        }

        std::cout << "Salvato: " << path_file.filename() << "\n";
        return true;
    }
    catch (const std::exception &e)
    {
        std::cerr << "\n[X] Errore scrittura: " << e.what() << "\n";
        return false;
    }
}

void setup_cors(httplib::Response &res)
{
    res.set_header("Access-Control-Allow-Origin", "*");
    res.set_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
    res.set_header("Access-Control-Allow-Headers", "Content-Type");
}

int main()
{
    httplib::Server server;

    server.set_pre_routing_handler([](const httplib::Request &, httplib::Response &res)
                                   {
        setup_cors(res);
        return httplib::Server::HandlerResponse::Unhandled; });

    server.Options(".*", [](const httplib::Request &, httplib::Response &res)
                   { res.status = 204; });

    server.Post("/salva", [](const httplib::Request &req, httplib::Response &res)
                {
        try {
            auto body = json::parse(req.body);
            std::string cartella = body.value("cartella",  "dataset");
            std::string timestamp = body.value("timestamp", "0");
            auto righe = body["righe"];

            if (salva_dati_csv(cartella, timestamp, righe)) {
                res.set_content("ok", "text/plain");
            } else {
                res.status = 500;
                res.set_content("Errore scrittura file", "text/plain");
            }
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(std::string("JSON non valido: ") + e.what(), "text/plain");
        } });

    server.Get("/ping", [](const httplib::Request &, httplib::Response &res)
               { res.set_content("pong", "text/plain"); });

    std::cout << "Cartella di lavoro: " << fs::current_path() << "\n";
    std::cout << "Attivo su http://127.0.0.1:5050\n\n";

    server.listen("127.0.0.1", 5050);
    return 0;
}