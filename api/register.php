<?php
// ================================================================
// api/register.php — Registrazione nuovo utente
// POST { realname, surname, username, email, password_hash }
// ================================================================
require_once __DIR__ . '/../config/db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['error' => 'Metodo non consentito.'], 405);
}

$body          = getJsonBody();
$realname      = trim($body['realname']      ?? '');
$surname       = trim($body['surname']       ?? '');
$username      = trim($body['username']      ?? '');
$email         = trim($body['email']         ?? '');
$password_hash = trim($body['password_hash'] ?? '');

if (!$realname || !$surname || !$username || !$email || !$password_hash) {
    jsonResponse(['error' => 'Tutti i campi sono obbligatori.'], 400);
}

$db = getDB();

try {
    $stmt = $db->prepare(
        'INSERT INTO users (realName, surname, username, email, password_hash)
         VALUES (:realname, :surname, :username, :email, :hash)'
    );
    $stmt->execute([
        ':realname' => $realname,
        ':surname'  => $surname,
        ':username' => $username,
        ':email'    => $email,
        ':hash'     => $password_hash,
    ]);

    $newId = (int)$db->lastInsertId();
    jsonResponse(['id' => $newId, 'username' => $username, 'email' => $email]);

} catch (PDOException $e) {
    // Violazione UNIQUE (codice MySQL 23000 / 1062)
    if ($e->getCode() === '23000') {
        $msg = $e->getMessage();
        if (stripos($msg, 'username') !== false)  jsonResponse(['error' => 'Username già in uso.'], 409);
        if (stripos($msg, 'email') !== false)      jsonResponse(['error' => 'Email già registrata.'], 409);
        if (stripos($msg, 'realName') !== false)   jsonResponse(['error' => 'Nome già in uso.'], 409);
        jsonResponse(['error' => 'Username o email già in uso.'], 409);
    }
    jsonResponse(['error' => 'Errore durante la registrazione: ' . $e->getMessage()], 500);
}
