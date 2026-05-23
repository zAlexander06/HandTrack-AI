<?php
// ================================================================
// api/user.php — Operazioni sull'utente loggato
//
// GET  ?action=get                               → dati utente (dalla sessione)
// POST { action:"heartbeat" }
// POST { action:"update_profile",  realname, surname, username }
// POST { action:"change_password", old_password, new_password }
// POST { action:"forgot_check",    email }        → NON richiede auth
// POST { action:"forgot_reset",    email, new_password } → NON richiede auth
// POST { action:"schedule_delete" }
// POST { action:"cancel_delete" }
// ================================================================
require_once __DIR__ . '/../config/db.php';

$method = $_SERVER['REQUEST_METHOD'];
$db     = getDB();

// ── GET ──────────────────────────────────────────────────────────
if ($method === 'GET') {
    $action = $_GET['action'] ?? 'get';

    if ($action === 'get') {
        $id = requireAuth(); // ← ID dalla sessione, non dall'URL

        $stmt = $db->prepare(
            'SELECT id, username, email, realName, surname, role_user, status_user, scheduled_deletion_at
             FROM users WHERE id = :id LIMIT 1'
        );
        $stmt->execute([':id' => $id]);
        $user = $stmt->fetch();

        if (!$user) jsonResponse(['ok' => false, 'error' => 'Utente non trovato.'], 404);

        // ── Controllo ban ─────────────────────────────────────────
        if ($user['role_user'] === 'onThinIce') {
            // Distrugge la sessione e segnala al client di reindirizzare
            session_unset();
            session_destroy();
            jsonResponse(['ok' => false, 'error' => 'banned', 'redirect' => 'index.html'], 403);
        }

        jsonResponse(['ok' => true, 'user' => $user]);
    }

    jsonResponse(['ok' => false, 'error' => 'Azione non riconosciuta.'], 400);
}

