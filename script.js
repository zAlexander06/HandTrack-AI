// ================================================================
// HandTrackLIS — script.js
// Backend: PHP + MySQL (phpMyAdmin) — niente Supabase
// ================================================================

// Base URL delle API PHP (modifica se il progetto è in una sottocartella)
const API = {
  login:         'api/login.php',
  register:      'api/register.php',
  user:          'api/user.php',
  contacts:      'api/contacts.php',
  calls:         'api/calls.php',
  messages:      'api/messages.php',
  notifications: 'api/notifications.php',
  signal:        'api/signal.php',
  bannedWords:   'api/banned_words.php',
  report:        'api/report.php',
};

// ── Cache parole bannate ─────────────────────────────────────────
let _bannedWordsCache = null;

async function getBannedWords() {
  if (_bannedWordsCache !== null) return _bannedWordsCache;
  try {
    const { data, ok } = await apiGet(API.bannedWords);
    _bannedWordsCache = (ok && Array.isArray(data?.words))
      ? data.words.map(w => w.toLowerCase())
      : [];
  } catch {
    _bannedWordsCache = [];
  }
  return _bannedWordsCache;
}

function containsBannedWord(text, bannedWords) {
  if (!bannedWords.length) return null;
  const lowerText = text.toLowerCase();
  for (const word of bannedWords) {
    // Controllo come parola intera (boundary) — es. "cazzo" non blocca "cazzola"
    const regex = new RegExp('(?<![a-zàèéìòùáéóú])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-zàèéìòùáéóú])', 'i');
    if (regex.test(lowerText)) return word;
  }
  return null;
}

// Helper fetch JSON
async function apiFetch(url, options = {}) {
  let res;
  try {
    res = await fetch(url, {
      credentials: 'include',                          // ← invia il cookie di sessione PHP ad ogni richiesta
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (networkErr) {
    console.error('apiFetch network error [' + url + ']:', networkErr.message);
    return { data: { ok: false, error: 'network_error' }, ok: false, status: 0 };
  }
  const text = await res.text().catch(() => '');
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // Risposta non-JSON: probabilmente errore PHP 500 con output HTML
    console.error('apiFetch non-JSON [HTTP ' + res.status + '] from ' + url + ':', text.slice(0, 400));
    json = { ok: false, error: 'invalid_json', rawResponse: text.slice(0, 400) };
  }
  return { data: json, ok: res.ok, status: res.status };
}

async function apiGet(endpoint, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return apiFetch(endpoint + (qs ? '?' + qs : ''));
}

async function apiPost(endpoint, body = {}) {
  return apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
}

// ================================================================
// SESSION
// ================================================================
let currentUser = null;

// Salva SOLO dati non sensibili (per la UI): no id, no email, no ruolo
// L'autenticazione vera è gestita dal cookie di sessione PHP (HttpOnly).
function saveSession(user) {
  const uiData = {
    id:       user.id,       // utile per logica UI lato client (non è un segreto)
    username: user.username,
    nome:     user.nome,
    cognome:  user.cognome,
    initials: user.initials,
    role:     user.role,
    scheduled_deletion_at: user.scheduled_deletion_at || null,
  };
  sessionStorage.setItem('htl_user', JSON.stringify(uiData));
}
function clearSession() {
  sessionStorage.removeItem('htl_user');
  sessionStorage.removeItem('htl_current_page');
  sessionStorage.removeItem('htl_login_tab');
}
async function loadSession() {
  // Verifica la sessione PHP chiedendo al server chi siamo
  try {
    const { data, ok, status } = await apiGet(API.user, { action: 'get' });
    if (ok && data?.user?.id) {
      const u = data.user;
      currentUser = {
        id:                    u.id,
        username:              u.username,
        email:                 u.email,
        nome:                  u.realName || u.realname,
        cognome:               u.surname,
        role:                  u.role_user || u.role,
        scheduled_deletion_at: u.scheduled_deletion_at || null,
        initials: ((u.realName || u.realname || '')[0] + (u.surname || '')[0]).toUpperCase(),
      };
      updateNavUser(currentUser);
      return true;
    }
    // 403 banned: sessione distrutta dal server → torna alla home
    if (status === 403 && data?.error === 'banned') {
      clearSession();
      window.location.href = 'index.html';
      return false;
    }
    // 401: sessione non valida/account non trovato su pagina protetta → torna alla home
    if (status === 401) {
      const protectedFiles = ['dashboard.html', 'permission.html'];
      const currentFile = window.location.pathname.split('/').pop() || 'index.html';
      if (protectedFiles.includes(currentFile)) {
        clearSession();
        window.location.href = 'index.html';
        return false;
      }
    }
  } catch (_) {}
  return false;
}

// hashPassword: mantenuta solo per retrocompatibilità (non più usata per login/register)
// Il backend usa bcrypt via password_hash()/password_verify()
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ================================================================
// AUTH: LOGIN
// ================================================================
async function loginUser() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');

  if (!email || !password)  return showFormError(errEl, 'Compila tutti i campi.');
  if (!isValidEmail(email)) return showFormError(errEl, 'Inserisci un indirizzo email valido.');

  const btn = document.querySelector('#login-inner .btn-primary') ||
              document.querySelector('#tab-login .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = _t('login.signingIn'); }

  // Niente più hashPassword() — manda plain text su HTTPS
  const { data, ok } = await apiPost(API.login, { email, password });

  if (btn) { btn.disabled = false; btn.textContent = _t('login.btn'); }

  if (!ok) {
    // Utente bannato: redirect immediato alla home
    if (data?.error === 'banned') {
      clearSession();
      window.location.href = 'index.html';
      return;
    }
    return showFormError(errEl, data.error || 'Email o password errati.');
  }

  clearFormError(errEl);
  const u = data.user;
  currentUser = {
    id:                     u.id,
    username:               u.username,
    email:                  u.email,
    nome:                   u.realname,
    cognome:                u.surname,
    role:                   u.role,
    scheduled_deletion_at:  u.scheduled_deletion_at || null,
    initials: ((u.realname?.[0] || '') + (u.surname?.[0] || '')).toUpperCase()
  };
  saveSession(currentUser);
  updateNavUser(currentUser);
  startIncomingCallPoller();
  startNotificationPoller();
  startHeartbeat();
  goTo('page-permissions');
}

// ================================================================
// AUTH: REGISTER
// ================================================================
async function registerUser() {
  const realName = document.getElementById('signup-realname').value.trim();
  const surname  = document.getElementById('signup-cognome').value.trim();
  const username = document.getElementById('signup-username').value.trim();
  const email    = document.getElementById('signup-email').value.trim();
  const emailCf  = document.getElementById('signup-email-conf').value.trim();
  const password = document.getElementById('signup-password').value;
  const passCf   = document.getElementById('signup-password-conf').value;
  const errEl    = document.getElementById('signup-error');

  if (!realName || !surname || !username || !email || !emailCf || !password || !passCf)
    return showFormError(errEl, 'Compila tutti i campi.');
  if (!isValidEmail(email))
    return showFormError(errEl, 'Inserisci un indirizzo email valido.');
  if (email !== emailCf)
    return showFormError(errEl, 'Gli indirizzi email non corrispondono.');

  // Validazione password lato client (stesso controllo del backend)
  const pwErrors = [];
  if (password.length < 8)                      pwErrors.push('almeno 8 caratteri');
  if (!/[A-Z]/.test(password))                  pwErrors.push('almeno una maiuscola');
  if (!/[a-z]/.test(password))                  pwErrors.push('almeno una minuscola');
  if (!/[0-9]/.test(password))                  pwErrors.push('almeno un numero');
  if (!/[\W_]/.test(password))                  pwErrors.push('almeno un carattere speciale');
  if (pwErrors.length)
    return showFormError(errEl, 'Password non valida: ' + pwErrors.join(', ') + '.');

  if (password !== passCf)
    return showFormError(errEl, 'Le password non corrispondono.');

  const btn = document.querySelector('#tab-signup .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = _t('login.registering'); }

  // Mandiamo la password in chiaro (su HTTPS è sicuro) — l'hash lo fa il backend con bcrypt
  const { data, ok } = await apiPost(API.register, {
    realname: realName,
    surname,
    username,
    email,
    password,   // <-- plain text, non più password_hash
  });

  if (btn) { btn.disabled = false; btn.textContent = _t('login.btnSignup'); }

  if (!ok) {
    return showFormError(errEl, data.error || 'Errore durante la registrazione.');
  }

  clearFormError(errEl);
  const u = data.user;
  currentUser = {
    id:       u.id,
    username: u.username,
    email:    u.email,
    nome:     u.realname,
    cognome:  u.surname,
    role:     u.role || 'utente',
    initials: ((u.realname?.[0] || realName[0] || '') + (u.surname?.[0] || surname[0] || '')).toUpperCase()
  };
  saveSession(currentUser);
  updateNavUser(currentUser);
  startIncomingCallPoller();
  startNotificationPoller();
  startHeartbeat();
  showToast('Account creato con successo!');
  goTo('page-permissions');
}

// ================================================================
// AUTH: FORGOT PASSWORD
// ================================================================
async function submitForgotPassword() {
  const email  = document.getElementById('forgot-email').value.trim();
  const pw     = document.getElementById('forgot-password').value;
  const pwConf = document.getElementById('forgot-password-conf').value;
  const errEl  = document.getElementById('forgot-error');

  if (!email)               return showFormError(errEl, 'Inserisci la tua email.');
  if (!isValidEmail(email)) return showFormError(errEl, 'Inserisci un indirizzo email valido.');
  if (!pw || !pwConf)       return showFormError(errEl, 'Compila tutti i campi.');
  if (pw !== pwConf)        return showFormError(errEl, 'Le password non corrispondono.');

  const btn = document.querySelector('#page-forgot .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = _t('forgot.verifying'); }

  const { data: checkData, ok: checkOk } = await apiPost(API.user, { action: 'forgot_check', email });

  if (!checkOk) {
    if (btn) { btn.disabled = false; btn.textContent = _t('forgot.btn'); }
    return showFormError(errEl, checkData.error || 'Nessun account trovato con questa email.');
  }

  if (btn) btn.textContent = _t('forgot.updating');

  const { data, ok } = await apiPost(API.user, { action: 'forgot_reset', email, new_password: pw });

  if (btn) { btn.disabled = false; btn.textContent = _t('forgot.btn'); }

  if (!ok) return showFormError(errEl, data.error || 'Errore durante l\'aggiornamento. Riprova.');

  document.getElementById('forgot-email').value = '';
  document.getElementById('forgot-password').value = '';
  document.getElementById('forgot-password-conf').value = '';
  showToast('Password aggiornata! Puoi ora accedere.');
  goTo('page-login');
}

// ================================================================
// ACCOUNT VALIDITY CHECK
// Verifica ogni 30 secondi che l'account esista ancora nel DB.
// Se è stato eliminato, disconnette automaticamente l'utente.
// ================================================================
let _accountCheckInterval = null;

function startAccountValidityCheck() {
  stopAccountValidityCheck();
  _accountCheckInterval = setInterval(async () => {
    if (!currentUser?.id) return;
    const { data, ok, status } = await apiGet(API.user, { action: 'get' });
    // 401 = sessione scaduta, 404 = account eliminato
    if (!ok || !data?.user?.id) {
      stopAccountValidityCheck();
      showToast('Il tuo account è stato eliminato. Disconnessione in corso…');
      await logoutUser();
    }
  }, 30000); // ogni 30 secondi
}

function stopAccountValidityCheck() {
  if (_accountCheckInterval) {
    clearInterval(_accountCheckInterval);
    _accountCheckInterval = null;
  }
}


async function logoutUser() {
  stopHeartbeat();
  stopIncomingCallPoller();
  stopNotificationPoller();
  stopChatPoller();
  stopAccountValidityCheck();
  clearInterval(callStatusPollInterval);
  activeCallId = null; outgoingCallId = null;
  Object.values(mediaStreams).forEach(s => s && s.getTracks().forEach(t => t.stop()));

  // Chiama il logout lato server per distruggere la sessione PHP
  try { await apiPost('api/logout.php', {}); } catch (_) {}

  clearSession();
  currentUser = null;
  goTo('page-home');
}

// ================================================================
// HEARTBEAT
// Invia un ping al backend ogni 20 secondi per segnalare che
// l'utente è ancora attivo (status_user = 'online', last_seen = NOW()).
// Il backend considera offline chiunque non abbia un last_seen
// aggiornato negli ultimi ~40 secondi (2× l'intervallo).
// Al logout o alla chiusura della tab, il beacon imposta offline.
// ================================================================
let _heartbeatInterval = null;

function startHeartbeat() {
  stopHeartbeat();
  if (!currentUser?.id) return;

  // Ping immediato al primo avvio
  _sendHeartbeat();

  _heartbeatInterval = setInterval(_sendHeartbeat, 20000);

  // Quando la tab viene chiusa/ricaricata usa sendBeacon (fire-and-forget)
  // per non bloccare l'unload della pagina
  window.addEventListener('visibilitychange', _onVisibilityChange);
  window.addEventListener('pagehide', _onPageHide);
}

function stopHeartbeat() {
  if (_heartbeatInterval) {
    clearInterval(_heartbeatInterval);
    _heartbeatInterval = null;
  }
  window.removeEventListener('visibilitychange', _onVisibilityChange);
  window.removeEventListener('pagehide', _onPageHide);
}

async function _sendHeartbeat() {
  if (!currentUser?.id) return;
  try {
    await apiPost(API.user, { action: 'heartbeat' }); // ID letto dalla sessione PHP
  } catch {
    // Heartbeat fallito (offline temporaneo): non fare nulla
  }
}

function _onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    _sendHeartbeat();
  }
}

function _onPageHide() {
  if (!currentUser?.id) return;
  // sendBeacon non supporta Content-Type JSON su tutti i browser,
  // usiamo application/json con blob — il backend lo gestisce
  const blob = new Blob([JSON.stringify({ action: 'heartbeat' })], { type: 'application/json' });
  navigator.sendBeacon(API.user + '?beacon=1', blob);
}

// ================================================================
// UTILS
// ================================================================
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function showFormError(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}
function clearFormError(el) {
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}
function updateNavUser(user) {
  document.querySelectorAll('.nav-user-initials').forEach(el => {
    el.textContent = user.initials;
  });
  document.querySelectorAll('.nav-user-name').forEach(el => {
    el.textContent = user.nome + ' ' + user.cognome;
  });
  const homeNavRight = document.querySelector('#page-home .nav-right');
  if (homeNavRight) {
    homeNavRight.innerHTML = `
      <div class="badge badge-green badge-dot">Connesso</div>
      <div class="avatar nav-user-initials" onclick="goTo('page-profile')" style="cursor:pointer;">${user.initials}</div>
    `;
  }

  // Inietta il link Admin Panel in tutte le sidebar per admin e moderator
  injectAdminLink(user);
}

function injectAdminLink(user) {
  const isStaff = user.role === 'admin' || user.role === 'moderator';

  // Rimuovi eventuali link già presenti (evita duplicati su re-render)
  document.querySelectorAll('.sidebar-admin-link').forEach(el => el.remove());

  if (!isStaff) return;

  const adminSvg = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%232563eb' stroke-width='2'%3E%3Crect x='3' y='3' width='7' height='7'/%3E%3Crect x='14' y='3' width='7' height='7'/%3E%3Crect x='3' y='14' width='7' height='7'/%3E%3Cpath d='M14 17h7M17 14v7'/%3E%3C/svg%3E`;

  document.querySelectorAll('.sidebar').forEach(sidebar => {
    // Inserisci prima del sidebar-spacer (prima del pulsante Esci)
    const spacer = sidebar.querySelector('.sidebar-spacer');
    if (!spacer) return;

    // Sezione "Moderazione" (label)
    const label = document.createElement('div');
    label.className = 'sidebar-section-label sidebar-admin-link';
    label.style.marginTop = '12px';
    label.textContent = 'Moderazione';

    // Link Admin Panel
    const btn = document.createElement('button');
    btn.className = 'sidebar-link sidebar-admin-link';
    btn.style.color = 'var(--accent)';
    btn.innerHTML = `<img class="sicon" src="${adminSvg}" alt="" style="filter:none !important;">Admin Panel`;
    btn.onclick = () => window.open('admin.html', '_blank');

    sidebar.insertBefore(label, spacer);
    sidebar.insertBefore(btn, spacer);
  });
}

// ================================================================
// PERMISSIONS STATE
// ================================================================
const perms = { camera: false, mic: false, hand: false };
const mediaStreams = {};

async function grantPerm(type) {
  // I pulsanti sono toggle: se il permesso è già concesso, lo revochiamo
  if (perms[type]) {
    _revokePerm(type);
    return;
  }

  const btn  = document.getElementById('btn-' + type);
  const card = document.getElementById('perm-' + type);

  // Animazione "in attesa": toggle diventa semi-trasparente
  if (btn) btn.style.opacity = '0.5';

  try {
    if (type === 'camera') {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      mediaStreams.camera = stream;
    } else if (type === 'mic') {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreams.mic = stream;
    } else if (type === 'hand') {
      // Il tracciamento mano richiede la fotocamera attiva come prerequisito
      if (!perms.camera) {
        if (btn) btn.style.opacity = '1';
        showToast('Abilita prima la fotocamera.');
        return;
      }
      await new Promise(r => setTimeout(r, 400));
    }

    perms[type] = true;
    if (card) card.classList.add('granted');
    if (btn)  { btn.classList.add('on'); btn.style.opacity = '1'; }
    // Sync mic consent into settings so the Settings page reflects reality
    if (type === 'mic') {
      const s = loadSettings(); s.micEnabled = true; persistSettings(s);
    }
    checkAllPerms();

  } catch (err) {
    if (btn) btn.style.opacity = '1';
    const msg = err.name === 'NotAllowedError'
      ? 'Permesso negato. Controlla le impostazioni del browser.'
      : err.name === 'NotFoundError'
      ? 'Dispositivo non trovato. Verifica la connessione.'
      : 'Errore: ' + err.message;
    showToast(msg);
  }
}

function _revokePerm(type) {
  // Non si può revocare hand se hand non è ancora concesso (no-op)
  // Non si può revocare camera se hand è già concesso (dipendenza)
  if (type === 'camera' && perms.hand) {
    showToast('Disabilita prima il tracciamento mano.');
    return;
  }
  // Ferma lo stream se presente
  if (mediaStreams[type]) {
    mediaStreams[type].getTracks().forEach(t => t.stop());
    delete mediaStreams[type];
  }
  perms[type] = false;
  const card = document.getElementById('perm-' + type);
  const btn  = document.getElementById('btn-' + type);
  if (card) card.classList.remove('granted');
  if (btn)  btn.classList.remove('on');
  // Sync mic revocation into settings
  if (type === 'mic') {
    const s = loadSettings(); s.micEnabled = false; persistSettings(s);
  }
  checkAllPerms();
}

function checkAllPerms() {
  // Obbligatoria: solo fotocamera. Microfono e tracciamento mano facoltativi.
  const ready = perms.camera;
  const btn   = document.getElementById('continue-btn');
  const warn  = document.getElementById('perm-warning');
  if (btn) btn.disabled = !ready;
  if (warn) warn.style.display = ready ? 'none' : 'block';
}

// ================================================================
// CONTACTS
// ================================================================
let allContacts = [];
let contactFilter = '';
let statusFilter = 'all';

const AVATAR_COLORS = [
  'linear-gradient(135deg,#059669,#0d9488)',
  'linear-gradient(135deg,#2563eb,#4f46e5)',
  'linear-gradient(135deg,#7c3aed,#4f46e5)',
  'linear-gradient(135deg,#dc2626,#9f1239)',
  'linear-gradient(135deg,#b45309,#92400e)',
  'linear-gradient(135deg,#0284c7,#0369a1)',
  'linear-gradient(135deg,#6d28d9,#5b21b6)',
  'linear-gradient(135deg,#0f766e,#0d9488)',
];
function avatarColor(id) { return AVATAR_COLORS[Number(id) % AVATAR_COLORS.length]; }
function initials(nome, cognome) {
  return ((nome?.[0] || '') + (cognome?.[0] || '')).toUpperCase() || '?';
}

async function loadContacts() {
  const list = document.getElementById('contacts-list');
  if (!list || !currentUser?.id) return;
  list.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text3);">${_t('common.loading')}</div>`;

  const { data, ok } = await apiGet(API.contacts, { action: 'list' });

  if (!ok) {
    list.innerHTML = '<div style="text-align:center;padding:32px;color:var(--red);">Errore nel caricamento contatti.</div>';
    return;
  }

  allContacts = (data || []).map(u => ({
    id:       u.id,
    initials: initials(u.realName, u.surname),
    name:     (u.realName + ' ' + u.surname).trim(),
    email:    u.email,
    username: u.username,
    status:   u.status_user || 'offline',
    color:    avatarColor(u.id),
  }));

  renderContacts();
  updateDashStats();
}

function updateDashStats() {
  const totalEl  = document.querySelector('#page-dashboard .stat-card:first-child .stat-value');
  const onlineEl = document.querySelector('#page-dashboard .stat-card:last-child .stat-value');
  if (totalEl)  totalEl.textContent  = allContacts.length;
  if (onlineEl) onlineEl.textContent = allContacts.filter(c => c.status === 'online').length;
}

function renderContacts() {
  const list = document.getElementById('contacts-list');
  if (!list) return;
  const filtered = allContacts.filter(c => {
    const q = contactFilter.toLowerCase();
    const matchText   = c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchText && matchStatus;
  });
  if (!filtered.length) {
    list.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text3);">${_t('dash.noContacts')}</div>`;
    return;
  }
  list.innerHTML = filtered.map(c => `
    <div class="contact-item">
      <div class="avatar" style="background:${c.color};">${c.initials}</div>
      <div class="status-dot ${c.status === 'online' ? 'status-online' : 'status-offline'}"></div>
      <div class="contact-info">
        <div class="contact-name">${c.name}</div>
        <div class="contact-status">${c.email} · ${c.status === 'online' ? 'Online' : 'Offline'}</div>
      </div>
      <button class="btn btn-success text-xs" onclick="startCall(${c.id}, '${c.name.replace(/'/g,"\\'")}', '${c.initials}')">
        <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2'%3E%3Cpath d='M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 11.9 19.79 19.79 0 0 1 1.61 3.27 2 2 0 0 1 3.58 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.56a16 16 0 0 0 6 6'/%3E%3C/svg%3E" style="width:12px;height:12px;" alt="">Chiama
      </button>
      <div class="contact-menu-wrap" style="position:relative;">
        <button class="btn contact-menu-btn" onclick="toggleContactMenu(event, ${c.id})" title="Altre opzioni" style="width:30px;height:30px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--bg2);border:1px solid var(--border);">
          <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
        </button>
        <div id="contact-menu-${c.id}" class="contact-dropdown" style="display:none;">
          <button class="contact-dropdown-item" onclick="reportContactPrompt(${c.id}, '${c.name.replace(/'/g,"\'")}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="color:#d97706;flex-shrink:0;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Segnala
          </button>
          <div style="height:1px;background:var(--border);margin:3px 6px;"></div>
          <button class="contact-dropdown-item contact-dropdown-danger" onclick="removeContactConfirm(${c.id}, '${c.name.replace(/'/g,"\'")}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="flex-shrink:0;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            Rimuovi
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function filterContacts(val)         { contactFilter = val; renderContacts(); }
function filterContactsByStatus(val) { statusFilter = val;  renderContacts(); }

async function removeContact(btn, contactId, name) {
  const item = btn.closest('.contact-item');
  item.style.transition = 'all 0.3s';
  item.style.opacity = '0';
  item.style.transform = 'translateX(20px)';

  await apiPost(API.contacts, { action: 'remove', contact_id: contactId });

  allContacts = allContacts.filter(c => c.id !== contactId);
  setTimeout(() => { item.remove(); updateDashStats(); }, 300);
  showToast(name + ' rimosso dai contatti');
}

// ── Three-dot contact menu ────────────────────────────────────────
function toggleContactMenu(e, contactId) {
  e.stopPropagation();
  // Close all other open menus
  document.querySelectorAll('.contact-dropdown').forEach(d => {
    if (d.id !== 'contact-menu-' + contactId) d.style.display = 'none';
  });
  const menu = document.getElementById('contact-menu-' + contactId);
  if (!menu) return;
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

// Close menus when clicking elsewhere
document.addEventListener('click', () => {
  document.querySelectorAll('.contact-dropdown').forEach(d => d.style.display = 'none');
});

function removeContactConfirm(contactId, name) {
  document.querySelectorAll('.contact-dropdown').forEach(d => d.style.display = 'none');
  openGenericModal({
    title: 'Rimuovi contatto',
    message: `Sei sicuro di voler rimuovere <strong>${name}</strong> dai tuoi contatti? L'azione non può essere annullata.`,
    confirmLabel: 'Rimuovi',
    confirmClass: 'btn-danger-soft',
    onConfirm: async () => {
      const item = document.querySelector(`.contact-item:has(#contact-menu-${contactId})`);
      if (item) { item.style.transition = 'all 0.3s'; item.style.opacity = '0'; item.style.transform = 'translateX(20px)'; }
      await apiPost(API.contacts, { action: 'remove', contact_id: contactId });
      allContacts = allContacts.filter(c => c.id !== contactId);
      setTimeout(() => { if (item) item.remove(); updateDashStats(); }, 300);
      showToast(name + ' rimosso dai contatti');
    }
  });
}

