<?php
// ================================================================
// api/user.php — Operazioni sull'utente loggato
//
// GET  ?action=get&id=X                      → dati utente
// POST { action:"logout",         id }       → status offline
// POST { action:"update_status",  id, status }
// POST { action:"update_profile", id, realname, surname, username }
// POST { action:"change_password", id, old_hash, new_hash }
// POST { action:"forgot_check",   email }    → verifica email esiste
// POST { action:"forgot_reset",   id, new_hash } → aggiorna password
// ================================================================
require_once __DIR__ . '/../config/db.php';

$method = $_SERVER['REQUEST_METHOD'];
$db     = getDB();

// ── GET ──────────────────────────────────────────────────────────
if ($method === 'GET') {
    $id = (int)($_GET['id'] ?? 0);
    if (!$id) jsonResponse(['error' => 'ID mancante.'], 400);

    $stmt = $db->prepare(
        'SELECT id, username, email, realName, surname, role_user, status_user
         FROM users WHERE id = :id LIMIT 1'
    );
    $stmt->execute([':id' => $id]);
    $user = $stmt->fetch();

    if (!$user) jsonResponse(['error' => 'Utente non trovato.'], 404);
    jsonResponse($user);
}

// ── POST ─────────────────────────────────────────────────────────
if ($method === 'POST') {
    $body   = getJsonBody();
    $action = $body['action'] ?? '';

    // ── logout / update_status ───────────────────────────────────
    if ($action === 'logout' || $action === 'update_status') {
        $id     = (int)($body['id'] ?? 0);
        $status = $action === 'logout' ? 'offline' : ($body['status'] ?? 'offline');
        if (!$id) jsonResponse(['error' => 'ID mancante.'], 400);

        $db->prepare('UPDATE users SET status_user = :s WHERE id = :id')
           ->execute([':s' => $status, ':id' => $id]);
        jsonResponse(['ok' => true]);
    }

    // ── update_profile ───────────────────────────────────────────
    if ($action === 'update_profile') {
        $id       = (int)($body['id']       ?? 0);
        $realname = trim($body['realname']  ?? '');
        $surname  = trim($body['surname']   ?? '');
        $username = trim($body['username']  ?? '');
        if (!$id || !$realname || !$surname || !$username) {
            jsonResponse(['error' => 'Dati mancanti.'], 400);
        }
        try {
            $db->prepare(
                'UPDATE users SET realName = :r, surname = :s, username = :u WHERE id = :id'
            )->execute([':r' => $realname, ':s' => $surname, ':u' => $username, ':id' => $id]);
            jsonResponse(['ok' => true]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') {
                $msg = $e->getMessage();
                if (stripos($msg, 'username') !== false) jsonResponse(['error' => 'Username già in uso.'], 409);
                if (stripos($msg, 'realName') !== false) jsonResponse(['error' => 'Nome già in uso.'], 409);
                jsonResponse(['error' => 'Dati già in uso.'], 409);
            }
            jsonResponse(['error' => 'Errore aggiornamento.'], 500);
        }
    }

    // ── change_password ──────────────────────────────────────────
    if ($action === 'change_password') {
        $id      = (int)($body['id']       ?? 0);
        $oldHash = trim($body['old_hash']  ?? '');
        $newHash = trim($body['new_hash']  ?? '');
        if (!$id || !$oldHash || !$newHash) jsonResponse(['error' => 'Dati mancanti.'], 400);

        // Verifica vecchia password
        $stmt = $db->prepare('SELECT id FROM users WHERE id = :id AND password_hash = :h LIMIT 1');
        $stmt->execute([':id' => $id, ':h' => $oldHash]);
        if (!$stmt->fetch()) jsonResponse(['error' => 'La password attuale non è corretta.'], 401);

        $db->prepare('UPDATE users SET password_hash = :h WHERE id = :id')
           ->execute([':h' => $newHash, ':id' => $id]);
        jsonResponse(['ok' => true]);
    }

    // ── forgot_check ─────────────────────────────────────────────
    if ($action === 'forgot_check') {
        $email = trim($body['email'] ?? '');
        if (!$email) jsonResponse(['error' => 'Email mancante.'], 400);

        $stmt = $db->prepare('SELECT id FROM users WHERE email = :e LIMIT 1');
        $stmt->execute([':e' => $email]);
        $row = $stmt->fetch();
        if (!$row) jsonResponse(['error' => 'Nessun account trovato con questa email.'], 404);
        jsonResponse(['id' => (int)$row['id']]);
    }

    // ── forgot_reset ─────────────────────────────────────────────
    if ($action === 'forgot_reset') {
        $id      = (int)($body['id']       ?? 0);
        $newHash = trim($body['new_hash']  ?? '');
        if (!$id || !$newHash) jsonResponse(['error' => 'Dati mancanti.'], 400);

        $db->prepare('UPDATE users SET password_hash = :h WHERE id = :id')
           ->execute([':h' => $newHash, ':id' => $id]);
        jsonResponse(['ok' => true]);
    }

    jsonResponse(['error' => 'Azione non riconosciuta.'], 400);
}

jsonResponse(['error' => 'Metodo non consentito.'], 405);
