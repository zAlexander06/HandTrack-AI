<?php
// ================================================================
// api/messages.php — Messaggi in chiamata
//
// GET  ?call_id=X[&after_id=Y]   → messaggi della chiamata
// POST { sender_id, receiver_id, call_id, content }
// ================================================================
require_once __DIR__ . '/../config/db.php';

$method = $_SERVER['REQUEST_METHOD'];
$db     = getDB();

// ── GET ──────────────────────────────────────────────────────────
if ($method === 'GET') {
    $call_id  = (int)($_GET['call_id']  ?? 0);
    $after_id = (int)($_GET['after_id'] ?? 0);

    if (!$call_id) jsonResponse(['error' => 'call_id mancante.'], 400);

    $sql = 'SELECT id, sender_id, content, sent_at
            FROM message
            WHERE call_id = :cid';
    $params = [':cid' => $call_id];

    if ($after_id) {
        $sql .= ' AND id > :aid';
        $params[':aid'] = $after_id;
    }

    $sql .= ' ORDER BY sent_at ASC';

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    jsonResponse($stmt->fetchAll());
}

// ── POST ─────────────────────────────────────────────────────────
if ($method === 'POST') {
    $body        = getJsonBody();
    $sender_id   = (int)($body['sender_id']   ?? 0);
    $receiver_id = isset($body['receiver_id']) ? (int)$body['receiver_id'] : null;
    $call_id     = isset($body['call_id'])     ? (int)$body['call_id']     : null;
    $content     = trim($body['content'] ?? '');

    if (!$sender_id || !$content) jsonResponse(['error' => 'Dati mancanti.'], 400);
    if (!$receiver_id && !$call_id) jsonResponse(['error' => 'receiver_id o call_id obbligatorio.'], 400);

    $stmt = $db->prepare(
        'INSERT INTO message (sender_id, receiver_id, call_id, content) VALUES (:s, :r, :c, :cnt)'
    );
    $stmt->execute([
        ':s'   => $sender_id,
        ':r'   => $receiver_id,
        ':c'   => $call_id,
        ':cnt' => $content,
    ]);
    jsonResponse(['id' => (int)$db->lastInsertId()]);
}

jsonResponse(['error' => 'Metodo non consentito.'], 405);