function reportContactPrompt(userId, name) {
  document.querySelectorAll('.contact-dropdown').forEach(d => d.style.display = 'none');
  openReportModal({ userId, name, context: 'contatto' });
}

function reportCallUserPrompt(userId, name) {
  openReportModal({ userId, name, context: 'chiamata' });
}

// ── Generic confirm modal ─────────────────────────────────────────
function openGenericModal({ title, message, confirmLabel, confirmClass, onConfirm }) {
  let modal = document.getElementById('generic-confirm-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'generic-confirm-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);align-items:center;justify-content:center;padding:24px;';
    modal.innerHTML = `
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:18px;padding:28px;max-width:400px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,0.3);">
        <h3 id="gcm-title" style="font-family:'Syne',sans-serif;font-size:18px;font-weight:700;margin-bottom:10px;"></h3>
        <p id="gcm-message" style="font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:20px;"></p>
        <div style="display:flex;gap:10px;">
          <button class="btn w-full" style="justify-content:center;padding:11px;border-radius:10px;" onclick="closeGenericModal()">Annulla</button>
          <button id="gcm-confirm" class="btn w-full" style="justify-content:center;padding:11px;border-radius:10px;font-weight:600;"></button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('gcm-title').textContent = title;
  document.getElementById('gcm-message').innerHTML = message;
  const btn = document.getElementById('gcm-confirm');
  btn.textContent = confirmLabel;
  btn.className = 'btn w-full ' + (confirmClass || '');
  btn.style.cssText = 'justify-content:center;padding:11px;border-radius:10px;font-weight:600;';
  if (confirmClass === 'btn-danger-soft') {
    btn.style.background = 'rgba(220,38,38,0.1)';
    btn.style.color = 'var(--red)';
    btn.style.border = '1px solid rgba(220,38,38,0.3)';
  }
  btn.onclick = () => { closeGenericModal(); onConfirm(); };
  modal.style.display = 'flex';
}
function closeGenericModal() {
  const m = document.getElementById('generic-confirm-modal');
  if (m) m.style.display = 'none';
}

// ── Report modal ──────────────────────────────────────────────────
function openReportModal({ userId, name, context }) {
  let modal = document.getElementById('report-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'report-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);align-items:center;justify-content:center;padding:24px;';
    modal.innerHTML = `
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:18px;padding:28px;max-width:420px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,0.3);">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
          <div style="width:42px;height:42px;border-radius:12px;background:rgba(217,119,6,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" width="20" height="20"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <div>
            <h3 style="font-family:'Syne',sans-serif;font-size:17px;font-weight:700;margin-bottom:2px;">Segnala utente</h3>
            <div id="report-modal-sub" style="font-size:12px;color:var(--text3);"></div>
          </div>
        </div>
        <div class="input-group" style="margin-bottom:16px;">
          <label class="input-label">Descrizione del problema</label>
          <textarea id="report-modal-desc" class="input" rows="4" placeholder="Descrivi il comportamento inappropriato…" style="resize:vertical;min-height:90px;font-family:inherit;"></textarea>
        </div>
        <div id="report-modal-error" style="display:none;font-size:12px;color:var(--red);margin-bottom:12px;padding:8px 12px;background:rgba(220,38,38,0.07);border-radius:8px;"></div>
        <div style="display:flex;gap:10px;">
          <button class="btn w-full" style="justify-content:center;padding:11px;border-radius:10px;" onclick="closeReportModal()">Annulla</button>
          <button id="report-modal-confirm" class="btn w-full" style="justify-content:center;padding:11px;border-radius:10px;font-weight:600;background:rgba(217,119,6,0.1);color:#d97706;border:1px solid rgba(217,119,6,0.3);" onclick="submitReport()">Invia Segnalazione</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  modal._reportUserId = userId;
  modal._reportName   = name;
  document.getElementById('report-modal-sub').textContent = 'Stai segnalando ' + name;
  document.getElementById('report-modal-desc').value = '';
  document.getElementById('report-modal-error').style.display = 'none';
  modal.style.display = 'flex';
}
function closeReportModal() {
  const m = document.getElementById('report-modal');
  if (m) m.style.display = 'none';
}
async function submitReport() {
  const modal = document.getElementById('report-modal');
  const desc  = document.getElementById('report-modal-desc').value.trim();
  const errEl = document.getElementById('report-modal-error');
  if (!desc) {
    errEl.textContent = 'Inserisci una descrizione prima di inviare la segnalazione.';
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';
  const btn = document.getElementById('report-modal-confirm');
  btn.disabled = true;
  btn.textContent = _t('addContact.sending');

  let success = false;
  let errMsg  = '';
  try {
    const { ok, data } = await apiPost(API.report, {
      action:      'send',
      reported_id: modal._reportUserId,
      reason:      desc,
    });
    success = ok;
    if (!ok) errMsg = data?.error || "Errore durante l'invio della segnalazione.";
  } catch (_) {
    errMsg = 'Errore di rete. Riprova.';
  }

  if (!success) {
    errEl.textContent   = errMsg;
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = _t('addContact.sendReport');
    return;
  }

  closeReportModal();
  showToast('Segnalazione inviata per ' + modal._reportName);
  btn.disabled = false;
  btn.textContent = _t('addContact.sendReport');
}

// ================================================================
// RECENT CALLS
// ================================================================
async function loadRecents() {
  const list = document.getElementById('recents-list');
  if (!list || !currentUser?.id) return;
  list.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text3);">${_t('recents.loadingCalls')}</div>`;

  const { data, ok } = await apiGet(API.calls, { action: 'history' });

  if (!ok) {
    list.innerHTML = '<div style="text-align:center;padding:32px;color:var(--red);">Errore nel caricamento chiamate.</div>';
    return;
  }
  if (!data || !data.length) {
    list.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text3);">${_t('recents.noRecents')}</div>`;
    return;
  }

  const ICON_OUT    = `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2316a34a' stroke-width='2.5'%3E%3Cline x1='7' y1='17' x2='17' y2='7'/%3E%3Cpath d='M7 7h10v10'/%3E%3C/svg%3E" alt="">`;
  const ICON_IN     = `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%232563eb' stroke-width='2.5'%3E%3Cline x1='17' y1='7' x2='7' y2='17'/%3E%3Cpath d='M17 17H7V7'/%3E%3C/svg%3E" alt="">`;
  const ICON_MISSED = `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23dc2626' stroke-width='2.5'%3E%3Cline x1='18' y1='6' x2='6' y2='18'/%3E%3Cline x1='6' y1='6' x2='18' y2='18'/%3E%3C/svg%3E" alt="">`;

  list.innerHTML = data.map(call => {
    const isOut  = call.caller_id === currentUser.id;
    const missed = call.status_call === 'missed';

    // Il PHP restituisce già nome+cognome delle due parti
    const otherName = isOut
      ? ((call.receiver_name || '') + ' ' + (call.receiver_surname || '')).trim() || 'Utente sconosciuto'
      : ((call.caller_name   || '') + ' ' + (call.caller_surname   || '')).trim() || 'Utente sconosciuto';
    const otherId   = isOut ? call.receiver_id : call.caller_id;
    const otherInit = initials(
      isOut ? call.receiver_name  : call.caller_name,
      isOut ? call.receiver_surname : call.caller_surname
    );
    const color = avatarColor(otherId || 0);

    let durationStr = '';
    if (call.start_time && call.end_time) {
      const secs = Math.round((new Date(call.end_time) - new Date(call.start_time)) / 1000);
      const m = Math.floor(secs / 60), s = secs % 60;
      durationStr = ` · ${m > 0 ? m + ' min' : s + ' sec'}`;
    }

    const when      = call.created_at ? formatCallDate(call.created_at) : '';
    const dirLabel  = missed ? 'Chiamata persa' : isOut ? 'In uscita' : 'In entrata';
    const dirColor  = missed ? 'var(--red)' : 'var(--text2)';
    const iconClass = missed ? 'missed' : isOut ? 'out' : 'in';
    const icon      = missed ? ICON_MISSED : isOut ? ICON_OUT : ICON_IN;

    return `
      <div class="call-item" onclick="openCallDetail(${call.id})">
        <div class="call-icon ${iconClass}">${icon}</div>
        <div class="avatar" style="width:36px;height:36px;font-size:13px;flex-shrink:0;background:${color};">${otherInit}</div>
        <div style="flex:1;">
          <div class="font-semibold text-sm">${otherName}</div>
          <div class="text-xs" style="color:${dirColor};">${dirLabel}${durationStr}</div>
        </div>
        <div class="text-xs text-muted">${when}</div>
        <button class="btn btn-primary text-xs" data-uid="${otherId||0}" data-name="${otherName}" data-ini="${otherInit}" onclick="event.stopPropagation();startCall(+this.dataset.uid,this.dataset.name,this.dataset.ini)">Richiama</button>
      </div>`;
  }).join('');
}

function formatCallDate(isoStr) {
  const d = new Date(isoStr);
  const now = new Date();
  const diff = Math.floor((now - d) / 86400000);
  const hm = d.toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' });
  if (diff === 0) return 'Oggi, ' + hm;
  if (diff === 1) return 'Ieri, ' + hm;
  if (diff < 7)  return diff + ' giorni fa';
  return d.toLocaleDateString('it-IT');
}

function closeAllDropdowns() {
  document.querySelectorAll('.contact-dropdown').forEach(d => d.style.display = 'none');
}

async function openCallDetail(callId) {
  // Crea o riusa il bottom sheet
  let sheet = document.getElementById('call-detail-sheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'call-detail-sheet';
    sheet.className = 'call-detail-sheet';
    sheet.innerHTML = `
      <div class="call-detail-backdrop" onclick="closeCallDetail()"></div>
      <div class="call-detail-panel">
        <div class="call-detail-handle"></div>
        <div class="call-detail-header">
          <span class="call-detail-title">Partecipanti alla chiamata</span>
          <button class="call-detail-close" onclick="closeCallDetail()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div id="call-detail-list" class="call-detail-list">
          <div class="call-detail-loading">${_t('common.loading')}</div>
        </div>
      </div>`;
    document.body.appendChild(sheet);
  }

  // Mostra il sheet
  const listEl = document.getElementById('call-detail-list');
  listEl.innerHTML = `<div class="call-detail-loading">${_t('common.loading')}</div>`;
  sheet.classList.add('open');
  document.body.style.overflow = 'hidden';

  const { data, ok } = await apiGet(API.calls, { action: 'all_participants', call_id: callId });

  if (!ok || !data || !data.length) {
    listEl.innerHTML = `<div class="call-detail-empty">${_t('recents.noParticipants')}</div>`;
    return;
  }

  listEl.innerHTML = data.map(p => {
    const fullName = ((p.realName || '') + ' ' + (p.surname || '')).trim() || p.username || ('Utente #' + p.user_id);
    const ini = initials(p.realName, p.surname) || (p.username || '?').slice(0, 2).toUpperCase();
    const col = avatarColor(p.user_id);
    const isMe = p.user_id === currentUser?.id;
    const safeName = fullName.replace(/'/g, "\\'");
    const isContact = allContacts.some(c => c.id === p.user_id);

    const actions = isMe ? '' : `
      <div class="call-detail-actions">
        <button class="call-detail-action-btn call-detail-call-btn"
          data-uid="${p.user_id}" data-name="${fullName}" data-ini="${ini}"
          onclick="closeCallDetail();startCall(+this.dataset.uid,this.dataset.name,this.dataset.ini)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 11.9 19.79 19.79 0 0 1 1.61 3.27 2 2 0 0 1 3.58 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.56a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          Richiama
        </button>
        ${!isContact ? `<button class="call-detail-action-btn call-detail-add-btn" id="cd-add-${p.user_id}"
          onclick="cdAddContact(this,${p.user_id},'${safeName}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
          Aggiungi
        </button>` : ''}
        <button class="call-detail-report-btn"
          onclick="closeCallDetail();reportCallUserPrompt(${p.user_id},'${safeName}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Segnala
        </button>
      </div>`;

    return `
      <div class="call-detail-row">
        <div class="avatar" style="width:38px;height:38px;font-size:13px;flex-shrink:0;background:${col};">${ini}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:500;">${fullName}${isMe ? ' <span style="font-size:11px;color:var(--text3);">(tu)</span>' : ''}</div>
          ${p.username ? `<div style="font-size:12px;color:var(--text3);">@${p.username}</div>` : ''}
        </div>
        ${actions}
      </div>`;
  }).join('');
}

function closeCallDetail() {
  const sheet = document.getElementById('call-detail-sheet');
  if (sheet) sheet.classList.remove('open');
  document.body.style.overflow = '';
}

async function cdAddContact(btn, userId, name) {
  btn.disabled = true;
  btn.textContent = '…';
  const { ok, error } = await apiPost(API.contacts, { action: 'send', contact_id: userId });
  if (ok) {
    btn.textContent = _t('addContact.requestSent');
    btn.style.opacity = '0.5';
    btn.style.cursor = 'default';
  } else {
    btn.disabled = false;
    btn.textContent = _t('addContact.add');
    showToast(error || 'Errore nell\'invio della richiesta.');
  }
}

// ================================================================
// ADD CONTACT
// ================================================================
let myContactIds = new Set();

async function loadSuggestedContacts() {
  const list = document.getElementById('suggested-list');
  if (!list || !currentUser?.id) return;
  list.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text3);" class="text-sm">${_t('common.loading')}</div>`;

  // Se allContacts non è ancora popolato, caricalo prima
  if (!allContacts || allContacts.length === 0) {
    const { data: cData, ok: cOk } = await apiGet(API.contacts, { action: 'list' });
    if (cOk && cData) {
      allContacts = cData.map(u => ({
        id:       u.id,
        initials: initials(u.realName, u.surname),
        name:     (u.realName + ' ' + u.surname).trim(),
        email:    u.email,
        username: u.username,
        status:   u.status_user || 'offline',
        color:    avatarColor(u.id),
      }));
    }
  }

  const { data, ok } = await apiGet(API.contacts, { action: 'suggested' });

  if (!ok || !data || !data.length) {
    list.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text3);" class="text-sm">${_t('addContact.noSuggested')}</div>`;
    return;
  }

  myContactIds = new Set(allContacts.map(c => c.id));
  list.innerHTML = data.map(u => renderUserCard(u, 'suggested-list')).join('');
}

async function searchUsers() {
  const q = document.getElementById('contact-search').value.trim();
  const results = document.getElementById('search-results');
  if (!results) return;
  if (!q) {
    results.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3);"><div class="text-sm">Digita per cercare utenti</div></div>';
    return;
  }
  results.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text3);" class="text-sm">${_t('addContact.searching')}</div>`;

  const { data, ok } = await apiGet(API.contacts, { action: 'search', q });

  if (!ok) {
    results.innerHTML = '<div style="text-align:center;padding:24px;color:var(--red);" class="text-sm">Errore nella ricerca</div>';
    return;
  }
  if (!data || !data.length) {
    results.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text3);" class="text-sm">${_t('addContact.noResults')}</div>`;
    return;
  }
  results.innerHTML = data.map(u => renderUserCard(u, 'search-results')).join('');
}

function renderUserCard(u, context) {
  const name = (u.realName + ' ' + u.surname).trim();
  const init = initials(u.realName, u.surname);
  const color = avatarColor(u.id);
  const isAlready = myContactIds.has(u.id);
  const btnHtml = isAlready
    ? `<button class="btn text-xs" disabled style="opacity:0.5;">Già aggiunto</button>`
    : `<button class="btn btn-primary text-xs" onclick="sendContactRequest(this,${u.id},'${name.replace(/'/g,"\\'")}')">+ Aggiungi</button>`;
  return `
    <div class="contact-item">
      <div class="avatar" style="background:${color};">${init}</div>
      <div class="contact-info">
        <div class="contact-name">${name}</div>
        <div class="contact-status">@${u.username}</div>
      </div>
      ${btnHtml}
    </div>`;
}

async function sendContactRequest(btn, targetId, name) {
  btn.disabled = true;
  btn.textContent = '…';

  const { data, ok } = await apiPost(API.contacts, {
    action:     'send',
    contact_id: targetId,
  });

  if (!ok && !data.error?.includes('già')) {
    btn.disabled = false;
    btn.textContent = _t('addContact.addPlus');
    showToast('Errore nell\'invio della richiesta');
    return;
  }
  myContactIds.add(targetId);
  btn.textContent = 'Inviata';
  btn.style.opacity = '0.6';
  showToast('Richiesta inviata a ' + name);
}

function filterSuggestedContacts() { searchUsers(); }

