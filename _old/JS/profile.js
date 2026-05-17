/* =====================================================================
   HandTrackLIS — profile.js
   ===================================================================== */
'use strict';

/* ── API helpers ────────────────────────────────────────────────────── */
async function apiGet(endpoint) {
  const res  = await fetch(`api/${endpoint}`, { credentials: 'same-origin' });
  return res.json();
}
async function apiPost(endpoint, body) {
  const res  = await fetch(`api/${endpoint}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

/* ── State ──────────────────────────────────────────────────────────── */
let profile      = null;   // { id, username, email, role, avatar_url, avatar_color, avatar_initials, created_at }
let allFriends   = [];     // raw list from API
let friendFilter = 'all';
let friendQuery  = '';
let selectedPresetColor = '#7c3aed';
let selectedPresetInitials = '';

/* ── Avatar rendering ───────────────────────────────────────────────── */
const AVATAR_GRADIENTS = [
  ['#7c3aed','#4f46e5'], ['#059669','#0d9488'], ['#dc2626','#9f1239'],
  ['#0284c7','#0369a1'], ['#b45309','#92400e'], ['#4f46e5','#7c3aed'],
  ['#be185d','#9d174d'], ['#15803d','#166534'],
];

function renderAvatarEl(el, { url, color, initials }) {
  if (url) {
    el.style.background = '#1e293b';
    el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="avatar"/>`;
  } else {
    el.style.background = color || 'linear-gradient(135deg,#7c3aed,#4f46e5)';
    el.textContent = initials || '??';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
  }
}

function refreshAvatarUI() {
  if (!profile) return;
  const avData = {
    url:      profile.avatar_url      || null,
    color:    profile.avatar_color    || 'linear-gradient(135deg,#7c3aed,#4f46e5)',
    initials: profile.avatar_initials || initials(profile.username),
  };
  renderAvatarEl(document.getElementById('avatar-img'), avData);
  // Nav avatar too
  const nav = document.getElementById('nav-avatar');
  if (nav) {
    nav.textContent = '';
    renderAvatarEl(nav, avData);
    nav.style.width  = '32px';
    nav.style.height = '32px';
    nav.style.fontSize = '11px';
  }
}

function initials(username) {
  if (!username) return '??';
  const parts = username.replace(/\./g,' ').split(' ').filter(Boolean);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : username.slice(0,2).toUpperCase();
}

/* ── Load profile from API ──────────────────────────────────────────── */
async function loadProfile() {
  const res = await apiGet('profile.php');
  if (!res.ok) {
    // Not logged in — redirect
    window.location.href = 'login.html';
    return;
  }
  profile = res.user;

  document.getElementById('username-val').textContent    = profile.username;
  document.getElementById('profile-email').value         = profile.email;
  document.getElementById('username-input').value        = profile.username;
  document.getElementById('member-since').textContent    = fmtDate(profile.created_at);

  const roleMap = { user:'Utente', admin:'Admin', moderator:'Moderatore', onThinIce:'⚠ On Thin Ice' };
  const roleEl  = document.getElementById('role-badge');
  roleEl.textContent = roleMap[profile.role] || profile.role;
  if (profile.role === 'admin')       roleEl.className = 'badge badge-yellow';
  else if (profile.role === 'moderator') roleEl.className = 'badge badge-blue';

  selectedPresetInitials = initials(profile.username);
  refreshAvatarUI();
  loadStats();
  loadFriends();
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('it-IT', { year:'numeric', month:'long', day:'numeric' });
}

/* ── Stats ──────────────────────────────────────────────────────────── */
async function loadStats() {
  const res = await apiGet('friends.php?stats=1');
  if (!res.ok) return;
  document.getElementById('stat-friends').textContent  = res.stats.accepted  ?? '0';
  document.getElementById('stat-calls').textContent    = res.stats.calls     ?? '0';
  document.getElementById('stat-pending').textContent  = res.stats.pending   ?? '0';
}

/* ── Friends list ───────────────────────────────────────────────────── */
async function loadFriends() {
  const res = await apiGet('friends.php');
  if (!res.ok) return;
  allFriends = res.friends || [];
  renderFriends();
}

function filterFriends(q) {
  friendQuery = q.toLowerCase();
  renderFriends();
}

function setFriendFilter(filter, btn) {
  friendFilter = filter;
  document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active-filter'));
  btn.classList.add('active-filter');
  renderFriends();
}

function statusLabel(s) {
  return s === 'online' ? 'Online' : s === 'away' ? 'Assente' : 'Offline';
}
function statusDotClass(s) {
  return s === 'online' ? 'status-online' : s === 'away' ? 'status-away' : 'status-offline';
}

