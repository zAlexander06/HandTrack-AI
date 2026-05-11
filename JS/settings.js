// ---- GENERIC TOGGLE ----
function toggleBtn(btn) { btn.classList.toggle('on'); }

// ---- SAVE SETTINGS ----
function saveSettings() {
  showToast('Impostazioni salvate con successo');
  setTimeout(() => { window.location.href = 'dashboard.html'; }, 1200);
}
