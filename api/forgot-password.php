<?php
require_once __DIR__ . '/_bootstrap.php';
requireMethod('POST');

$data  = body();
$email = trim($data['email'] ?? '');

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    fail('Indirizzo email non valido.');
}

$pdo  = getDB();
$stmt = $pdo->prepare('SELECT Id FROM user WHERE Email = :email LIMIT 1');
$stmt->execute([':email' => $email]);
$user = $stmt->fetch();

// Always return ok to avoid email enumeration
// In a real app you would generate a token, store it, and send an email.
if ($user) {
    // TODO: generate reset token, store in a password_reset table, send email
    // For now we just acknowledge the request silently
}

ok(['message' => 'Se l\'email è registrata riceverai un link a breve.']);