// ================================================================
// RICHIESTE IN ENTRATA
// ================================================================
async function loadIncomingRequests() {
  const container = document.getElementById('incoming-requests-card');
  const list      = document.getElementById('incoming-requests-list');
  const badge     = document.getElementById('incoming-badge');
  if (!list || !currentUser?.id) return;

  list.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text3);" class="text-sm">${_t('common.loading')}</div>`;

  const { data, ok } = await apiGet(API.contacts, { action: 'incoming' });

  if (!ok) {
    list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--red);" class="text-sm">Errore nel caricamento</div>';
    return;
  }

  if (!data || !data.length) {
    if (badge) badge.style.display = 'none';
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3);" class="text-sm">Nessuna richiesta in attesa</div>';
    return;
  }

  if (badge) { badge.textContent = data.length; badge.style.display = 'inline-flex'; }

  list.innerHTML = data.map(req => {
    const name  = (req.realName + ' ' + req.surname).trim() || 'Utente sconosciuto';
    const init  = initials(req.realName, req.surname);
    const color = avatarColor(req.user_id);
    const uname = req.username ? '@' + req.username : '';
    const when  = req.created_at ? formatCallDate(req.created_at) : '';
    return `
      <div class="contact-item" id="req-row-${req.id}">
        <div class="avatar" style="background:${color};flex-shrink:0;">${init}</div>
        <div class="contact-info" style="flex:1;">
          <div class="contact-name">${name}</div>
          <div class="contact-status">${uname} · ${when}</div>
        </div>
        <button class="btn btn-success text-xs" onclick="acceptRequest(${req.id},'${name.replace(/'/g,"\\'")}')">✓ Accetta</button>
        <button class="btn btn-danger-soft text-xs" onclick="rejectRequest(${req.id},'${name.replace(/'/g,"\\'")}')">✕ Rifiuta</button>
      </div>`;
  }).join('');
}

async function acceptRequest(rowId, name) {
  const row = document.getElementById('req-row-' + rowId);
  if (row) { row.style.opacity = '0.5'; row.style.pointerEvents = 'none'; }

  const { ok } = await apiPost(API.contacts, { action: 'accept', id: rowId });

  if (!ok) {
    if (row) { row.style.opacity = '1'; row.style.pointerEvents = ''; }
    showToast('Errore nell\'accettare la richiesta');
    return;
  }
  if (row) row.remove();
  showToast(name + ' aggiunto ai contatti!');
  loadIncomingRequests();
  loadContacts();
}

async function rejectRequest(rowId, name) {
  const row = document.getElementById('req-row-' + rowId);
  if (row) { row.style.opacity = '0.5'; row.style.pointerEvents = 'none'; }

  const { ok } = await apiPost(API.contacts, { action: 'reject', id: rowId });

  if (!ok) {
    if (row) { row.style.opacity = '1'; row.style.pointerEvents = ''; }
    showToast('Errore nel rifiutare la richiesta');
    return;
  }
  if (row) row.remove();
  showToast('Richiesta di ' + name + ' rifiutata');
  loadIncomingRequests();
}

// ================================================================
// PAGE LOADER
// ================================================================
let _loaderTimer = null;

function _getLoaderMode() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    // animations: true → dettagliata, false → semplice
    return (s && s.animations === false) ? 'simple' : 'detail';
  } catch(e) { return 'detail'; }
}

function showLoader() {
  const loader = document.getElementById('page-loader');
  if (!loader) return;
  clearTimeout(_loaderTimer);

  const mode = _getLoaderMode();
  loader.classList.remove('loader-simple', 'loader-detail-mode');

  if (mode === 'simple') {
    loader.classList.add('loader-simple');
    const bar = loader.querySelector('.loader-bar');
    if (bar) { bar.style.transition = 'none'; bar.style.width = '0%'; }
    loader.classList.add('visible');
    requestAnimationFrame(() => {
      if (bar) { bar.style.transition = 'width 0.4s cubic-bezier(0.4,0,0.2,1)'; bar.style.width = '75%'; }
    });
  } else {
    loader.classList.add('loader-detail-mode');
    loader.classList.add('visible');
  }
}

function hideLoader() {
  const loader = document.getElementById('page-loader');
  if (!loader) return;
  const mode = _getLoaderMode();

  if (mode === 'simple') {
    const bar = loader.querySelector('.loader-bar');
    if (bar) { bar.style.width = '100%'; }
    _loaderTimer = setTimeout(() => {
      loader.classList.remove('visible');
      if (bar) { bar.style.transition = 'none'; bar.style.width = '0%'; }
    }, 250);
  } else {
    loader.classList.remove('visible');
  }
}

// ================================================================
// PAGE NAVIGATION
// ================================================================
function _applyPageChange(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(pageId);
  if (target) {
    target.classList.add('active');
    window.scrollTo(0, 0);
  }
  // Salva la pagina corrente per ripristinarla al ricaricamento
  sessionStorage.setItem('htl_current_page', pageId);
  if (pageId === 'page-dashboard')   loadContacts();
  if (pageId === 'page-recents')     loadRecents();
  if (pageId === 'page-add-contact') { loadSuggestedContacts(); loadIncomingRequests(); }
  if (pageId === 'page-call')        startCallTimer();
  else                               stopCallTimer();
  if (pageId === 'page-permissions') resetPerms();
  if (pageId === 'page-settings')   _syncMicPermissionToSettings();
  if (pageId === 'page-login') {
    clearFormError(document.getElementById('login-error'));
    clearFormError(document.getElementById('signup-error'));
    const loginInner  = document.getElementById('login-inner');
    const signupInner = document.getElementById('signup-inner');
    // Ripristina il tab salvato, di default "Accedi"
    const savedTab = sessionStorage.getItem('htl_login_tab') || 'login';
    if (savedTab === 'signup') {
      if (loginInner)  { loginInner.style.display = 'none'; }
      if (signupInner) { signupInner.style.display = 'flex'; signupInner.style.flexDirection = 'column'; }
      const tabs = document.querySelectorAll('#page-login .pill-tab');
      if (tabs.length >= 2) { tabs[0].classList.remove('active'); tabs[1].classList.add('active'); }
    } else {
      if (loginInner)  { loginInner.style.display = 'flex'; loginInner.style.flexDirection = 'column'; }
      if (signupInner) { signupInner.style.display = 'none'; }
      const tabs = document.querySelectorAll('#page-login .pill-tab');
      if (tabs.length >= 2) { tabs[0].classList.add('active'); tabs[1].classList.remove('active'); }
    }
  }
  if (pageId === 'page-forgot')   clearFormError(document.getElementById('forgot-error'));
  if (pageId === 'page-profile')  populateProfilePage();
}

function goTo(pageId) {
  // Controlla se le animazioni sono completamente disabilitate
  const noAnim = document.body.classList.contains('no-animations');
  if (noAnim) { _applyPageChange(pageId); return; }

  const mode = _getLoaderMode();
  showLoader();

  // Dettagliata: aspetta 350ms così si vede il logo; Semplice: quasi istantanea
  const delay = (mode === 'detail') ? 350 : 80;

  setTimeout(() => {
    _applyPageChange(pageId);
    hideLoader();
  }, delay);
}

function resetPerms() {
  // Stop any previously acquired streams
  ['camera', 'mic'].forEach(t => {
    if (mediaStreams[t]) {
      mediaStreams[t].getTracks().forEach(tr => tr.stop());
      delete mediaStreams[t];
    }
  });
  // Reset state and UI for all three permissions
  ['camera', 'mic', 'hand'].forEach(t => {
    perms[t] = false;
    const card = document.getElementById('perm-' + t);
    const btn  = document.getElementById('btn-' + t);
    if (card) card.classList.remove('granted');
    if (btn)  { btn.classList.remove('on'); btn.style.opacity = '1'; }
  });
  const continueBtn = document.getElementById('continue-btn');
  if (continueBtn) continueBtn.disabled = true;
  const warn = document.getElementById('perm-warning');
  if (warn) warn.style.display = 'block';
}

// ================================================================
// LOGIN TABS
// ================================================================
function showTab(showId, hideId, clickedBtn) {
  const showEl = document.getElementById(showId);
  showEl.style.display = 'flex';
  showEl.style.flexDirection = 'column';
  document.getElementById(hideId).style.display = 'none';
  const tabs = clickedBtn.parentElement.querySelectorAll('.pill-tab');
  tabs.forEach(t => t.classList.remove('active'));
  clickedBtn.classList.add('active');
  // Salva il tab attivo per ripristinarlo al ricaricamento
  sessionStorage.setItem('htl_login_tab', showId === 'signup-inner' ? 'signup' : 'login');
}

function goToLogin() { sessionStorage.setItem('htl_login_tab', 'login'); goTo('page-login'); }
function goToRegister() {
  sessionStorage.setItem('htl_login_tab', 'signup');
  // Se page-login è nel documento corrente, naviga in-page; altrimenti vai ad access.html
  if (document.getElementById('page-login')) {
    const mode = _getLoaderMode();
    const delay = (mode === 'detail') ? 350 : 80;
    showLoader();
    setTimeout(() => {
      _applyPageChange('page-login');
      const loginInner  = document.getElementById('login-inner');
      const signupInner = document.getElementById('signup-inner');
      if (loginInner)  { loginInner.style.display = 'none'; }
      if (signupInner) { signupInner.style.display = 'flex'; signupInner.style.flexDirection = 'column'; }
      const tabs = document.querySelectorAll('#page-login .pill-tab');
      if (tabs.length >= 2) { tabs[0].classList.remove('active'); tabs[1].classList.add('active'); }
      hideLoader();
    }, delay);
  } else {
    window.location.href = 'access.html';
  }
}

// ================================================================
// CALL ENGINE
// ================================================================
let activeCallId       = null;
let activeCallPeer     = null;
let callRole           = null;
let outgoingCallId     = null;
let incomingCallData   = null;
const callParticipantsMap = {};

let incomingPollInterval   = null;
let callStatusPollInterval = null;
let chatPollInterval       = null;
let lastChatMsgId          = 0;
let _callTranscriptLog     = []; // registro in memoria della chat di chiamata

function startIncomingCallPoller() {
  stopIncomingCallPoller();
  incomingPollInterval = setInterval(pollIncomingCalls, 3000);
}
function stopIncomingCallPoller() { clearInterval(incomingPollInterval); }

async function pollIncomingCalls() {
  if (!currentUser?.id) return;
  if (activeCallId || outgoingCallId) return;

  const { data } = await apiGet(API.calls, { action: 'poll_incoming' });

  // Scarta risposte invalide: nessuna chiamata, o riga orfana senza caller
  if (!data?.id || !data?.caller_id) {
    if (incomingCallData && !activeCallId) hideIncomingCallOverlay();
    return;
  }

  // Stessa chiamata già mostrata — non fare nulla
  if (incomingCallData && incomingCallData.callId === data.id) return;

  incomingCallData = {
    callId:         data.id,
    callerId:       data.caller_id,
    callerName:     ((data.realName || '') + ' ' + (data.surname || '')).trim() || 'Utente sconosciuto',
    callerInitials: initials(data.realName, data.surname),
    callerColor:    avatarColor(data.caller_id),
  };

  showIncomingCallOverlay(incomingCallData);
}

function showIncomingCallOverlay(data) {
  const overlay = document.getElementById('incoming-call-overlay');
  document.getElementById('incoming-caller-name').textContent = data.callerName;
  document.getElementById('incoming-caller-sub').textContent  = 'HandTrackLIS · Chiamata Diretta';
  const av = document.getElementById('incoming-caller-avatar');
  av.textContent = data.callerInitials;
  av.style.background = data.callerColor;
  overlay.style.display = 'block';
}

function hideIncomingCallOverlay() {
  document.getElementById('incoming-call-overlay').style.display = 'none';
  incomingCallData = null;
}

async function acceptIncomingCall() {
  if (!incomingCallData) return;
  const { callId, callerId, callerName, callerInitials, callerColor } = incomingCallData;

  await apiPost(API.calls, { action: 'accept', call_id: callId });

  hideIncomingCallOverlay();
  enterCall(callId, { id: callerId, name: callerName, initials: callerInitials, color: callerColor }, 'callee');
}

async function declineIncomingCall() {
  if (!incomingCallData) return;
  await apiPost(API.calls, { action: 'decline', call_id: incomingCallData.callId });
  hideIncomingCallOverlay();
  showToast('Chiamata rifiutata');
}

// Outgoing call
async function startCall(contactId, contactName, contactInitials) {
  if (!currentUser?.id) return showToast('Effettua il login per chiamare.');
  if (activeCallId)     return showToast('Sei già in una chiamata.');

  const av = document.getElementById('waiting-callee-avatar');
  if (av) { av.textContent = contactInitials; av.style.background = avatarColor(contactId); }
  const nm = document.getElementById('waiting-callee-name');
  if (nm) nm.textContent = contactName;

  goTo('page-waiting');

  // Sincronizza stato UI del bottone microfono in base alle impostazioni
  _syncWaitingMicButtonToSettings();

  // Avvia anteprima camera nella waiting room
  await startWaitingPreview();

  const { data, ok } = await apiPost(API.calls, {
    action:      'create',
    receiver_id: contactId,
  });

  if (!ok || !data?.id) {
    showToast('Errore nell\'avvio della chiamata.');
    goTo('page-dashboard');
    return;
  }

  outgoingCallId = data.id;

  let ticks = 0;
  callStatusPollInterval = setInterval(async () => {
    // Se outgoingCallId è già null (es. l'utente ha annullato) ferma subito il polling
    if (!outgoingCallId) { clearInterval(callStatusPollInterval); return; }

    ticks++;
    if (ticks > 20) {
      clearInterval(callStatusPollInterval);
      await apiPost(API.calls, { action: 'cancel', call_id: outgoingCallId });
      outgoingCallId = null;
      goTo('page-dashboard');
      showToast('Nessuna risposta.');
      return;
    }

    const { data: callRow } = await apiGet(API.calls, { action: 'status', call_id: outgoingCallId });
    if (!callRow) return;

    if (callRow.status_call === 'accepted') {
      clearInterval(callStatusPollInterval);
      const cid = outgoingCallId;
      outgoingCallId = null;
      enterCall(cid, { id: contactId, name: contactName, initials: contactInitials, color: avatarColor(contactId) }, 'caller');
    } else if (callRow.status_call === 'missed' || callRow.status_call === 'ended') {
      clearInterval(callStatusPollInterval);
      outgoingCallId = null;
      goTo('page-dashboard');
      showToast('Chiamata non risposta.');
    }
  }, 1500);
}

async function cancelOutgoingCall() {
  clearInterval(callStatusPollInterval);
  stopWaitingPreview();
  if (outgoingCallId) {
    await apiPost(API.calls, { action: 'cancel', call_id: outgoingCallId });
    outgoingCallId = null;
  }
  goTo('page-dashboard');
}

const callControls = { mic: true, cam: true };
const waitingControls = { mic: true, cam: true };

// ── Sincronizza il bottone microfono nella waiting room con le impostazioni ──
function _syncWaitingMicButtonToSettings() {
  const micAllowed = isMicEnabledInSettings();
  waitingControls.mic = micAllowed;
  callControls.mic    = micAllowed;

  const btn    = document.getElementById('btn-waiting-mic');
  const iconOn  = document.getElementById('icon-waiting-mic-on');
  const iconOff = document.getElementById('icon-waiting-mic-off');
  if (iconOn)  iconOn.style.display  = micAllowed ? '' : 'none';
  if (iconOff) iconOff.style.display = micAllowed ? 'none' : '';
  if (btn) {
    btn.classList.toggle('muted', !micAllowed);
    btn.title = micAllowed ? 'Microfono attivo' : 'Microfono disabilitato nelle impostazioni';
  }
}

// Toggle cam/mic nella waiting room
function toggleWaitingCam() {
  waitingControls.cam = !waitingControls.cam;
  const on = waitingControls.cam;
  const btn = document.getElementById('btn-waiting-cam');
  const iconOn  = document.getElementById('icon-waiting-cam-on');
  const iconOff = document.getElementById('icon-waiting-cam-off');
  if (iconOn)  iconOn.style.display  = on ? '' : 'none';
  if (iconOff) iconOff.style.display = on ? 'none' : '';
  if (btn) btn.classList.toggle('muted', !on);
  // Mostra/nasconde avatar quando la cam è spenta
  const avatarWrap = document.getElementById('waiting-cam-off-avatar');
  const avatarIni  = document.getElementById('waiting-cam-off-ini');
  if (avatarWrap) {
    avatarWrap.style.display = on ? 'none' : 'flex';
    if (!on && avatarIni && currentUser) {
      avatarIni.textContent = currentUser.initials || '?';
      avatarIni.style.background = avatarColor(currentUser.id);
    }
  }
  if (waitingPreviewStream) {
    waitingPreviewStream.getVideoTracks().forEach(t => { t.enabled = on; });
    const vPrev = document.getElementById('video-waiting-preview');
    const ph    = document.querySelector('#page-waiting .webcam-placeholder');
    if (vPrev) vPrev.style.display = on ? 'block' : 'none';
    if (ph)    ph.style.display    = 'none';
  }
  // Rifletti anche sullo stato callControls per quando la chiamata inizia
  callControls.cam = on;
}

function toggleWaitingMic() {
  // Se il microfono è disabilitato dalle impostazioni, mostra un avviso e non fare nulla
  if (!isMicEnabledInSettings()) {
    showToast('Microfono disabilitato nelle impostazioni. Abilitalo prima di usarlo.');
    return;
  }
  waitingControls.mic = !waitingControls.mic;
  const on = waitingControls.mic;
  const btn = document.getElementById('btn-waiting-mic');
  const iconOn  = document.getElementById('icon-waiting-mic-on');
  const iconOff = document.getElementById('icon-waiting-mic-off');
  if (iconOn)  iconOn.style.display  = on ? '' : 'none';
  if (iconOff) iconOff.style.display = on ? 'none' : '';
  if (btn) btn.classList.toggle('muted', !on);
  if (waitingPreviewStream) {
    waitingPreviewStream.getAudioTracks().forEach(t => { t.enabled = on; });
  }
  callControls.mic = on;
}

function toggleCallControl(type) {
  // Se il microfono è disabilitato dalle impostazioni, non si può attivare in chiamata
  if (type === 'mic' && !isMicEnabledInSettings()) {
    showToast('Microfono disabilitato nelle impostazioni.');
    return;
  }
  callControls[type] = !callControls[type];
  const on = callControls[type];
  // 'btn-mic' è duplicato nel DOM (pagina permessi) — usiamo ID univoci per la call
  const elPrefix = type === 'mic' ? 'call-mic' : type;
  const btn = document.getElementById('btn-' + elPrefix);
  const iconOn  = document.getElementById('icon-' + elPrefix + '-on');
  const iconOff = document.getElementById('icon-' + elPrefix + '-off');
  if (iconOn)  iconOn.style.display  = on ? '' : 'none';
  if (iconOff) iconOff.style.display = on ? 'none' : '';
  if (btn) btn.classList.toggle('muted', !on);
  const label = document.getElementById('label-' + elPrefix);
  if (label) {
    if (type === 'mic') label.textContent = on ? 'Microfono'  : 'Muto';
    if (type === 'cam') label.textContent = on ? 'Fotocamera' : 'Camera off';
  }
  if (localStream) {
    if (type === 'mic') {
      localStream.getAudioTracks().forEach(t => { t.enabled = on; });
    } else if (type === 'cam') {
      localStream.getVideoTracks().forEach(t => { t.enabled = on; });
      const vLocal = document.getElementById('video-local');
      const selfOff = document.getElementById('self-cam-off');
      if (vLocal)  vLocal.style.display  = on ? 'block' : 'none';
      if (selfOff) selfOff.style.display = on ? 'none'  : 'flex';
    }
  }
  // cam-off-badge sul remote card non serve più (è per la cam locale)
  // La call-remote-card è gestita da ontrack/stopWebRTC, non da qui
}

