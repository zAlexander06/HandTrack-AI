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
};

// Helper fetch JSON
async function apiFetch(url, options = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
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

function saveSession(user) {
  const s = JSON.stringify(user);
  localStorage.setItem('htl_user', s);
  sessionStorage.setItem('htl_user', s);
}
function clearSession() {
  localStorage.removeItem('htl_user');
  sessionStorage.removeItem('htl_user');
}
function loadSession() {
  const raw = localStorage.getItem('htl_user') || sessionStorage.getItem('htl_user');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.id) {
        currentUser = parsed;
        updateNavUser(currentUser);
      } else {
        clearSession();
      }
    } catch (e) {
      clearSession();
    }
  }
}

// ================================================================
// PASSWORD HASHING — SHA-256 via Web Crypto API
// ================================================================
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
  if (btn) { btn.disabled = true; btn.textContent = 'Accesso in corso...'; }

  const hash = await hashPassword(password);

  const { data, ok } = await apiPost(API.login, { email, password_hash: hash });

  if (btn) { btn.disabled = false; btn.textContent = 'Accedi'; }

  if (!ok) {
    return showFormError(errEl, data.error || 'Email o password errati.');
  }

  clearFormError(errEl);
  currentUser = {
    id:       data.id,
    username: data.username,
    email:    data.email,
    nome:     data.realname,
    cognome:  data.surname,
    role:     data.role,
    initials: ((data.realname?.[0] || '') + (data.surname?.[0] || '')).toUpperCase()
  };
  saveSession(currentUser);
  updateNavUser(currentUser);
  startIncomingCallPoller();
  startNotificationPoller();
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
  if (password.length < 8)
    return showFormError(errEl, 'La password deve essere di almeno 8 caratteri.');
  if (password !== passCf)
    return showFormError(errEl, 'Le password non corrispondono.');

  const btn = document.querySelector('#tab-signup .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Registrazione in corso...'; }

  const hash = await hashPassword(password);

  const { data, ok } = await apiPost(API.register, {
    realname: realName,
    surname,
    username,
    email,
    password_hash: hash,
  });

  if (btn) { btn.disabled = false; btn.textContent = 'Crea Account'; }

  if (!ok) {
    return showFormError(errEl, data.error || 'Errore durante la registrazione.');
  }

  clearFormError(errEl);
  currentUser = {
    id:       data.id,
    username,
    email,
    nome:     realName,
    cognome:  surname,
    role:     'utente',
    initials: (realName[0] + surname[0]).toUpperCase()
  };
  saveSession(currentUser);
  updateNavUser(currentUser);
  startIncomingCallPoller();
  startNotificationPoller();
  showToast('Account creato con successo!');
  goTo('page-permissions');
}

// ================================================================
// AUTH: FORGOT PASSWORD
// ================================================================
async function submitForgotPassword() {
  const email = document.getElementById('forgot-email').value.trim();
  const errEl = document.getElementById('forgot-error');

  if (!email)               return showFormError(errEl, 'Inserisci la tua email.');
  if (!isValidEmail(email)) return showFormError(errEl, 'Inserisci un indirizzo email valido.');

  const btn = document.querySelector('#page-forgot .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Verifica in corso...'; }

  const { data, ok } = await apiPost(API.user, { action: 'forgot_check', email });

  if (btn) { btn.disabled = false; btn.textContent = 'Reimposta Password'; }

  if (!ok) return showFormError(errEl, data.error || 'Nessun account trovato con questa email.');

  showResetForm(email, data.id);
}

