<?php
require_once __DIR__ . '/_bootstrap.php';

$user = requireAuth();
$pdo  = getDB();

/* ── GET — return full profile ────────────────────────────────────── */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $stmt = $pdo->prepare('
        SELECT Id, Username, Email, Role_user, Status_user,
               avatar_url, avatar_color, avatar_initials, Created_at
        FROM user WHERE Id = :id
    ');
    $stmt->execute([':id' => $user['id']]);
    $row = $stmt->fetch();
    if (!$row) fail('Utente non trovato.', 404);

    ok(['user' => [
        'id'              => $row['Id'],
        'username'        => $row['Username'],
        'email'           => $row['Email'],
        'role'            => $row['Role_user'],
        'status'          => $row['Status_user'],
        'avatar_url'      => $row['avatar_url']      ?? null,
        'avatar_color'    => $row['avatar_color']    ?? null,
        'avatar_initials' => $row['avatar_initials'] ?? null,
        'created_at'      => $row['Created_at'],
    ]]);
}

/* ── POST — mutations ──────────────────────────────────────────────── */
requireMethod('POST');
$data   = body();
$action = $data['action'] ?? '';

/* update_username ─────────────────────────────────────────────────── */
if ($action === 'update_username') {
    $username = trim($data['username'] ?? '');

    if (strlen($username) < 3)
        fail('Il nome utente deve avere almeno 3 caratteri.');
    if (!preg_match('/^[a-zA-Z0-9_.]+$/', $username))
        fail('Solo lettere, numeri, punti e underscore sono permessi.');

    // Check uniqueness excluding current user
    $chk = $pdo->prepare('SELECT Id FROM user WHERE Username = :u AND Id <> :id LIMIT 1');
    $chk->execute([':u' => $username, ':id' => $user['id']]);
    if ($chk->fetch()) fail('Questo username è già in uso.');

    $pdo->prepare('UPDATE user SET Username = :u WHERE Id = :id')
        ->execute([':u' => $username, ':id' => $user['id']]);

    $_SESSION['user']['username'] = $username;
    ok(['username' => $username]);
}

/* update_avatar_preset ────────────────────────────────────────────── */
if ($action === 'update_avatar_preset') {
    $color    = $data['avatar_color']    ?? null;
    $initials = $data['avatar_initials'] ?? null;

    $pdo->prepare('UPDATE user SET avatar_url = NULL, avatar_color = :c, avatar_initials = :i WHERE Id = :id')
        ->execute([':c' => $color, ':i' => $initials, ':id' => $user['id']]);
    ok();
}

/* remove_avatar ───────────────────────────────────────────────────── */
if ($action === 'remove_avatar') {
    $pdo->prepare('UPDATE user SET avatar_url = NULL, avatar_color = NULL, avatar_initials = NULL WHERE Id = :id')
        ->execute([':id' => $user['id']]);
    ok();
}

fail('Azione non riconosciuta.');
