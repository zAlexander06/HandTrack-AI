<?php
// ================================================================
// HandTrackLIS — Configurazione database MySQL
// Modifica i valori sotto per adattarli al tuo server phpMyAdmin
// ================================================================

define('DB_HOST',    'localhost');   // Host MySQL (di solito localhost)
define('DB_NAME',    'handtracklis'); // Nome del database creato in phpMyAdmin
define('DB_USER',    'root');        // Utente MySQL
define('DB_PASS',    '');            // Password MySQL
define('DB_CHARSET', 'utf8mb4');

/**
 * Restituisce una connessione PDO al database.
 * La connessione viene riutilizzata (singleton).
 */
function getDB(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=%s',
        DB_HOST, DB_NAME, DB_CHARSET
    );

    try {
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Errore di connessione al database.']);
        exit;
    }

    return $pdo;
}

// ================================================================
// Helper: invia una risposta JSON e termina lo script
// ================================================================
function jsonResponse(mixed $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    // Permetti richieste dallo stesso origine (adatta se frontend è su altro dominio)
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// Gestione richieste OPTIONS (preflight CORS)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    http_response_code(204);
    exit;
}

// ================================================================
// Helper: legge il body JSON della richiesta
// ================================================================
function getJsonBody(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}
