<?php
// ================================================================
// api/register.php — Registrazione nuovo utente
// POST { realname, surname, username, email, password }
// ================================================================
require_once __DIR__ . '/../config/db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['ok' => false, 'error' => 'Metodo non consentito.'], 405);
}

$body     = getJsonBody();
$realname = trim($body['realname']  ?? '');
$surname  = trim($body['surname']   ?? '');
$username = trim($body['username']  ?? '');
$email    = trim($body['email']     ?? '');
$password = trim($body['password']  ?? '');

if (!$realname || !$surname || !$username || !$email || !$password) {
    jsonResponse(['ok' => false, 'error' => 'Tutti i campi sono obbligatori.'], 400);
}

// ── Validazione password ──────────────────────────────────────────
$pwErrors = [];
if (strlen($password) < 8)                $pwErrors[] = 'almeno 8 caratteri';
if (!preg_match('/[A-Z]/', $password))    $pwErrors[] = 'almeno una lettera maiuscola';
if (!preg_match('/[a-z]/', $password))    $pwErrors[] = 'almeno una lettera minuscola';
if (!preg_match('/[0-9]/', $password))    $pwErrors[] = 'almeno un numero';
if (!preg_match('/[\W_]/', $password))    $pwErrors[] = 'almeno un carattere speciale';

if ($pwErrors) {
    jsonResponse(['ok' => false, 'error' => 'Password non valida: ' . implode(', ', $pwErrors) . '.'], 422);
}

$hash = password_hash($password, PASSWORD_BCRYPT);

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
        ':hash'     => $hash,
    ]);

    $newId = (int)$db->lastInsertId();

    // ── Avvia sessione subito dopo la registrazione ──────────────
    session_regenerate_id(true);
    $_SESSION['user_id']  = $newId;
    $_SESSION['role']     = 'utente';
    $_SESSION['username'] = $username;

    jsonResponse([
        'ok'   => true,
        'user' => [
            'id'       => $newId,
            'username' => $username,
            'email'    => $email,
            'realname' => $realname,
            'surname'  => $surname,
            'role'     => 'utente',
        ],
    ]);

} catch (PDOException $e) {
    if ($e->getCode() === '23000') {
        $msg = $e->getMessage();
        if (stripos($msg, 'username') !== false) jsonResponse(['ok' => false, 'error' => 'Username già in uso.'], 409);
        if (stripos($msg, 'email')    !== false) jsonResponse(['ok' => false, 'error' => 'Email già registrata.'], 409);
        if (stripos($msg, 'realName') !== false) jsonResponse(['ok' => false, 'error' => 'Nome già in uso.'], 409);
        jsonResponse(['ok' => false, 'error' => 'Username o email già in uso.'], 409);
    }
    jsonResponse(['ok' => false, 'error' => 'Errore durante la registrazione.'], 500);
}