async function enterCall(callId, peer, role) {
  activeCallId   = callId;
  activeCallPeer = peer;
  callRole       = role;
  lastChatMsgId  = 0;
  _callTranscriptLog = [];

  // Popola sempre currentUser nel map
  Object.keys(callParticipantsMap).forEach(k => delete callParticipantsMap[k]);
  callParticipantsMap[currentUser.id] = {
    initials: currentUser.initials,
    color:    avatarColor(currentUser.id),
    name:     (currentUser.nome + ' ' + currentUser.cognome).trim(),
  };
  // Popola l'interlocutore noto (invitante o caller)
  callParticipantsMap[peer.id] = { initials: peer.initials, color: peer.color, name: peer.name };

  // FIX: carica tutti i partecipanti attivi già presenti in chiamata
  // in modo che i tile vengano creati con nome/iniziali corretti anche
  // per gli utenti entrati prima di noi (terzo, quarto partecipante ecc.)
  try {
    const { data: existingParticipants } = await apiGet(API.calls, {
      action: 'active_participants',
      call_id: callId,
    });
    if (existingParticipants && existingParticipants.length) {
      const unknownIds = existingParticipants
        .map(p => parseInt(p.user_id))
        .filter(pid => pid !== currentUser.id && !callParticipantsMap[pid]);

      await Promise.all(unknownIds.map(async uid => {
        try {
          const { data: uData, ok: uOk } = await apiGet(API.user, { action: 'get', id: uid });
          if (uOk && uData && uData.id) {
            callParticipantsMap[uid] = {
              initials: initials(uData.realname || uData.realName, uData.surname),
              color:    avatarColor(uid),
              name:     ((uData.realname || uData.realName || '') + ' ' + (uData.surname || '')).trim(),
            };
          } else {
            callParticipantsMap[uid] = { initials: 'U' + uid, color: avatarColor(uid), name: 'Utente ' + uid };
          }
        } catch {
          callParticipantsMap[uid] = { initials: 'U' + uid, color: avatarColor(uid), name: 'Utente ' + uid };
        }
      }));
    }
  } catch (e) {
    console.warn('enterCall: impossibile caricare partecipanti esistenti', e);
  }

  // Se il microfono è disabilitato dalle impostazioni, forza callControls.mic = false
  if (!isMicEnabledInSettings()) callControls.mic = false;

  // Rispetta lo stato cam/mic impostato nella waiting room (callControls già aggiornato da toggleWaiting*)
  // Nota: per il mic usiamo ID 'btn-call-mic' ecc. per evitare collisione con la pagina permessi
  ['mic','cam'].forEach(t => {
    const on = callControls[t];
    const elPrefix = t === 'mic' ? 'call-mic' : t;
    const btn = document.getElementById('btn-' + elPrefix);
    if (btn) btn.classList.toggle('muted', !on);
    const iconOn  = document.getElementById('icon-' + elPrefix + '-on');
    const iconOff = document.getElementById('icon-' + elPrefix + '-off');
    if (iconOn)  iconOn.style.display  = on ? '' : 'none';
    if (iconOff) iconOff.style.display = on ? 'none' : '';
  });
  const labelMic = document.getElementById('label-call-mic');
  const labelCam = document.getElementById('label-cam');
  if (labelMic) labelMic.textContent = callControls.mic ? 'Microfono'  : 'Muto';
  if (labelCam) labelCam.textContent = callControls.cam ? 'Fotocamera' : 'Camera off';

  // Pulisci il grid dei video remoti dalla chiamata precedente
  const remGrid = document.getElementById('remote-videos-grid');
  if (remGrid) remGrid.innerHTML = '';

  // La call-remote-card statica non è più usata nel layout multi-peer
  const remCard = document.getElementById('call-remote-card');
  if (remCard) remCard.style.display = 'none';

  const remoteAvEl = document.getElementById('call-remote-avatar');
  if (remoteAvEl) { remoteAvEl.textContent = peer.initials; remoteAvEl.style.background = peer.color; }
  const remoteNameEl = document.getElementById('call-remote-name');
  if (remoteNameEl) remoteNameEl.textContent = peer.name;
  const topbarName = document.getElementById('call-topbar-name');
  if (topbarName) topbarName.textContent = peer.name;
  const chatPeer = document.getElementById('chat-peer-name');
  if (chatPeer) chatPeer.textContent = peer.name;
  document.querySelectorAll('.call-local-name').forEach(el => {
    el.textContent = (currentUser.nome + ' ' + currentUser.cognome).trim() + ' (Tu)';
  });
  const selfAvEl = document.querySelector('.call-self-tile .avatar');
  if (selfAvEl) selfAvEl.textContent = currentUser.initials;

  const chatMsgs = document.getElementById('chat-msgs');
  if (chatMsgs) chatMsgs.innerHTML = `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:32px 16px;color:var(--text3);">
      <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.5'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/%3E%3C/svg%3E" style="width:36px;height:36px;opacity:0.2;">
      <div id="chat-empty-msg" style="font-size:13px;text-align:center;">Nessun messaggio ancora.<br>Inizia la conversazione!</div>
    </div>`;

  goTo('page-call');
  startCallTimer();
  startChatPoller();
  // Inizializza il self tile (PiP draggable)
  setTimeout(initSelfTile, 100);

  // Avvia WebRTC dopo aver mostrato la pagina
  startWebRTC(callId, role);
}

async function endActiveCall() {
  clearInterval(callStatusPollInterval);
  stopChatPoller();
  stopCallTimer();
  stopWebRTC(); // ferma stream e PeerConnection
  selfTileExitGrid(); // rimuovi self dal grid se presente

  if (activeCallId) {
    await apiPost(API.calls, { action: 'end', call_id: activeCallId });
  }

  // Raccogli la trascrizione chat prima di azzerare lo stato
  const transcript = collectChatTranscript();

  activeCallId = null; activeCallPeer = null; callRole = null;

  handlePostCallTranscript(transcript);
}

// Costruisce la trascrizione dal registro in memoria (non dal DOM)
function collectChatTranscript() {
  return _callTranscriptLog.map(e => `[${e.time}] ${e.sender}: ${e.content}`).join('\n');
}

let _pendingTranscript = '';

/**
 * Gestisce la trascrizione a fine chiamata.
 * Se "Salvataggio Automatico" è attivo nelle impostazioni, scarica
 * direttamente senza mostrare l'overlay di conferma.
 * Altrimenti mostra l'overlay come di consueto.
 */
function handlePostCallTranscript(transcript) {
  if (!transcript || !transcript.trim()) {
    goTo('page-dashboard');
    return;
  }
  const s = loadSettings();
  if (s.autoSave) {
    // Download immediato — nessun prompt
    _pendingTranscript = transcript;
    downloadTranscript();
  } else {
    showTranscriptOverlay(transcript);
  }
}

function showTranscriptOverlay(transcript) {
  _pendingTranscript = transcript;

  // Mostra anteprima
  const preview = document.getElementById('transcript-preview');
  if (preview) {
    const lines = transcript.split('\n');
    preview.textContent = lines.length > 12
      ? lines.slice(0, 12).join('\n') + `\n… (+${lines.length - 12} messaggi)`
      : transcript;
  }

  const overlay = document.getElementById('save-transcript-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.add('show');
  }
}

function closeTranscriptOverlay() {
  const overlay = document.getElementById('save-transcript-overlay');
  if (overlay) { overlay.style.display = 'none'; overlay.classList.remove('show'); }
  _pendingTranscript = '';
  goTo('page-dashboard');
}

async function downloadTranscript() {
  const text = _pendingTranscript;
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `trascrizione-chiamata-${ts}`;
  _downloadBlob(new Blob([text], { type: 'text/plain' }), filename + '.txt');
  closeTranscriptOverlay();
  showToast('Trascrizione salvata!');
}

function _downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ================================================================
// WEBRTC ENGINE — multi-peer
// ================================================================
let localStream          = null;
let waitingPreviewStream = null;
let signalPollTimer      = null;
let lastSignalSeq        = 0;

// peerConnections: { [peerId]: { pc: RTCPeerConnection, icePending: [] } }
const peerConnections = {};

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

// ── Anteprima camera nella waiting room ───────────────────────────
async function startWaitingPreview() {
  // Camera si avvia SOLO qui (waiting room) e in chiamata attiva — mai prima.
  // Il microfono viene incluso solo se abilitato nelle impostazioni.
  try {
    const micEnabled = isMicEnabledInSettings();
    const constraints = { video: true, audio: micEnabled };
    waitingPreviewStream = await navigator.mediaDevices.getUserMedia(constraints);
    // Rifletti subito lo stato del toggle waiting-room sul track audio
    if (!waitingControls.mic && waitingPreviewStream.getAudioTracks().length) {
      waitingPreviewStream.getAudioTracks().forEach(t => { t.enabled = false; });
    }
    const vPrev = document.getElementById('video-waiting-preview');
    const placeholder = document.querySelector('#page-waiting .webcam-placeholder');
    if (vPrev) { vPrev.srcObject = waitingPreviewStream; vPrev.style.display = 'block'; }
    if (placeholder) placeholder.style.display = 'none';
  } catch (err) {
    console.warn('Waiting preview error:', err);
    // Se la cam fallisce (permesso negato ecc.) proviamo solo audio
    try {
      if (isMicEnabledInSettings()) {
        waitingPreviewStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      }
    } catch (_) { /* ignora */ }
  }
}

function stopWaitingPreview() {
  const vPrev = document.getElementById('video-waiting-preview');
  const placeholder = document.querySelector('#page-waiting .webcam-placeholder');
  if (vPrev) { vPrev.srcObject = null; vPrev.style.display = 'none'; }
  if (placeholder) placeholder.style.display = '';
}

// ── Crea/ottieni un tile video per un peer nella call stage ───────
function _ensureRemoteTile(peerId) {
  const grid = document.getElementById('remote-videos-grid');
  if (!grid) return null;
  const existingVideo = document.getElementById('video-remote-' + peerId);
  if (existingVideo) return existingVideo;

  const peer  = callParticipantsMap[peerId] || {};
  const name  = peer.name     || ('Utente ' + peerId);
  const init  = peer.initials || '?';
  const color = peer.color    || avatarColor(peerId);

  const tile = document.createElement('div');
  tile.id = 'tile-remote-' + peerId;
  tile.className = 'remote-video-tile';
  tile.innerHTML = `
    <video id="video-remote-${peerId}" autoplay playsinline
      style="width:100%;height:100%;object-fit:cover;background:#0d1117;display:none;"></video>
    <div id="card-remote-${peerId}" class="call-remote-card" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
      <div id="av-remote-${peerId}" class="avatar" style="width:72px;height:72px;font-size:26px;background:${color};box-shadow:0 0 0 4px rgba(255,255,255,0.08);">${init}</div>
      <div id="name-remote-${peerId}" style="font-size:15px;font-weight:700;color:#e2e8f0;margin-top:12px;font-family:'Syne',sans-serif;">${escapeHtml(name)}</div>
    </div>
    <div id="label-remote-${peerId}" style="position:absolute;bottom:6px;left:0;right:0;text-align:center;font-size:10px;padding:2px 6px;background:rgba(0,0,0,0.55);color:#e2e8f0;pointer-events:none;">${escapeHtml(name)}</div>`;
  grid.appendChild(tile);
  _updateGridLayout();
  return document.getElementById('video-remote-' + peerId);
}

function _removeRemoteTile(peerId) {
  const tile = document.getElementById('tile-remote-' + peerId);
  if (tile) tile.remove();
  _updateGridLayout();
}

function _updateGridLayout() {
  const grid = document.getElementById('remote-videos-grid');
  if (!grid) return;
  const count = grid.querySelectorAll('.remote-video-tile').length;
  grid.setAttribute('data-peers', count);

  grid.querySelectorAll('.remote-video-tile video').forEach(v => {
    if (count === 2) {
      // Override the hardcoded inline width/height/object-fit so the video
      // can shrink to its natural aspect ratio inside the flex-centered tile.
      v.style.width      = 'auto';
      v.style.height     = 'auto';
      v.style.maxWidth   = '100%';
      v.style.maxHeight  = '100%';
      v.style.objectFit  = 'contain';
    } else {
      // All other layouts: restore full-tile fill.
      v.style.width      = '100%';
      v.style.height     = '100%';
      v.style.maxWidth   = '';
      v.style.maxHeight  = '';
      v.style.objectFit  = 'contain';
      v.style.aspectRatio = '';
    }
  });
}

// ── Crea una RTCPeerConnection verso un peer specifico ────────────
function _createPeerConnection(peerId, callId) {
  if (peerConnections[peerId]) return peerConnections[peerId].pc;

  const pc = new RTCPeerConnection(RTC_CONFIG);
  peerConnections[peerId] = { pc, icePending: [] };

  // Aggiungi i track locali
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // Track remoto → tile video
  pc.ontrack = (event) => {
    const remoteStream = event.streams?.[0];
    if (!remoteStream) return;
    const vEl = _ensureRemoteTile(peerId);
    if (!vEl) return;
    if (!vEl.srcObject || vEl.srcObject.id !== remoteStream.id) {
      vEl.srcObject = remoteStream;
    }
    vEl.style.display = 'block';
    const card = document.getElementById('card-remote-' + peerId);
    if (card) card.style.display = 'none';
    vEl.play().catch(() => {});

    // Mostra avatar quando la telecamera remota viene disattivata
    const videoTrack = remoteStream.getVideoTracks()[0];
    if (videoTrack) {
      const _updateRemoteCamState = () => {
        const camOff = !videoTrack.enabled || videoTrack.muted || videoTrack.readyState === 'ended';
        if (vEl) vEl.style.display = camOff ? 'none' : 'block';
        const c = document.getElementById('card-remote-' + peerId);
        if (c) c.style.display = camOff ? 'flex' : 'none';
      };
      videoTrack.addEventListener('mute',   _updateRemoteCamState);
      videoTrack.addEventListener('unmute', _updateRemoteCamState);
      videoTrack.addEventListener('ended',  _updateRemoteCamState);
    }

    // Re-apply layout styles now that this video is live (peer count may
    // have just reached 2, so inline overrides need to be set immediately).
    _updateGridLayout();

    // Store the native aspect-ratio as an inline style once dimensions are
    // known — this lets the browser correctly size the video in 2-peer mode.
    const _applyAspectRatio = () => {
      if (vEl.videoWidth && vEl.videoHeight) {
        vEl.style.aspectRatio = `${vEl.videoWidth} / ${vEl.videoHeight}`;
      }
    };
    if (vEl.videoWidth) {
      _applyAspectRatio();
    } else {
      vEl.addEventListener('loadedmetadata', _applyAspectRatio, { once: true });
    }
  };

  // ICE candidate → segnala includendo targetId nel payload
  pc.onicecandidate = async ({ candidate }) => {
    if (candidate && callId) {
      await apiPost(API.signal, {
        action:  'send',
        call_id: callId,
        type:    'ice',
        payload: JSON.stringify({ ...candidate.toJSON(), targetId: peerId, senderId: currentUser.id }),
      });
    }
  };

  // Disconnect → rimuovi tile solo su stati terminali definitivi
  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === 'closed') {
      _removeRemoteTile(peerId);
      delete peerConnections[peerId];
    } else if (state === 'failed') {
      // 'failed' è definitivo ma proviamo prima un ICE restart
      if (pc.signalingState === 'stable') {
        pc.restartIce();
      } else {
        _removeRemoteTile(peerId);
        delete peerConnections[peerId];
      }
    }
    // 'disconnected' è transitorio (es. cambio di rete, rinegoziazione) — non rimuovere
  };

  return pc;
}

// ── Avvia WebRTC (ingresso in chiamata) ───────────────────────────
async function startWebRTC(callId, role) {
  try {
    // Riutilizza lo stream della waiting room se disponibile
    if (waitingPreviewStream && waitingPreviewStream.active) {
      localStream = waitingPreviewStream;
      waitingPreviewStream = null;
      stopWaitingPreview();
    } else {
      // Fallback: richiedi cam + mic (rispettando il toggle microfono dalle impostazioni)
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: isMicEnabledInSettings() });
    }

    // Mostra video locale nel self-tile
    const vLocal  = document.getElementById('video-local');
    const selfOff = document.getElementById('self-cam-off');
    if (vLocal)  { vLocal.srcObject = localStream; vLocal.style.display = 'block'; }
    if (selfOff) selfOff.style.display = 'none';

    // Avvia il polling segnali
    lastSignalSeq = 0;
    signalPollTimer = setInterval(() => pollSignals(callId), 1000);

    // Politica offer unificata: per ogni coppia di peer, chi ha ID più alto
    // invia l'offer. Questo è deterministico e non produce mai glare.
    const allPeerIds = Object.keys(callParticipantsMap)
      .map(k => parseInt(k))
      .filter(pid => pid !== currentUser.id);

    console.log('[WebRTC] startWebRTC — myId:', currentUser.id, 'callId:', callId, 'role:', role, 'peers noti:', allPeerIds, 'callParticipantsMap:', JSON.stringify(callParticipantsMap));

    for (const peerId of allPeerIds) {
      _ensureRemoteTile(peerId);
      const pc = _createPeerConnection(peerId, callId);

      if (currentUser.id > peerId) {
        // Siamo noi a fare l'offer verso questo peer
        console.log('[WebRTC] invio offer a', peerId, '(myId > peerId)');
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await apiPost(API.signal, {
            action:  'send',
            call_id: callId,
            type:    'offer',
            payload: JSON.stringify({ ...offer, targetId: peerId, senderId: currentUser.id }),
          });
          console.log('[WebRTC] offer inviato a', peerId);
        } catch (e) { console.warn('startWebRTC offer error to', peerId, e); }
      } else {
        console.log('[WebRTC] aspetto offer da', peerId, '(peerId > myId)');
      }
    }

    // Segnala la propria presenza a tutti i peer già in chiamata.
    console.log('[WebRTC] invio presence, myId:', currentUser.id);
    await apiPost(API.signal, {
      action:  'send',
      call_id: callId,
      type:    'presence',
      payload: JSON.stringify({
        senderId:       currentUser.id,
        senderName:     ((currentUser.nome || '') + ' ' + (currentUser.cognome || '')).trim(),
        senderInitials: currentUser.initials,
      }),
    });
    console.log('[WebRTC] presence inviato');

  } catch (err) {
    console.error('WebRTC error:', err);
  }
}

// ── Connetti a un nuovo partecipante arrivato a metà chiamata ─────
async function connectToNewPeer(peerId, callId) {
  if (peerConnections[peerId] || peerId === currentUser.id) return;
  console.log('[WebRTC] connectToNewPeer — myId:', currentUser.id, 'peerId:', peerId);
  _ensureRemoteTile(peerId);
  const pc = _createPeerConnection(peerId, callId);

  // Stessa politica: chi ha ID più alto fa l'offer.
  // Garantisce che esattamente uno dei due lati invii l'offer, senza glare.
  if (currentUser.id > peerId) {
    console.log('[WebRTC] connectToNewPeer — invio offer a', peerId);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await apiPost(API.signal, {
        action:  'send',
        call_id: callId,
        type:    'offer',
        payload: JSON.stringify({ ...offer, targetId: peerId, senderId: currentUser.id }),
      });
      console.log('[WebRTC] connectToNewPeer — offer inviato a', peerId);
    } catch (e) { console.warn('connectToNewPeer offer error:', e); }
  } else {
    console.log('[WebRTC] connectToNewPeer — aspetto offer da', peerId, '(ha ID più alto)');
  }
}

