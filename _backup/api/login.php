<?php
// ================================================================
// api/login.php — Autenticazione utente
// POST { email, password_hash }
// ================================================================
require_once __DIR__ . '/../config/db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['error' => 'Metodo non consentito.'], 405);
}

$body = getJsonBody();
$email         = trim($body['email']         ?? '');
$password_hash = trim($body['password_hash'] ?? '');

if (!$email || !$password_hash) {
    jsonResponse(['error' => 'Email e password sono obbligatorie.'], 400);
}

$db = getDB();

// Cerca l'utente con email + hash corrispondenti
$stmt = $db->prepare(
    'SELECT id, username, email, realName, surname, role_user, status_user
     FROM users
     WHERE email = :email AND password_hash = :hash
     LIMIT 1'
);
$stmt->execute([':email' => $email, ':hash' => $password_hash]);
$user = $stmt->fetch();

if (!$user) {
    jsonResponse(['error' => 'Email o password errati.'], 401);
}

// Aggiorna status a online
$db->prepare('UPDATE users SET status_user = "online" WHERE id = :id')
   ->execute([':id' => $user['id']]);

jsonResponse([
    'id'       => (int)$user['id'],
    'username' => $user['username'],
    'email'    => $user['email'],
    'realname' => $user['realName'],
    'surname'  => $user['surname'],
    'role'     => $user['role_user'],
]);
