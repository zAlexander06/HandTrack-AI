<?php
// ================================================================
// api/notifications.php — Notifiche
//
// GET  ?type=call_invite&unread=1          → { ok:true, notifications:[...] }
// POST { action:"create",    type_notification, content }
// POST { action:"mark_read", id }
// ================================================================
require_once __DIR__ . '/../config/db.php';

$method = $_SERVER['REQUEST_METHOD'];
$db     = getDB();

// ── GET ──────────────────────────────────────────────────────────
if ($method === 'GET') {
    $uid    = requireAuth();
    $type   = $_GET['type']   ?? '';
    $unread = isset($_GET['unread']) && $_GET['unread'] === '1';

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

    $sql .= ' ORDER BY created_at ASC LIMIT 10';

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    jsonResponse(['ok' => true, 'notifications' => $stmt->fetchAll() ?: []]);
}

// ── POST ─────────────────────────────────────────────────────────
if ($method === 'POST') {
    $uid    = requireAuth();
    $body   = getJsonBody();
    $action = $body['action'] ?? '';

    if ($action === 'create') {
        $type    = trim($body['type_notification'] ?? '');
        $content = $body['content'] ?? null;
        // Il destinatario può essere un altro utente (es. invito chiamata)
        $target_uid = isset($body['user_id']) ? (int)$body['user_id'] : $uid;

        if (!$type) jsonResponse(['ok' => false, 'error' => 'type_notification mancante.'], 400);

        $stmt = $db->prepare(
            'INSERT INTO notification (user_id, type_notification, content, is_read)
             VALUES (:uid, :type, :content, 0)'
        );
        $stmt->execute([
            ':uid'     => $target_uid,
            ':type'    => $type,
            ':content' => is_array($content) ? json_encode($content) : $content,
        ]);
        jsonResponse(['ok' => true, 'id' => (int)$db->lastInsertId()]);
    }

    if ($action === 'mark_read') {
        $id = (int)($body['id'] ?? 0);
        if (!$id) jsonResponse(['ok' => false, 'error' => 'ID mancante.'], 400);
        // Verifica che la notifica appartenga all'utente loggato
        $stmt = $db->prepare('SELECT id FROM notification WHERE id = :id AND user_id = :uid LIMIT 1');
        $stmt->execute([':id' => $id, ':uid' => $uid]);
        if (!$stmt->fetch()) jsonResponse(['ok' => false, 'error' => 'Notifica non trovata.'], 404);

        $db->prepare('UPDATE notification SET is_read = 1 WHERE id = :id')->execute([':id' => $id]);
        jsonResponse(['ok' => true]);
    }

    jsonResponse(['ok' => false, 'error' => 'Azione non riconosciuta.'], 400);
}

jsonResponse(['ok' => false, 'error' => 'Metodo non consentito.'], 405);