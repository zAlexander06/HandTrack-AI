<?php
// ================================================================
// HandTrackLIS — api/cron_delete_accounts.php
//
// Elimina definitivamente gli account la cui data di eliminazione
// schedulata è già trascorsa.
//
// UTILIZZO:
//   Aprilo dal browser oppure configuralo come Cron Job su
//   Altervista puntando a:
//   https://tuosito.altervista.org/api/cron_delete_accounts.php
// ================================================================
require_once __DIR__ . '/../config/db.php';

header('Content-Type: application/json; charset=utf-8');

$db  = getDB();
$now = (new DateTime())->format('Y-m-d H:i:s');

$stmt = $db->prepare(
    'SELECT id, username, email
     FROM users
     WHERE scheduled_deletion_at IS NOT NULL
       AND scheduled_deletion_at <= :now'
);
$stmt->execute([':now' => $now]);
$toDelete = $stmt->fetchAll();

if (empty($toDelete)) {
    echo json_encode([
        'ok'      => true,
        'deleted' => 0,
        'message' => 'Nessun account da eliminare.',
        'run_at'  => $now,
    ]);
    exit;
}

$deleted = [];
$errors  = [];

foreach ($toDelete as $user) {
    try {
        $db->prepare('DELETE FROM users WHERE id = :id')
           ->execute([':id' => $user['id']]);

        $deleted[] = [
            'id'       => $user['id'],
            'username' => $user['username'],
            'email'    => $user['email'],
        ];
    } catch (PDOException $e) {
        $errors[] = [
            'id'    => $user['id'],
            'error' => $e->getMessage(),
        ];
    }
}

http_response_code(empty($errors) ? 200 : 207);
echo json_encode([
    'ok'      => empty($errors),
    'run_at'  => $now,
    'deleted' => $deleted,
    'errors'  => $errors,
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);