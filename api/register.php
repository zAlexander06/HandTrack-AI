<?php
require_once __DIR__ . '/_bootstrap.php';
requireMethod('POST');

$data      = body();
$firstName = trim($data['firstName'] ?? '');
$lastName  = trim($data['lastName']  ?? '');
$email     = trim($data['email']     ?? '');
$email2    = trim($data['email2']    ?? '');
$pass      = $data['password']  ?? '';
$pass2     = $data['password2'] ?? '';

// ── Validation ────────────────────────────────────────────────────────
if ($firstName === '' || $lastName === '') {
    fail('Nome e cognome sono obbligatori.');
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    fail('Indirizzo email non valido.');
}
if ($email !== $email2) {
    fail('Le email non coincidono.');
}
if (strlen($pass) < 8) {
    fail('La password deve contenere almeno 8 caratteri.');
}
if ($pass !== $pass2) {
    fail('Le password non coincidono.');
}

// Build a username from first + last name (lowercase, no spaces)
$baseUsername = strtolower($firstName . '.' . $lastName);
// Strip anything that isn't a-z, 0-9, or a dot
$baseUsername = preg_replace('/[^a-z0-9.]/', '', $baseUsername);

$pdo = getDB();

// Check email uniqueness
$stmt = $pdo->prepare('SELECT Id FROM user WHERE Email = :email LIMIT 1');
$stmt->execute([':email' => $email]);
if ($stmt->fetch()) {
    fail('Questa email è già registrata.');
}

// Make username unique by appending a counter if needed
$username = $baseUsername;
$counter  = 1;
while (true) {
    $stmt = $pdo->prepare('SELECT Id FROM user WHERE Username = :u LIMIT 1');
    $stmt->execute([':u' => $username]);
    if (!$stmt->fetch()) break;
    $username = $baseUsername . $counter++;
}

$hash = password_hash($pass, PASSWORD_BCRYPT);

$stmt = $pdo->prepare('
    INSERT INTO user (Username, Email, Password_hash)
    VALUES (:username, :email, :hash)
');
$stmt->execute([
    ':username' => $username,
    ':email'    => $email,
    ':hash'     => $hash,
]);
$newId = (int) $pdo->lastInsertId();

// Auto-login after registration
$_SESSION['user'] = [
    'id'       => $newId,
    'username' => $username,
    'email'    => $email,
    'role'     => 'user',
];

ok(['user' => $_SESSION['user']]);