function showResetForm(email, userId) {
  if (document.getElementById('reset-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'reset-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML = `
    <div style="background:var(--bg1);border:1px solid var(--border);border-radius:20px;padding:36px;max-width:400px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,0.2);">
      <h2 style="font-family:'Syne',sans-serif;font-size:22px;font-weight:700;margin-bottom:6px;">Nuova Password</h2>
      <p style="font-size:13px;color:var(--text2);margin-bottom:20px;">Account: <strong>${email}</strong></p>
      <div class="input-group" style="margin-bottom:12px;">
        <label class="input-label">Nuova Password</label>
        <input class="input" type="password" id="reset-pw" placeholder="Minimo 8 caratteri"/>
      </div>
      <div class="input-group" style="margin-bottom:16px;">
        <label class="input-label">Conferma Password</label>
        <input class="input" type="password" id="reset-pw-conf" placeholder="••••••••"/>
      </div>
      <div id="reset-error" style="display:none;font-size:12px;color:var(--red);margin-bottom:12px;padding:8px 12px;background:rgba(220,38,38,0.07);border-radius:8px;"></div>
      <button class="btn btn-primary w-full" style="justify-content:center;padding:12px;"
              onclick="confirmNewPassword(${userId})">Salva Nuova Password</button>
      <button class="btn btn-ghost w-full" style="justify-content:center;margin-top:8px;"
              onclick="document.getElementById('reset-modal').remove()">Annulla</button>
    </div>
  `;
  document.body.appendChild(modal);
}

async function confirmNewPassword(userId) {
  const pw     = document.getElementById('reset-pw').value;
  const pwConf = document.getElementById('reset-pw-conf').value;
  const errEl  = document.getElementById('reset-error');

  if (!pw || !pwConf)  return showFormError(errEl, 'Compila entrambi i campi.');
  if (pw.length < 8)   return showFormError(errEl, 'Minimo 8 caratteri.');
  if (pw !== pwConf)   return showFormError(errEl, 'Le password non corrispondono.');

  const hash = await hashPassword(pw);
  const { data, ok } = await apiPost(API.user, { action: 'forgot_reset', id: userId, new_hash: hash });

  if (!ok) return showFormError(errEl, data.error || 'Errore durante l\'aggiornamento. Riprova.');

  document.getElementById('reset-modal')?.remove();
  document.getElementById('forgot-email').value = '';
  showToast('Password aggiornata! Puoi ora accedere.');
  goTo('page-login');
}

// ================================================================
// LOGOUT
// ================================================================
async function logoutUser() {
  if (currentUser) {
    await apiPost(API.user, { action: 'logout', id: currentUser.id });
  }
  clearSession();
  currentUser = null;
  stopIncomingCallPoller();
  stopNotificationPoller();
  stopChatPoller();
  clearInterval(callStatusPollInterval);
  activeCallId = null; outgoingCallId = null;
  Object.values(mediaStreams).forEach(s => s && s.getTracks().forEach(t => t.stop()));
  goTo('page-home');
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
}

// ================================================================
// PERMISSIONS STATE
// ================================================================
const perms = { camera: false, mic: false, hand: false };
const mediaStreams = {};

async function grantPerm(type) {
  const btn   = document.getElementById('btn-' + type);
  const check = document.getElementById('check-' + type);
  const card  = document.getElementById('perm-' + type);

  btn.disabled = true;
  btn.textContent = 'In attesa...';

  try {
    if (type === 'camera') {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      mediaStreams.camera = stream;
    } else if (type === 'mic') {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreams.mic = stream;
    } else if (type === 'hand') {
      if (!perms.camera) {
        btn.disabled = false;
        btn.textContent = 'Abilita Tracciamento';
        return showToast('Concedi prima l\'accesso alla fotocamera.');
      }
      await new Promise(r => setTimeout(r, 600));
    }

    perms[type] = true;
    card.classList.add('granted');
    check.classList.add('ok');
    check.textContent = 'v';
    btn.textContent = 'Concesso';
    btn.style.opacity = '0.5';
    checkAllPerms();

  } catch (err) {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.textContent = type === 'camera' ? 'Consenti Fotocamera'
                    : type === 'mic'    ? 'Consenti Microfono'
                                        : 'Abilita Tracciamento';
    const msg = err.name === 'NotAllowedError'
      ? 'Permesso negato. Controlla le impostazioni del sito.'
      : err.name === 'NotFoundError'
      ? 'Dispositivo non trovato. Verifica la connessione.'
      : 'Errore: ' + err.message;
    showToast(msg);
  }
}

function checkAllPerms() {
  const all = perms.camera && perms.mic && perms.hand;
  const btn = document.getElementById('continue-btn');
  const warn = document.getElementById('perm-warning');
  btn.disabled = !all;
  warn.style.display = all ? 'none' : 'block';
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
  list.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text3);">Caricamento…</div>';

  const { data, ok } = await apiGet(API.contacts, { action: 'list', user_id: currentUser.id });

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
    list.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text3);">Nessun contatto trovato</div>';
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
      <button class="btn btn-danger-soft text-xs" onclick="removeContact(this, ${c.id}, '${c.name.replace(/'/g,"\\'")}')">
        <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23dc2626' stroke-width='2'%3E%3Cpolyline points='3 6 5 6 21 6'/%3E%3Cpath d='M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'/%3E%3C/svg%3E" style="width:12px;height:12px;" alt="">Rimuovi
      </button>
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

  await apiPost(API.contacts, { action: 'remove', user_id: currentUser.id, contact_id: contactId });

  allContacts = allContacts.filter(c => c.id !== contactId);
  setTimeout(() => { item.remove(); updateDashStats(); }, 300);
  showToast(name + ' rimosso dai contatti');
}

