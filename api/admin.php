<?php
// ================================================================
// api/admin.php — Pannello di amministrazione HandTrackLIS
//
// Tutte le route richiedono role_user IN ('admin','moderator')
//
// GET  ?action=users[&q=testo&page=1]       → lista/ricerca utenti
// GET  ?action=user_detail&id=X             → dettaglio singolo utente
// GET  ?action=reports[&status=pending]     → segnalazioni
// GET  ?action=mod_log[&page=1]             → log azioni moderazione
// GET  ?action=stats                        → statistiche generali
// GET  ?action=banned_words                 → lista parole bannate
//
// POST { action:"ban",            user_id, reason }
// POST { action:"unban",          user_id }         → rimuove blocked da contact + sblocca accesso
// POST { action:"set_role",       user_id, role }   → solo admin
// POST { action:"delete_user",    user_id, reason } → solo admin
// POST { action:"warn_user",      user_id, reason }
// POST { action:"resolve_report", report_id, resolution }
// POST { action:"add_banned_word",    word }         → solo admin
// POST { action:"remove_banned_word", word_id }      → solo admin
// POST { action:"force_logout",   user_id }
// ================================================================
require_once __DIR__ . '/../config/db.php';

$method = $_SERVER['REQUEST_METHOD'];
$db     = getDB();

