<?php
// ================================================================
// api/report.php — Segnalazioni utenti
//
// POST { action:"send", reported_id, reason }   → invia segnalazione
// GET  ?action=my                               → segnalazioni inviate dall'utente loggato
// ================================================================
require_once __DIR__ . '/../config/db.php';

$method = $_SERVER['REQUEST_METHOD'];
$db     = getDB();

// ── POST ─────────────────────────────────────────────────────────
if ($method === 'POST') {
    $reporter_id = requireAuth();
    $body        = getJsonBody();
    $action      = $body['action'] ?? '';

    if ($action === 'send') {
        $reported_id = (int)($body['reported_id'] ?? 0);
        $reason      = trim($body['reason'] ?? '');

        if (!$reported_id) {
            jsonResponse(['ok' => false, 'error' => 'reported_id mancante.'], 400);
        }
        if ($reported_id === $reporter_id) {
            jsonResponse(['ok' => false, 'error' => 'Non puoi segnalare te stesso.'], 400);
        }
        if (!$reason) {
            jsonResponse(['ok' => false, 'error' => 'Il motivo della segnalazione è obbligatorio.'], 400);
        }

        // Verifica che l'utente segnalato esista
        $chk = $db->prepare('SELECT id FROM users WHERE id = :id LIMIT 1');
        $chk->execute([':id' => $reported_id]);
        if (!$chk->fetch()) {
            jsonResponse(['ok' => false, 'error' => 'Utente segnalato non trovato.'], 404);
        }

        // Controllo anti-duplicato: una segnalazione pending per la stessa coppia
        $dup = $db->prepare(
            'SELECT id FROM report
             WHERE reporter_id = :rep AND reported_id = :rpd AND status_report = "pending"
             LIMIT 1'
        );
        $dup->execute([':rep' => $reporter_id, ':rpd' => $reported_id]);
        if ($dup->fetch()) {
            jsonResponse(['ok' => false, 'error' => 'Hai già una segnalazione in corso per questo utente.'], 409);
        }

        $stmt = $db->prepare(
            'INSERT INTO report (reporter_id, reported_id, reason, status_report)
             VALUES (:rep, :rpd, :reason, "pending")'
        );
        $stmt->execute([
            ':rep'    => $reporter_id,
            ':rpd'    => $reported_id,
            ':reason' => $reason,
        ]);

        $reportId = (int)$db->lastInsertId();

        // Notifica interna agli admin/moderatori (opzionale ma utile)
        $admins = $db->query(
            "SELECT id FROM users WHERE role_user IN ('admin','moderator')"
        )->fetchAll(PDO::FETCH_COLUMN);

        $notifStmt = $db->prepare(
            'INSERT INTO notification (user_id, type_notification, content)
             VALUES (:uid, "new_report", :content)'
        );
        foreach ($admins as $adminId) {
            $notifStmt->execute([
                ':uid'     => $adminId,
                ':content' => json_encode(['report_id' => $reportId, 'reported_id' => $reported_id]),
            ]);
        }

        jsonResponse(['ok' => true, 'id' => $reportId]);
    }

    jsonResponse(['ok' => false, 'error' => 'Azione non riconosciuta.'], 400);
}

// ── GET ──────────────────────────────────────────────────────────
if ($method === 'GET') {
    $reporter_id = requireAuth();
    $action      = $_GET['action'] ?? 'my';

    if ($action === 'my') {
        $stmt = $db->prepare(
            'SELECT r.id, r.reason, r.status_report, r.created_at,
                    u.username AS reported_username, u.realName AS reported_name
             FROM report r
             JOIN users u ON u.id = r.reported_id
             WHERE r.reporter_id = :rep
             ORDER BY r.created_at DESC
             LIMIT 20'
        );
        $stmt->execute([':rep' => $reporter_id]);
        jsonResponse(['ok' => true, 'reports' => $stmt->fetchAll()]);
    }

    jsonResponse(['ok' => false, 'error' => 'Azione non riconosciuta.'], 400);
}

jsonResponse(['ok' => false, 'error' => 'Metodo non consentito.'], 405);
