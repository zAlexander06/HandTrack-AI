<?php
// ================================================================
// api/contacts.php — Gestione contatti
//
// GET  ?action=list                        → contatti accettati
// GET  ?action=suggested                   → utenti suggeriti
// GET  ?action=search&q=testo              → ricerca utenti
// GET  ?action=incoming                    → richieste in attesa
// POST { action:"send",    contact_id }
// POST { action:"accept",  id }
// POST { action:"reject",  id }
// POST { action:"remove",  contact_id }
// ================================================================
require_once __DIR__ . '/../config/db.php';

$method = $_SERVER['REQUEST_METHOD'];
$db     = getDB();

// ── GET ──────────────────────────────────────────────────────────
if ($method === 'GET') {
    $user_id = requireAuth(); // ← dalla sessione
    $action  = $_GET['action'] ?? '';

    if ($action === 'list') {
        $stmt = $db->prepare(
            'SELECT u.id, u.realName, u.surname, u.username, u.email,
                    IF(u.last_seen >= NOW() - INTERVAL 40 SECOND, "online", "offline") AS status_user
             FROM contact c
             JOIN users u ON (
               (c.user_id = :uid  AND u.id = c.contact_id)
               OR (c.contact_id = :uid2 AND u.id = c.user_id)
             )
             WHERE c.status_contact = "accepted"
               AND (c.user_id = :uid3 OR c.contact_id = :uid4)'
        );
        $stmt->execute([':uid' => $user_id, ':uid2' => $user_id, ':uid3' => $user_id, ':uid4' => $user_id]);
        jsonResponse($stmt->fetchAll());
    }

    if ($action === 'suggested') {
        $stmt = $db->prepare(
            'SELECT contact_id AS cid FROM contact WHERE user_id = :uid
             UNION
             SELECT user_id AS cid FROM contact WHERE contact_id = :uid2'
        );
        $stmt->execute([':uid' => $user_id, ':uid2' => $user_id]);
        $exclude = array_column($stmt->fetchAll(), 'cid');
        $exclude[] = $user_id;

        $placeholders = implode(',', array_fill(0, count($exclude), '?'));
        $stmt2 = $db->prepare(
            "SELECT id, realName, surname, username,
                    IF(last_seen >= NOW() - INTERVAL 40 SECOND, 'online', 'offline') AS status_user
             FROM users
             WHERE id NOT IN ($placeholders)
             ORDER BY RAND()
             LIMIT 10"
        );
        $stmt2->execute($exclude);
        jsonResponse($stmt2->fetchAll());
    }

    if ($action === 'search') {
        $q = '%' . trim($_GET['q'] ?? '') . '%';
        $stmt = $db->prepare(
            'SELECT id, realName, surname, username, email,
                    IF(last_seen >= NOW() - INTERVAL 40 SECOND, "online", "offline") AS status_user
             FROM users
             WHERE id <> :uid
               AND (username LIKE :q OR email LIKE :q2 OR realName LIKE :q3 OR surname LIKE :q4)
             LIMIT 10'
        );
        $stmt->execute([':uid' => $user_id, ':q' => $q, ':q2' => $q, ':q3' => $q, ':q4' => $q]);
        jsonResponse($stmt->fetchAll());
    }

    if ($action === 'incoming') {
        $stmt = $db->prepare(
            'SELECT c.id, c.user_id, c.created_at,
                    u.realName, u.surname, u.username,
                    IF(u.last_seen >= NOW() - INTERVAL 40 SECOND, "online", "offline") AS status_user
             FROM contact c
             JOIN users u ON u.id = c.user_id
             WHERE c.contact_id = :uid AND c.status_contact = "pending"
             ORDER BY c.created_at DESC'
        );
        $stmt->execute([':uid' => $user_id]);
        jsonResponse($stmt->fetchAll());
    }

    jsonResponse(['ok' => false, 'error' => 'Azione non riconosciuta.'], 400);
}

// ── POST ─────────────────────────────────────────────────────────
if ($method === 'POST') {
    $user_id = requireAuth();
    $body    = getJsonBody();
    $action  = $body['action'] ?? '';

    if ($action === 'send') {
        $cid = (int)($body['contact_id'] ?? 0);
        if (!$cid) jsonResponse(['ok' => false, 'error' => 'contact_id mancante.'], 400);
        if ($cid === $user_id) jsonResponse(['ok' => false, 'error' => 'Non puoi aggiungere te stesso.'], 400);
        try {
            $db->prepare(
                'INSERT INTO contact (user_id, contact_id, status_contact) VALUES (:u, :c, "pending")'
            )->execute([':u' => $user_id, ':c' => $cid]);
            jsonResponse(['ok' => true]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') jsonResponse(['ok' => false, 'error' => 'Richiesta già inviata.'], 409);
            jsonResponse(['ok' => false, 'error' => $e->getMessage()], 500);
        }
    }

    if ($action === 'accept') {
        $id = (int)($body['id'] ?? 0);
        if (!$id) jsonResponse(['ok' => false, 'error' => 'ID mancante.'], 400);
        // Verifica che la richiesta sia davvero destinata a questo utente
        $stmt = $db->prepare('SELECT id FROM contact WHERE id = :id AND contact_id = :uid AND status_contact = "pending" LIMIT 1');
        $stmt->execute([':id' => $id, ':uid' => $user_id]);
        if (!$stmt->fetch()) jsonResponse(['ok' => false, 'error' => 'Richiesta non trovata.'], 404);

        $db->prepare('UPDATE contact SET status_contact = "accepted" WHERE id = :id')
           ->execute([':id' => $id]);
        jsonResponse(['ok' => true]);
    }

    if ($action === 'reject') {
        $id = (int)($body['id'] ?? 0);
        if (!$id) jsonResponse(['ok' => false, 'error' => 'ID mancante.'], 400);
        // Verifica ownership
        $stmt = $db->prepare('SELECT id FROM contact WHERE id = :id AND contact_id = :uid LIMIT 1');
        $stmt->execute([':id' => $id, ':uid' => $user_id]);
        if (!$stmt->fetch()) jsonResponse(['ok' => false, 'error' => 'Richiesta non trovata.'], 404);

        $db->prepare('DELETE FROM contact WHERE id = :id')->execute([':id' => $id]);
        jsonResponse(['ok' => true]);
    }

    if ($action === 'remove') {
        $cid = (int)($body['contact_id'] ?? 0);
        if (!$cid) jsonResponse(['ok' => false, 'error' => 'contact_id mancante.'], 400);
        $db->prepare(
            'DELETE FROM contact WHERE (user_id = :u AND contact_id = :c) OR (user_id = :c2 AND contact_id = :u2)'
        )->execute([':u' => $user_id, ':c' => $cid, ':c2' => $cid, ':u2' => $user_id]);
        jsonResponse(['ok' => true]);
    }

    jsonResponse(['ok' => false, 'error' => 'Azione non riconosciuta.'], 400);
}

jsonResponse(['ok' => false, 'error' => 'Metodo non consentito.'], 405);