// ── POST ─────────────────────────────────────────────────────────
if ($method === 'POST') {
    $body   = getJsonBody();
    $action = $body['action'] ?? '';

    // ── forgot_check — unica action che NON richiede login ───────
    if ($action === 'forgot_check') {
        $email = trim($body['email'] ?? '');
        if (!$email) jsonResponse(['ok' => false, 'error' => 'Email mancante.'], 400);

        $stmt = $db->prepare('SELECT id FROM users WHERE email = :e LIMIT 1');
        $stmt->execute([':e' => $email]);
        $row = $stmt->fetch();
        if (!$row) jsonResponse(['ok' => false, 'error' => 'Nessun account trovato con questa email.'], 404);
        // Non esponiamo l'ID: usiamo l'email come riferimento nel reset
        jsonResponse(['ok' => true]);
    }

    // ── forgot_reset — NON richiede login ────────────────────────
    if ($action === 'forgot_reset') {
        $email       = trim($body['email']        ?? '');
        $newPassword = trim($body['new_password'] ?? '');
        if (!$email || !$newPassword) jsonResponse(['ok' => false, 'error' => 'Dati mancanti.'], 400);

        // Validazione password
        $pwErrors = [];
        if (strlen($newPassword) < 8)             $pwErrors[] = 'almeno 8 caratteri';
        if (!preg_match('/[A-Z]/', $newPassword))  $pwErrors[] = 'almeno una lettera maiuscola';
        if (!preg_match('/[a-z]/', $newPassword))  $pwErrors[] = 'almeno una lettera minuscola';
        if (!preg_match('/[0-9]/', $newPassword))  $pwErrors[] = 'almeno un numero';
        if (!preg_match('/[\W_]/', $newPassword))  $pwErrors[] = 'almeno un carattere speciale';
        if ($pwErrors) jsonResponse(['ok' => false, 'error' => 'Password non valida: ' . implode(', ', $pwErrors) . '.'], 422);

        $hash = password_hash($newPassword, PASSWORD_BCRYPT);

        $stmt = $db->prepare('UPDATE users SET password_hash = :h WHERE email = :e');
        $stmt->execute([':h' => $hash, ':e' => $email]);

        if ($stmt->rowCount() === 0) jsonResponse(['ok' => false, 'error' => 'Email non trovata.'], 404);
        jsonResponse(['ok' => true]);
    }

    // ── Tutte le action successive richiedono login ───────────────
    $id = requireAuth();

    // ── heartbeat ────────────────────────────────────────────────
    if ($action === 'heartbeat') {
        $db->prepare(
            "UPDATE users SET status_user = 'online', last_seen = NOW() WHERE id = :id"
        )->execute([':id' => $id]);
        jsonResponse(['ok' => true]);
    }

    // ── update_profile ───────────────────────────────────────────
    if ($action === 'update_profile') {
        $realname = trim($body['realname'] ?? '');
        $surname  = trim($body['surname']  ?? '');
        $username = trim($body['username'] ?? '');
        if (!$realname || !$surname || !$username) {
            jsonResponse(['ok' => false, 'error' => 'Dati mancanti.'], 400);
        }
        try {
            $db->prepare(
                'UPDATE users SET realName = :r, surname = :s, username = :u WHERE id = :id'
            )->execute([':r' => $realname, ':s' => $surname, ':u' => $username, ':id' => $id]);

            // Aggiorna anche la sessione
            $_SESSION['username'] = $username;

            jsonResponse(['ok' => true]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') {
                $msg = $e->getMessage();
                if (stripos($msg, 'username') !== false) jsonResponse(['ok' => false, 'error' => 'Username già in uso.'], 409);
                jsonResponse(['ok' => false, 'error' => 'Dati già in uso.'], 409);
            }
            jsonResponse(['ok' => false, 'error' => 'Errore aggiornamento.'], 500);
        }
    }

    // ── change_password ──────────────────────────────────────────
    if ($action === 'change_password') {
        $oldPassword = trim($body['old_password'] ?? '');
        $newPassword = trim($body['new_password'] ?? '');
        if (!$oldPassword || !$newPassword) jsonResponse(['ok' => false, 'error' => 'Dati mancanti.'], 400);

        // Verifica vecchia password con bcrypt
        $stmt = $db->prepare('SELECT password_hash FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        if (!$row || !password_verify($oldPassword, $row['password_hash'])) {
            jsonResponse(['ok' => false, 'error' => 'La password attuale non è corretta.'], 401);
        }

        // Validazione nuova password
        $pwErrors = [];
        if (strlen($newPassword) < 8)             $pwErrors[] = 'almeno 8 caratteri';
        if (!preg_match('/[A-Z]/', $newPassword))  $pwErrors[] = 'almeno una lettera maiuscola';
        if (!preg_match('/[a-z]/', $newPassword))  $pwErrors[] = 'almeno una lettera minuscola';
        if (!preg_match('/[0-9]/', $newPassword))  $pwErrors[] = 'almeno un numero';
        if (!preg_match('/[\W_]/', $newPassword))  $pwErrors[] = 'almeno un carattere speciale';
        if ($pwErrors) jsonResponse(['ok' => false, 'error' => 'Password non valida: ' . implode(', ', $pwErrors) . '.'], 422);

        $hash = password_hash($newPassword, PASSWORD_BCRYPT);
        $db->prepare('UPDATE users SET password_hash = :h WHERE id = :id')
           ->execute([':h' => $hash, ':id' => $id]);
        jsonResponse(['ok' => true]);
    }

    // ── schedule_delete ──────────────────────────────────────────
    if ($action === 'schedule_delete') {
        $stmt = $db->prepare(
            'SELECT id, scheduled_deletion_at FROM users WHERE id = :id LIMIT 1'
        );
        $stmt->execute([':id' => $id]);
        $user = $stmt->fetch();
        if (!$user) jsonResponse(['ok' => false, 'error' => 'Utente non trovato.'], 404);

        if ($user['scheduled_deletion_at']) {
            jsonResponse([
                'ok'               => true,
                'already_scheduled' => true,
                'deletion_date'    => $user['scheduled_deletion_at'],
            ]);
        }

        $deletionDate = (new DateTime('+7 days'))->format('Y-m-d H:i:s');
        $db->prepare(
            "UPDATE users SET scheduled_deletion_at = :d, status_user = 'offline' WHERE id = :id"
        )->execute([':d' => $deletionDate, ':id' => $id]);

        jsonResponse(['ok' => true, 'deletion_date' => $deletionDate]);
    }

    // ── cancel_delete ────────────────────────────────────────────
    if ($action === 'cancel_delete') {
        $stmt = $db->prepare(
            'SELECT scheduled_deletion_at FROM users WHERE id = :id LIMIT 1'
        );
        $stmt->execute([':id' => $id]);
        $user = $stmt->fetch();
        if (!$user) jsonResponse(['ok' => false, 'error' => 'Utente non trovato.'], 404);

        if (!$user['scheduled_deletion_at']) {
            jsonResponse(['ok' => false, 'error' => 'Nessuna eliminazione schedulata.'], 409);
        }

        $deletionDate = new DateTime($user['scheduled_deletion_at']);
        if ($deletionDate <= new DateTime()) {
            jsonResponse(['ok' => false, 'error' => 'Il termine per annullare è scaduto.'], 410);
        }

        $db->prepare('UPDATE users SET scheduled_deletion_at = NULL WHERE id = :id')
           ->execute([':id' => $id]);

        jsonResponse(['ok' => true]);
    }

    jsonResponse(['ok' => false, 'error' => 'Azione non riconosciuta.'], 400);
}

jsonResponse(['ok' => false, 'error' => 'Metodo non consentito.'], 405);