// ── Verifica ruolo admin/moderator ───────────────────────────────
function requireAdmin(bool $adminOnly = false): array {
    if (!isset($_SESSION['user_id'])) {
        jsonResponse(['ok' => false, 'error' => 'Non autenticato.'], 401);
    }
    $db  = getDB();
    $stmt = $db->prepare('SELECT id, role_user, username FROM users WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $_SESSION['user_id']]);
    $admin = $stmt->fetch();

    if (!$admin) jsonResponse(['ok' => false, 'error' => 'Utente non trovato.'], 401);

    $allowed = $adminOnly
        ? ['admin']
        : ['admin', 'moderator'];

    if (!in_array($admin['role_user'], $allowed, true)) {
        jsonResponse(['ok' => false, 'error' => 'Accesso negato.'], 403);
    }
    return $admin;
}

// ── Helper: registra azione di moderazione ───────────────────────
function logAction(int $adminId, ?int $targetId, string $type, string $description): void {
    $db = getDB();
    $db->prepare(
        'INSERT INTO moderation_action (admin_id, target_user_id, action_type, description_action)
         VALUES (:a, :t, :type, :desc)'
    )->execute([':a' => $adminId, ':t' => $targetId, ':type' => $type, ':desc' => $description]);
}

// ================================================================
// GET
// ================================================================
if ($method === 'GET') {
    $me     = requireAdmin();
    $action = $_GET['action'] ?? '';

    // ── Lista utenti con ricerca e paginazione ───────────────────
    if ($action === 'users') {
        $q    = trim($_GET['q'] ?? '');
        $page = max(1, (int)($_GET['page'] ?? 1));
        $role = $_GET['role'] ?? '';
        $perPage = 20;
        $offset  = ($page - 1) * $perPage;

        $where  = ['1=1'];
        $params = [];

        if ($q) {
            $like = '%' . $q . '%';
            $where[]           = '(u.username LIKE :q OR u.email LIKE :q2 OR u.realName LIKE :q3 OR u.surname LIKE :q4)';
            $params[':q']  = $like;
            $params[':q2'] = $like;
            $params[':q3'] = $like;
            $params[':q4'] = $like;
        }
        if ($role) {
            $where[]         = 'u.role_user = :role';
            $params[':role'] = $role;
        }

        $whereStr = implode(' AND ', $where);

        $countStmt = $db->prepare("SELECT COUNT(*) FROM users u WHERE $whereStr");
        $countStmt->execute($params);
        $total = (int)$countStmt->fetchColumn();

        $params[':limit']  = $perPage;
        $params[':offset'] = $offset;

        $stmt = $db->prepare(
            "SELECT u.id, u.realName, u.surname, u.username, u.email,
                    u.role_user, u.status_user, u.created_at, u.scheduled_deletion_at,
                    IF(u.last_seen >= NOW() - INTERVAL 40 SECOND, 'online', 'offline') AS online_status,
                    (SELECT COUNT(*) FROM report r WHERE r.reported_id = u.id AND r.status_report = 'pending') AS open_reports,
                    (SELECT COUNT(*) FROM moderation_action ma WHERE ma.target_user_id = u.id) AS mod_actions
             FROM users u
             WHERE $whereStr
             ORDER BY u.created_at DESC
             LIMIT :limit OFFSET :offset"
        );
        $stmt->execute($params);

        jsonResponse([
            'ok'    => true,
            'users' => $stmt->fetchAll(),
            'total' => $total,
            'page'  => $page,
            'pages' => (int)ceil($total / $perPage),
        ]);
    }

    // ── Dettaglio singolo utente ─────────────────────────────────
    if ($action === 'user_detail') {
        $uid = (int)($_GET['id'] ?? 0);
        if (!$uid) jsonResponse(['ok' => false, 'error' => 'ID mancante.'], 400);

        $stmt = $db->prepare(
            "SELECT id, realName, surname, username, email, role_user, status_user,
                    created_at, last_seen, scheduled_deletion_at
             FROM users WHERE id = :id LIMIT 1"
        );
        $stmt->execute([':id' => $uid]);
        $user = $stmt->fetch();
        if (!$user) jsonResponse(['ok' => false, 'error' => 'Utente non trovato.'], 404);

        // Storico azioni mod su questo utente
        $stmtMod = $db->prepare(
            "SELECT ma.action_type, ma.description_action, ma.created_at,
                    u.username AS admin_username
             FROM moderation_action ma
             JOIN users u ON u.id = ma.admin_id
             WHERE ma.target_user_id = :uid
             ORDER BY ma.created_at DESC
             LIMIT 20"
        );
        $stmtMod->execute([':uid' => $uid]);

        // Report aperti su questo utente
        $stmtRep = $db->prepare(
            "SELECT r.id, r.reason, r.status_report, r.created_at,
                    u.username AS reporter_username
             FROM report r
             JOIN users u ON u.id = r.reporter_id
             WHERE r.reported_id = :uid
             ORDER BY r.created_at DESC
             LIMIT 10"
        );
        $stmtRep->execute([':uid' => $uid]);

        jsonResponse([
            'ok'         => true,
            'user'       => $user,
            'mod_log'    => $stmtMod->fetchAll(),
            'reports'    => $stmtRep->fetchAll(),
        ]);
    }

    // ── Lista segnalazioni ───────────────────────────────────────
    if ($action === 'reports') {
        $status = $_GET['status'] ?? 'pending';
        $page   = max(1, (int)($_GET['page'] ?? 1));
        $perPage = 20;
        $offset  = ($page - 1) * $perPage;

        $params = [];
        $where  = '1=1';

        if ($status && $status !== 'all') {
            $where           = 'r.status_report = :status';
            $params[':status'] = $status;
        }

        $countStmt = $db->prepare("SELECT COUNT(*) FROM report r WHERE $where");
        $countStmt->execute($params);
        $total = (int)$countStmt->fetchColumn();

        $params[':limit']  = $perPage;
        $params[':offset'] = $offset;

        $stmt = $db->prepare(
            "SELECT r.id, r.reason, r.status_report, r.created_at,
                    u1.id AS reporter_id, u1.username AS reporter_username,
                    u2.id AS reported_id, u2.username AS reported_username,
                    u2.role_user AS reported_role
             FROM report r
             JOIN users u1 ON u1.id = r.reporter_id
             JOIN users u2 ON u2.id = r.reported_id
             WHERE $where
             ORDER BY r.created_at DESC
             LIMIT :limit OFFSET :offset"
        );
        $stmt->execute($params);

        jsonResponse([
            'ok'      => true,
            'reports' => $stmt->fetchAll(),
            'total'   => $total,
            'page'    => $page,
            'pages'   => (int)ceil($total / $perPage),
        ]);
    }

    // ── Log moderazione ──────────────────────────────────────────
    if ($action === 'mod_log') {
        $page    = max(1, (int)($_GET['page'] ?? 1));
        $perPage = 30;
        $offset  = ($page - 1) * $perPage;

        $countStmt = $db->prepare("SELECT COUNT(*) FROM moderation_action");
        $countStmt->execute();
        $total = (int)$countStmt->fetchColumn();

        $stmt = $db->prepare(
            "SELECT ma.id, ma.action_type, ma.description_action, ma.created_at,
                    a.username  AS admin_username,  a.role_user AS admin_role,
                    t.username  AS target_username, t.id AS target_id
             FROM moderation_action ma
             JOIN users a ON a.id = ma.admin_id
             LEFT JOIN users t ON t.id = ma.target_user_id
             ORDER BY ma.created_at DESC
             LIMIT :limit OFFSET :offset"
        );
        $stmt->execute([':limit' => $perPage, ':offset' => $offset]);

        jsonResponse([
            'ok'     => true,
            'log'    => $stmt->fetchAll(),
            'total'  => $total,
            'page'   => $page,
            'pages'  => (int)ceil($total / $perPage),
        ]);
    }

    // ── Statistiche globali ──────────────────────────────────────
    if ($action === 'stats') {
        $stats = [];

        $stats['total_users']   = (int)$db->query("SELECT COUNT(*) FROM users")->fetchColumn();
        $stats['online_users']  = (int)$db->query("SELECT COUNT(*) FROM users WHERE last_seen >= NOW() - INTERVAL 40 SECOND")->fetchColumn();
        $stats['total_calls']   = (int)$db->query("SELECT COUNT(*) FROM call_table")->fetchColumn();
        $stats['calls_today']   = (int)$db->query("SELECT COUNT(*) FROM call_table WHERE DATE(created_at) = CURDATE()")->fetchColumn();
        $stats['total_messages']= (int)$db->query("SELECT COUNT(*) FROM message")->fetchColumn();
        $stats['open_reports']  = (int)$db->query("SELECT COUNT(*) FROM report WHERE status_report = 'pending'")->fetchColumn();
        $stats['banned_words']  = (int)$db->query("SELECT COUNT(*) FROM banned_word")->fetchColumn();
        $stats['pending_deletions'] = (int)$db->query("SELECT COUNT(*) FROM users WHERE scheduled_deletion_at IS NOT NULL")->fetchColumn();

        // Nuovi utenti negli ultimi 7 giorni
        $stats['new_users_7d']  = (int)$db->query("SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL 7 DAY")->fetchColumn();

        // Ruoli
        $roleStmt = $db->query("SELECT role_user, COUNT(*) AS cnt FROM users GROUP BY role_user");
        $stats['roles'] = $roleStmt->fetchAll();

        jsonResponse(['ok' => true, 'stats' => $stats]);
    }

    // ── Lista parole bannate ─────────────────────────────────────
    if ($action === 'banned_words') {
        $stmt = $db->query("SELECT id, word, created_at FROM banned_word ORDER BY word ASC");
        jsonResponse(['ok' => true, 'words' => $stmt->fetchAll()]);
    }

    jsonResponse(['ok' => false, 'error' => 'Azione non riconosciuta.'], 400);
}

// ================================================================
// POST
// ================================================================
if ($method === 'POST') {
    $me     = requireAdmin();
    $body   = getJsonBody();
    $action = $body['action'] ?? '';

    // ── Ban utente (role → onThinIce) ────────────────────────────
    if ($action === 'ban') {
        $uid    = (int)($body['user_id'] ?? 0);
        $reason = trim($body['reason'] ?? 'Nessun motivo specificato.');
        if (!$uid) jsonResponse(['ok' => false, 'error' => 'user_id mancante.'], 400);

        // Non può bannare se stesso o un admin (solo admin può)
        $tStmt = $db->prepare("SELECT role_user, username FROM users WHERE id = :id LIMIT 1");
        $tStmt->execute([':id' => $uid]);
        $target = $tStmt->fetch();
        if (!$target) jsonResponse(['ok' => false, 'error' => 'Utente non trovato.'], 404);
        if ($target['role_user'] === 'admin' && $me['role_user'] !== 'admin') {
            jsonResponse(['ok' => false, 'error' => 'Non puoi bannare un admin.'], 403);
        }
        if ($uid === (int)$me['id']) {
            jsonResponse(['ok' => false, 'error' => 'Non puoi bannare te stesso.'], 400);
        }

        $db->prepare("UPDATE users SET role_user = 'onThinIce', status_user = 'offline' WHERE id = :id")
           ->execute([':id' => $uid]);

        logAction((int)$me['id'], $uid, 'ban', "Ban applicato a @{$target['username']}. Motivo: $reason");

        // Notifica all'utente bannato
        $db->prepare(
            "INSERT INTO notification (user_id, type_notification, content) VALUES (:uid, 'ban', :content)"
        )->execute([':uid' => $uid, ':content' => json_encode(['reason' => $reason])]);

        jsonResponse(['ok' => true]);
    }

    // ── Unban utente ─────────────────────────────────────────────
    if ($action === 'unban') {
        $uid = (int)($body['user_id'] ?? 0);
        if (!$uid) jsonResponse(['ok' => false, 'error' => 'user_id mancante.'], 400);

        $tStmt = $db->prepare("SELECT username FROM users WHERE id = :id LIMIT 1");
        $tStmt->execute([':id' => $uid]);
        $target = $tStmt->fetch();
        if (!$target) jsonResponse(['ok' => false, 'error' => 'Utente non trovato.'], 404);

        $db->prepare("UPDATE users SET role_user = 'utente' WHERE id = :id AND role_user = 'onThinIce'")
           ->execute([':id' => $uid]);

        logAction((int)$me['id'], $uid, 'unban', "Unban applicato a @{$target['username']}.");
        jsonResponse(['ok' => true]);
    }

    // ── Cambia ruolo (solo admin) ─────────────────────────────────
    if ($action === 'set_role') {
        requireAdmin(adminOnly: true);
        $uid  = (int)($body['user_id'] ?? 0);
        $role = $body['role'] ?? '';
        $validRoles = ['utente', 'admin', 'moderator', 'onThinIce'];
        if (!$uid || !in_array($role, $validRoles, true)) {
            jsonResponse(['ok' => false, 'error' => 'Parametri non validi.'], 400);
        }

        $tStmt = $db->prepare("SELECT username FROM users WHERE id = :id LIMIT 1");
        $tStmt->execute([':id' => $uid]);
        $target = $tStmt->fetch();
        if (!$target) jsonResponse(['ok' => false, 'error' => 'Utente non trovato.'], 404);

        $db->prepare("UPDATE users SET role_user = :role WHERE id = :id")
           ->execute([':role' => $role, ':id' => $uid]);

        logAction((int)$me['id'], $uid, 'set_role', "Ruolo cambiato a '$role' per @{$target['username']}.");
        jsonResponse(['ok' => true]);
    }

    // ── Elimina utente definitivamente (solo admin) ───────────────
    if ($action === 'delete_user') {
        requireAdmin(adminOnly: true);
        $uid    = (int)($body['user_id'] ?? 0);
        $reason = trim($body['reason'] ?? '');
        if (!$uid) jsonResponse(['ok' => false, 'error' => 'user_id mancante.'], 400);
        if ($uid === (int)$me['id']) jsonResponse(['ok' => false, 'error' => 'Non puoi eliminare te stesso.'], 400);

        $tStmt = $db->prepare("SELECT username, email FROM users WHERE id = :id LIMIT 1");
        $tStmt->execute([':id' => $uid]);
        $target = $tStmt->fetch();
        if (!$target) jsonResponse(['ok' => false, 'error' => 'Utente non trovato.'], 404);

        logAction((int)$me['id'], null, 'delete_user',
            "Eliminato account @{$target['username']} ({$target['email']}). Motivo: $reason");

        $db->prepare("DELETE FROM users WHERE id = :id")->execute([':id' => $uid]);

        jsonResponse(['ok' => true]);
    }

    // ── Avvisa utente ────────────────────────────────────────────
    if ($action === 'warn_user') {
        $uid    = (int)($body['user_id'] ?? 0);
        $reason = trim($body['reason'] ?? '');
        if (!$uid || !$reason) jsonResponse(['ok' => false, 'error' => 'Parametri mancanti.'], 400);

        $tStmt = $db->prepare("SELECT username FROM users WHERE id = :id LIMIT 1");
        $tStmt->execute([':id' => $uid]);
        $target = $tStmt->fetch();
        if (!$target) jsonResponse(['ok' => false, 'error' => 'Utente non trovato.'], 404);

        $db->prepare(
            "INSERT INTO notification (user_id, type_notification, content) VALUES (:uid, 'warning', :content)"
        )->execute([':uid' => $uid, ':content' => json_encode(['reason' => $reason])]);

        logAction((int)$me['id'], $uid, 'warn', "Avviso inviato a @{$target['username']}. Motivo: $reason");
        jsonResponse(['ok' => true]);
    }

    // ── Risolvi segnalazione ─────────────────────────────────────
    if ($action === 'resolve_report') {
        $rid        = (int)($body['report_id']  ?? 0);
        $resolution = $body['resolution'] ?? 'reviewed';
        $validRes   = ['reviewed', 'resolved'];
        if (!$rid || !in_array($resolution, $validRes, true)) {
            jsonResponse(['ok' => false, 'error' => 'Parametri non validi.'], 400);
        }

        $rStmt = $db->prepare("SELECT id FROM report WHERE id = :id LIMIT 1");
        $rStmt->execute([':id' => $rid]);
        if (!$rStmt->fetch()) jsonResponse(['ok' => false, 'error' => 'Segnalazione non trovata.'], 404);

        $db->prepare("UPDATE report SET status_report = :res WHERE id = :id")
           ->execute([':res' => $resolution, ':id' => $rid]);

        logAction((int)$me['id'], null, 'resolve_report', "Segnalazione #$rid marcata come '$resolution'.");
        jsonResponse(['ok' => true]);
    }

    // ── Aggiungi parola bannata (solo admin) ──────────────────────
    if ($action === 'add_banned_word') {
        requireAdmin(adminOnly: true);
        $word = strtolower(trim($body['word'] ?? ''));
        if (!$word) jsonResponse(['ok' => false, 'error' => 'Parola mancante.'], 400);

        try {
            $db->prepare("INSERT INTO banned_word (word) VALUES (:w)")->execute([':w' => $word]);
            logAction((int)$me['id'], null, 'add_banned_word', "Aggiunta parola bannata: '$word'.");
            jsonResponse(['ok' => true]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') jsonResponse(['ok' => false, 'error' => 'Parola già presente.'], 409);
            jsonResponse(['ok' => false, 'error' => 'Errore.'], 500);
        }
    }

    // ── Rimuovi parola bannata (solo admin) ───────────────────────
    if ($action === 'remove_banned_word') {
        requireAdmin(adminOnly: true);
        $wid = (int)($body['word_id'] ?? 0);
        if (!$wid) jsonResponse(['ok' => false, 'error' => 'word_id mancante.'], 400);

        $wStmt = $db->prepare("SELECT word FROM banned_word WHERE id = :id LIMIT 1");
        $wStmt->execute([':id' => $wid]);
        $row = $wStmt->fetch();
        if (!$row) jsonResponse(['ok' => false, 'error' => 'Parola non trovata.'], 404);

        $db->prepare("DELETE FROM banned_word WHERE id = :id")->execute([':id' => $wid]);
        logAction((int)$me['id'], null, 'remove_banned_word', "Rimossa parola bannata: '{$row['word']}'.");
        jsonResponse(['ok' => true]);
    }

    // ── Forza logout utente (invalida sessione) ───────────────────
    if ($action === 'force_logout') {
        $uid = (int)($body['user_id'] ?? 0);
        if (!$uid) jsonResponse(['ok' => false, 'error' => 'user_id mancante.'], 400);

        $tStmt = $db->prepare("SELECT username FROM users WHERE id = :id LIMIT 1");
        $tStmt->execute([':id' => $uid]);
        $target = $tStmt->fetch();
        if (!$target) jsonResponse(['ok' => false, 'error' => 'Utente non trovato.'], 404);

        // Imposta offline + last_seen nel passato così il prossimo heartbeat fallirà
        $db->prepare("UPDATE users SET status_user = 'offline', last_seen = '2000-01-01 00:00:00' WHERE id = :id")
           ->execute([':id' => $uid]);

        $db->prepare(
            "INSERT INTO notification (user_id, type_notification, content) VALUES (:uid, 'force_logout', NULL)"
        )->execute([':uid' => $uid]);

        logAction((int)$me['id'], $uid, 'force_logout', "Logout forzato per @{$target['username']}.");
        jsonResponse(['ok' => true]);
    }

    jsonResponse(['ok' => false, 'error' => 'Azione non riconosciuta.'], 400);
}

jsonResponse(['ok' => false, 'error' => 'Metodo non consentito.'], 405);
