<?php
// ================================================================
// HandTrackLIS — Configurazione database MySQL
// ================================================================

define('DB_HOST',    'localhost');
define('DB_NAME',    'my_handtracklis');
define('DB_USER',    'root');
define('DB_PASS',    '');
define('DB_CHARSET', 'utf8mb4');

// ================================================================
// Sessione sicura — chiamata UNA VOLTA, prima di qualsiasi output
// ================================================================
function startSecureSession(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;

    session_set_cookie_params([
        'lifetime' => 0,          // scade alla chiusura del browser
        'path'     => '/',
        'secure'   => true,       // HTTPS obbligatorio (Altervista usa HTTPS)
        'httponly' => true,       // JS non può leggere il cookie
        'samesite' => 'None',     // necessario con credentials: 'include' su HTTPS
    ]);
    session_start();
}

// Avvia subito la sessione (prima di qualsiasi header/output)
startSecureSession();

// ================================================================
// Connessione PDO (singleton)
// ================================================================
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
// Helper: verifica che l'utente sia autenticato via sessione.
// Se non lo è, risponde 401 e termina lo script.
// ================================================================
function requireAuth(): int {
    if (!isset($_SESSION['user_id'])) {
        jsonResponse(['ok' => false, 'error' => 'Non autenticato.'], 401);
    }
    return (int)$_SESSION['user_id'];
}

// ================================================================
// CORS — necessario per credentials: 'include' (cookie di sessione)
// Con credentials il browser non accetta Access-Control-Allow-Origin: *
// ================================================================
function setCorsHeaders(): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    // Lista origini consentite (aggiungi qui il tuo dominio)
    $allowed = [
        'https://handtracklis.altervista.org',
        'http://localhost',
        'http://127.0.0.1',
    ];
    if (in_array($origin, $allowed, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
    }
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}
function jsonResponse(mixed $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    setCorsHeaders();
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// Gestione richieste OPTIONS (preflight CORS)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
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