// ================================================================
// RECENT CALLS
// ================================================================
async function loadRecents() {
  const list = document.getElementById('recents-list');
  if (!list || !currentUser?.id) return;
  list.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text3);">Caricamento chiamate…</div>';

  const { data, ok } = await apiGet(API.calls, { action: 'history', user_id: currentUser.id });

  if (!ok) {
    list.innerHTML = '<div style="text-align:center;padding:32px;color:var(--red);">Errore nel caricamento chiamate.</div>';
    return;
  }
  if (!data || !data.length) {
    list.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text3);">Nessuna chiamata recente</div>';
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
    const trascrBtn = !missed
      ? `<button class="btn btn-outline text-xs" onclick="goTo('page-call')">Trascrizione</button>`
      : '';

    return `
      <div class="call-item">
        <div class="call-icon ${iconClass}">${icon}</div>
        <div class="avatar" style="width:36px;height:36px;font-size:13px;flex-shrink:0;background:${color};">${otherInit}</div>
        <div style="flex:1;">
          <div class="font-semibold text-sm">${otherName}</div>
          <div class="text-xs" style="color:${dirColor};">${dirLabel}${durationStr}</div>
        </div>
        <div class="text-xs text-muted">${when}</div>
        ${trascrBtn}
        <button class="btn btn-primary text-xs" onclick="startCall(${otherId || 0}, '${otherName.replace(/'/g,"\\'")}', '${otherInit}')">Richiama</button>
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

// ================================================================
// ADD CONTACT
// ================================================================
let myContactIds = new Set();

async function loadSuggestedContacts() {
  const list = document.getElementById('suggested-list');
  if (!list || !currentUser?.id) return;
  list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3);" class="text-sm">Caricamento…</div>';

  // Se allContacts non è ancora popolato, caricalo prima
  if (!allContacts || allContacts.length === 0) {
    const { data: cData, ok: cOk } = await apiGet(API.contacts, { action: 'list', user_id: currentUser.id });
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

  const { data, ok } = await apiGet(API.contacts, { action: 'suggested', user_id: currentUser.id });

  if (!ok || !data || !data.length) {
    list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3);" class="text-sm">Nessun utente suggerito</div>';
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
  results.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3);" class="text-sm">Ricerca in corso…</div>';

  const { data, ok } = await apiGet(API.contacts, { action: 'search', user_id: currentUser.id, q });

  if (!ok) {
    results.innerHTML = '<div style="text-align:center;padding:24px;color:var(--red);" class="text-sm">Errore nella ricerca</div>';
    return;
  }
  if (!data || !data.length) {
    results.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3);" class="text-sm">Nessun utente trovato</div>';
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
    user_id:    currentUser.id,
    contact_id: targetId,
  });

  if (!ok && !data.error?.includes('già')) {
    btn.disabled = false;
    btn.textContent = '+ Aggiungi';
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

  list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text3);" class="text-sm">Caricamento…</div>';

  const { data, ok } = await apiGet(API.contacts, { action: 'incoming', user_id: currentUser.id });

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
  if (pageId === 'page-dashboard')   loadContacts();
  if (pageId === 'page-recents')     loadRecents();
  if (pageId === 'page-add-contact') { loadSuggestedContacts(); loadIncomingRequests(); }
  if (pageId === 'page-call')        startCallTimer();
  else                               stopCallTimer();
  if (pageId === 'page-permissions') resetPerms();
  if (pageId === 'page-login') {
    clearFormError(document.getElementById('login-error'));
    clearFormError(document.getElementById('signup-error'));
    const loginInner  = document.getElementById('login-inner');
    const signupInner = document.getElementById('signup-inner');
    if (loginInner)  { loginInner.style.display = 'flex'; loginInner.style.flexDirection = 'column'; }
    if (signupInner) { signupInner.style.display = 'none'; }
    const tabs = document.querySelectorAll('#page-login .pill-tab');
    if (tabs.length >= 2) {
      tabs[0].classList.add('active');
      tabs[1].classList.remove('active');
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
  ['camera','mic','hand'].forEach(t => {
    perms[t] = false;
    const card = document.getElementById('perm-' + t);
    if (card) card.classList.remove('granted');
    const check = document.getElementById('check-' + t);
    if (check) { check.classList.remove('ok'); check.textContent = ''; }
    const btn = document.getElementById('btn-' + t);
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.textContent = t === 'camera' ? 'Consenti Fotocamera' : t === 'mic' ? 'Consenti Microfono' : 'Abilita Tracciamento';
    }
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
}

function goToLogin() { goTo('page-login'); }
function goToRegister() {
  const mode = _getLoaderMode();
  const delay = (mode === 'detail') ? 350 : 80;
  showLoader();
  setTimeout(() => {
    _applyPageChange('page-login');
    // Sovrascrive il reset e mostra il tab "Crea Account"
    const loginInner  = document.getElementById('login-inner');
    const signupInner = document.getElementById('signup-inner');
    if (loginInner)  { loginInner.style.display = 'none'; }
    if (signupInner) { signupInner.style.display = 'flex'; signupInner.style.flexDirection = 'column'; }
    const tabs = document.querySelectorAll('#page-login .pill-tab');
    if (tabs.length >= 2) { tabs[0].classList.remove('active'); tabs[1].classList.add('active'); }
    hideLoader();
  }, delay);
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

function startIncomingCallPoller() {
  stopIncomingCallPoller();
  incomingPollInterval = setInterval(pollIncomingCalls, 3000);
}
function stopIncomingCallPoller() { clearInterval(incomingPollInterval); }

async function pollIncomingCalls() {
  if (!currentUser?.id) return;
  if (activeCallId || outgoingCallId) return;

  const { data } = await apiGet(API.calls, { action: 'poll_incoming', user_id: currentUser.id });

  if (!data) {
    if (incomingCallData && !activeCallId) hideIncomingCallOverlay();
    return;
  }

  if (incomingCallData && incomingCallData.callId === data.id) return;

  incomingCallData = {
    callId:         data.id,
    callerId:       data.caller_id,
    callerName:     ((data.realName || '') + ' ' + (data.surname || '')).trim(),
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

  await apiPost(API.calls, { action: 'accept', call_id: callId, user_id: currentUser.id });

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

  // Avvia anteprima camera nella waiting room
  await startWaitingPreview();

  const { data, ok } = await apiPost(API.calls, {
    action:      'create',
    caller_id:   currentUser.id,
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
  if (waitingPreviewStream) {
    waitingPreviewStream.getVideoTracks().forEach(t => { t.enabled = on; });
    const vPrev = document.getElementById('video-waiting-preview');
    const ph    = document.querySelector('#page-waiting .webcam-placeholder');
    if (vPrev) vPrev.style.display = on ? 'block' : 'none';
    if (ph)    ph.style.display    = on ? 'none'  : '';
  }
  // Rifletti anche sullo stato callControls per quando la chiamata inizia
  callControls.cam = on;
}

function toggleWaitingMic() {
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
  callControls[type] = !callControls[type];
  const on = callControls[type];
  const btn = document.getElementById('btn-' + type);
  const iconOn  = document.getElementById('icon-' + type + '-on');
  const iconOff = document.getElementById('icon-' + type + '-off');
  if (iconOn)  iconOn.style.display  = on ? '' : 'none';
  if (iconOff) iconOff.style.display = on ? 'none' : '';
  if (btn) btn.classList.toggle('muted', !on);
  const label = document.getElementById('label-' + type);
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

  // Rispetta lo stato cam/mic impostato nella waiting room (callControls già aggiornato da toggleWaiting*)
  ['mic','cam'].forEach(t => {
    const on = callControls[t];
    const btn = document.getElementById('btn-' + t);
    if (btn) btn.classList.toggle('muted', !on);
    const iconOn  = document.getElementById('icon-' + t + '-on');
    const iconOff = document.getElementById('icon-' + t + '-off');
    if (iconOn)  iconOn.style.display  = on ? '' : 'none';
    if (iconOff) iconOff.style.display = on ? 'none' : '';
  });
  const labelMic = document.getElementById('label-mic');
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
    await apiPost(API.calls, { action: 'end', call_id: activeCallId, user_id: currentUser.id });
  }

  activeCallId = null; activeCallPeer = null; callRole = null;
  goTo('page-dashboard');
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
  try {
    waitingPreviewStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const vPrev = document.getElementById('video-waiting-preview');
    const placeholder = document.querySelector('#page-waiting .webcam-placeholder');
    if (vPrev) { vPrev.srcObject = waitingPreviewStream; vPrev.style.display = 'block'; }
    if (placeholder) placeholder.style.display = 'none';
  } catch (err) {
    console.warn('Waiting preview error:', err);
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

  const peer = callParticipantsMap[peerId] || {};
  const name = peer.name || ('Utente ' + peerId);
  const init = peer.initials || '?';
  const color = peer.color || avatarColor(peerId);

  const tile = document.createElement('div');
  tile.id = 'tile-remote-' + peerId;
  tile.className = 'remote-video-tile';
  tile.innerHTML = `
    <video id="video-remote-${peerId}" autoplay playsinline
      style="width:100%;height:100%;object-fit:cover;background:#0d1117;display:none;"></video>
    <div id="card-remote-${peerId}" class="call-remote-card" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
      <div class="avatar" style="width:72px;height:72px;font-size:26px;background:${color};box-shadow:0 0 0 4px rgba(255,255,255,0.08);">${init}</div>
      <div style="font-size:15px;font-weight:700;color:#e2e8f0;margin-top:12px;font-family:'Syne',sans-serif;">${escapeHtml(name)}</div>
    </div>
    <div style="position:absolute;bottom:6px;left:0;right:0;text-align:center;font-size:10px;padding:2px 6px;background:rgba(0,0,0,0.55);color:#e2e8f0;pointer-events:none;">${escapeHtml(name)}</div>`;
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
  };

  // ICE candidate → segnala includendo targetId nel payload
  pc.onicecandidate = async ({ candidate }) => {
    if (candidate && callId) {
      await apiPost(API.signal, {
        action:  'send',
        call_id: callId,
        user_id: currentUser.id,
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
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
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
            user_id: currentUser.id,
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
      user_id: currentUser.id,
      type:    'presence',
      payload: JSON.stringify({ senderId: currentUser.id }),
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
        user_id: currentUser.id,
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
  if (!Object.keys(peerConnections).length && !activeCallPeer) return;
  let result;
  try {
    result = await apiGet(API.signal, {
      action:  'recv',
      call_id: callId,
      user_id: currentUser.id,
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
          user_id: currentUser.id,
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
        // Se il nostro ID è più alto del suo, dobbiamo inviargli l'offer.
        const newPeerId = payload.senderId;
        console.log('[WebRTC] presence ricevuto da', newPeerId, '— myId:', currentUser.id, 'myId > newPeerId:', currentUser.id > newPeerId, 'già connesso:', !!peerConnections[newPeerId]);
        if (!newPeerId || newPeerId === currentUser.id) continue;
        if (currentUser.id > newPeerId && !peerConnections[newPeerId]) {
          // Aggiorna callParticipantsMap se non lo conosciamo ancora
          if (!callParticipantsMap[newPeerId]) {
            try {
              const { data: uData, ok: uOk } = await apiGet(API.user, { action: 'get', id: newPeerId });
              if (uOk && uData && uData.id) {
                callParticipantsMap[newPeerId] = {
                  initials: initials(uData.realname || uData.realName, uData.surname),
                  color:    avatarColor(newPeerId),
                  name:     ((uData.realname || uData.realName || '') + ' ' + (uData.surname || '')).trim(),
                };
              }
            } catch(_) {}
          }
          connectToNewPeer(newPeerId, callId);
        } else if (currentUser.id < newPeerId) {
          console.log('[WebRTC] presence da', newPeerId, '— aspetto offer (ha ID più alto)');
        }
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
    user_id: currentUser.id,
    type:    'call_invite',
    unread:  '1',
  });

  console.log('[invite] GET notifications →', { ok, status, data });

  if (!ok) {
    console.log('[invite] exit: ok=false');
    if (pendingCallInvite) hideCallInviteOverlay();
    return;
  }

  if (!data?.notifications?.length) {
    console.log('[invite] exit: notifications vuoto o assente', data);
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
  await apiPost(API.calls, { action: 'join', call_id: callId, user_id: currentUser.id });

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

  const { data: contacts } = await apiGet(API.contacts, { action: 'list', user_id: currentUser.id });
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
  vid.style.cssText = 'width:100%;height:100%;object-fit:cover;background:#0d1117;';

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
    activeCallId = null; activeCallPeer = null; callRole = null;
    goTo('page-dashboard');
    showToast('La chiamata è stata terminata dall\'altro utente.');
    return;
  }

  // Controlla partecipanti attivi — rileva nuovi arrivati e avvia WebRTC verso di loro
  const { data: activeParticipants } = await apiGet(API.calls, { action: 'active_participants', call_id: activeCallId });
  if (activeParticipants && activeParticipants.length <= 1) {
    await endActiveCall();
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
    const div    = document.createElement('div');
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

  input.value = '';
  input.focus();

  const { ok } = await apiPost(API.messages, {
    sender_id:   currentUser.id,
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
    action: 'update_profile',
    id:       currentUser.id,
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

  const oldHash = await hashPassword(oldPw);
  const newHash = await hashPassword(newPw);

  const { data, ok } = await apiPost(API.user, {
    action:   'change_password',
    id:       currentUser.id,
    old_hash: oldHash,
    new_hash: newHash,
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

function downloadTranscript() {
  const content = "TRASCRIZIONE CHIAMATA HandTrackLIS\nData: " + new Date().toLocaleDateString('it-IT') + "\nDurata: 24 minuti - 47 gesti LIS riconosciuti\n---------------------------------------------\n\n[14:02] Lucia Conti: Ciao, come stai?\n[14:02] Mario Rossi: Sto bene, grazie!\n[14:03] Lucia Conti: Oggi voglio parlare del progetto.\n[14:03] Mario Rossi: Certo, sono pronto ad ascoltare.\n\n---------------------------------------------\nTrascrizione generata automaticamente da HandTrackLIS - LIS AI Engine v2.1\n";
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'trascrizione_handtracklis.txt'; a.click();
  URL.revokeObjectURL(url);
  showToast('Trascrizione scaricata');
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
document.addEventListener('DOMContentLoaded', () => {
  loadSession();
  if (currentUser) {
    startIncomingCallPoller();
    startNotificationPoller();
    goTo('page-dashboard');
  }
});

// ================================================================
// SETTINGS
// ================================================================
const SETTINGS_KEY = 'htl_settings';
const DEFAULT_SETTINGS = {
  subtitleSize: '16px', subtitlePos: 'panel', highContrast: false, confidence: false,
  langUI: 'it', langSub: 'it', darkMode: false, animations: true, statusBadge: true,
  autoSave: true, exportFormat: '.txt'
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    return Object.assign({}, DEFAULT_SETTINGS, saved || {});
  } catch(e) { return Object.assign({}, DEFAULT_SETTINGS); }
}
function persistSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

function applySettings(s) {
  if (s.darkMode) { document.body.classList.add('dark'); const td = document.getElementById('toggle-dark'); if (td) td.classList.add('on'); }
  else { document.body.classList.remove('dark'); const td = document.getElementById('toggle-dark'); if (td) td.classList.remove('on'); }
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
  _setSelectById('sel-export-fmt',    s.exportFormat);
  _syncToggle('toggle-contrast',  s.highContrast);
  _syncToggle('toggle-confidence',s.confidence);
  _syncToggle('toggle-dark',      s.darkMode);
  _syncToggle('toggle-anim',      s.animations);
  _syncToggle('toggle-status',    s.statusBadge);
  _syncToggle('toggle-save',      s.autoSave);
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
  const expFmt  = document.getElementById('sel-export-fmt');
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
    exportFormat:  expFmt  ? expFmt.value : loadSettings().exportFormat,
  };
}

function toggleBtn(btn) { btn.classList.toggle('on'); const s = readSettingsFromUI(); applySettings(s); }
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark');
  const td = document.getElementById('toggle-dark');
  if (td) { if (isDark) td.classList.add('on'); else td.classList.remove('on'); }
  const s = loadSettings(); s.darkMode = isDark; persistSettings(s);
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
    'hero.sub': 'HandTrackLIS usa la visione artificiale e l\'IA per riconoscere i gesti della Lingua dei Segni Italiana e generare sottotitoli in diretta — rendendo la comunicazione video accessibile a tutti.',
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
    'perm.sub': 'HandTrackLIS ha bisogno dell\'accesso a fotocamera, microfono e tracciamento della mano per funzionare.',
    'perm.camTitle': 'Accesso Fotocamera', 'perm.camDesc': 'Necessario per videochiamate e rilevamento gesti della mano.', 'perm.camBtn': 'Consenti Fotocamera',
    'perm.micTitle': 'Accesso Microfono', 'perm.micDesc': 'Abilita l\'audio durante le videochiamate.', 'perm.micBtn': 'Consenti Microfono',
    'perm.handTitle': 'Tracciamento Mano', 'perm.handDesc': 'Abilita il riconoscimento gesti LIS e la generazione di sottotitoli.', 'perm.handBtn': 'Abilita Tracciamento',
    'perm.privacy': 'Tutta l\'elaborazione video avviene localmente nel browser. Nessun dato gestuale viene inviato ai nostri server.',
    'perm.continueBtn': 'Continua alla Dashboard', 'perm.warning': 'Concedi tutti e tre i permessi per continuare.',
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
    'settings.subPos': 'Posizione Sottotitoli', 'settings.subPosDesc': 'Dove mostrare i sottotitoli durante la chiamata',
    'settings.highContrast': 'Alto Contrasto Sottotitoli', 'settings.highContrastDesc': 'Migliora la leggibilità con sfondo più scuro',
    'settings.confidence': 'Mostra Confidence Score', 'settings.confidenceDesc': 'Visualizza l\'affidabilità del riconoscimento',
    'settings.langTitle': 'Lingua e Localizzazione',
    'settings.langUI': 'Lingua Interfaccia', 'settings.langUIDesc': 'Lingua dei menu e delle notifiche',
    'settings.langSub': 'Lingua Sottotitoli LIS', 'settings.langSubDesc': 'Output testuale delle trascrizioni',
    'settings.appearTitle': 'Aspetto',
    'settings.darkMode': 'Modalità Scura', 'settings.darkModeDesc': 'Attiva il tema scuro per l\'intera applicazione',
    'settings.animations': 'Animazioni Interfaccia', 'settings.animationsDesc': 'Transizioni e animazioni nell\'app',
    'settings.statusBadge': 'Mostra Badge Status', 'settings.statusBadgeDesc': 'Visualizza il tuo stato online nella navbar',
    'settings.transcriptTitle': 'Trascrizioni e Dati',
    'settings.autoSave': 'Salvataggio Automatico', 'settings.autoSaveDesc': 'Salva le trascrizioni al termine di ogni chiamata',
    'settings.exportFmt': 'Formato Export', 'settings.exportFmtDesc': 'Tipo di file per le trascrizioni esportate',
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
    'hero.sub': 'HandTrackLIS uses computer vision and AI to recognize Italian Sign Language gestures and generate live subtitles — making video communication accessible to everyone.',
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
    'perm.sub': 'HandTrackLIS needs access to your camera, microphone and hand tracking to work.',
    'perm.camTitle': 'Camera Access', 'perm.camDesc': 'Required for video calls and hand gesture detection.', 'perm.camBtn': 'Allow Camera',
    'perm.micTitle': 'Microphone Access', 'perm.micDesc': 'Enables audio during video calls.', 'perm.micBtn': 'Allow Microphone',
    'perm.handTitle': 'Hand Tracking', 'perm.handDesc': 'Enables LIS gesture recognition and subtitle generation.', 'perm.handBtn': 'Enable Tracking',
    'perm.privacy': 'All video processing happens locally in the browser. No gesture data is sent to our servers.',
    'perm.continueBtn': 'Continue to Dashboard', 'perm.warning': 'Grant all three permissions to continue.',
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
    'settings.subPos': 'Subtitle Position', 'settings.subPosDesc': 'Where to show subtitles during a call',
    'settings.highContrast': 'High Contrast Subtitles', 'settings.highContrastDesc': 'Improve readability with a darker background',
    'settings.confidence': 'Show Confidence Score', 'settings.confidenceDesc': 'Display recognition reliability',
    'settings.langTitle': 'Language & Localization',
    'settings.langUI': 'Interface Language', 'settings.langUIDesc': 'Language for menus and notifications',
    'settings.langSub': 'LIS Subtitle Language', 'settings.langSubDesc': 'Text output for transcriptions',
    'settings.appearTitle': 'Appearance',
    'settings.darkMode': 'Dark Mode', 'settings.darkModeDesc': 'Enable the dark theme for the entire app',
    'settings.animations': 'Interface Animations', 'settings.animationsDesc': 'Transitions and animations in the app',
    'settings.statusBadge': 'Show Status Badge', 'settings.statusBadgeDesc': 'Display your online status in the navbar',
    'settings.transcriptTitle': 'Transcripts & Data',
    'settings.autoSave': 'Auto Save', 'settings.autoSaveDesc': 'Save transcripts at the end of each call',
    'settings.exportFmt': 'Export Format', 'settings.exportFmtDesc': 'File type for exported transcripts',
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
  }
};

function applyLangUI(lang) {
  const t = I18N[lang] || I18N['it'];
  _tagI18nElements();
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (!t[key]) return;
    if (el.classList.contains('sidebar-link') || el.getAttribute('data-i18n-textonly')) {
      const nodes = Array.from(el.childNodes);
      const textNode = nodes.reverse().find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      if (textNode) textNode.textContent = t[key];
    } else { el.textContent = t[key]; }
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