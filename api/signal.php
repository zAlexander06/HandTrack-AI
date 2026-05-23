<?php
// ================================================================
// api/signal.php — WebRTC Signaling per HandTrackLIS
// ================================================================
require_once __DIR__ . '/../config/db.php';

// Crea tabella se non esiste
getDB()->exec("
  CREATE TABLE IF NOT EXISTS webrtc_signals (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    call_id     INT         NOT NULL,
    sender_id   INT         NOT NULL,
    type        VARCHAR(16) NOT NULL,
    payload     MEDIUMTEXT  NOT NULL,
    created_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_call    (call_id),
    INDEX idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");

// Pulizia segnali vecchi (~1 volta/min)
if ((int)date('s') < 2) {
    getDB()->exec("DELETE FROM webrtc_signals WHERE created_at < NOW() - INTERVAL 10 MINUTE");
}

$method = $_SERVER['REQUEST_METHOD'];

// ── POST — invia segnale ─────────────────────────────────────────
if ($method === 'POST') {
    $user_id = requireAuth(); // ← ID dalla sessione
    $body    = getJsonBody();
    $action  = $body['action']  ?? '';
    $call_id = (int)($body['call_id'] ?? 0);
    $type    = $body['type']    ?? '';
    $payload = $body['payload'] ?? '';

    if ($action !== 'send' || !$call_id || !$type || !$payload) {
        jsonResponse(['ok' => false, 'error' => 'Parametri mancanti.'], 400);
    }

    $db = getDB();

    if ($type === 'offer' || $type === 'answer') {
        $decoded   = json_decode($payload, true);
        $target_id = $decoded['targetId'] ?? null;

        if ($target_id !== null) {
            $del = $db->prepare("
                DELETE FROM webrtc_signals
                WHERE call_id = ? AND sender_id = ? AND type = ?
                  AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.targetId')) = ?
            ");
            $del->execute([$call_id, $user_id, $type, (string)$target_id]);
        } else {
            $del = $db->prepare("DELETE FROM webrtc_signals WHERE call_id = ? AND sender_id = ? AND type = ?");
            $del->execute([$call_id, $user_id, $type]);
        }
    }

    $stmt = $db->prepare("INSERT INTO webrtc_signals (call_id, sender_id, type, payload) VALUES (?, ?, ?, ?)");
    $stmt->execute([$call_id, $user_id, $type, $payload]);
    jsonResponse(['ok' => true, 'id' => (int)$db->lastInsertId()]);
}

// ── GET — ricevi segnali ─────────────────────────────────────────
if ($method === 'GET') {
    $user_id = requireAuth();
    $action  = $_GET['action']   ?? '';
    $call_id = (int)($_GET['call_id'] ?? 0);
    $after   = (int)($_GET['after']   ?? 0);

    if ($action !== 'recv' || !$call_id) {
        jsonResponse(['ok' => false, 'error' => 'Parametri mancanti.'], 400);
    }

    $stmt = getDB()->prepare("
        SELECT id, type, payload
        FROM webrtc_signals
        WHERE call_id   = ?
          AND sender_id != ?
          AND id        > ?
        ORDER BY id ASC
        LIMIT 50
    ");
    $stmt->execute([$call_id, $user_id, $after]);
    $signals = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($signals as &$s) { $s['id'] = (int)$s['id']; }

    jsonResponse(['ok' => true, 'signals' => $signals]);
}

jsonResponse(['ok' => false, 'error' => 'Metodo non supportato.'], 405);