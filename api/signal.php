<?php
// ================================================================
// api/signal.php — WebRTC Signaling backend per HandTrackLIS
// ================================================================

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

require_once __DIR__ . '/../config/db.php'; // $pdo = PDO instance

// ── Crea la tabella se non esiste ─────────────────────────────────
getDB()->exec("
  CREATE TABLE IF NOT EXISTS webrtc_signals (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    call_id     INT         NOT NULL,
    sender_id   INT         NOT NULL,
    type        VARCHAR(16) NOT NULL,
    payload     MEDIUMTEXT  NOT NULL,
    created_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_call (call_id),
    INDEX idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");

// ── Pulizia segnali vecchi: solo quando i secondi sono 0-1 (~1 volta/min)
if ((int)date('s') < 2) {
  getDB()->exec("DELETE FROM webrtc_signals WHERE created_at < NOW() - INTERVAL 10 MINUTE");
}

$method = $_SERVER['REQUEST_METHOD'];

// POST — action: send
if ($method === 'POST') {
  $body    = json_decode(file_get_contents('php://input'), true) ?? [];
  $action  = $body['action']  ?? '';
  $call_id = (int)($body['call_id']  ?? 0);
  $user_id = (int)($body['user_id']  ?? 0);
  $type    = $body['type']    ?? '';
  $payload = $body['payload'] ?? '';

  if ($action !== 'send' || !$call_id || !$user_id || !$type || !$payload) {
    echo json_encode(['ok' => false, 'error' => 'parametri mancanti']); exit;
  }

  // Per offer/answer: sostituisci eventuali duplicati dallo stesso sender VERSO lo stesso target
  $db = getDB();
  if ($type === 'offer' || $type === 'answer') {
    // Estrai targetId dal payload JSON per la deduplicazione fine-grained
    $decoded   = json_decode($payload, true);
    $target_id = $decoded['targetId'] ?? null;

    if ($target_id !== null) {
      // Deduplicazione per (call_id, sender_id, type, targetId)
      $del = $db->prepare("
        DELETE FROM webrtc_signals
        WHERE call_id = ? AND sender_id = ? AND type = ?
          AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.targetId')) = ?
      ");
      $del->execute([$call_id, $user_id, $type, (string)$target_id]);
    } else {
      // Fallback: vecchia logica senza targetId
      $del = $db->prepare("DELETE FROM webrtc_signals WHERE call_id=? AND sender_id=? AND type=?");
      $del->execute([$call_id, $user_id, $type]);
    }
  }

  $stmt = $db->prepare("INSERT INTO webrtc_signals (call_id, sender_id, type, payload) VALUES (?,?,?,?)");
  $stmt->execute([$call_id, $user_id, $type, $payload]);
  echo json_encode(['ok' => true, 'id' => (int)$db->lastInsertId()]);
  exit;
}

// GET — action: recv
if ($method === 'GET') {
  $action  = $_GET['action']   ?? '';
  $call_id = (int)($_GET['call_id'] ?? 0);
  $user_id = (int)($_GET['user_id'] ?? 0);
  $after   = (int)($_GET['after']   ?? 0);

  if ($action !== 'recv' || !$call_id || !$user_id) {
    echo json_encode(['ok' => false, 'error' => 'parametri mancanti']); exit;
  }

  $stmt = getDB()->prepare("
    SELECT id, type, payload
    FROM webrtc_signals
    WHERE call_id   = ?
      AND sender_id != ?
      AND id        > ?
    ORDER BY id ASC
    LIMIT 50
  ");
  $stmt->execute([$call_id, $user_id, $after]);
  $signals = $stmt->fetchAll(PDO::FETCH_ASSOC);
  foreach ($signals as &$s) { $s['id'] = (int)$s['id']; }

  echo json_encode(['ok' => true, 'signals' => $signals]);
  exit;
}

echo json_encode(['ok' => false, 'error' => 'metodo non supportato']);