<?php
// ================================================================
// api/logout.php — Distrugge la sessione server-side
// POST {} (nessun body richiesto)
// ================================================================
require_once __DIR__ . '/../config/db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['ok' => false, 'error' => 'Metodo non consentito.'], 405);
}

// Aggiorna stato offline se l'utente era loggato
if (isset($_SESSION['user_id'])) {
    try {
        $db = getDB();
        $db->prepare('UPDATE users SET status_user = "offline" WHERE id = :id')
           ->execute([':id' => $_SESSION['user_id']]);
    } catch (Throwable) {
        // Non bloccare il logout anche se la query fallisce
    }
}

// Svuota i dati di sessione
$_SESSION = [];

// Invalida il cookie di sessione nel browser
if (ini_get('session.use_cookies')) {
    $params = session_get_cookie_params();
    setcookie(
        session_name(), '',
        time() - 42000,
        $params['path'],
        $params['domain'],
        $params['secure'],
        $params['httponly']
    );
}

// Distrugge la sessione sul server
session_destroy();

jsonResponse(['ok' => true]);