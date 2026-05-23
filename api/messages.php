<?php
// ================================================================
// api/messages.php — Messaggi in chiamata
//
// GET  ?call_id=X[&after_id=Y]   → messaggi della chiamata
// POST { call_id, content [, receiver_id] }
// ================================================================
require_once __DIR__ . '/../config/db.php';

$method = $_SERVER['REQUEST_METHOD'];
$db     = getDB();

// ── GET ──────────────────────────────────────────────────────────
if ($method === 'GET') {
    requireAuth(); // verifica login (ma non usiamo l'ID per il filtro qui)
    $call_id  = (int)($_GET['call_id']  ?? 0);
    $after_id = (int)($_GET['after_id'] ?? 0);

    if (!$call_id) jsonResponse(['ok' => false, 'error' => 'call_id mancante.'], 400);

    $sql    = 'SELECT id, sender_id, content, sent_at FROM message WHERE call_id = :cid';
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
    $sender_id   = requireAuth(); // ← ID dalla sessione
    $body        = getJsonBody();
    $receiver_id = isset($body['receiver_id']) ? (int)$body['receiver_id'] : null;
    $call_id     = isset($body['call_id'])     ? (int)$body['call_id']     : null;
    $content     = trim($body['content'] ?? '');

    if (!$content) jsonResponse(['ok' => false, 'error' => 'Contenuto mancante.'], 400);
    if (!$receiver_id && !$call_id) jsonResponse(['ok' => false, 'error' => 'receiver_id o call_id obbligatorio.'], 400);

    $stmt = $db->prepare(
        'INSERT INTO message (sender_id, receiver_id, call_id, content) VALUES (:s, :r, :c, :cnt)'
    );
    $stmt->execute([
        ':s'   => $sender_id,
        ':r'   => $receiver_id,
        ':c'   => $call_id,
        ':cnt' => $content,
    ]);
    jsonResponse(['ok' => true, 'id' => (int)$db->lastInsertId()]);
}

jsonResponse(['ok' => false, 'error' => 'Metodo non consentito.'], 405);