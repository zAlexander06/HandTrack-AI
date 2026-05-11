<?php
session_start();

header('Content-Type: application/json; charset=utf-8');
// Adjust origin to your actual domain in production
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/../config/db.php';

// ── Helpers ──────────────────────────────────────────────────────────

function ok(array $data = []): never {
    echo json_encode(['ok' => true] + $data);
    exit;
}

function fail(string $message, int $status = 400): never {
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message]);
    exit;
}

function body(): array {
    $raw = file_get_contents('php://input');
    return json_decode($raw, true) ?? [];
}

function requireMethod(string $method): void {
    if ($_SERVER['REQUEST_METHOD'] !== $method) {
        fail('Method not allowed', 405);
    }
}

function requireAuth(): array {
    if (empty($_SESSION['user'])) {
        fail('Non autenticato', 401);
    }
    return $_SESSION['user'];
}
