<?php
// ================================================================
// api/notifications.php — Notifiche (usate per inviti in chiamata)
//
// GET  ?user_id=X&type=call_invite&unread=1   → { ok:true, notifications:[...] }
// POST { action:"create",   user_id, type_notification, content }
// POST { action:"mark_read", id }
// ================================================================
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

require_once __DIR__ . '/../config/db.php';

$method = $_SERVER['REQUEST_METHOD'];
$db     = getDB();

// ── GET ──────────────────────────────────────────────────────────
if ($method === 'GET') {
    $uid    = (int)($_GET['user_id'] ?? 0);
    $type   = $_GET['type']   ?? '';
    $unread = isset($_GET['unread']) && $_GET['unread'] === '1';

    if (!$uid) {
        echo json_encode(['ok' => false, 'error' => 'user_id mancante.']);
        exit;
    }

    $sql    = 'SELECT id, type_notification, content, is_read, created_at
               FROM notification WHERE user_id = :uid';
    $params = [':uid' => $uid];

    if ($type) {
        $sql .= ' AND type_notification = :type';
        $params[':type'] = $type;
    }
    if ($unread) {
        $sql .= ' AND is_read = 0';
    }

    // ASC: la piu vecchia prima, cosi il frontend processa in ordine
    $sql .= ' ORDER BY created_at ASC LIMIT 10';

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Risposta sempre consistente: { ok:true, notifications:[...] }
    echo json_encode(['ok' => true, 'notifications' => $rows ?: []]);
    exit;
}

// ── POST ─────────────────────────────────────────────────────────
if ($method === 'POST') {
    $body   = json_decode(file_get_contents('php://input'), true) ?? [];
    $action = $body['action'] ?? '';

    // Crea notifica
    if ($action === 'create') {
        $uid     = (int)($body['user_id'] ?? 0);
        $type    = trim($body['type_notification'] ?? '');
        $content = $body['content'] ?? null;
        if (!$uid || !$type) {
            echo json_encode(['ok' => false, 'error' => 'Dati mancanti.']);
            exit;
        }

        $stmt = $db->prepare(
            'INSERT INTO notification (user_id, type_notification, content, is_read)
             VALUES (:uid, :type, :content, 0)'
        );
        $stmt->execute([
            ':uid'     => $uid,
            ':type'    => $type,
            ':content' => is_array($content) ? json_encode($content) : $content,
        ]);
        echo json_encode(['ok' => true, 'id' => (int)$db->lastInsertId()]);
        exit;
    }

    // Segna come letta
    if ($action === 'mark_read') {
        $id = (int)($body['id'] ?? 0);
        if (!$id) {
            echo json_encode(['ok' => false, 'error' => 'ID mancante.']);
            exit;
        }
        $db->prepare('UPDATE notification SET is_read = 1 WHERE id = :id')
           ->execute([':id' => $id]);
        echo json_encode(['ok' => true]);
        exit;
    }

    echo json_encode(['ok' => false, 'error' => 'Azione non riconosciuta.']);
    exit;
}

echo json_encode(['ok' => false, 'error' => 'Metodo non consentito.']);