// ── Polling segnali WebRTC ─────────────────────────────────────────
async function pollSignals(callId) {
  // Always poll while in an active call — peerConnections starts empty
  // until the offer/answer exchange completes, and the callee side in
  // particular has no entries yet when waiting to receive the first offer.
  if (!activeCallId) return;
  let result;
  try {
    result = await apiGet(API.signal, {
      action:  'recv',
      call_id: callId,
      after:   lastSignalSeq,
    });
  } catch (e) { return; }

  const { data } = result;
  if (!data?.signals) {
    if (data && !data.ok) console.warn('pollSignals error:', data.error);
    return;
  }
  if (!Array.isArray(data.signals)) return;

  for (const sig of data.signals) {
    lastSignalSeq = Math.max(lastSignalSeq, sig.id);
    try {
      const payload = JSON.parse(sig.payload);
      // targetId nel payload indica il destinatario dell'offer/answer;
      // senderId è chi ha inviato il segnale (ricavato dal record DB come sender_id, ma
      // non è nel payload — usiamo targetId per ricavare la controparte)
      const senderId = payload.senderId || null;

      if (sig.type === 'offer') {
        const offerSenderId = payload.senderId || _guessSenderFromOffer(payload);
        console.log('[WebRTC] offer ricevuto — da:', offerSenderId, 'myId:', currentUser.id, 'targetId:', payload.targetId);
        if (!offerSenderId || offerSenderId === currentUser.id) { console.log('[WebRTC] offer ignorato: sender è me stesso'); continue; }

        // Ignora offer non destinati a noi
        if (payload.targetId && payload.targetId !== currentUser.id) { console.log('[WebRTC] offer ignorato: targetId', payload.targetId, '!= myId', currentUser.id); continue; }

        // Con la politica "ID più alto fa l'offer", non ci può essere glare:
        // se riceviamo un offer, significa che il sender ha ID più alto di noi,
        // quindi siamo noi a dover rispondere. Ignoriamo offer da chi ha ID più basso
        // (non dovrebbero arrivare, ma per sicurezza).
        if (offerSenderId < currentUser.id) { console.log('[WebRTC] offer ignorato: sender ha ID più basso di me'); continue; }

        if (!peerConnections[offerSenderId]) {
          _ensureRemoteTile(offerSenderId);
          _createPeerConnection(offerSenderId, callId);
        }
        const entry = peerConnections[offerSenderId];
        const pc = entry.pc;

        // Se il PC è già in have-local-offer (non dovrebbe accadere con la policy),
        // lo ignoriamo per sicurezza.
        if (pc.signalingState === 'have-local-offer') { console.log('[WebRTC] offer ignorato: signalingState=have-local-offer'); continue; }

        const offerDesc = { type: payload.type, sdp: payload.sdp };
        await pc.setRemoteDescription(new RTCSessionDescription(offerDesc));
        console.log('[WebRTC] setRemoteDescription(offer) ok, applico', entry.icePending.length, 'ICE pending');
        for (const c of entry.icePending) {
          await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
        entry.icePending = [];

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await apiPost(API.signal, {
          action:  'send',
          call_id: callId,
          type:    'answer',
          payload: JSON.stringify({ ...answer, targetId: offerSenderId, senderId: currentUser.id }),
        });
        console.log('[WebRTC] answer inviato a', offerSenderId);

      } else if (sig.type === 'answer') {
        // L'answer è indirizzata a currentUser.id; il sender è payload.senderId
        const answerSenderId = payload.senderId;
        console.log('[WebRTC] answer ricevuto — da:', answerSenderId, 'myId:', currentUser.id, 'targetId:', payload.targetId, 'pc esiste:', !!peerConnections[answerSenderId]);

        // Ignora answer non destinati a noi
        if (payload.targetId && payload.targetId !== currentUser.id) { console.log('[WebRTC] answer ignorato: targetId', payload.targetId, '!= myId', currentUser.id); continue; }

        if (!answerSenderId || !peerConnections[answerSenderId]) continue;
        const pc = peerConnections[answerSenderId].pc;
        console.log('[WebRTC] answer signalingState:', pc.signalingState);
        if (pc.signalingState === 'have-local-offer') {
          const answerDesc = { type: payload.type, sdp: payload.sdp };
          await pc.setRemoteDescription(new RTCSessionDescription(answerDesc));
          const entry = peerConnections[answerSenderId];
          console.log('[WebRTC] setRemoteDescription(answer) ok, applico', entry.icePending.length, 'ICE pending');
          for (const c of entry.icePending) {
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
          }
          entry.icePending = [];
        }

      } else if (sig.type === 'presence') {
        // Un nuovo peer ha annunciato il proprio ingresso.
        const newPeerId      = payload.senderId;
        const newPeerName    = payload.senderName    || ('Utente ' + newPeerId);
        const newPeerInitials= payload.senderInitials|| ('U' + newPeerId);
        console.log('[WebRTC] presence ricevuto da', newPeerId, '— myId:', currentUser.id, 'già connesso:', !!peerConnections[newPeerId]);
        if (!newPeerId || newPeerId === currentUser.id) continue;

        // Aggiorna sempre callParticipantsMap con i dati ricevuti nel payload
        callParticipantsMap[newPeerId] = {
          name:     newPeerName,
          initials: newPeerInitials,
          color:    avatarColor(newPeerId),
        };

        // Aggiorna il tile se già esistente (caso: tile creato prima della presence)
        const nameEl  = document.getElementById('name-remote-'  + newPeerId);
        const avEl    = document.getElementById('av-remote-'    + newPeerId);
        const labelEl = document.getElementById('label-remote-' + newPeerId);
        if (nameEl)  nameEl.textContent  = newPeerName;
        if (labelEl) labelEl.textContent = newPeerName;
        if (avEl)    { avEl.textContent = newPeerInitials; avEl.style.background = avatarColor(newPeerId); }

        if (currentUser.id > newPeerId && !peerConnections[newPeerId]) {
          connectToNewPeer(newPeerId, callId);
        } else if (currentUser.id < newPeerId) {
          console.log('[WebRTC] presence da', newPeerId, '— aspetto offer (ha ID più alto)');
        }

        // Rispondi sempre con la propria presence così il nuovo peer conosce il nostro nome
        await apiPost(API.signal, {
          action:  'send',
          call_id: callId,
          type:    'presence',
          payload: JSON.stringify({
            senderId:       currentUser.id,
            senderName:     ((currentUser.nome || '') + ' ' + (currentUser.cognome || '')).trim(),
            senderInitials: currentUser.initials,
          }),
        });
      } else if (sig.type === 'ice') {
        const iceTarget = payload.targetId;
        // L'ICE ci riguarda se targetId === currentUser.id oppure non c'è targetId
        if (iceTarget && iceTarget !== currentUser.id) continue;
        if (!senderId || senderId === currentUser.id) continue;
        let entry = peerConnections[senderId];
        // FIX race condition: gli ICE candidate possono arrivare prima dell'offer
        // (i segnali vengono inviati quasi in parallelo). Se non abbiamo ancora
        // la PeerConnection per questo sender, la creiamo subito e mettiamo
        // il candidato in icePending invece di scartarlo silenziosamente.
        if (!entry) {
          _ensureRemoteTile(senderId);
          _createPeerConnection(senderId, callId);
          entry = peerConnections[senderId];
        }
        if (!entry) continue; // sicurezza extra
        const iceCandidate = { candidate: payload.candidate, sdpMid: payload.sdpMid, sdpMLineIndex: payload.sdpMLineIndex };
        if (!entry.pc.remoteDescription) {
          entry.icePending.push(iceCandidate);
        } else {
          await entry.pc.addIceCandidate(new RTCIceCandidate(iceCandidate)).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('Signal error [' + sig.type + ']:', e);
    }
  }
}

// Ricava l'ID del sender di un offer cercando tra i partecipanti noti
// (fallback se senderId non è nel payload — compatibilità con segnali vecchi)
function _guessSenderFromOffer(payload) {
  // Se activeCallPeer è l'unico peer noto, è quasi certamente lui
  if (activeCallPeer && !peerConnections[activeCallPeer.id]) return activeCallPeer.id;
  // Altrimenti cerca il primo peer noto senza connessione
  for (const [pid, entry] of Object.entries(peerConnections)) {
    if (!entry.pc.remoteDescription) return parseInt(pid);
  }
  return null;
}

function stopWebRTC() {
  clearInterval(signalPollTimer);
  signalPollTimer = null;

  if (waitingPreviewStream) {
    waitingPreviewStream.getTracks().forEach(t => t.stop());
    waitingPreviewStream = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  for (const peerId of Object.keys(peerConnections)) {
    peerConnections[peerId].pc.close();
    delete peerConnections[peerId];
  }

  const vLocal  = document.getElementById('video-local');
  const selfOff = document.getElementById('self-cam-off');
  const grid    = document.getElementById('remote-videos-grid');
  if (vLocal)  { vLocal.srcObject = null; vLocal.style.display = 'none'; }
  if (selfOff) selfOff.style.display = 'flex';
  if (grid)    grid.innerHTML = '';

  // Reset waiting room controls per la prossima chiamata
  callControls.mic = true; callControls.cam = true;
  waitingControls.mic = true; waitingControls.cam = true;
}

// ================================================================
// INVITE TO CALL
// ================================================================
let pendingCallInvite       = null;
let notificationPollInterval = null;

function startNotificationPoller() {
  stopNotificationPoller();
  notificationPollInterval = setInterval(pollCallInvites, 3000);
}
function stopNotificationPoller() { clearInterval(notificationPollInterval); }

async function pollCallInvites() {
  if (!currentUser?.id) { console.log('[invite] skip: no currentUser'); return; }
  if (activeCallId)     { console.log('[invite] skip: already in call', activeCallId); return; }
  if (outgoingCallId)   { console.log('[invite] skip: outgoing call', outgoingCallId); return; }

  const { data, ok, status } = await apiGet(API.notifications, {
    type:    'call_invite',
    unread:  '1',
  });

  //console.log('[invite] GET notifications →', { ok, status, data });

  if (!ok) {
    console.log('[invite] exit: ok=false');
    if (pendingCallInvite) hideCallInviteOverlay();
    return;
  }

  if (!data?.notifications?.length) {
    //console.log('[invite] exit: notifications vuoto o assente', data);
    if (pendingCallInvite) hideCallInviteOverlay();
    return;
  }

  const notif = data.notifications[0];
  console.log('[invite] notifica trovata →', notif);

  if (!notif?.id || !notif?.content) {
    console.log('[invite] exit: notif senza id o content');
    if (pendingCallInvite) hideCallInviteOverlay();
    return;
  }

  if (pendingCallInvite && pendingCallInvite.notificationId === notif.id) {
    console.log('[invite] skip: già mostrato id=', notif.id);
    return;
  }

  let payload;
  try { payload = JSON.parse(notif.content); } catch(e) { console.log('[invite] exit: JSON.parse fallito', e); return; }
  console.log('[invite] payload →', payload);

  if (!payload?.callId) { console.log('[invite] exit: callId mancante nel payload'); return; }

  const { data: callRow } = await apiGet(API.calls, { action: 'status', call_id: payload.callId });
  console.log('[invite] stato chiamata →', callRow);

  if (!callRow || callRow.status_call === 'ended' || callRow.status_call === 'missed') {
    console.log('[invite] exit: chiamata terminata/persa, mark_read');
    await apiPost(API.notifications, { action: 'mark_read', id: notif.id });
    pendingCallInvite = null;
    return;
  }

  console.log('[invite] ✅ mostro overlay');
  pendingCallInvite = {
    notificationId:  notif.id,
    callId:          payload.callId,
    inviterId:       payload.inviterId,
    inviterName:     payload.inviterName,
    inviterInitials: payload.inviterInitials,
  };
  showCallInviteOverlay(pendingCallInvite);
}

function showCallInviteOverlay(data) {
  const overlay = document.getElementById('call-invite-overlay');
  if (!overlay) return;
  document.getElementById('invite-caller-name').textContent = data.inviterName;
  const av = document.getElementById('invite-caller-avatar');
  av.textContent      = data.inviterInitials;
  av.style.background = avatarColor(data.inviterId);
  overlay.style.display = 'block';
}

function hideCallInviteOverlay() {
  const overlay = document.getElementById('call-invite-overlay');
  if (overlay) overlay.style.display = 'none';
  pendingCallInvite = null;
}

async function acceptCallInvite() {
  if (!pendingCallInvite) return;
  const { notificationId, callId, inviterId, inviterName, inviterInitials } = pendingCallInvite;

  await apiPost(API.notifications, { action: 'mark_read', id: notificationId });
  await apiPost(API.calls, { action: 'join', call_id: callId });

  hideCallInviteOverlay();
  enterCall(callId, {
    id: inviterId, name: inviterName, initials: inviterInitials, color: avatarColor(inviterId),
  }, 'callee');
}

async function declineCallInvite() {
  if (!pendingCallInvite) return;
  await apiPost(API.notifications, { action: 'mark_read', id: pendingCallInvite.notificationId });
  hideCallInviteOverlay();
  showToast('Invito rifiutato');
}

async function openInviteModal() {
  if (!activeCallId || !currentUser?.id) return;

  const existingModal = document.getElementById('invite-modal');
  if (existingModal) existingModal.remove();

  const { data: contacts } = await apiGet(API.contacts, { action: 'list' });
  if (!contacts || !contacts.length) { showToast('Nessun contatto da invitare.'); return; }

  const { data: participants } = await apiGet(API.calls, { action: 'active_participants', call_id: activeCallId });
  const inCallIds = new Set((participants || []).map(r => r.user_id));
  const available = contacts.filter(u => !inCallIds.has(u.id));

  const listHtml = !available.length
    ? '<div style="text-align:center;padding:32px;color:#64748b;font-size:13px;">Tutti i tuoi contatti sono già in chiamata</div>'
    : available.map(u => {
        const name  = (u.realName + ' ' + u.surname).trim();
        const init  = initials(u.realName, u.surname);
        const color = avatarColor(u.id);
        const online = u.status_user === 'online';
        return `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,0.04);margin-bottom:8px;">
            <div class="avatar" style="background:${color};width:40px;height:40px;font-size:14px;flex-shrink:0;">${init}</div>
            <div style="flex:1;">
              <div style="font-size:14px;font-weight:600;color:#e2e8f0;">${name}</div>
              <div style="font-size:11px;color:${online ? '#4ade80' : '#64748b'};">${online ? '● Online' : '● Offline'}</div>
            </div>
            <button class="btn btn-primary text-xs" onclick="inviteToCall(${u.id},'${name.replace(/'/g,"\\'")}','${init}',this)">Invita</button>
          </div>`;
      }).join('');

  const modal = document.createElement('div');
  modal.id = 'invite-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML = `
    <div style="background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:28px;max-width:420px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,0.5);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h3 style="font-family:'Syne',sans-serif;font-size:18px;font-weight:700;color:#e2e8f0;margin:0;">Invita alla Chiamata</h3>
        <button onclick="document.getElementById('invite-modal').remove()" style="background:rgba(255,255,255,0.08);border:none;border-radius:8px;width:32px;height:32px;cursor:pointer;color:#94a3b8;font-size:16px;display:flex;align-items:center;justify-content:center;">✕</button>
      </div>
      <div style="max-height:320px;overflow-y:auto;">${listHtml}</div>
    </div>`;
  document.body.appendChild(modal);
}

async function inviteToCall(contactId, contactName, contactInitials, btn) {
  if (!activeCallId || !currentUser?.id) return;
  btn.disabled = true; btn.textContent = 'Invio…';

  const { ok } = await apiPost(API.notifications, {
    action:            'create',
    user_id:           contactId,
    type_notification: 'call_invite',
    content: JSON.stringify({
      callId:          activeCallId,
      inviterId:       currentUser.id,
      inviterName:     (currentUser.nome + ' ' + currentUser.cognome).trim(),
      inviterInitials: currentUser.initials,
    }),
  });

  if (!ok) {
    btn.disabled = false; btn.textContent = 'Invita';
    showToast('Errore nell\'invio dell\'invito');
    return;
  }
  btn.textContent  = '✓ Inviato';
  btn.style.opacity = '0.6';
  showToast('Invito inviato a ' + contactName);
}

// ================================================================
// SELF TILE — click to expand, drag to corner, enter grid
// ================================================================
let _selfTileExpanded = false;
let _selfInGrid       = false;
let _selfGridTileId   = 'tile-self-in-grid';

// Angoli disponibili con le proprietà CSS corrispondenti
const CORNERS = {
  'bottom-right': { bottom: '96px', right: '16px', top: '',    left: '' },
  'bottom-left':  { bottom: '96px', left:  '16px', top: '',    right: '' },
  'top-right':    { top:    '16px', right: '16px', bottom: '', left: '' },
  'top-left':     { top:    '16px', left:  '16px', bottom: '', right: '' },
};

function _applySelfTileCorner(tile, corner) {
  const pos = CORNERS[corner] || CORNERS['bottom-right'];
  tile.style.bottom = pos.bottom;
  tile.style.right  = pos.right;
  tile.style.top    = pos.top;
  tile.style.left   = pos.left;
  tile.dataset.corner = corner;
}

function initSelfTile() {
  const tile = document.getElementById('call-self-tile');
  if (!tile) return;

  _selfTileExpanded = false;
  _selfInGrid       = false;
  tile.classList.remove('expanded', 'in-grid', 'dragging');
  _applySelfTileCorner(tile, 'bottom-right');

  // ── Click: espandi / riduci ──────────────────────────────────────
  tile.addEventListener('click', _onSelfTileClick);

  // ── Long-press / drag ───────────────────────────────────────────
  let dragActive    = false;
  let longPressTimer = null;
  let startX, startY, origLeft, origTop;

  tile.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.self-tile-grid-btn')) return; // pulsante griglia
    startX = e.clientX; startY = e.clientY;

    longPressTimer = setTimeout(() => {
      dragActive = true;
      tile.classList.add('dragging');
      tile.setPointerCapture(e.pointerId);

      // Converti posizione corrente in top/left assoluti per drag libero
      const rect = tile.getBoundingClientRect();
      const stageRect = tile.parentElement.getBoundingClientRect();
      origLeft = rect.left - stageRect.left;
      origTop  = rect.top  - stageRect.top;
      tile.style.left   = origLeft + 'px';
      tile.style.top    = origTop  + 'px';
      tile.style.right  = '';
      tile.style.bottom = '';
    }, 400); // 400ms = long press
  });

  tile.addEventListener('pointermove', (e) => {
    if (!dragActive) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    tile.style.left = (origLeft + dx) + 'px';
    tile.style.top  = (origTop  + dy) + 'px';
  });

  tile.addEventListener('pointerup', (e) => {
    clearTimeout(longPressTimer);
    if (!dragActive) return;
    dragActive = false;
    tile.classList.remove('dragging');

    // Snap all'angolo più vicino
    const stageRect = tile.parentElement.getBoundingClientRect();
    const tileRect  = tile.getBoundingClientRect();
    const cx = tileRect.left + tileRect.width / 2 - stageRect.left;
    const cy = tileRect.top  + tileRect.height / 2 - stageRect.top;
    const halfW = stageRect.width  / 2;
    const halfH = stageRect.height / 2;

    let corner;
    if (cx < halfW && cy < halfH)       corner = 'top-left';
    else if (cx >= halfW && cy < halfH) corner = 'top-right';
    else if (cx < halfW)                corner = 'bottom-left';
    else                                corner = 'bottom-right';

    tile.style.left = ''; tile.style.top = '';
    _applySelfTileCorner(tile, corner);
  });

  tile.addEventListener('pointercancel', () => {
    clearTimeout(longPressTimer);
    dragActive = false;
    tile.classList.remove('dragging');
  });
}

function _onSelfTileClick(e) {
  if (e.target.closest('.self-tile-grid-btn')) return;
  if (e.target.closest('.self-tile-drag-handle')) return;
  const tile = document.getElementById('call-self-tile');
  if (!tile) return;
  _selfTileExpanded = !_selfTileExpanded;
  tile.classList.toggle('expanded', _selfTileExpanded);
}

// Entra nella griglia: nasconde il PiP e aggiunge un tile nella griglia
function selfTileEnterGrid() {
  if (_selfInGrid) return;
  const tile  = document.getElementById('call-self-tile');
  const grid  = document.getElementById('remote-videos-grid');
  const vLocal = document.getElementById('video-local');
  if (!tile || !grid || !vLocal) return;

  _selfInGrid = true;
  tile.classList.add('in-grid');

  // Crea tile self nella griglia
  const selfTile = document.createElement('div');
  selfTile.id = _selfGridTileId;
  selfTile.className = 'remote-video-tile self-in-grid';

  const vid = document.createElement('video');
  vid.autoplay = true;
  vid.playsInline = true;
  vid.muted = true;
  vid.srcObject = localStream;
  vid.style.cssText = '';

  // Label "Tu"
  const label = document.createElement('div');
  label.style.cssText = 'position:absolute;bottom:4px;left:0;right:0;text-align:center;font-size:10px;padding:2px 6px;background:rgba(0,0,0,0.55);color:#e2e8f0;pointer-events:none;';
  label.textContent = 'Tu';

  // Pulsante per uscire dalla griglia
  const exitBtn = document.createElement('button');
  exitBtn.style.cssText = 'position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:6px;border:none;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transition:opacity 0.15s;z-index:2;padding:0;';
  exitBtn.title = 'Torna al PiP';
  exitBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" style="width:13px;height:13px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  exitBtn.onclick = selfTileExitGrid;
  selfTile.addEventListener('mouseenter', () => { exitBtn.style.opacity = '1'; });
  selfTile.addEventListener('mouseleave', () => { exitBtn.style.opacity = '0'; });

  selfTile.appendChild(vid);
  selfTile.appendChild(label);
  selfTile.appendChild(exitBtn);
  grid.appendChild(selfTile);

  // Aggiorna contatore peer nella griglia
  const currentPeers = parseInt(grid.dataset.peers || '0');
  grid.setAttribute('data-peers', currentPeers + 1);
}

// Esci dalla griglia: rimuove il tile self e ripristina il PiP
function selfTileExitGrid() {
  if (!_selfInGrid) return;
  const tile     = document.getElementById('call-self-tile');
  const grid     = document.getElementById('remote-videos-grid');
  const selfTile = document.getElementById(_selfGridTileId);
  if (!tile || !grid) return;

  _selfInGrid = false;
  tile.classList.remove('in-grid');

  if (selfTile) {
    // Ferma il video nel tile della griglia prima di rimuoverlo
    const vid = selfTile.querySelector('video');
    if (vid) { vid.srcObject = null; }
    selfTile.remove();
  }

  const currentPeers = parseInt(grid.dataset.peers || '1');
  grid.setAttribute('data-peers', Math.max(0, currentPeers - 1));
}

// ================================================================
// CALL TIMER
// ================================================================
let callTimerInterval = null;
let callSeconds = 0;
function startCallTimer() {
  callSeconds = 0; updateTimer();
  callTimerInterval = setInterval(() => { callSeconds++; updateTimer(); }, 1000);
}
function stopCallTimer() { clearInterval(callTimerInterval); }
function updateTimer() {
  const el = document.getElementById('call-timer');
  if (!el) return;
  const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
  const s = String(callSeconds % 60).padStart(2, '0');
  el.textContent = m + ':' + s;
}

// ================================================================
// CHAT — polling via PHP
// ================================================================
function startChatPoller() { stopChatPoller(); chatPollInterval = setInterval(pollChatMessages, 2000); }
function stopChatPoller()  { clearInterval(chatPollInterval); }

async function pollChatMessages() {
  if (!activeCallId || !currentUser?.id) return;

  // Controlla se l'altra parte ha chiuso la chiamata
  const { data: callRow } = await apiGet(API.calls, { action: 'status', call_id: activeCallId });
  if (callRow && callRow.status_call === 'ended') {
    stopChatPoller(); stopCallTimer();
    const transcript = collectChatTranscript();
    activeCallId = null; activeCallPeer = null; callRole = null;
    handlePostCallTranscript(transcript);
    showToast('La chiamata è stata terminata dall\'altro utente.');
    return;
  }

  // Controlla partecipanti attivi — rileva nuovi arrivati e avvia WebRTC verso di loro
  const { data: activeParticipants } = await apiGet(API.calls, { action: 'active_participants', call_id: activeCallId });
  if (activeParticipants && activeParticipants.length <= 1) {
    const transcript = collectChatTranscript();
    await endActiveCall();
    handlePostCallTranscript(transcript);
    showToast('La chiamata è terminata (tutti gli altri hanno lasciato).');
    return;
  }
  if (activeParticipants) {
    // Rileva chi è uscito: chiudi PC e rimuovi tile per i peer non più presenti
    const activePidSet = new Set(activeParticipants.map(p => parseInt(p.user_id)));
    for (const peerId of Object.keys(peerConnections)) {
      const pid = parseInt(peerId);
      if (!activePidSet.has(pid)) {
        console.log("[WebRTC] peer", pid, "uscito dalla chiamata — chiudo connessione");
        peerConnections[pid].pc.close();
        delete peerConnections[pid];
        _removeRemoteTile(pid);
        delete callParticipantsMap[pid];
      }
    }

    for (const p of activeParticipants) {
      const pid = parseInt(p.user_id);
      if (pid === currentUser.id) continue;

      // FIX: aggiorna callParticipantsMap se l'endpoint restituisce dati reali,
      // anche se il peer era già presente con un fallback "Utente X".
      const alreadyReal = callParticipantsMap[pid] && !callParticipantsMap[pid].name.startsWith('Utente ');
      if (!alreadyReal && p.realName) {
        callParticipantsMap[pid] = {
          initials: initials(p.realName, p.surname),
          color:    avatarColor(pid),
          name:     (p.realName + ' ' + (p.surname || '')).trim(),
        };
        // Aggiorna i tile già nel DOM se erano stati creati col nome fallback
        const nameEl  = document.querySelector(`#tile-remote-${pid} div[style*="font-size:15px"]`);
        const avEl    = document.querySelector(`#tile-remote-${pid} .avatar`);
        const labelEl = document.querySelector(`#tile-remote-${pid} div[style*="font-size:10px"]`);
        const pp = callParticipantsMap[pid];
        if (nameEl)  nameEl.textContent  = pp.name;
        if (avEl)    { avEl.textContent = pp.initials; avEl.style.background = pp.color; }
        if (labelEl) labelEl.textContent = pp.name;
      } else if (!callParticipantsMap[pid] && !p.realName) {
        // Se l'endpoint non restituisce dati anagrafici, fai un fetch puntuale
        apiGet(API.user, { action: 'get', id: pid }).then(({ data: uData, ok: uOk }) => {
          if (uOk && uData && uData.id) {
            callParticipantsMap[pid] = {
              initials: initials(uData.realname || uData.realName, uData.surname),
              color:    avatarColor(pid),
              name:     ((uData.realname || uData.realName || '') + ' ' + (uData.surname || '')).trim(),
            };
            const nameEl  = document.querySelector(`#tile-remote-${pid} div[style*="font-size:15px"]`);
            const avEl    = document.querySelector(`#tile-remote-${pid} .avatar`);
            const labelEl = document.querySelector(`#tile-remote-${pid} div[style*="font-size:10px"]`);
            const pp = callParticipantsMap[pid];
            if (nameEl)  nameEl.textContent  = pp.name;
            if (avEl)    { avEl.textContent = pp.initials; avEl.style.background = pp.color; }
            if (labelEl) labelEl.textContent = pp.name;
          }
        }).catch(() => {});
      }

      // Connetti via WebRTC se è un nuovo partecipante
      if (!peerConnections[pid]) {
        connectToNewPeer(pid, activeCallId);
      }
    }
  }

  // Messaggi nuovi
  const params = { call_id: activeCallId };
  if (lastChatMsgId) params.after_id = lastChatMsgId;
  const { data, ok } = await apiGet(API.messages, params);
  if (!ok || !data || !data.length) return;

  // Risolvi utenti sconosciuti con una fetch reale a api/user.php
  const unknownIds = [...new Set(data.map(m => m.sender_id))]
    .filter(id => id !== currentUser.id && !callParticipantsMap[id]);

  if (unknownIds.length) {
    await Promise.all(unknownIds.map(async uid => {
      try {
        const { data: uData, ok: uOk } = await apiGet(API.user, { action: 'get', id: uid });
        if (uOk && uData && uData.id) {
          callParticipantsMap[uid] = {
            initials: initials(uData.realname || uData.realName, uData.surname),
            color:    avatarColor(uid),
            name:     ((uData.realname || uData.realName || '') + ' ' + (uData.surname || '')).trim(),
          };
          // Aggiorna eventuali tile video già presenti con nome/iniziali corretti
          const nameEl = document.querySelector(`#tile-remote-${uid} div[style*="font-size:15px"]`);
          const avEl   = document.querySelector(`#tile-remote-${uid} .avatar`);
          const labelEl = document.querySelector(`#tile-remote-${uid} div[style*="font-size:10px"]`);
          const p = callParticipantsMap[uid];
          if (nameEl)  nameEl.textContent  = p.name;
          if (avEl)    { avEl.textContent = p.initials; avEl.style.background = p.color; }
          if (labelEl) labelEl.textContent = p.name;
        } else {
          // Fallback: iniziali derivate dall'ID
          callParticipantsMap[uid] = {
            initials: 'U' + uid,
            color:    avatarColor(uid),
            name:     'Utente ' + uid,
          };
        }
      } catch {
        callParticipantsMap[uid] = { initials: 'U' + uid, color: avatarColor(uid), name: 'Utente ' + uid };
      }
    }));
  }

  const chatMsgs = document.getElementById('chat-msgs');
  if (!chatMsgs) return;

  const emptyWrapper = chatMsgs.querySelector('div:has(#chat-empty-msg)');
  if (emptyWrapper) emptyWrapper.remove();
  const legacyEmpty = document.getElementById('chat-empty-msg');
  if (legacyEmpty) legacyEmpty.closest('div')?.remove();

  data.forEach(msg => {
    if (msg.id > lastChatMsgId) lastChatMsgId = msg.id;
    const isOwn  = msg.sender_id === currentUser.id;
    const sender = callParticipantsMap[msg.sender_id];
    const time   = new Date(msg.sent_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

    // ── Registro in memoria per la trascrizione ──────────────────
    const senderName = isOwn
      ? ((currentUser.nome || '') + ' ' + (currentUser.cognome || '')).trim() || currentUser.username || 'Tu'
      : (sender?.name || 'Utente ' + msg.sender_id);
    _callTranscriptLog.push({ time, sender: senderName, content: msg.content });
    // ─────────────────────────────────────────────────────────────

    const div = document.createElement('div');
    div.className = isOwn ? 'chat-msg-own' : 'chat-msg-other';
    if (isOwn) {
      div.innerHTML = `
        <div>
          <div class="chat-bubble-own">${escapeHtml(msg.content)}</div>
          <div class="chat-time">${time}</div>
        </div>
        <div class="avatar" style="width:28px;height:28px;font-size:11px;flex-shrink:0;">${currentUser.initials}</div>`;
    } else {
      const sAvatar   = sender?.initials || '?';
      const sColor    = sender?.color    || '#059669';
      const sName     = sender?.name     || '';
      const nameLabel = sName ? `<div style="font-size:10px;color:var(--text3);margin-bottom:2px;">${escapeHtml(sName)}</div>` : '';
      div.innerHTML = `
        <div class="avatar" style="width:28px;height:28px;font-size:11px;flex-shrink:0;background:${sColor};" title="${escapeHtml(sName)}">${sAvatar}</div>
        <div>
          ${nameLabel}
          <div class="chat-bubble-other">${escapeHtml(msg.content)}</div>
          <div class="chat-time-other">${time}</div>
        </div>`;
    }
    chatMsgs.appendChild(div);
  });

  const listEl = document.getElementById('chat-messages-list');
  if (listEl) listEl.scrollTop = listEl.scrollHeight;
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  if (!input || !activeCallId || !currentUser?.id) return;
  const content = input.value.trim();
  if (!content) return;

  // ── Controllo parole bannate ──────────────────────────────────
  const bannedWords = await getBannedWords();
  const foundWord = containsBannedWord(content, bannedWords);
  if (foundWord) {
    // Mostra feedback visivo sull'input senza svuotarlo
    input.style.borderColor = 'var(--red)';
    input.style.background  = 'rgba(220,38,38,0.07)';
    showToast('⚠️ Messaggio non inviato: contiene una parola non consentita.');
    setTimeout(() => {
      input.style.borderColor = '';
      input.style.background  = '';
    }, 2500);
    return;
  }
  // ─────────────────────────────────────────────────────────────

  input.value = '';
  input.focus();

  const { ok } = await apiPost(API.messages, {
    receiver_id: activeCallPeer?.id || null,
    call_id:     activeCallId,
    content,
  });

  if (!ok) {
    showToast('Errore nell\'invio del messaggio.');
    input.value = content;
    return;
  }
  await pollChatMessages();
}

function escapeHtml(str) {
  return str
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function switchCallTab(tab) { /* chat sempre visibile */ }

// ================================================================
// PROFILE PAGE
// ================================================================
function populateProfilePage() {
  if (!currentUser) return;
  const { initials: init, nome, cognome, username, email } = currentUser;

  const avatar = document.getElementById('profile-avatar');
  if (avatar) avatar.textContent = init;
  const fullname = document.getElementById('profile-fullname');
  if (fullname) fullname.textContent = (nome + ' ' + cognome).trim();
  const usernameDisplay = document.getElementById('profile-username');
  if (usernameDisplay) usernameDisplay.textContent = '@' + username;
  const emailDisplay = document.getElementById('profile-email-display');
  if (emailDisplay) emailDisplay.textContent = email;

  const rnInput = document.getElementById('profile-realname');
  if (rnInput) rnInput.value = nome;
  const snInput = document.getElementById('profile-surname');
  if (snInput) snInput.value = cognome;
  const unInput = document.getElementById('profile-username-input');
  if (unInput) unInput.value = username;

  ['profile-pw-old','profile-pw-new','profile-pw-conf'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  clearFormError(document.getElementById('profile-info-error'));
  clearFormError(document.getElementById('profile-pw-error'));
  // Mostra/nascondi il banner basandosi sul dato che arriva dal server
  updateDeleteAccountBanner(currentUser.scheduled_deletion_at || null);
}

async function saveProfileInfo() {
  const errEl    = document.getElementById('profile-info-error');
  const realName = document.getElementById('profile-realname').value.trim();
  const surname  = document.getElementById('profile-surname').value.trim();
  const username = document.getElementById('profile-username-input').value.trim();

  if (!realName || !surname || !username)
    return showFormError(errEl, 'Compila tutti i campi.');
  if (!currentUser)
    return showFormError(errEl, 'Sessione scaduta. Accedi di nuovo.');

  const btn = document.querySelector('#page-profile .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }

  const { data, ok } = await apiPost(API.user, {
    action:   'update_profile',
    realname: realName,
    surname,
    username,
  });

  if (btn) { btn.disabled = false; btn.innerHTML = `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2'%3E%3Cpath d='M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z'/%3E%3Cpolyline points='17 21 17 13 7 13 7 21'/%3E%3Cpolyline points='7 3 7 8 15 8'/%3E%3C/svg%3E" style="width:14px;height:14px;" alt=""> Salva Modifiche`; }

  if (!ok) {
    return showFormError(errEl, data.error || 'Errore durante il salvataggio. Riprova.');
  }

  clearFormError(errEl);
  currentUser.nome     = realName;
  currentUser.cognome  = surname;
  currentUser.username = username;
  currentUser.initials = (realName[0] + surname[0]).toUpperCase();
  saveSession(currentUser);
  updateNavUser(currentUser);
  populateProfilePage();
  showToast('Profilo aggiornato con successo!');
}

async function saveProfilePassword() {
  const errEl  = document.getElementById('profile-pw-error');
  const oldPw  = document.getElementById('profile-pw-old').value;
  const newPw  = document.getElementById('profile-pw-new').value;
  const confPw = document.getElementById('profile-pw-conf').value;

  if (!oldPw || !newPw || !confPw)
    return showFormError(errEl, 'Compila tutti i campi.');
  if (newPw.length < 8)
    return showFormError(errEl, 'La nuova password deve essere di almeno 8 caratteri.');
  if (newPw !== confPw)
    return showFormError(errEl, 'Le nuove password non corrispondono.');
  if (!currentUser)
    return showFormError(errEl, 'Sessione scaduta. Accedi di nuovo.');

  const btn = [...document.querySelectorAll('#page-profile .btn-primary')].find(b => b.textContent.includes('Aggiorna'));
  if (btn) { btn.disabled = true; btn.textContent = 'Verifica…'; }

  const { data, ok } = await apiPost(API.user, {
    action:       'change_password',
    old_password: oldPw,
    new_password: newPw,
  });

  if (btn) { btn.disabled = false; btn.innerHTML = `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2'%3E%3Crect x='5' y='11' width='14' height='10' rx='2'/%3E%3Cpath d='M8 11V7a4 4 0 0 1 8 0v4'/%3E%3C/svg%3E" style="width:14px;height:14px;" alt=""> Aggiorna Password`; }

  if (!ok) return showFormError(errEl, data.error || 'Errore durante l\'aggiornamento. Riprova.');

  clearFormError(errEl);
  ['profile-pw-old','profile-pw-new','profile-pw-conf'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  showToast('Password aggiornata con successo!');
}

// ================================================================
// ELIMINA ACCOUNT (schedulato lato server dopo 7 giorni)
// ================================================================

function openDeleteAccountModal() {
  const modal = document.getElementById('delete-account-modal');
  if (!modal) return;
  const check = document.getElementById('delete-account-confirm-check');
  if (check) check.checked = false;
  const errEl = document.getElementById('delete-account-modal-error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  modal.style.display = 'flex';
}

function closeDeleteAccountModal() {
  const modal = document.getElementById('delete-account-modal');
  if (modal) modal.style.display = 'none';
}

async function confirmDeleteAccount() {
  const errEl = document.getElementById('delete-account-modal-error');
  const check = document.getElementById('delete-account-confirm-check');

  if (!check || !check.checked) {
    if (errEl) {
      errEl.textContent = 'Devi spuntare la casella di conferma per procedere.';
      errEl.style.display = 'block';
    }
    return;
  }
  if (!currentUser) {
    if (errEl) {
      errEl.textContent = 'Sessione scaduta. Accedi di nuovo.';
      errEl.style.display = 'block';
    }
    return;
  }

  const btn = document.getElementById('btn-confirm-delete-account');
  if (btn) { btn.disabled = true; btn.textContent = 'Elaborazione…'; }

  const { data, ok } = await apiPost(API.user, {
    action: 'schedule_delete',
  });

  if (!ok) {
    if (btn) { btn.disabled = false; btn.textContent = 'Conferma eliminazione'; }
    if (errEl) {
      errEl.textContent = data.error || 'Errore durante la richiesta. Riprova.';
      errEl.style.display = 'block';
    }
    return;
  }

  // Logout immediato: l'account è schedulato per l'eliminazione lato server
  closeDeleteAccountModal();
  clearSession();
  showToast('Account programmato per l\'eliminazione. Verrai disconnesso.');
  setTimeout(() => goTo('page-home'), 1800);
}

async function cancelDeleteAccount() {
  if (!currentUser) return;

  const { data, ok } = await apiPost(API.user, {
    action: 'cancel_delete',
  });

  if (!ok) {
    showToast(data.error || 'Impossibile annullare. Riprova.');
    return;
  }

  updateDeleteAccountBanner(null);
  showToast('Eliminazione account annullata.');
}

// Aggiorna il banner nella pagina profilo.
// Accetta la deletion_date come stringa ISO (passata dal server al login),
// oppure null per nascondere il banner.
function updateDeleteAccountBanner(deletionDateISO) {
  const banner = document.getElementById('delete-account-pending-banner');
  const btnDel = document.getElementById('btn-delete-account');
  const textEl = document.getElementById('delete-account-pending-text');
  if (!banner || !btnDel) return;

  if (!deletionDateISO) {
    banner.style.display = 'none';
    btnDel.style.display = 'flex';
    return;
  }

  const deletionDate = new Date(deletionDateISO);
  const now          = new Date();

  if (now >= deletionDate) {
    // Data già passata: mostra solo il banner, nascondi il pulsante annulla
    if (textEl) textEl.textContent = 'Il tuo account è in fase di eliminazione definitiva.';
    banner.style.display = 'block';
    btnDel.style.display = 'none';
    // Nascondi il pulsante "Annulla" dentro il banner
    const cancelBtn = banner.querySelector('button');
    if (cancelBtn) cancelBtn.style.display = 'none';
    return;
  }

  const msLeft    = deletionDate - now;
  const daysLeft  = Math.floor(msLeft / (1000 * 60 * 60 * 24));
  const hoursLeft = Math.floor((msLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const dateStr   = deletionDate.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr   = deletionDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  if (textEl) {
    textEl.textContent =
      `Il tuo account verrà eliminato il ${dateStr} alle ${timeStr} ` +
      `(tra ${daysLeft > 0 ? daysLeft + ' giorn' + (daysLeft === 1 ? 'o' : 'i') + ' e ' : ''}` +
      `${hoursLeft} or${hoursLeft === 1 ? 'a' : 'e'}). ` +
      `Puoi annullare l'operazione cliccando il pulsante qui sotto.`;
  }

  banner.style.display = 'block';
  btnDel.style.display = 'none';
  const cancelBtn = banner.querySelector('button');
  if (cancelBtn) cancelBtn.style.display = 'flex';
}

// ================================================================
// TOAST
// ================================================================
function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ================================================================
// INIT
// ================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Verifica sessione PHP lato server (async)
  const isLoggedIn = await loadSession();

  // Pagine accessibili solo se loggati
  const protectedPages = new Set([
    'page-dashboard', 'page-recents', 'page-add-contact',
    'page-call', 'page-permissions', 'page-waiting',
    'page-profile', 'page-settings'
  ]);

  const savedPage = sessionStorage.getItem('htl_current_page');

  if (isLoggedIn) {
    startIncomingCallPoller();
    startNotificationPoller();
    startAccountValidityCheck();
    startHeartbeat();
    // Se arrivo dall'Admin Panel con una destinazione specifica, usala
    const gotoPage = sessionStorage.getItem('htl_goto');
    if (gotoPage) {
      sessionStorage.removeItem('htl_goto');
      goTo(gotoPage);
    } else {
      // Ripristina la pagina in cui si trovava l'utente, altrimenti vai alla dashboard
      const pageToRestore = (savedPage && document.getElementById(savedPage)) ? savedPage : 'page-dashboard';
      goTo(pageToRestore);
    }
  } else {
    clearSession();
    // Utente non loggato: ripristina solo pagine pubbliche
    if (savedPage && !protectedPages.has(savedPage) && document.getElementById(savedPage)) {
      goTo(savedPage);
    }
    // Altrimenti rimane su page-home (già attiva nell'HTML)
  }
});

// ── Helper: microfono abilitato nelle impostazioni? ─────────────────
function isMicEnabledInSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('htl_settings'));
    return s && typeof s.micEnabled !== 'undefined' ? !!s.micEnabled : false;
  } catch(_) { return false; }
}

// ================================================================
// SETTINGS
// ================================================================
const SETTINGS_KEY = 'htl_settings';
const DEFAULT_SETTINGS = {
  subtitleSize: '16px', subtitlePos: 'panel', highContrast: false, confidence: false,
  langUI: 'it', langSub: 'it', darkMode: false, animations: true, statusBadge: true,
  autoSave: true, micEnabled: false   // off until explicitly granted
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    return Object.assign({}, DEFAULT_SETTINGS, saved || {});
  } catch(e) { return Object.assign({}, DEFAULT_SETTINGS); }
}
function persistSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

/**
 * Check the real browser mic permission state and, if it's 'denied' or 'prompt'
 * (i.e. never explicitly granted), force micEnabled=false in persisted settings.
 * This prevents the Settings toggle from appearing ON after login when the user
 * never actually approved the microphone.
 */
async function _syncMicPermissionToSettings() {
  try {
    if (!navigator.permissions) return;
    const status = await navigator.permissions.query({ name: 'microphone' });
    if (status.state !== 'granted') {
      const s = loadSettings();
      if (s.micEnabled) { s.micEnabled = false; persistSettings(s); }
    }
    // Re-apply settings so the toggle reflects the corrected value
    applySettings(loadSettings());
  } catch (_) {}
}

function applySettings(s) {
  const footerBtn = document.getElementById('drawer-footer-btn');
  const footerArrow = document.getElementById('drawer-footer-arr');
  if (s.darkMode) {
    document.body.classList.add('dark');
    const td = document.getElementById('toggle-dark'); if (td) td.classList.add('on');
    if (footerBtn) footerBtn.style.boxShadow = '0 4px 16px rgba(255, 255, 255, 0.15)';
    if (footerArrow) footerArrow.setAttribute('stroke', 'white');
  } else {
    document.body.classList.remove('dark');
    const td = document.getElementById('toggle-dark'); if (td) td.classList.remove('on');
    if (footerBtn) footerBtn.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.15)';
    if (footerArrow) footerArrow.setAttribute('stroke', 'black');
  }
  if (!s.animations) {
    document.body.style.setProperty('--transition', '0s');
    const loader = document.getElementById('page-loader');
    if (loader) { loader.classList.remove('loader-detail-mode'); loader.classList.add('loader-simple'); }
  } else {
    document.body.style.removeProperty('--transition');
    const loader = document.getElementById('page-loader');
    if (loader) { loader.classList.remove('loader-simple'); loader.classList.add('loader-detail-mode'); }
  }
  document.querySelectorAll('.badge-green.badge-dot').forEach(el => { el.style.display = s.statusBadge ? '' : 'none'; });
  document.querySelectorAll('.subtitle-text').forEach(el => { el.style.fontSize = s.subtitleSize; });
  document.querySelectorAll('.subtitle-entry').forEach(el => {
    if (s.highContrast) { el.style.background = 'rgba(0,0,0,0.75)'; el.style.borderRadius = '6px'; el.style.padding = '8px 12px'; }
    else { el.style.background = ''; el.style.borderRadius = ''; el.style.padding = ''; }
  });
  const confBadge = document.getElementById('confidence-badge');
  if (confBadge) confBadge.style.display = s.confidence ? '' : 'none';
  applyLangUI(s.langUI);
  _setSelectById('sel-subtitle-size', sizeToOption(s.subtitleSize));
  _setSelectById('sel-subtitle-pos',  posToOption(s.subtitlePos));
  _setSelectById('sel-lang-ui',       s.langUI === 'en' ? 'English' : 'Italiano');
  _setSelectById('sel-lang-sub',      s.langSub === 'en' ? 'English' : 'Italiano');
  _syncToggle('toggle-contrast',  s.highContrast);
  _syncToggle('toggle-confidence',s.confidence);
  _syncToggle('toggle-dark',      s.darkMode);
  _syncToggle('toggle-anim',      s.animations);
  _syncToggle('toggle-status',    s.statusBadge);
  _syncToggle('toggle-save',      s.autoSave);
  _syncToggle('toggle-mic-enabled', s.micEnabled);
}

function _syncToggle(id, on) { const el = document.getElementById(id); if (!el) return; if (on) el.classList.add('on'); else el.classList.remove('on'); }
function _setSelectById(id, value) {
  const el = document.getElementById(id); if (!el) return;
  for (let i = 0; i < el.options.length; i++) {
    if (el.options[i].value === value || el.options[i].text === value) { el.selectedIndex = i; return; }
  }
}

function sizeToOption(px) { return { '12px':'Piccolo (12px)', '16px':'Medio (16px)', '20px':'Grande (20px)', '24px':'Molto Grande (24px)' }[px] || 'Medio (16px)'; }
function optionToSize(opt) { return { 'Piccolo (12px)':'12px', 'Medio (16px)':'16px', 'Grande (20px)':'20px', 'Molto Grande (24px)':'24px' }[opt] || '16px'; }
function posToOption(key) { return { 'panel':'Pannello laterale', 'overlay':'Sovrapposto', 'bottom':'In basso' }[key] || 'Pannello laterale'; }
function optionToPos(opt) { return { 'Pannello laterale':'panel', 'Sovrapposto':'overlay', 'In basso':'bottom' }[opt] || 'panel'; }

function readSettingsFromUI() {
  const isOn = id => { const el = document.getElementById(id); return el ? el.classList.contains('on') : false; };
  const sizeSel = document.getElementById('sel-subtitle-size');
  const posSel  = document.getElementById('sel-subtitle-pos');
  const langUI  = document.getElementById('sel-lang-ui');
  const langSub = document.getElementById('sel-lang-sub');
  return {
    subtitleSize:  sizeSel ? optionToSize(sizeSel.value) : loadSettings().subtitleSize,
    subtitlePos:   posSel  ? optionToPos(posSel.value)   : loadSettings().subtitlePos,
    highContrast:  isOn('toggle-contrast'),
    confidence:    isOn('toggle-confidence'),
    langUI:        langUI  ? (langUI.value === 'English' ? 'en' : 'it')  : loadSettings().langUI,
    langSub:       langSub ? (langSub.value === 'English' ? 'en' : 'it') : loadSettings().langSub,
    darkMode:      isOn('toggle-dark'),
    animations:    isOn('toggle-anim'),
    statusBadge:   isOn('toggle-status'),
    autoSave:      isOn('toggle-save'),
    micEnabled:    isOn('toggle-mic-enabled'),
  };
}

function toggleBtn(btn) { btn.classList.toggle('on'); const s = readSettingsFromUI(); applySettings(s); }
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark');
  const td = document.getElementById('toggle-dark');
  const footerBtn = document.getElementById('drawer-footer-btn');
  const footerArrow = document.getElementById('drawer-footer-arr');
  if (td) {
    if (isDark) {
      td.classList.add('on');
      if (footerBtn) footerBtn.style.boxShadow = '0 4px 16px rgba(255, 255, 255, 0.15)';
      if (footerArrow) footerArrow.setAttribute('stroke', 'white');
    } else {
      td.classList.remove('on');
      if (footerBtn) footerBtn.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.15)';
      if (footerArrow) footerArrow.setAttribute('stroke', 'black');
    }
  }
  const s = loadSettings(); s.darkMode = isDark; persistSettings(s);
}
function onToggleMicEnabled(btn) {
  btn.classList.toggle('on');
  const s = readSettingsFromUI();
  persistSettings(s);
  // Se il microfono viene disabilitato mentre siamo in waiting room, ferma i track audio
  if (!s.micEnabled && waitingPreviewStream) {
    waitingPreviewStream.getAudioTracks().forEach(t => { t.stop(); });
  }
  // Se viene abilitato in waiting room, riavvia il preview per acquisire il mic
  if (s.micEnabled && waitingPreviewStream && waitingPreviewStream.active) {
    // Aggiunge audio allo stream esistente (getUserMedia separato e merge)
    navigator.mediaDevices.getUserMedia({ audio: true }).then(audioStream => {
      audioStream.getAudioTracks().forEach(track => {
        waitingPreviewStream.addTrack(track);
        track.enabled = waitingControls.mic;
      });
    }).catch(() => {});
  }
}

