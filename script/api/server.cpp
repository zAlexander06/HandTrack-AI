#include "header/httplib.h"
#include "header/nlohmann/json.hpp"
#include <fstream>
#include <filesystem>

namespace fs = std::filesystem;
using json = nlohmann::json;

int main()
{
    httplib::Server server;

    // fa chiamata, tramite fetch, da localhost (in questo caso) usando una porta diversa
    server.set_pre_routing_handler([](const httplib::Request &, httplib::Response &res)
                                   {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
        return httplib::Server::HandlerResponse::Unhandled; });

    // da come risultato http di successo (204)
    server.Options(".*", [](const httplib::Request &, httplib::Response &res)
                   { res.status = 204; });

    server.Post("/salva", [](const httplib::Request &req, httplib::Response &res)
                {
        try{
            auto body = json::parse(req.body);
            std::string cartella = body["cartella"];
            std::string timestamp = body["timestamp"];
            auto righe = body["righe"];

            fs::create_directories(cartella);
            std::string dir_file = cartella + "/hand_" + timestamp + ".csv";

            std::ofstream f(dir_file);
            for(auto& riga : righe) {
                for(size_t i = 0; i < riga.size(); ++i){
                    (riga[i].is_string()) ? f << riga[i].get<std::string>() : f << riga[i].dump();
                    if(i < riga.size() - 1) f << ",";
                }
                f << "\n";
            }

            res.set_content("ok", "text/plain");
        }
        catch(const std::exception& e){
            res.status = 500;
            res.set_content(e.what(), "text/plain");
        } });

    server.Get("/ping", [](const httplib::Request &, httplib::Response &res)
               { res.set_content("pong", "text/plain"); });

    std::cout << "-> Server in ascolto su http://localhost:5050\n";
    server.listen("127.0.0.1", 5050);
}