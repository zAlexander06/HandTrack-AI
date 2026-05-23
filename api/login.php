<?php
// ================================================================
// api/login.php — Autenticazione utente
// POST { email, password }
// Risposta: { ok:true, user:{ id, username, email, realname, surname, role } }
// ================================================================
require_once __DIR__ . '/../config/db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['ok' => false, 'error' => 'Metodo non consentito.'], 405);
}

$body     = getJsonBody();
$email    = trim($body['email']    ?? '');
$password = trim($body['password'] ?? '');

if (!$email || !$password) {
    jsonResponse(['ok' => false, 'error' => 'Email e password sono obbligatorie.'], 400);
}

$db = getDB();

$stmt = $db->prepare(
    'SELECT id, username, email, realName, surname, role_user, password_hash, scheduled_deletion_at
     FROM users
     WHERE email = :email
     LIMIT 1'
);
$stmt->execute([':email' => $email]);
$user = $stmt->fetch();

if (!$user || !password_verify($password, $user['password_hash'])) {
    jsonResponse(['ok' => false, 'error' => 'Email o password errati.'], 401);
}

// Aggiorna stato online
$db->prepare('UPDATE users SET status_user = "online", last_seen = NOW() WHERE id = :id')
   ->execute([':id' => $user['id']]);

// ── Avvia la sessione server-side ────────────────────────────────
// session_start() è già stato chiamato da db.php.
// Rigenera l'ID di sessione per prevenire session fixation.
session_regenerate_id(true);

$_SESSION['user_id']  = (int)$user['id'];
$_SESSION['role']     = $user['role_user'];
$_SESSION['username'] = $user['username'];

// ── Risponde solo con dati NON sensibili (niente password_hash) ──
jsonResponse([
    'ok'   => true,
    'user' => [
        'id'                    => (int)$user['id'],
        'username'              => $user['username'],
        'email'                 => $user['email'],
        'realname'              => $user['realName'],
        'surname'               => $user['surname'],
        'role'                  => $user['role_user'],
        'scheduled_deletion_at' => $user['scheduled_deletion_at'],
    ],
]);