function friendCardHTML(f) {
  const av = f.avatar_url
    ? `<img src="${f.avatar_url}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;" alt=""/>`
    : `<div class="avatar" style="width:40px;height:40px;font-size:13px;flex-shrink:0;background:${f.avatar_color || 'linear-gradient(135deg,#7c3aed,#4f46e5)'};">${f.initials || initials(f.username)}</div>`;
  const statusDot  = f.contact_status === 'pending'
    ? `<span class="badge badge-yellow" style="font-size:10px;padding:2px 8px;">In attesa</span>`
    : `<span class="status-dot ${statusDotClass(f.status_user)}" title="${statusLabel(f.status_user)}"></span>`;

  return `<div class="friend-card" id="fc-${f.id}">
    ${av}
    <div class="fc-info">
      <div class="fc-name">${escHtml(f.username)}</div>
      <div class="fc-meta">${escHtml(f.email)}</div>
    </div>
    ${statusDot}
    ${f.contact_status === 'accepted'
      ? `<button class="btn btn-success text-xs" onclick="callFriend(${f.id},'${escHtml(f.username)}')">
           <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" style="flex-shrink:0;">
             <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 11.9 19.79 19.79 0 0 1 1.61 3.27 2 2 0 0 1 3.58 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.56a16 16 0 0 0 6 6"/>
           </svg>Chiama
         </button>`
      : ''}
  </div>`;
}

