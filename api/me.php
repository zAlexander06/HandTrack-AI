<?php
require_once __DIR__ . '/_bootstrap.php';
requireMethod('GET');

if (empty($_SESSION['user'])) {
    fail('Non autenticato.', 401);
}

ok(['user' => $_SESSION['user']]);
