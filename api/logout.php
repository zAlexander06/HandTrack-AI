<?php
require_once __DIR__ . '/_bootstrap.php';
requireMethod('POST');

if (!empty($_SESSION['user']['id'])) {
    $pdo = getDB();
    $pdo->prepare('UPDATE user SET Status_user = "offline" WHERE Id = :id')
        ->execute([':id' => $_SESSION['user']['id']]);
}

$_SESSION = [];
session_destroy();

ok(['message' => 'Disconnesso.']);
