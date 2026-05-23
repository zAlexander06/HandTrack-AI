<?php
// ================================================================
// api/calls.php — Gestione chiamate
//
// GET  ?action=history                     → cronologia
// GET  ?action=poll_incoming               → chiamata in arrivo
// GET  ?action=status&call_id=X            → stato chiamata
// GET  ?action=active_participants&call_id=X
// POST { action:"create",      receiver_id }
// POST { action:"accept",      call_id }
// POST { action:"decline",     call_id }
// POST { action:"end",         call_id }
// POST { action:"cancel",      call_id }
// POST { action:"join",        call_id }
// POST { action:"leave",       call_id }
// ================================================================
require_once __DIR__ . '/../config/db.php';

$method = $_SERVER['REQUEST_METHOD'];
$db     = getDB();

// ── GET ──────────────────────────────────────────────────────────
if ($method === 'GET') {
    $uid    = requireAuth();
    $action = $_GET['action'] ?? '';

    if ($action === 'history') {
        $stmt = $db->prepare(
            'SELECT c.id, c.caller_id, c.receiver_id, c.call_type,
                    c.status_call, c.start_time, c.end_time, c.created_at,
                    u1.realName AS caller_name,  u1.surname AS caller_surname,
                    u2.realName AS receiver_name, u2.surname AS receiver_surname
             FROM call_table c
             LEFT JOIN users u1 ON u1.id = c.caller_id
             LEFT JOIN users u2 ON u2.id = c.receiver_id
             WHERE c.caller_id = :uid OR c.receiver_id = :uid2
             ORDER BY c.created_at DESC
             LIMIT 30'
        );
        $stmt->execute([':uid' => $uid, ':uid2' => $uid]);
        jsonResponse($stmt->fetchAll());
    }

    if ($action === 'poll_incoming') {
        $stmt = $db->prepare(
            'SELECT ct.id, ct.caller_id, ct.status_call,
                    u.realName, u.surname
             FROM call_table ct
             JOIN users u ON u.id = ct.caller_id
             WHERE ct.receiver_id = :uid AND ct.status_call = "ringing"
             ORDER BY ct.created_at DESC
             LIMIT 1'
        );
        $stmt->execute([':uid' => $uid]);
        $row = $stmt->fetch();
        jsonResponse($row ?: null);
    }

    if ($action === 'status') {
        $cid = (int)($_GET['call_id'] ?? 0);
        if (!$cid) jsonResponse(['ok' => false, 'error' => 'call_id mancante.'], 400);
        $stmt = $db->prepare('SELECT id, status_call, start_time, end_time FROM call_table WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $cid]);
        jsonResponse($stmt->fetch() ?: null);
    }

    if ($action === 'active_participants') {
        $cid = (int)($_GET['call_id'] ?? 0);
        if (!$cid) jsonResponse(['ok' => false, 'error' => 'call_id mancante.'], 400);
        $stmt = $db->prepare('SELECT id, user_id FROM call_participants WHERE call_id = :cid AND left_at IS NULL');
        $stmt->execute([':cid' => $cid]);
        jsonResponse($stmt->fetchAll());
    }

    if ($action === 'all_participants') {
        $cid = (int)($_GET['call_id'] ?? 0);
        if (!$cid) jsonResponse(['ok' => false, 'error' => 'call_id mancante.'], 400);
        $stmt = $db->prepare(
            'SELECT cp.user_id, u.username, u.realName, u.surname
             FROM call_participants cp
             JOIN users u ON u.id = cp.user_id
             WHERE cp.call_id = :cid
             ORDER BY cp.joined_at ASC'
        );
        $stmt->execute([':cid' => $cid]);
        jsonResponse($stmt->fetchAll());
    }

    jsonResponse(['ok' => false, 'error' => 'Azione non riconosciuta.'], 400);
}

// ── POST ─────────────────────────────────────────────────────────
if ($method === 'POST') {
    $uid    = requireAuth();
    $body   = getJsonBody();
    $action = $body['action'] ?? '';

    if ($action === 'create') {
        $receiver = (int)($body['receiver_id'] ?? 0);
        if (!$receiver) jsonResponse(['ok' => false, 'error' => 'receiver_id mancante.'], 400);

        $db->prepare(
            'INSERT INTO call_table (caller_id, receiver_id, call_type, status_call)
             VALUES (:c, :r, "direct", "ringing")'
        )->execute([':c' => $uid, ':r' => $receiver]);

        $callId = (int)$db->lastInsertId();

        $db->prepare(
            'INSERT IGNORE INTO call_participants (call_id, user_id, joined_at) VALUES (:cid, :uid, NOW())'
        )->execute([':cid' => $callId, ':uid' => $uid]);

        jsonResponse(['ok' => true, 'id' => $callId]);
    }

    if ($action === 'accept') {
        $cid = (int)($body['call_id'] ?? 0);
        if (!$cid) jsonResponse(['ok' => false, 'error' => 'call_id mancante.'], 400);

        $db->prepare(
            'UPDATE call_table SET status_call = "accepted", start_time = NOW() WHERE id = :id'
        )->execute([':id' => $cid]);

        $db->prepare(
            'INSERT INTO call_participants (call_id, user_id, joined_at)
             VALUES (:cid, :uid, NOW())
             ON DUPLICATE KEY UPDATE joined_at = NOW()'
        )->execute([':cid' => $cid, ':uid' => $uid]);

        jsonResponse(['ok' => true]);
    }

    if ($action === 'decline') {
        $cid = (int)($body['call_id'] ?? 0);
        if (!$cid) jsonResponse(['ok' => false, 'error' => 'call_id mancante.'], 400);
        $db->prepare('UPDATE call_table SET status_call = "missed" WHERE id = :id')->execute([':id' => $cid]);
        jsonResponse(['ok' => true]);
    }

    if ($action === 'end') {
        $cid = (int)($body['call_id'] ?? 0);
        if (!$cid) jsonResponse(['ok' => false, 'error' => 'call_id mancante.'], 400);

        $db->prepare(
            'UPDATE call_participants SET left_at = NOW() WHERE call_id = :cid AND user_id = :uid'
        )->execute([':cid' => $cid, ':uid' => $uid]);

        $stmt = $db->prepare(
            'SELECT COUNT(*) AS cnt FROM call_participants WHERE call_id = :cid AND left_at IS NULL'
        );
        $stmt->execute([':cid' => $cid]);
        $cnt = (int)$stmt->fetchColumn();

        if ($cnt <= 1) {
            $db->prepare(
                'UPDATE call_table SET status_call = "ended", end_time = NOW() WHERE id = :id'
            )->execute([':id' => $cid]);
        }

        jsonResponse(['ok' => true]);
    }

    if ($action === 'cancel') {
        $cid = (int)($body['call_id'] ?? 0);
        if (!$cid) jsonResponse(['ok' => false, 'error' => 'call_id mancante.'], 400);
        $db->prepare('UPDATE call_table SET status_call = "missed" WHERE id = :id')->execute([':id' => $cid]);
        jsonResponse(['ok' => true]);
    }

    if ($action === 'join') {
        $cid = (int)($body['call_id'] ?? 0);
        if (!$cid) jsonResponse(['ok' => false, 'error' => 'call_id mancante.'], 400);
        $db->prepare(
            'INSERT INTO call_participants (call_id, user_id, joined_at)
             VALUES (:cid, :uid, NOW())
             ON DUPLICATE KEY UPDATE joined_at = NOW(), left_at = NULL'
        )->execute([':cid' => $cid, ':uid' => $uid]);
        jsonResponse(['ok' => true]);
    }

    if ($action === 'leave') {
        $cid = (int)($body['call_id'] ?? 0);
        if (!$cid) jsonResponse(['ok' => false, 'error' => 'call_id mancante.'], 400);
        $db->prepare(
            'UPDATE call_participants SET left_at = NOW() WHERE call_id = :cid AND user_id = :uid'
        )->execute([':cid' => $cid, ':uid' => $uid]);
        jsonResponse(['ok' => true]);
    }

    jsonResponse(['ok' => false, 'error' => 'Azione non riconosciuta.'], 400);
}

jsonResponse(['ok' => false, 'error' => 'Metodo non consentito.'], 405);