<?php
require_once __DIR__ . '/_bootstrap.php';
requireMethod('POST');

$data  = body();
$login = trim($data['login'] ?? '');    // accepts email OR username
$pass  = $data['password'] ?? '';

if ($login === '' || $pass === '') {
    fail('Email/username e password sono obbligatori.');
}

$pdo = getDB();

// Look up by email or username
$stmt = $pdo->prepare('
    SELECT Id, Username, Email, Password_hash, Role_user, Status_user
    FROM user
    WHERE Email = :login OR Username = :login
    LIMIT 1
');
$stmt->execute([':login' => $login]);
$user = $stmt->fetch();

if (!$user || !password_verify($pass, $user['Password_hash'])) {
    fail('Credenziali non valide.');
}

// Mark user as online
$pdo->prepare('UPDATE user SET Status_user = "online" WHERE Id = :id')
    ->execute([':id' => $user['Id']]);

// Store safe subset in session (never store password hash)
$_SESSION['user'] = [
    'id'       => $user['Id'],
    'username' => $user['Username'],
    'email'    => $user['Email'],
    'role'     => $user['Role_user'],
];

ok([
    'user' => $_SESSION['user'],
]);