function saveSettings() { const s = readSettingsFromUI(); persistSettings(s); applySettings(s); showToast('Impostazioni salvate'); }

// ================================================================
// i18n
// ================================================================
const I18N = {
  it: {
    'nav.home': 'Home', 'nav.how': 'Come Funziona', 'nav.about': 'Chi Siamo',
    'nav.login': 'Accedi', 'nav.start': 'Inizia',
    'nav.contacts': 'Contatti', 'nav.recents': 'Chiamate Recenti',
    'nav.backHome': '← Torna alla Home', 'nav.backLogin': '← Torna al Login',
    'nav.connected': 'Connesso',
    'sidebar.navLabel': 'Navigazione', 'sidebar.accountLabel': 'Account',
    'sidebar.contacts': 'Contatti', 'sidebar.recents': 'Chiamate Recenti',
    'sidebar.addContact': 'Aggiungi Contatto', 'sidebar.profile': 'Profilo',
    'sidebar.settings': 'Impostazioni', 'sidebar.logout': 'Esci',
    'hero.tag': 'Italiano · LIS · Intelligenza Artificiale',
    'hero.sub': 'HandTrackLIS usa l\'IA per riconoscere i gesti della Lingua dei Segni Italiana e generare sottotitoli in diretta — rendendo la comunicazione video accessibile a tutti.',
    'hero.cta1': 'Inizia a Usare HandTrackLIS', 'hero.cta2': 'Come Funziona',
    'feat1.title': 'Riconoscimento Gesti LIS',
    'feat1.desc': 'Rilevamento in tempo reale dei gesti della Lingua dei Segni Italiana tramite MediaPipe e modelli IA addestrati su dataset LIS.',
    'feat2.title': 'Sottotitoli in Diretta',
    'feat2.desc': 'I gesti vengono convertiti istantaneamente in testo italiano mostrato su entrambi i lati della chiamata, senza ritardi.',
    'feat3.title': 'Comunicazione Accessibile',
    'feat3.desc': 'Progettato per la comunità sorda e ipoudente con dimensioni dei sottotitoli personalizzabili, contrasto e export trascrizioni.',
    'home.howTitle': 'Come Funziona HandTrackLIS', 'home.howSub': 'Un flusso continuo dal gesto alla conversazione.',
    'step.webcamDesc': 'Il browser accede alla webcam in modo sicuro', 'step.detection': 'Rilevamento',
    'step.detectionDesc': 'MediaPipe rileva i punti della mano in tempo reale', 'step.recognition': 'Riconoscimento LIS',
    'step.recognitionDesc': 'Il modello IA classifica i gesti nel vocabolario LIS', 'step.subtitleDesc': 'Il testo appare in diretta durante la chiamata',
    'home.learnMore': 'Approfondisci la Tecnologia',
    'stat.signs': 'Segni LIS nel modello', 'stat.latency': 'Latenza media sottotitoli',
    'stat.accuracy': 'Precisione riconoscimento', 'stat.browser': 'Browser-based, nessuna installazione',
    'login.title': 'Bentornato', 'login.sub': 'Accedi al tuo account HandTrackLIS',
    'login.tab': 'Accedi', 'login.tabSignup': 'Crea Account', 'login.btn': 'Accedi', 'login.btnSignup': 'Crea Account',
    'perm.title': 'Permessi Necessari',
    'perm.sub': 'La fotocamera è necessaria per usare HandTrackLIS. Microfono e tracciamento mano sono facoltativi.',
    'perm.camTitle': 'Accesso Fotocamera', 'perm.camDesc': 'Necessario per videochiamate e rilevamento gesti della mano.', 'perm.camBtn': 'Consenti Fotocamera',
    'perm.micTitle': 'Accesso Microfono', 'perm.micDesc': 'Abilita l\'audio durante le videochiamate.', 'perm.micBtn': 'Consenti Microfono',
    'perm.handTitle': 'Tracciamento Mano', 'perm.handDesc': 'Abilita il riconoscimento gesti LIS e la generazione di sottotitoli. Modificabile in qualsiasi momento dalle impostazioni.', 'perm.handBtn': 'Abilita Tracciamento',
    'perm.privacy': 'Tutta l\'elaborazione video avviene localmente nel browser. Nessun dato gestuale viene inviato ai nostri server.',
    'perm.continueBtn': 'Continua alla Dashboard', 'perm.warning': 'Concedi l\'accesso alla telecamera per continuare.',
    'dash.title': 'Contatti', 'dash.sub': 'La tua rete HandTrackLIS',
    'dash.statTotal': 'Contatti Totali', 'dash.statWeek': '+2 questa settimana',
    'dash.statOnline': 'Online Ora', 'dash.statAvail': 'Disponibili per chiamate',
    'recents.title': 'Chiamate Recenti', 'recents.sub': 'Cronologia chiamate con trascrizioni sottotitoli',
    'recents.history': 'Cronologia', 'recents.export': 'Esporta Trascrizioni',
    'addContact.title': 'Aggiungi Contatto', 'addContact.sub': 'Cerca utenti per email o nome utente',
    'addContact.searchTitle': 'Cerca Utenti', 'addContact.searchBtn': 'Cerca',
    'addContact.results': 'Risultati', 'addContact.resultsSub': 'Utenti HandTrackLIS trovati',
    'addContact.placeholder': 'Digita per cercare utenti',
    'addContact.suggested': 'Contatti Suggeriti', 'addContact.suggestedSub': 'Persone che potresti conoscere',
    'waiting.preview': 'Anteprima', 'waiting.camActive': 'Fotocamera attiva',
    'waiting.waitingMsg': 'In attesa di risposta…', 'waiting.cancel': 'Annulla Chiamata',
    'call.remoteStream': 'Stream video remoto', 'call.yourCamera': 'La tua camera',
    'call.tabSubs': 'Sottotitoli', 'call.tabChat': 'Chat Testo', 'call.liveTranscript': 'Trascrizione LIS in Diretta',
    'settings.title': 'Impostazioni', 'settings.sub': 'Personalizza la tua esperienza HandTrackLIS',
    'settings.subsTitle': 'Sottotitoli e Accessibilità',
    'settings.subSize': 'Dimensione Sottotitoli', 'settings.subSizeDesc': 'Adatta la dimensione del testo per una migliore leggibilità',
    'settings.subSizeSmall': 'Piccolo (12px)',
    'settings.subSizeMedium': 'Medio (16px)',
    'settings.subSizeBig': 'Grande (20px)',
    'settings.subSizeReallyBig': 'Molto Grande (24px)',
    'settings.subPos': 'Posizione Sottotitoli', 'settings.subPosDesc': 'Scegli dove vuoi vedere i sottotitoli durante la chiamata',
    'settings.subPosSidePanel':'Pannello Laterale',
    'settings.subPosOverlapping':'Sovrapposto',
    'settings.subPosBottom':'In basso',
    'settings.highContrast': 'Alto Contrasto Sottotitoli', 'settings.highContrastDesc': 'Rende il testo più facile da leggere aggiungendo uno sfondo scuro ai sottotitoli',
    'settings.confidence': 'Mostra Percentuale di Sicurezza', 'settings.confidenceDesc': 'Mostra quanto è sicuro il sistema di aver riconosciuto correttamente il gesto',
    'settings.langTitle': 'Lingua e Localizzazione',
    'settings.langUI': 'Lingua Interfaccia', 'settings.langUIDesc': 'La lingua usata per pulsanti, menu e messaggi dell\'app',
    'settings.langSub': 'Lingua Sottotitoli LIS', 'settings.langSubDesc': 'In che lingua vuoi leggere i sottotitoli generati durante la chiamata',
    'settings.appearTitle': 'Aspetto',
    'settings.darkMode': 'Modalità Scura', 'settings.darkModeDesc': 'Passa a uno sfondo scuro, più riposante per gli occhi in ambienti poco illuminati',
    'settings.animations': 'Animazioni Interfaccia', 'settings.animationsDesc': 'Abilita o disabilita le animazioni di apertura e chiusura delle schermate',
    'settings.statusBadge': 'Mostra Stato Online', 'settings.statusBadgeDesc': 'Mostra agli altri utenti quando sei online',
    'settings.transcriptTitle': 'Trascrizioni e Dati',
    'settings.autoSave': 'Salvataggio Automatico', 'settings.autoSaveDesc': 'Al termine di ogni chiamata, il testo dei sottotitoli viene salvato automaticamente sul tuo dispositivo',
    'settings.exportFmt': 'Formato di Esportazione', 'settings.exportFmtDesc': 'Scegli il formato del file quando scarichi i sottotitoli di una chiamata',
    'settings.save': 'Salva Impostazioni', 'settings.cancel': 'Annulla',
    'profile.title': 'Profilo', 'profile.sub': 'Gestisci le tue informazioni personali e la sicurezza dell\'account',
    'profile.personalInfo': 'Informazioni Personali', 'profile.saveInfo': 'Salva Modifiche',
    'profile.changePass': 'Cambia Password', 'profile.savePass': 'Aggiorna Password',
    'profile.dangerZone': 'Zona Account', 'profile.logoutDesc': 'Termina la sessione corrente su questo dispositivo.',
    'profile.logout': 'Esci dall\'Account',
    'forgot.title': 'Reimposta Password', 'forgot.sub': 'Inserisci la tua email e scegli una nuova password.', 'forgot.btn': 'Aggiorna Password',
    'how.title': 'Come Funziona HandTrackLIS',
    'how.sub': 'Dall\'immagine della fotocamera al testo sullo schermo, in meno di 200 millisecondi. Ecco il percorso completo.',
    'how.step1Title': 'Acquisizione Webcam', 'how.step2Title': 'Rilevamento Landmark della Mano',
    'how.step3Title': 'Classificazione Gesti LIS', 'how.step4Title': 'Generazione Sottotitoli in Diretta',
    'about.title': 'Chi Siamo', 'about.projectTitle': 'Il Progetto',
    'about.lisTitle': 'Perché la LIS è Importante', 'about.teamTitle': 'Il Nostro Team',
    'about.teamSub': 'Cinque studenti con una visione condivisa: rendere la comunicazione accessibile a tutti.',
    'about.sub': 'HandTrackLIS nasce dalla volontà di rendere la comunicazione in Lingua dei Segni Italiana accessibile a tutti, abbattendo le barriere tra udenti e non udenti attraverso la tecnologia.',
    'about.projectDesc': 'HandTrackLIS è una piattaforma di videochiamata che integra il riconoscimento automatico dei gesti della Lingua dei Segni Italiana (LIS) tramite intelligenza artificiale. L\'obiettivo è consentire comunicazioni fluide tra persone sorde, ipoudenti e udenti, eliminando la necessità di un interprete fisico.',
    'about.lisDesc': 'In Italia ci sono circa 80.000 persone sorde che utilizzano la LIS come lingua principale. Nonostante ciò, gli interpreti LIS sono pochi e il loro accesso è spesso limitato. HandTrackLIS vuole colmare questo divario, rendendo la comunicazione accessibile ovunque e in qualsiasi momento.',
    'team.role1': 'Project Manager', 'team.role2': 'Machine Learning & AI',
    'team.role3': 'Backend & Database', 'team.role4': 'Dataset & LIS Research',
    'team.role5': 'Testing & Accessibility',
    'nav.backHome2': 'Torna alla Home', 'nav.contacts2': 'Contatti',
    'footer.desc': 'Progetto open-source che unisce la LIS e la comunicazione video in tempo reale tramite IA.',
    'footer.platform': 'Piattaforma', 'footer.project': 'Progetto', 'footer.support': 'Supporto',
    'footer.register': 'Registrati', 'footer.research': 'Ricerca',
    'footer.accessibility': 'Accessibilità', 'footer.docs': 'Documentazione',
    'footer.location': 'Sede', 'footer.city': 'Genova, Italia',
    'footer.schoolProject': 'Progetto Scolastico 2026', 'footer.schoolProject2': 'Progetto Scolastico',
    'footer.madeWith': 'Fatto con passione per la comunità LIS',
    'call.incomingLabel': 'Chiamata in Entrata', 'call.directCall': 'HandTrackLIS · Chiamata Diretta',
    'call.inviteLabel': 'Invito Chiamata', 'call.invitesSub': 'ti invita a partecipare',
    'call.decline': 'Rifiuta', 'call.accept': 'Accetta', 'call.join': 'Partecipa',
    'call.you': 'Tu', 'call.trackingOn': 'Tracciamento ON',
    'call.inCallWith': 'In chiamata con', 'call.mic': 'Microfono',
    'call.camera': 'Fotocamera', 'call.end': 'Termina', 'call.invite': 'Invita',
    'call.chatEmpty': 'Nessun messaggio ancora.\nInizia la conversazione!',
    'call.chatPlaceholder': 'Scrivi un messaggio…',
    'waiting.calling': 'Chiamata in corso…', 'waiting.awaitingAnswer': 'In attesa che risponda',
    'how.technologyTag': 'Tecnologia',
    'how.pipelineTitle': 'Pipeline Tecnica Completa',
    'how.pipeWebcamDesc': '30 FPS acquisizione', 'how.pipeMediapipeDesc': '21 punti landmark',
    'how.pipeModelLabel': 'Modello IA', 'how.pipeModelDesc': 'Classificazione LIS',
    'how.pipeSubDesc': 'Testo in diretta',
    'step.webcam': 'Webcam', 'step.subtitles': 'Sottotitoli',
    'settings.micTitle': 'Permessi',
    'settings.micEnabled': 'Abilita Microfono nelle Chiamate',
    'settings.micEnabledDesc': 'Se attivo, l\'app userà il microfono durante le chiamate. Puoi comunque silenziarlo in qualsiasi momento anche mentre sei in chiamata.',
    'settings.handTracking': 'Tracciamento Mano',
    'settings.handTrackingBadge': 'Facoltativo',
    'settings.handTrackingDesc': 'Abilita il riconoscimento gesti LIS e la generazione di sottotitoli in tempo reale.',
    'form.firstName': 'Nome', 'form.lastName': 'Cognome', 'form.username': 'Username',
    'form.email': 'Indirizzo Email', 'form.confirmEmail': 'Conferma Indirizzo Email',
    'form.password': 'Password', 'form.confirmPassword': 'Conferma Password',
    'form.newPassword': 'Nuova Password', 'form.confirmNewPassword': 'Conferma Nuova Password',
    'form.currentPassword': 'Password Attuale',
    'login.forgotPassword': 'Password dimenticata?',
    'forgot.rememberPassword': 'Ricordi la password?', 'forgot.backToLogin': 'Torna al login',
    'profile.deleteDesc': 'Elimina definitivamente il tuo account e tutti i dati associati.',
    'profile.deletionScheduled': 'Eliminazione programmata',
    'profile.cancelDeletion': 'Annulla eliminazione account',
    'profile.deleteAccount': 'Elimina Account',
    'modal.deleteTitle': 'Elimina il tuo account?',
    'modal.deleteDesc': 'L\'eliminazione verrà pianificata tra 7 giorni. Entro tale data potrai annullarla accedendo nuovamente al tuo profilo.',
    'modal.deleteConfirmCheck': 'Ho capito che questa operazione è irreversibile e che dopo 7 giorni il mio account verrà eliminato definitivamente.',
    'modal.cancel': 'Annulla', 'modal.confirmDelete': 'Conferma eliminazione',
    'addContact.searchLabel': 'Email o Nome Utente',
    'addContact.incomingRequests': 'Richieste in Entrata',
    'addContact.incomingRequestsSub': 'Utenti che vogliono aggiungerti come contatto',
    'common.loading': 'Caricamento…', 'recents.loadingCalls': 'Caricamento chiamate…',
    'dash.filterAll': 'Tutti i Contatti', 'dash.filterOnline': 'Online', 'dash.filterOffline': 'Offline',
    'dash.noContacts': 'Nessun contatto trovato',
    'recents.noRecents': 'Nessuna chiamata recente', 'recents.noParticipants': 'Nessun partecipante trovato.',
    'addContact.noSuggested': 'Nessun utente suggerito', 'addContact.searching': 'Ricerca in corso…',
    'addContact.noResults': 'Nessun utente trovato', 'addContact.requestSent': 'Richiesta inviata',
    'addContact.add': 'Aggiungi', 'addContact.addPlus': '+ Aggiungi',
    'addContact.sending': 'Invio in corso…', 'addContact.sendReport': 'Invia Segnalazione',
    'login.signingIn': 'Accesso in corso...', 'login.registering': 'Registrazione in corso...',
    'forgot.verifying': 'Verifica in corso...', 'forgot.updating': 'Aggiornamento in corso...',
    'waiting.micAccess': 'Accesso Microfono', 'nav.recents': 'Chiamate Recenti',
  },
  en: {
    'nav.home': 'Home', 'nav.how': 'How It Works', 'nav.about': 'About Us',
    'nav.login': 'Sign In', 'nav.start': 'Get Started',
    'nav.contacts': 'Contacts', 'nav.recents': 'Recent Calls',
    'nav.backHome': '← Back to Home', 'nav.backLogin': '← Back to Login',
    'nav.connected': 'Connected',
    'sidebar.navLabel': 'Navigation', 'sidebar.accountLabel': 'Account',
    'sidebar.contacts': 'Contacts', 'sidebar.recents': 'Recent Calls',
    'sidebar.addContact': 'Add Contact', 'sidebar.profile': 'Profile',
    'sidebar.settings': 'Settings', 'sidebar.logout': 'Sign Out',
    'hero.tag': 'Italian · LIS · Artificial Intelligence',
    'hero.sub': 'HandTrackLIS uses AI to recognize Italian Sign Language gestures and generate live subtitles — making video communication accessible to everyone.',
    'hero.cta1': 'Start Using HandTrackLIS', 'hero.cta2': 'How It Works',
    'feat1.title': 'LIS Gesture Recognition',
    'feat1.desc': 'Real-time detection of Italian Sign Language gestures via MediaPipe and AI models trained on LIS datasets.',
    'feat2.title': 'Live Subtitles',
    'feat2.desc': 'Gestures are instantly converted into Italian text shown on both sides of the call, without delays.',
    'feat3.title': 'Accessible Communication',
    'feat3.desc': 'Designed for the deaf and hard-of-hearing community with customizable subtitle sizes, contrast and transcript export.',
    'home.howTitle': 'How HandTrackLIS Works', 'home.howSub': 'A continuous flow from gesture to conversation.',
    'step.webcamDesc': 'The browser accesses the webcam securely', 'step.detection': 'Detection',
    'step.detectionDesc': 'MediaPipe detects hand landmarks in real time', 'step.recognition': 'LIS Recognition',
    'step.recognitionDesc': 'The AI model classifies gestures in the LIS vocabulary', 'step.subtitleDesc': 'Text appears live during the call',
    'home.learnMore': 'Explore the Technology',
    'stat.signs': 'LIS signs in the model', 'stat.latency': 'Average subtitle latency',
    'stat.accuracy': 'Recognition accuracy', 'stat.browser': 'Browser-based, no installation',
    'login.title': 'Welcome Back', 'login.sub': 'Sign in to your HandTrackLIS account',
    'login.tab': 'Sign In', 'login.tabSignup': 'Create Account', 'login.btn': 'Sign In', 'login.btnSignup': 'Create Account',
    'perm.title': 'Required Permissions',
    'perm.sub': 'HandTrackLIS needs camera access to work. Microphone and hand tracking are optional.',
    'perm.camTitle': 'Camera Access', 'perm.camDesc': 'Required for video calls and hand gesture detection.', 'perm.camBtn': 'Allow Camera',
    'perm.micTitle': 'Microphone Access', 'perm.micDesc': 'Enables audio during video calls.', 'perm.micBtn': 'Allow Microphone',
    'perm.handTitle': 'Hand Tracking', 'perm.handDesc': 'Enables LIS gesture recognition and subtitle generation. Can be changed anytime in settings.', 'perm.handBtn': 'Enable Tracking',
    'perm.privacy': 'All video processing happens locally in the browser. No gesture data is sent to our servers.',
    'perm.continueBtn': 'Continue to Dashboard', 'perm.warning': 'Camera access is required to continue.',
    'dash.title': 'Contacts', 'dash.sub': 'Your HandTrackLIS network',
    'dash.statTotal': 'Total Contacts', 'dash.statWeek': '+2 this week',
    'dash.statOnline': 'Online Now', 'dash.statAvail': 'Available for calls',
    'recents.title': 'Recent Calls', 'recents.sub': 'Call history with subtitle transcripts',
    'recents.history': 'History', 'recents.export': 'Export Transcripts',
    'addContact.title': 'Add Contact', 'addContact.sub': 'Search users by email or username',
    'addContact.searchTitle': 'Search Users', 'addContact.searchBtn': 'Search',
    'addContact.results': 'Results', 'addContact.resultsSub': 'HandTrackLIS users found',
    'addContact.placeholder': 'Type to search users',
    'addContact.suggested': 'Suggested Contacts', 'addContact.suggestedSub': 'People you may know',
    'waiting.preview': 'Preview', 'waiting.camActive': 'Camera active',
    'waiting.waitingMsg': 'Waiting for answer…', 'waiting.cancel': 'Cancel Call',
    'call.remoteStream': 'Remote video stream', 'call.yourCamera': 'Your camera',
    'call.tabSubs': 'Subtitles', 'call.tabChat': 'Text Chat', 'call.liveTranscript': 'Live LIS Transcription',
    'settings.title': 'Settings', 'settings.sub': 'Customize your HandTrackLIS experience',
    'settings.subsTitle': 'Subtitles & Accessibility',
    'settings.subSize': 'Subtitle Size', 'settings.subSizeDesc': 'Adjust text size for better readability',
    'settings.subSizeSmall': 'Small (12px)',
    'settings.subSizeMedium': 'Medium (16px)',
    'settings.subSizeBig': 'Big (20px)',
    'settings.subSizeReallyBig': 'Really Big (24px)',
    'settings.subPos': 'Subtitle Position', 'settings.subPosDesc': 'Choose where you want to see subtitles during a call',
    'settings.subPosSidePanel':'Side Panel',
    'settings.subPosOverlapping':'Overlapping',
    'settings.subPosBottom':'Bottom',
    'settings.highContrast': 'High Contrast Subtitles', 'settings.highContrastDesc': 'Makes text easier to read by adding a dark background behind the subtitles',
    'settings.confidence': 'Show Recognition Confidence', 'settings.confidenceDesc': 'Shows how sure the system is that it correctly recognised the gesture',
    'settings.langTitle': 'Language & Localization',
    'settings.langUI': 'Interface Language', 'settings.langUIDesc': 'The language used for buttons, menus and app messages',
    'settings.langSub': 'LIS Subtitle Language', 'settings.langSubDesc': 'The language in which you want to read the subtitles generated during the call',
    'settings.appearTitle': 'Appearance',
    'settings.darkMode': 'Dark Mode', 'settings.darkModeDesc': 'Switch to a dark background, easier on the eyes in low-light environments',
    'settings.animations': 'Interface Animations', 'settings.animationsDesc': 'Enable or disable the opening and closing animations between screens',
    'settings.statusBadge': 'Show Online Status', 'settings.statusBadgeDesc': 'Let other users see when you are online',
    'settings.transcriptTitle': 'Transcripts & Data',
    'settings.autoSave': 'Auto Save', 'settings.autoSaveDesc': 'At the end of each call, the subtitle text is automatically saved to your device',
    'settings.exportFmt': 'Export Format', 'settings.exportFmtDesc': 'Choose the file format when downloading subtitles from a call',
    'settings.save': 'Save Settings', 'settings.cancel': 'Cancel',
    'profile.title': 'Profile', 'profile.sub': 'Manage your personal information and account security',
    'profile.personalInfo': 'Personal Information', 'profile.saveInfo': 'Save Changes',
    'profile.changePass': 'Change Password', 'profile.savePass': 'Update Password',
    'profile.dangerZone': 'Account Zone', 'profile.logoutDesc': 'End the current session on this device.',
    'profile.logout': 'Sign Out',
    'forgot.title': 'Reset Password', 'forgot.sub': 'Enter your email and choose a new password.', 'forgot.btn': 'Update Password',
    'how.title': 'How HandTrackLIS Works',
    'how.sub': 'From the camera image to text on screen, in less than 200 milliseconds. Here\'s the complete journey.',
    'how.step1Title': 'Webcam Capture', 'how.step2Title': 'Hand Landmark Detection',
    'how.step3Title': 'LIS Gesture Classification', 'how.step4Title': 'Live Subtitle Generation',
    'about.title': 'About Us', 'about.projectTitle': 'The Project',
    'about.lisTitle': 'Why LIS Matters', 'about.teamTitle': 'Our Team',
    'about.teamSub': 'Five students with a shared vision: making communication accessible to everyone.',
    'about.sub': 'HandTrackLIS was born from the desire to make Italian Sign Language communication accessible to all, breaking down barriers between hearing and deaf people through technology.',
    'about.projectDesc': 'HandTrackLIS is a video call platform that integrates automatic recognition of Italian Sign Language (LIS) gestures through artificial intelligence. The goal is to enable smooth communication between deaf, hard-of-hearing and hearing people, eliminating the need for a physical interpreter.',
    'about.lisDesc': 'In Italy there are around 80,000 deaf people who use LIS as their primary language. Yet LIS interpreters are few and access to them is often limited. HandTrackLIS wants to bridge this gap, making communication accessible anywhere and at any time.',
    'team.role1': 'Project Manager', 'team.role2': 'Machine Learning & AI',
    'team.role3': 'Backend & Database', 'team.role4': 'Dataset & LIS Research',
    'team.role5': 'Testing & Accessibility',
    'nav.backHome2': 'Back to Home', 'nav.contacts2': 'Contact',
    'footer.desc': 'Open-source project combining LIS and real-time video communication through AI.',
    'footer.platform': 'Platform', 'footer.project': 'Project', 'footer.support': 'Support',
    'footer.register': 'Sign Up', 'footer.research': 'Research',
    'footer.accessibility': 'Accessibility', 'footer.docs': 'Documentation',
    'footer.location': 'Location', 'footer.city': 'Genoa, Italy',
    'footer.schoolProject': 'School Project 2026', 'footer.schoolProject2': 'School Project',
    'footer.madeWith': 'Made with passion for the LIS community',
    'call.incomingLabel': 'Incoming Call', 'call.directCall': 'HandTrackLIS · Direct Call',
    'call.inviteLabel': 'Call Invite', 'call.invitesSub': 'is inviting you to join',
    'call.decline': 'Decline', 'call.accept': 'Accept', 'call.join': 'Join',
    'call.you': 'You', 'call.trackingOn': 'Tracking ON',
    'call.inCallWith': 'In call with', 'call.mic': 'Microphone',
    'call.camera': 'Camera', 'call.end': 'End', 'call.invite': 'Invite',
    'call.chatEmpty': 'No messages yet.\nStart the conversation!',
    'call.chatPlaceholder': 'Write a message…',
    'waiting.calling': 'Calling…', 'waiting.awaitingAnswer': 'Waiting for an answer',
    'how.technologyTag': 'Technology',
    'how.pipelineTitle': 'Complete Technical Pipeline',
    'how.pipeWebcamDesc': '30 FPS capture', 'how.pipeMediapipeDesc': '21 hand landmarks',
    'how.pipeModelLabel': 'AI Model', 'how.pipeModelDesc': 'LIS Classification',
    'how.pipeSubDesc': 'Live text',
    'step.webcam': 'Webcam', 'step.subtitles': 'Subtitles',
    'settings.micTitle': 'Permissions',
    'settings.micEnabled': 'Enable Microphone in Calls',
    'settings.micEnabledDesc': 'If enabled, the app will use the microphone during calls. You can still mute it at any time even while in a call.',
    'settings.handTracking': 'Hand Tracking',
    'settings.handTrackingBadge': 'Optional',
    'settings.handTrackingDesc': 'Enables LIS gesture recognition and real-time subtitle generation.',
    'form.firstName': 'First Name', 'form.lastName': 'Last Name', 'form.username': 'Username',
    'form.email': 'Email Address', 'form.confirmEmail': 'Confirm Email Address',
    'form.password': 'Password', 'form.confirmPassword': 'Confirm Password',
    'form.newPassword': 'New Password', 'form.confirmNewPassword': 'Confirm New Password',
    'form.currentPassword': 'Current Password',
    'login.forgotPassword': 'Forgot password?',
    'forgot.rememberPassword': 'Remember your password?', 'forgot.backToLogin': 'Back to login',
    'profile.deleteDesc': 'Permanently delete your account and all associated data.',
    'profile.deletionScheduled': 'Deletion scheduled',
    'profile.cancelDeletion': 'Cancel account deletion',
    'profile.deleteAccount': 'Delete Account',
    'modal.deleteTitle': 'Delete your account?',
    'modal.deleteDesc': 'Deletion will be scheduled in 7 days. Until then you can cancel it by signing back into your profile.',
    'modal.deleteConfirmCheck': 'I understand this action is irreversible and that my account will be permanently deleted after 7 days.',
    'modal.cancel': 'Cancel', 'modal.confirmDelete': 'Confirm deletion',
    'addContact.searchLabel': 'Email or Username',
    'addContact.incomingRequests': 'Incoming Requests',
    'addContact.incomingRequestsSub': 'Users who want to add you as a contact',
    'common.loading': 'Loading…', 'recents.loadingCalls': 'Loading calls…',
    'dash.filterAll': 'All Contacts', 'dash.filterOnline': 'Online', 'dash.filterOffline': 'Offline',
    'dash.noContacts': 'No contacts found',
    'recents.noRecents': 'No recent calls', 'recents.noParticipants': 'No participants found.',
    'addContact.noSuggested': 'No suggested users', 'addContact.searching': 'Searching…',
    'addContact.noResults': 'No users found', 'addContact.requestSent': 'Request sent',
    'addContact.add': 'Add', 'addContact.addPlus': '+ Add',
    'addContact.sending': 'Sending…', 'addContact.sendReport': 'Submit Report',
    'login.signingIn': 'Signing in...', 'login.registering': 'Creating account...',
    'forgot.verifying': 'Verifying...', 'forgot.updating': 'Updating...',
    'waiting.micAccess': 'Microphone Access', 'nav.recents': 'Recent Calls',
  }
};

