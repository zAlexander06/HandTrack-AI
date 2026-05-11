/* ── Permissions state ─────────────────────────────────────────────── */
const perms = { camera: false, mic: false, hand: false };

// Keep track of active media streams so we can stop them on toggle-off
const streams = { camera: null, mic: null };

/* ── UI helpers ────────────────────────────────────────────────────── */
function setCardState(type, state) {
  // state: 'idle' | 'loading' | 'granted' | 'denied' | 'revoked'
  const card  = document.getElementById('perm-' + type);
  const check = document.getElementById('check-' + type);
  const btn   = document.getElementById('btn-' + type);

  card.classList.remove('granted', 'denied', 'loading');

  switch (state) {
    case 'loading':
      card.classList.add('loading');
      btn.disabled = true;
      btn.textContent = 'Richiesta in corso…';
      check.textContent = '';
      check.className = 'perm-check';
      break;

    case 'granted':
      card.classList.add('granted');
      check.className = 'perm-check ok';
      check.textContent = '✓';
      btn.disabled = false;
      btn.textContent = 'Revoca';
      btn.classList.remove('btn-outline');
      btn.classList.add('btn-danger');
      perms[type] = true;
      break;

    case 'denied':
      card.classList.add('denied');
      check.className = 'perm-check err';
      check.textContent = '✕';
      btn.disabled = false;
      btn.textContent = type === 'hand' ? 'Abilita Tracciamento' : 'Riprova';
      btn.classList.remove('btn-danger');
      btn.classList.add('btn-outline');
      perms[type] = false;
      break;

    case 'revoked':
    case 'idle':
    default:
      check.className = 'perm-check';
      check.textContent = '';
      btn.disabled = false;
      btn.textContent = type === 'camera' ? 'Consenti Fotocamera'
                      : type === 'mic'    ? 'Consenti Microfono'
                      :                    'Abilita Tracciamento';
      btn.classList.remove('btn-danger');
      btn.classList.add('btn-outline');
      perms[type] = false;
      break;
  }

  checkAllPerms();
}

function showDeniedHint(type) {
  const names = { camera: 'fotocamera', mic: 'microfono', hand: null };
  if (!names[type]) return;
  showToast(`Permesso ${names[type]} negato. Abilitalo nelle impostazioni del browser.`, true);
}

/* ── Real permission requests ──────────────────────────────────────── */
async function requestCamera() {
  setCardState('camera', 'loading');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    // Stop tracks immediately — we only needed the grant, real stream opens at call start
    stream.getTracks().forEach(t => t.stop());
    streams.camera = null;
    setCardState('camera', 'granted');
  } catch (err) {
    showDeniedHint('camera');
    setCardState('camera', 'denied');
  }
}

async function requestMic() {
  setCardState('mic', 'loading');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    streams.mic = null;
    setCardState('mic', 'granted');
  } catch (err) {
    showDeniedHint('mic');
    setCardState('mic', 'denied');
  }
}

function requestHand() {
  // No real browser API for hand tracking — it's a software toggle
  setCardState('hand', 'granted');
  showToast('Tracciamento mano abilitato.');
}

/* ── Revoke helpers ────────────────────────────────────────────────── */
function revokeCamera() {
  if (streams.camera) {
    streams.camera.getTracks().forEach(t => t.stop());
    streams.camera = null;
  }
  setCardState('camera', 'revoked');
  showToast('Fotocamera disabilitata per questa sessione.');
}

function revokeMic() {
  if (streams.mic) {
    streams.mic.getTracks().forEach(t => t.stop());
    streams.mic = null;
  }
  setCardState('mic', 'revoked');
  showToast('Microfono disabilitato per questa sessione.');
}

function revokeHand() {
  setCardState('hand', 'revoked');
  showToast('Tracciamento mano disabilitato.');
}

/* ── Toggle entry point (called by onclick in HTML) ────────────────── */
function grantPerm(type) {
  if (perms[type]) {
    // Already granted → revoke/toggle off
    if (type === 'camera') revokeCamera();
    else if (type === 'mic') revokeMic();
    else revokeHand();
  } else {
    // Not granted → request
    if (type === 'camera') requestCamera();
    else if (type === 'mic') requestMic();
    else requestHand();
  }
}

/* ── Continue button ───────────────────────────────────────────────── */
function checkAllPerms() {
  const all  = perms.camera && perms.mic && perms.hand;
  const btn  = document.getElementById('continue-btn');
  const warn = document.getElementById('perm-warning');
  btn.disabled       = !all;
  warn.style.display = all ? 'none' : 'block';
}

/* ── Auto-detect already-granted permissions on load ──────────────── */
async function checkExistingPermissions() {
  if (!navigator.permissions) return;

  const checks = [
    { name: 'camera',     type: 'camera' },
    { name: 'microphone', type: 'mic'    },
  ];

  for (const { name, type } of checks) {
    try {
      const status = await navigator.permissions.query({ name });
      if (status.state === 'granted') setCardState(type, 'granted');
      else if (status.state === 'denied') setCardState(type, 'denied');

      // React to the user changing permissions directly in the browser UI
      status.addEventListener('change', () => {
        if (status.state === 'granted')     setCardState(type, 'granted');
        else if (status.state === 'denied') setCardState(type, 'denied');
        else                                setCardState(type, 'idle');
      });
    } catch (_) { /* browser may not support querying this permission */ }
  }
}

/* ── Init ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  checkExistingPermissions();

  // Remove hardcoded onclick and use a real listener
  const continueBtn = document.getElementById('continue-btn');
  continueBtn.removeAttribute('onclick');
  continueBtn.addEventListener('click', () => {
    if (perms.camera && perms.mic && perms.hand) {
      window.location.href = 'dashboard.html';
    }
  });
});