function renderFriends() {
  const list = document.getElementById('friends-list');
  let filtered = allFriends.filter(f => {
    const matchQ = !friendQuery
      || f.username.toLowerCase().includes(friendQuery)
      || f.email.toLowerCase().includes(friendQuery);
    const matchF = friendFilter === 'all'
      || (friendFilter === 'pending'  && f.contact_status === 'pending')
      || (friendFilter === 'online'   && f.status_user === 'online' && f.contact_status === 'accepted')
      || (friendFilter === 'offline'  && f.status_user !== 'online' && f.contact_status === 'accepted');
    return matchQ && matchF;
  });

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-friends">
      <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      <p style="font-size:13px;">Nessun contatto trovato</p>
    </div>`;
    return;
  }
  list.innerHTML = filtered.map(friendCardHTML).join('');
}

function callFriend(id, username) {
  showToast(`📞 Chiamando ${username}…`);
  setTimeout(() => { window.location.href = 'waiting.html'; }, 700);
}

/* ── Username editing ───────────────────────────────────────────────── */
function initUsernameEdit() {
  const display   = document.getElementById('username-display');
  const form      = document.getElementById('username-form');
  const input     = document.getElementById('username-input');
  const errEl     = document.getElementById('username-error');
  const editBtn   = document.getElementById('edit-username-btn');
  const saveBtn   = document.getElementById('save-username-btn');
  const cancelBtn = document.getElementById('cancel-username-btn');

  editBtn.addEventListener('click', () => {
    display.style.display = 'none';
    form.style.display    = 'flex';
    input.value           = profile?.username || '';
    input.focus();
    errEl.style.display   = 'none';
  });

  cancelBtn.addEventListener('click', () => {
    display.style.display = 'flex';
    form.style.display    = 'none';
    errEl.style.display   = 'none';
  });

  saveBtn.addEventListener('click', async () => {
    const val = input.value.trim();
    errEl.style.display = 'none';
    input.style.outline = '';

    if (!val || val.length < 3) {
      input.style.outline = '2px solid var(--red)';
      errEl.textContent   = 'Minimo 3 caratteri.';
      errEl.style.display = 'block';
      return;
    }
    if (!/^[a-z0-9_.]+$/i.test(val)) {
      input.style.outline = '2px solid var(--red)';
      errEl.textContent   = 'Solo lettere, numeri, punti e underscore.';
      errEl.style.display = 'block';
      return;
    }

    saveBtn.disabled     = true;
    saveBtn.textContent  = '⏳';
    const res = await apiPost('profile.php', { action: 'update_username', username: val });
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Salva';

    if (!res.ok) {
      input.style.outline = '2px solid var(--red)';
      errEl.textContent   = res.error;
      errEl.style.display = 'block';
      return;
    }

    profile.username = val;
    selectedPresetInitials = initials(val);
    document.getElementById('username-val').textContent = val;
    display.style.display = 'flex';
    form.style.display    = 'none';
    refreshAvatarUI();
    showToast('✅ Username aggiornato');
  });

  // Save on Enter
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveBtn.click();
    if (e.key === 'Escape') cancelBtn.click();
  });
}

/* ── Avatar file upload ─────────────────────────────────────────────── */
function initAvatarUpload() {
  const fileInput = document.getElementById('avatar-file');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('⚠️ File troppo grande (max 2 MB)'); return; }
    if (!file.type.startsWith('image/')) { showToast('⚠️ Formato non supportato'); return; }

    // Preview immediately
    const reader = new FileReader();
    reader.onload = e => {
      profile.avatar_url   = e.target.result;
      profile.avatar_color = null;
      refreshAvatarUI();
    };
    reader.readAsDataURL(file);

    // Upload
    const progress = document.getElementById('upload-progress');
    const bar      = document.getElementById('upload-bar');
    progress.style.display = 'block';
    bar.style.width = '0%';

    // Simulate progress ticks while actual fetch runs
    let pct = 0;
    const tick = setInterval(() => { pct = Math.min(pct + 10, 85); bar.style.width = pct + '%'; }, 150);

    const fd = new FormData();
    fd.append('avatar', file);
    const res  = await fetch('api/upload-avatar.php', { method:'POST', credentials:'same-origin', body: fd });
    const data = await res.json();
    clearInterval(tick);
    bar.style.width = '100%';
    setTimeout(() => { progress.style.display = 'none'; }, 500);
    fileInput.value = '';

    if (!data.ok) { showToast('❌ ' + (data.error || 'Errore upload')); return; }
    profile.avatar_url = data.avatar_url;
    refreshAvatarUI();
    showToast('🖼 Immagine aggiornata');
  });
}

function removeAvatar() {
  profile.avatar_url   = null;
  profile.avatar_color = 'linear-gradient(135deg,#7c3aed,#4f46e5)';
  profile.avatar_initials = initials(profile.username);
  refreshAvatarUI();
  apiPost('profile.php', { action: 'remove_avatar' });
  showToast('Avatar rimosso');
}

/* ── Preset modal ───────────────────────────────────────────────────── */
const PRESET_EMOJIS  = ['😀','😎','🤖','🦊','🐬','🦁','🌟','🎮','🎨','🔥','⚡','🌈'];
const PRESET_COLORS  = [
  'linear-gradient(135deg,#7c3aed,#4f46e5)',
  'linear-gradient(135deg,#059669,#0d9488)',
  'linear-gradient(135deg,#dc2626,#9f1239)',
  'linear-gradient(135deg,#0284c7,#0369a1)',
  'linear-gradient(135deg,#b45309,#92400e)',
  'linear-gradient(135deg,#be185d,#9d174d)',
  'linear-gradient(135deg,#15803d,#166534)',
  'linear-gradient(135deg,#1e3a8a,#1e40af)',
];

function buildPresetModal() {
  const grid   = document.getElementById('preset-grid');
  const swatches = document.getElementById('color-swatches');

  // Emoji circles
  grid.innerHTML = PRESET_EMOJIS.map(e =>
    `<div class="preset-circle" data-type="emoji" data-val="${e}"
          style="background:${selectedPresetColor};font-size:22px;"
          onclick="selectPresetCircle(this)">${e}</div>`
  ).join('');

  // Initials circle
  const initCircle = document.createElement('div');
  initCircle.className = 'preset-circle selected';
  initCircle.dataset.type = 'initials';
  initCircle.dataset.val  = selectedPresetInitials;
  initCircle.style.background = selectedPresetColor;
  initCircle.style.fontSize   = '16px';
  initCircle.textContent = selectedPresetInitials;
  grid.prepend(initCircle);

  // Color swatches
  swatches.innerHTML = PRESET_COLORS.map(c =>
    `<div style="width:26px;height:26px;border-radius:50%;background:${c};cursor:pointer;
                 border:2px solid ${c === selectedPresetColor ? 'var(--accent)' : 'transparent'};
                 transition:all .15s;"
          onclick="selectPresetColor('${c}', this)"></div>`
  ).join('');
}

function selectPresetCircle(el) {
  document.querySelectorAll('.preset-circle').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
}

function selectPresetColor(color, swatchEl) {
  selectedPresetColor = color;
  document.querySelectorAll('.preset-circle').forEach(c => { c.style.background = color; });
  document.querySelectorAll('#color-swatches > div').forEach(s => {
    s.style.border = s === swatchEl ? '2px solid var(--accent)' : '2px solid transparent';
  });
}

function openPresetModal() {
  buildPresetModal();
  document.getElementById('preset-modal').classList.add('open');
}

function closePresetModal() {
  document.getElementById('preset-modal').classList.remove('open');
}

function applyPreset() {
  const selected = document.querySelector('.preset-circle.selected');
  if (!selected) { closePresetModal(); return; }

  profile.avatar_url      = null;
  profile.avatar_color    = selectedPresetColor;
  profile.avatar_initials = selected.dataset.val;
  refreshAvatarUI();

  apiPost('profile.php', {
    action:          'update_avatar_preset',
    avatar_color:    selectedPresetColor,
    avatar_initials: selected.dataset.val,
  });

  closePresetModal();
  showToast('✅ Avatar aggiornato');
}

/* ── Logout ─────────────────────────────────────────────────────────── */
function initLogout() {
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await apiPost('logout.php', {});
    sessionStorage.removeItem('user');
    window.location.href = 'login.html';
  });
}

/* ── CSS: active-filter button style ────────────────────────────────── */
function injectFilterStyle() {
  const s = document.createElement('style');
  s.textContent = `.active-filter{background:var(--accent);color:#fff;border-color:var(--accent);}`;
  document.head.appendChild(s);
}

/* ── Escape HTML helper ─────────────────────────────────────────────── */
function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Close preset modal on backdrop click ────────────────────────────── */
document.addEventListener('click', e => {
  const modal = document.getElementById('preset-modal');
  if (e.target === modal) closePresetModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePresetModal();
});

/* ── Init ───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  injectFilterStyle();
  initUsernameEdit();
  initAvatarUpload();
  initLogout();
  loadProfile();
});