let _currentLang = 'it';
function _t(key) { return (I18N[_currentLang] || I18N['it'])[key] || key; }

function applyLangUI(lang) {
  _currentLang = lang;
  const t = I18N[lang] || I18N['it'];
  _tagI18nElements();
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (!t[key]) return;
    if (el.classList.contains('sidebar-link') || el.getAttribute('data-i18n-textonly')) {
      const nodes = Array.from(el.childNodes);
      const textNode = nodes.reverse().find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      if (textNode) textNode.textContent = t[key];
    } else if (el.tagName === 'OPTION') {
      el.textContent = t[key];
    } else if (el.querySelector && el.querySelector('strong, em, span, br')) {
      if (/<[^>]+>/.test(t[key])) { el.innerHTML = t[key]; }
      else { el.textContent = t[key]; }
    } else {
      el.textContent = t[key];
    }
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (t[key]) el.placeholder = t[key];
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    if (t[key]) el.innerHTML = t[key];
  });
}

let _i18nTagged = false;
function _tagI18nElements() {
  if (_i18nTagged) return; _i18nTagged = true;
  const homeNav = document.querySelector('#page-home .nav-links');
  if (homeNav) {
    const links = homeNav.querySelectorAll('.nav-link');
    const keys = ['nav.home','nav.how','nav.about'];
    links.forEach((l, i) => { if (keys[i] && !l.getAttribute('data-i18n')) l.setAttribute('data-i18n', keys[i]); });
  }
  const homeNavRight = document.querySelector('#page-home .nav-right');
  if (homeNavRight) {
    homeNavRight.querySelectorAll('.btn-outline').forEach(el => { if (!el.getAttribute('data-i18n')) el.setAttribute('data-i18n','nav.login'); });
    homeNavRight.querySelectorAll('.btn-primary').forEach(el => { if (!el.getAttribute('data-i18n')) el.setAttribute('data-i18n','nav.start'); });
  }
  ['#page-about','#page-how'].forEach(page => {
    const nav = document.querySelector(page + ' .nav-links'); if (!nav) return;
    const links = nav.querySelectorAll('.nav-link');
    const keys = ['nav.home','nav.how','nav.about'];
    links.forEach((l, i) => { if (keys[i] && !l.getAttribute('data-i18n')) l.setAttribute('data-i18n', keys[i]); });
  });
  document.querySelectorAll('.btn-ghost').forEach(el => {
    const txt = el.textContent.trim(); if (!el.getAttribute('data-i18n')) {
      if (txt.includes('Home'))  el.setAttribute('data-i18n', 'nav.backHome');
      if (txt.includes('Login') || txt.includes('accesso')) el.setAttribute('data-i18n', 'nav.backLogin');
    }
  });
  document.querySelectorAll('.badge-green.badge-dot').forEach(el => { if (!el.getAttribute('data-i18n')) el.setAttribute('data-i18n', 'nav.connected'); });
  const sidebarMap = {
    'Contatti': 'sidebar.contacts', 'Contacts': 'sidebar.contacts',
    'Chiamate Recenti': 'sidebar.recents', 'Recent Calls': 'sidebar.recents',
    'Aggiungi Contatto': 'sidebar.addContact', 'Add Contact': 'sidebar.addContact',
    'Profilo': 'sidebar.profile', 'Profile': 'sidebar.profile',
    'Impostazioni': 'sidebar.settings', 'Settings': 'sidebar.settings',
    'Esci': 'sidebar.logout', 'Sign Out': 'sidebar.logout',
  };
  document.querySelectorAll('.sidebar-link').forEach(el => {
    if (el.getAttribute('data-i18n')) return;
    const txt = el.textContent.trim();
    for (const [match, key] of Object.entries(sidebarMap)) {
      if (txt.includes(match)) { el.setAttribute('data-i18n', key); break; }
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const settingsPage = document.getElementById('page-settings');
  if (!settingsPage) return;
  const selects = settingsPage.querySelectorAll('select.input');
  const ids = ['sel-subtitle-size','sel-subtitle-pos','sel-lang-ui','sel-lang-sub','sel-export-fmt'];
  selects.forEach((sel, i) => {
    if (ids[i]) sel.id = ids[i];
    sel.addEventListener('change', () => { const s = readSettingsFromUI(); applySettings(s); });
  });
  const s = loadSettings(); applySettings(s);
});

document.addEventListener('DOMContentLoaded', () => {
  const drawer  = document.getElementById('drawer-footer');
  const overlay = document.getElementById('drawer-footer-overlay');
  const btn     = document.getElementById('drawer-footer-btn');
  if (!drawer) return;

  function openDrawerFooter() {
    drawer.classList.add('open');
    overlay.classList.add('open');
    btn.classList.add('open');
    btn.setAttribute('title', 'Chiudi footer');
  }
  function closeDrawerFooter() {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    btn.classList.remove('open');
    btn.setAttribute('title', 'Apri footer');
  }
  function toggleDrawerFooter() {
    drawer.classList.contains('open') ? closeDrawerFooter() : openDrawerFooter();
  }

  window.closeDrawerFooter  = closeDrawerFooter;
  window.toggleDrawerFooter = toggleDrawerFooter;

  const _origGoTo = window.goTo;
  window.goTo = function(pageId) {
    if (btn) {
      const hide = pageId === 'page-waiting' || pageId === 'page-call';
      btn.style.display = hide ? 'none' : '';
      if (hide) closeDrawerFooter();
    }
    if (_origGoTo) _origGoTo(pageId);
  };
});