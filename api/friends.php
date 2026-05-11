<?php
require_once __DIR__ . '/_bootstrap.php';

requireMethod('GET');
$user = requireAuth();
$pdo  = getDB();

/* ── Stats mode ────────────────────────────────────────────────────── */
if (isset($_GET['stats'])) {
    $accepted = (int) $pdo->prepare('
        SELECT COUNT(*) FROM contact
        WHERE (User_id = :id OR Contact_id = :id) AND Status_contact = "accepted"
    ')->execute([':id' => $user['id']]) ? $pdo->query('SELECT FOUND_ROWS()')->fetchColumn() : 0;

    // A cleaner approach:
    $stmtA = $pdo->prepare('SELECT COUNT(*) FROM contact
        WHERE (User_id = :id OR Contact_id = :id) AND Status_contact = "accepted"');
    $stmtA->execute([':id' => $user['id']]);
    $acceptedCount = (int) $stmtA->fetchColumn();

    $stmtP = $pdo->prepare('SELECT COUNT(*) FROM contact
        WHERE Contact_id = :id AND Status_contact = "pending"');
    $stmtP->execute([':id' => $user['id']]);
    $pendingCount = (int) $stmtP->fetchColumn();

    $stmtC = $pdo->prepare('SELECT COUNT(*) FROM `call`
        WHERE (Caller_id = :id OR Receiver_id = :id) AND Status_call = "ended"');
    $stmtC->execute([':id' => $user['id']]);
    $callsCount = (int) $stmtC->fetchColumn();

    ok(['stats' => [
        'accepted' => $acceptedCount,
        'pending'  => $pendingCount,
        'calls'    => $callsCount,
    ]]);
}

/* ── Friends list ──────────────────────────────────────────────────── */
// Returns both accepted contacts and incoming pending requests
$stmt = $pdo->prepare("
    SELECT
        u.Id            AS id,
        u.Username      AS username,
        u.Email         AS email,
        u.Status_user   AS status_user,
        u.avatar_url,
        u.avatar_color,
        u.avatar_initials,
        c.Status_contact AS contact_status,
        c.Created_at    AS since
    FROM contact c
    JOIN user u ON (
        CASE WHEN c.User_id = :id THEN c.Contact_id ELSE c.User_id END = u.Id
    )
    WHERE (c.User_id = :id OR c.Contact_id = :id)
      AND c.Status_contact IN ('accepted','pending')
    ORDER BY c.Status_contact DESC, u.Username ASC
");
$stmt->execute([':id' => $user['id']]);
$rows = $stmt->fetchAll();

$friends = array_map(function($r) {
    return [
        'id'             => (int) $r['id'],
        'username'       => $r['username'],
        'email'          => $r['email'],
        'status_user'    => $r['status_user'],
        'avatar_url'     => $r['avatar_url']      ?? null,
        'avatar_color'   => $r['avatar_color']    ?? null,
        'avatar_initials'=> $r['avatar_initials'] ?? null,
        'contact_status' => $r['contact_status'],
        'since'          => $r['since'],
    ];
}, $rows);

ok(['friends' => $friends]);
