// ---- DARK MODE (persisted via localStorage) ----
function initDarkMode() {
  if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
    const t = document.getElementById('toggle-dark');
    if (t) t.classList.add('on');
  }
}

function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
  const on = document.body.classList.contains('dark-mode');
  localStorage.setItem('darkMode', on);
  const t = document.getElementById('toggle-dark');
  if (t) t.classList.toggle('on', on);
}

// ---- TOAST ----
function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ---- DOWNLOAD TRANSCRIPT ----
function downloadTranscript() {
  const content = `TRASCRIZIONE CHIAMATA HandTrackLIS
Data: ${new Date().toLocaleDateString('it-IT')}
Durata: 24 minuti · 47 gesti LIS riconosciuti
---------------------------------------------

[14:02] Lucia Conti: Ciao, come stai?
[14:02] Mario Rossi: Sto bene, grazie!
[14:03] Lucia Conti: Oggi voglio parlare del progetto.
[14:03] Mario Rossi: Certo, sono pronto ad ascoltare.
[14:04] Lucia Conti: Ho preparato alcune slide da mostrare.
[14:05] Mario Rossi: Ottimo, condividi pure.
[14:07] Lucia Conti: Come ti sembra il layout?
[14:08] Mario Rossi: Molto chiaro, ottimo lavoro!

---------------------------------------------
Trascrizione generata automaticamente da HandTrackLIS · LIS AI Engine v2.1
`;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'trascrizione_handtracklis.txt';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Trascrizione scaricata');
}

document.addEventListener('DOMContentLoaded', initDarkMode);
