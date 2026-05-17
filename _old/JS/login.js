/* ── Shared API helper ──────────────────────────────────────────────── */
async function apiFetch(endpoint, body) {
  const res  = await fetch(`api/${endpoint}`, {
    method:      'POST',
    credentials: 'same-origin',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify(body),
  });
  const data = await res.json();
  return data; // { ok: true/false, error?, ...payload }
}

/* ── Tab switch ─────────────────────────────────────────────────────── */
function showTab(showId, hideId, clickedBtn) {
  const shown = document.getElementById(showId);
  shown.style.display       = 'flex';
  shown.style.flexDirection = 'column';
  document.getElementById(hideId).style.display = 'none';
  clickedBtn.parentElement.querySelectorAll('.pill-tab')
    .forEach(t => t.classList.remove('active'));
  clickedBtn.classList.add('active');
}

/* ── Field helpers ──────────────────────────────────────────────────── */
function setError(inputEl, msgEl, msg) {
  if (msgEl) { msgEl.textContent = msg; msgEl.style.display = msg ? 'block' : 'none'; }
  inputEl.style.outline = msg ? '2px solid #ef4444' : '';
}

function clearErrors(...inputEls) {
  inputEls.forEach(el => { el.style.outline = ''; });
}

function setLoading(btn, loading) {
  btn.disabled     = loading;
  btn.dataset.orig = btn.dataset.orig || btn.textContent;
  btn.textContent  = loading ? 'Caricamento…' : btn.dataset.orig;
}

/* ── LOGIN ──────────────────────────────────────────────────────────── */
function initLogin() {
  const form    = document.getElementById('login-inner');
  const loginEl = form.querySelector('input[type="email"]');
  const passEl  = form.querySelector('input[type="password"]');
  const errEl   = document.getElementById('login-error');
  const btn     = form.querySelector('button.btn-primary');

  btn.addEventListener('click', async () => {
    clearErrors(loginEl, passEl);
    const login    = loginEl.value.trim();
    const password = passEl.value;

    if (!login)    { loginEl.style.outline = '2px solid #ef4444'; loginEl.focus(); return; }
    if (!password) { passEl.style.outline  = '2px solid #ef4444'; passEl.focus();  return; }

    setLoading(btn, true);
    const res = await apiFetch('login.php', { login, password });
    setLoading(btn, false);

    if (!res.ok) {
      errEl.textContent  = res.error;
      errEl.style.display = 'block';
      passEl.style.outline = '2px solid #ef4444';
      passEl.focus();
      return;
    }

    // Save minimal user info in sessionStorage for other pages to read
    sessionStorage.setItem('user', JSON.stringify(res.user));
    window.location.href = 'permissions.html';
  });
}

/* ── REGISTER ───────────────────────────────────────────────────────── */
function validateMatch(inputA, inputB, errEl) {
  const ok = !inputB.value || inputA.value === inputB.value;
  setError(inputB, errEl, ok ? '' : (errEl ? errEl.dataset.msg : 'Non coincidono'));
  return inputA.value === inputB.value;
}

function initSignup() {
  const email  = document.getElementById('su-email');
  const email2 = document.getElementById('su-email2');
  const pass   = document.getElementById('su-pass');
  const pass2  = document.getElementById('su-pass2');
  const errE   = document.getElementById('err-email');
  const errP   = document.getElementById('err-pass');
  const errG   = document.getElementById('signup-error');
  const btn    = document.getElementById('signup-btn');

  email2.addEventListener('input', () => validateMatch(email,  email2, errE));
  pass2.addEventListener('input',  () => validateMatch(pass,   pass2,  errP));
  email.addEventListener('input',  () => { if (email2.value)  validateMatch(email,  email2, errE); });
  pass.addEventListener('input',   () => { if (pass2.value)   validateMatch(pass,   pass2,  errP); });

  btn.addEventListener('click', async () => {
    const form      = document.getElementById('signup-inner');
    const firstName = form.querySelector('input[placeholder="Mario"]').value.trim();
    const lastName  = form.querySelector('input[placeholder="Rossi"]').value.trim();
    const emailOk   = validateMatch(email, email2, errE);
    const passOk    = validateMatch(pass,  pass2,  errP);
    errG.style.display = 'none';

    if (!firstName || !lastName || !email.value || !pass.value || !emailOk || !passOk) {
      if (!firstName || !lastName) errG.textContent = 'Nome e cognome sono obbligatori.', errG.style.display = 'block';
      return;
    }

    function script(){
      return window.location.href;
    }

    setLoading(btn, true);
    const res = await apiFetch('../api/register.php', {
      firstName,
      lastName,
      email:     email.value.trim(),
      email2:    email2.value.trim(),
      password:  pass.value,
      password2: pass2.value,
    });
    setLoading(btn, false);

    if (!res.ok) {
      errG.textContent   = res.error;
      errG.style.display = 'block';
      return;
    }

    sessionStorage.setItem('user', JSON.stringify(res.user));
    window.location.href = 'permissions.html';
  });
}

/* ── FORGOT PASSWORD ────────────────────────────────────────────────── */
function openForgot() {
  const modal = document.getElementById('forgot-modal');
  modal.style.display = 'flex';
  document.getElementById('forgot-form').style.display  = 'block';
  document.getElementById('forgot-sent').style.display  = 'none';
  document.getElementById('forgot-email').value = '';
  document.getElementById('forgot-email').style.outline = '';
  document.getElementById('forgot-email').focus();
}

function closeForgot() {
  document.getElementById('forgot-modal').style.display = 'none';
}

function initForgot() {
  document.getElementById('forgot-link').addEventListener('click', openForgot);

  const sendBtn = document.getElementById('forgot-send-btn');
  sendBtn.addEventListener('click', async () => {
    const emailEl = document.getElementById('forgot-email');
    const val     = emailEl.value.trim();
    if (!val || !val.includes('@')) {
      emailEl.style.outline = '2px solid #ef4444';
      emailEl.focus();
      return;
    }
    emailEl.style.outline = '';

    setLoading(sendBtn, true);
    const res = await apiFetch('forgot-password.php', { email: val });
    setLoading(sendBtn, false);

    // Always show success (anti-enumeration)
    document.getElementById('forgot-sent-addr').textContent = val;
    document.getElementById('forgot-form').style.display = 'none';
    document.getElementById('forgot-sent').style.display = 'block';
  });

  document.getElementById('forgot-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeForgot();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeForgot();
  });
}

/* ── INIT ───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initLogin();
  initSignup();
  initForgot();
});

