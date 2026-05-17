<?php
// ================================================================
// api/register.php — Registrazione nuovo utente
// POST { realname, surname, username, email, password_hash }
// ================================================================
require_once __DIR__ . '/../config/db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['error' => 'Metodo non consentito.'], 405);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    exit();
}

function isUsernameValido(string $username)
{
    $blacklist = ["admin", "administrator", "root", "superuser", "moderator", "staff", "support", "helpdesk", "negro", "nigga", "giganigga"];

    $search  = ['0', '1', '3', '4', '5', '7', '8'];
    $replace = ['o', 'i', 'e', 'a', 's', 't', 'b'];

    $nomeProcessato = str_replace($search, $replace, strtolower($username));

    foreach ($blacklist as $parolaVietata) {
        if (strpos($nomeProcessato, $parolaVietata) !== false) {
            return false;
        }
    }

    if (!preg_match('/^[a-zA-Z0-9_-]+$/', $username)) return false;

    return true;
}

$body = getJsonBody();
$realname = trim($body['realname'] ?? '');
$surname = trim($body['surname'] ?? '');
$username = trim($body['username'] ?? '');
$email = trim($body['email'] ?? '');
$password_hash = trim($body['password_hash'] ?? '');

if (!$realname || !$surname || !$username || !$email || !$password_hash) {
    jsonResponse(['error' => 'Tutti i campi sono obbligatori.'], 400);
}

if (!isUsernameValido($username)) {
    // log per dire che il nome utente non è valido
    exit();
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    // se in caso la pagina è separata, metto un log che compare per dire che non è valido
    exit();
} else {
    $dominioEmail = substr(strrchr($email, "@"), 1);
    if (!checkdnsrr($dominioEmail, "MX")) exit();
}

$controlloPsw = '/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])[A-Za-z\d!@#$%^&*(),.?":{}|<>]{8,}$/';
if (!preg_match($controlloPsw, $password_hash)) {
    // log per dire che la password non è conforme alla sicurezza
    exit();
}

$db = getDB();

try {
    $stmt = $db->prepare(
        'INSERT INTO users (realName, surname, username, email, password_hash)
         VALUES (:realname, :surname, :username, :email, :hash)'
    );
    $stmt->execute([
        ':realname' => $realname,
        ':surname' => $surname,
        ':username' => $username,
        ':email' => $email,
        ':hash' => $password_hash,
    ]);

    $newId = (int)$db->lastInsertId();
    jsonResponse(['id' => $newId, 'username' => $username, 'email' => $email]);
} catch (PDOException $e) {
    // Violazione UNIQUE
    if ($e->getCode() === '23000') {
        $msg = $e->getMessage();
        if (stripos($msg, 'username') !== false) jsonResponse(['error' => 'Username già in uso.'], 409);
        if (stripos($msg, 'email') !== false) jsonResponse(['error' => 'Email già registrata.'], 409);
        if (stripos($msg, 'realName') !== false) jsonResponse(['error' => 'Nome già in uso.'], 409);
        jsonResponse(['error' => 'Username o email già in uso.'], 409);
    }
    jsonResponse(['error' => 'Errore durante la registrazione: ' . $e->getMessage()], 500);
}
