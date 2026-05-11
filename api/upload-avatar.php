<?php
require_once __DIR__ . '/_bootstrap.php';

requireMethod('POST');
$user = requireAuth();

if (empty($_FILES['avatar'])) fail('Nessun file ricevuto.');

$file = $_FILES['avatar'];
if ($file['error'] !== UPLOAD_ERR_OK) fail('Errore durante il caricamento.');

/* ── Validate ─────────────────────────────────────────────────────── */
$maxBytes  = 2 * 1024 * 1024;   // 2 MB
$allowedMime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

if ($file['size'] > $maxBytes) fail('Il file supera il limite di 2 MB.');

// Verify MIME via finfo (don't trust $_FILES['type'])
$finfo = new finfo(FILEINFO_MIME_TYPE);
$mime  = $finfo->file($file['tmp_name']);
if (!in_array($mime, $allowedMime, true)) fail('Formato non supportato. Usa JPG, PNG o WebP.');

/* ── Save ─────────────────────────────────────────────────────────── */
$ext      = match($mime) {
    'image/jpeg' => 'jpg',
    'image/png'  => 'png',
    'image/webp' => 'webp',
    'image/gif'  => 'gif',
    default      => 'jpg',
};

// Store avatars one level above the web root when possible; adjust path as needed
$uploadDir = __DIR__ . '/../uploads/avatars/';
if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);

// Delete old avatar if any
$pdo  = getDB();
$prev = $pdo->prepare('SELECT avatar_url FROM user WHERE Id = :id');
$prev->execute([':id' => $user['id']]);
$old  = $prev->fetchColumn();
if ($old) {
    $oldPath = __DIR__ . '/../' . ltrim($old, '/');
    if (file_exists($oldPath)) @unlink($oldPath);
}

$filename = 'avatar_' . $user['id'] . '_' . bin2hex(random_bytes(6)) . '.' . $ext;
$dest     = $uploadDir . $filename;

if (!move_uploaded_file($file['tmp_name'], $dest)) fail('Impossibile salvare il file.');

// URL accessible from the browser (adjust if your web root differs)
$avatarUrl = 'uploads/avatars/' . $filename;

$pdo->prepare('UPDATE user SET avatar_url = :url, avatar_color = NULL, avatar_initials = NULL WHERE Id = :id')
    ->execute([':url' => $avatarUrl, ':id' => $user['id']]);

ok(['avatar_url' => $avatarUrl]);
