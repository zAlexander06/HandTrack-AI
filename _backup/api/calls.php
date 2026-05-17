<?php
// ================================================================
// api/calls.php — Gestione chiamate
//
// GET  ?action=history&user_id=X           → cronologia
// GET  ?action=poll_incoming&user_id=X     → chiamata in arrivo
// GET  ?action=status&call_id=X            → stato chiamata
// GET  ?action=active_participants&call_id=X
// POST { action:"create",      caller_id, receiver_id }
// POST { action:"accept",      call_id }
// POST { action:"decline",     call_id }
// POST { action:"end",         call_id, user_id }
// POST { action:"cancel",      call_id }
// POST { action:"join",        call_id, user_id }
// POST { action:"leave",       call_id, user_id }
// ================================================================
require_once __DIR__ . '/../config/db.php';

$method = $_SERVER['REQUEST_METHOD'];
$db     = getDB();

// ── GET ──────────────────────────────────────────────────────────
if ($method === 'GET') {
    $action = $_GET['action'] ?? '';

    // Cronologia chiamate con dati dell'altro utente
    if ($action === 'history') {
        $uid = (int)($_GET['user_id'] ?? 0);
        if (!$uid) jsonResponse(['error' => 'user_id mancante.'], 400);

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

    // Polling chiamata in arrivo (ringing)
    if ($action === 'poll_incoming') {
        $uid = (int)($_GET['user_id'] ?? 0);
        if (!$uid) jsonResponse(['error' => 'user_id mancante.'], 400);

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

    // Stato di una singola chiamata
    if ($action === 'status') {
        $cid = (int)($_GET['call_id'] ?? 0);
        if (!$cid) jsonResponse(['error' => 'call_id mancante.'], 400);

        $stmt = $db->prepare('SELECT id, status_call, start_time, end_time FROM call_table WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $cid]);
        $row = $stmt->fetch();
        jsonResponse($row ?: null);
    }

    // Partecipanti attivi (left_at IS NULL)
    if ($action === 'active_participants') {
        $cid = (int)($_GET['call_id'] ?? 0);
        if (!$cid) jsonResponse(['error' => 'call_id mancante.'], 400);

        $stmt = $db->prepare(
            'SELECT id, user_id FROM call_participants WHERE call_id = :cid AND left_at IS NULL'
        );
        $stmt->execute([':cid' => $cid]);
        jsonResponse($stmt->fetchAll());
    }

    jsonResponse(['error' => 'Azione non riconosciuta.'], 400);
}

// ── POST ─────────────────────────────────────────────────────────
if ($method === 'POST') {
    $body   = getJsonBody();
    $action = $body['action'] ?? '';

    // Crea nuova chiamata
    if ($action === 'create') {
        $caller   = (int)($body['caller_id']   ?? 0);
        $receiver = (int)($body['receiver_id'] ?? 0);
        if (!$caller || !$receiver) jsonResponse(['error' => 'Dati mancanti.'], 400);

        $db->prepare(
            'INSERT INTO call_table (caller_id, receiver_id, call_type, status_call)
             VALUES (:c, :r, "direct", "ringing")'
        )->execute([':c' => $caller, ':r' => $receiver]);

        $callId = (int)$db->lastInsertId();

        // Aggiunge il chiamante come partecipante
        $db->prepare(
            'INSERT IGNORE INTO call_participants (call_id, user_id, joined_at) VALUES (:cid, :uid, NOW())'
        )->execute([':cid' => $callId, ':uid' => $caller]);

        jsonResponse(['id' => $callId]);
    }

    // Accetta chiamata
    if ($action === 'accept') {
        $cid = (int)($body['call_id'] ?? 0);
        $uid = (int)($body['user_id'] ?? 0);
        if (!$cid) jsonResponse(['error' => 'call_id mancante.'], 400);

        $db->prepare(
            'UPDATE call_table SET status_call = "accepted", start_time = NOW() WHERE id = :id'
        )->execute([':id' => $cid]);

        if ($uid) {
            $db->prepare(
                'INSERT INTO call_participants (call_id, user_id, joined_at)
                 VALUES (:cid, :uid, NOW())
                 ON DUPLICATE KEY UPDATE joined_at = NOW()'
            )->execute([':cid' => $cid, ':uid' => $uid]);
        }

        jsonResponse(['ok' => true]);
    }

    // Rifiuta chiamata (missed)
    if ($action === 'decline') {
        $cid = (int)($body['call_id'] ?? 0);
        if (!$cid) jsonResponse(['error' => 'call_id mancante.'], 400);
        $db->prepare('UPDATE call_table SET status_call = "missed" WHERE id = :id')->execute([':id' => $cid]);
        jsonResponse(['ok' => true]);
    }

    // Termina chiamata (end)
    if ($action === 'end') {
        $cid = (int)($body['call_id'] ?? 0);
        $uid = (int)($body['user_id'] ?? 0);
        if (!$cid) jsonResponse(['error' => 'call_id mancante.'], 400);

        if ($uid) {
            $db->prepare(
                'UPDATE call_participants SET left_at = NOW() WHERE call_id = :cid AND user_id = :uid'
            )->execute([':cid' => $cid, ':uid' => $uid]);
        }

        // Controlla se rimangono partecipanti attivi
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

    // Annulla chiamata in uscita
    if ($action === 'cancel') {
        $cid = (int)($body['call_id'] ?? 0);
        if (!$cid) jsonResponse(['error' => 'call_id mancante.'], 400);
        $db->prepare('UPDATE call_table SET status_call = "missed" WHERE id = :id')->execute([':id' => $cid]);
        jsonResponse(['ok' => true]);
    }

    // Unisciti a chiamata di gruppo
    if ($action === 'join') {
        $cid = (int)($body['call_id'] ?? 0);
        $uid = (int)($body['user_id'] ?? 0);
        if (!$cid || !$uid) jsonResponse(['error' => 'Dati mancanti.'], 400);
        $db->prepare(
            'INSERT INTO call_participants (call_id, user_id, joined_at)
             VALUES (:cid, :uid, NOW())
             ON DUPLICATE KEY UPDATE joined_at = NOW(), left_at = NULL'
        )->execute([':cid' => $cid, ':uid' => $uid]);
        jsonResponse(['ok' => true]);
    }

    // Lascia chiamata
    if ($action === 'leave') {
        $cid = (int)($body['call_id'] ?? 0);
        $uid = (int)($body['user_id'] ?? 0);
        if (!$cid || !$uid) jsonResponse(['error' => 'Dati mancanti.'], 400);
        $db->prepare(
            'UPDATE call_participants SET left_at = NOW() WHERE call_id = :cid AND user_id = :uid'
        )->execute([':cid' => $cid, ':uid' => $uid]);
        jsonResponse(['ok' => true]);
    }

    jsonResponse(['error' => 'Azione non riconosciuta.'], 400);
}

jsonResponse(['error' => 'Metodo non consentito.'], 405);
