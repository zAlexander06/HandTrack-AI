<?php
// ================================================================
// api/banned_words.php — HandTrackLIS
// ================================================================

// db.php gestisce già la sessione sicura — NON chiamare session_start() qui
require_once __DIR__ . '/../db.php';

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');

// ── CORS (necessario su Altervista con credentials: include) ──
setCorsHeaders();

// ── Auth check ────────────────────────────────────────────────
if (empty($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'not_authenticated']);
    exit;
}

// ── Fetch parole bannate ──────────────────────────────────────
try {
    $pdo   = getDB();
    $stmt  = $pdo->query('SELECT word FROM banned_word ORDER BY word ASC');
    $words = $stmt->fetchAll(PDO::FETCH_COLUMN);

    echo json_encode(['ok' => true, 'words' => $words]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'db_error']);
}