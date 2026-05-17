<?php
// ================================================================
// api/contacts.php — Gestione contatti
//
// GET  ?action=list&user_id=X              → contatti accettati
// GET  ?action=suggested&user_id=X         → utenti suggeriti
// GET  ?action=search&user_id=X&q=testo    → ricerca utenti
// GET  ?action=incoming&user_id=X          → richieste in attesa
// POST { action:"send",    user_id, contact_id }
// POST { action:"accept",  id }            → accetta richiesta
// POST { action:"reject",  id }            → rifiuta richiesta
// POST { action:"remove",  user_id, contact_id }
// ================================================================
require_once __DIR__ . '/../config/db.php';

$method = $_SERVER['REQUEST_METHOD'];
$db     = getDB();

// ── GET ──────────────────────────────────────────────────────────
if ($method === 'GET') {
    $action  = $_GET['action']  ?? '';
    $user_id = (int)($_GET['user_id'] ?? 0);

    if (!$user_id) jsonResponse(['error' => 'user_id mancante.'], 400);

    // Lista contatti accettati con dati utente
    if ($action === 'list') {
        $stmt = $db->prepare(
            'SELECT u.id, u.realName, u.surname, u.username, u.email, u.status_user
             FROM contact c
             JOIN users u ON (
               (c.user_id = :uid AND u.id = c.contact_id)
               OR (c.contact_id = :uid2 AND u.id = c.user_id)
             )
             WHERE c.status_contact = "accepted"
               AND (c.user_id = :uid3 OR c.contact_id = :uid4)'
        );
        $stmt->execute([':uid' => $user_id, ':uid2' => $user_id, ':uid3' => $user_id, ':uid4' => $user_id]);
        jsonResponse($stmt->fetchAll());
    }

    // ID di tutti i contatti (qualsiasi status) per escluderli dai suggeriti
    if ($action === 'suggested') {
        // Raccoglie ID già connessi
        $stmt = $db->prepare(
            'SELECT contact_id AS cid FROM contact WHERE user_id = :uid
             UNION
             SELECT user_id    AS cid FROM contact WHERE contact_id = :uid2'
        );
        $stmt->execute([':uid' => $user_id, ':uid2' => $user_id]);
        $exclude = array_column($stmt->fetchAll(), 'cid');
        $exclude[] = $user_id;

        $placeholders = implode(',', array_fill(0, count($exclude), '?'));
        $stmt2 = $db->prepare(
            "SELECT id, realName, surname, username, status_user
             FROM users
             WHERE id NOT IN ($placeholders)
             ORDER BY RAND()
             LIMIT 10"
        );
        $stmt2->execute($exclude);
        jsonResponse($stmt2->fetchAll());
    }

    // Ricerca utenti
    if ($action === 'search') {
        $q = '%' . trim($_GET['q'] ?? '') . '%';
        $stmt = $db->prepare(
            'SELECT id, realName, surname, username, email, status_user
             FROM users
             WHERE id <> :uid
               AND (username LIKE :q OR email LIKE :q2 OR realName LIKE :q3 OR surname LIKE :q4)
             LIMIT 10'
        );
        $stmt->execute([':uid' => $user_id, ':q' => $q, ':q2' => $q, ':q3' => $q, ':q4' => $q]);
        jsonResponse($stmt->fetchAll());
    }

    // Richieste in entrata (pending dove contact_id = user_id)
    if ($action === 'incoming') {
        $stmt = $db->prepare(
            'SELECT c.id, c.user_id, c.created_at,
                    u.realName, u.surname, u.username, u.status_user
             FROM contact c
             JOIN users u ON u.id = c.user_id
             WHERE c.contact_id = :uid AND c.status_contact = "pending"
             ORDER BY c.created_at DESC'
        );
        $stmt->execute([':uid' => $user_id]);
        jsonResponse($stmt->fetchAll());
    }

    jsonResponse(['error' => 'Azione non riconosciuta.'], 400);
}

// ── POST ─────────────────────────────────────────────────────────
if ($method === 'POST') {
    $body   = getJsonBody();
    $action = $body['action'] ?? '';

    // Invia richiesta
    if ($action === 'send') {
        $uid = (int)($body['user_id']    ?? 0);
        $cid = (int)($body['contact_id'] ?? 0);
        if (!$uid || !$cid) jsonResponse(['error' => 'Dati mancanti.'], 400);
        try {
            $db->prepare(
                'INSERT INTO contact (user_id, contact_id, status_contact) VALUES (:u, :c, "pending")'
            )->execute([':u' => $uid, ':c' => $cid]);
            jsonResponse(['ok' => true]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') jsonResponse(['error' => 'Richiesta già inviata.'], 409);
            jsonResponse(['error' => $e->getMessage()], 500);
        }
    }

    // Accetta richiesta
    if ($action === 'accept') {
        $id = (int)($body['id'] ?? 0);
        if (!$id) jsonResponse(['error' => 'ID mancante.'], 400);
        $db->prepare('UPDATE contact SET status_contact = "accepted" WHERE id = :id')
           ->execute([':id' => $id]);
        jsonResponse(['ok' => true]);
    }

    // Rifiuta / rimuovi richiesta
    if ($action === 'reject') {
        $id = (int)($body['id'] ?? 0);
        if (!$id) jsonResponse(['error' => 'ID mancante.'], 400);
        $db->prepare('DELETE FROM contact WHERE id = :id')->execute([':id' => $id]);
        jsonResponse(['ok' => true]);
    }

    // Rimuovi contatto (entrambe le direzioni)
    if ($action === 'remove') {
        $uid = (int)($body['user_id']    ?? 0);
        $cid = (int)($body['contact_id'] ?? 0);
        if (!$uid || !$cid) jsonResponse(['error' => 'Dati mancanti.'], 400);
        $db->prepare('DELETE FROM contact WHERE (user_id=:u AND contact_id=:c) OR (user_id=:c2 AND contact_id=:u2)')
           ->execute([':u' => $uid, ':c' => $cid, ':c2' => $cid, ':u2' => $uid]);
        jsonResponse(['ok' => true]);
    }

    jsonResponse(['error' => 'Azione non riconosciuta.'], 400);
}

jsonResponse(['error' => 'Metodo non consentito.'], 405);
