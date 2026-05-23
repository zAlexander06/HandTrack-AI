// ================================================================
// HandTrackLIS — router.js
// Gestisce la navigazione cross-file.
// Va incluso PRIMA di script.js in ogni pagina.
// ================================================================

const PAGE_FILE_MAP = {
  'page-home':    'index.html',
  'page-how':     'index.html',
  'page-about':   'index.html',
  'page-privacy': 'index.html',

  'page-login':   'access.html',
  'page-forgot':  'access.html',

  'page-permissions': 'permission.html',

  'page-dashboard':       'dashboard.html',
  'page-recents':         'dashboard.html',
  'page-add-contact':     'dashboard.html',
  'page-settings':        'dashboard.html',
  'page-profile':         'dashboard.html',
  'page-guide-logged':    'dashboard.html',
  'page-privacy-logged':  'dashboard.html',
  'page-waiting':         'dashboard.html',
  'page-call':            'dashboard.html',
};

function _currentFile() {
  const parts = window.location.pathname.split('/');
  return parts[parts.length - 1] || 'index.html';
}

// Pagina attiva nell'HTML prima che script.js faccia qualcosa
const _ROUTER_INITIAL_PAGE = (document.querySelector('.page.active') || {}).id;

document.addEventListener('DOMContentLoaded', () => {
  const _nativeGoTo = window.goTo;

  // Dopo 1.5s l'init asincrono di script.js è certamente terminato
  let _initDone = false;
  setTimeout(() => { _initDone = true; }, 1500);

  window.goTo = function(pageId) {
    const targetFile = PAGE_FILE_MAP[pageId];
    const current    = _currentFile();

    if (!targetFile) {
      if (_nativeGoTo) _nativeGoTo(pageId);
      return;
    }

    if (targetFile === current || (current === '' && targetFile === 'index.html')) {
      // Durante l'init, blocca goTo verso la pagina già attiva per non
      // sovrascrivere lo stato UI (es. tab "Crea Account" su access.html).
      // Esegue però il caricamento dati necessario per la pagina.
      if (!_initDone && pageId === _ROUTER_INITIAL_PAGE) {
        if (pageId === 'page-dashboard'   && typeof loadContacts          === 'function') loadContacts();
        if (pageId === 'page-recents'     && typeof loadRecents           === 'function') loadRecents();
        if (pageId === 'page-add-contact' && typeof loadSuggestedContacts === 'function') {
          loadSuggestedContacts();
          if (typeof loadIncomingRequests === 'function') loadIncomingRequests();
        }
        return;
      }
      if (_nativeGoTo) _nativeGoTo(pageId);
    } else {
      sessionStorage.setItem('htl_current_page', pageId);
      window.location.href = targetFile;
    }
  };

  window.goToLogin = function() {
    sessionStorage.setItem('htl_login_tab', 'login');
    window.goTo('page-login');
  };
  window.goToRegister = function() {
    sessionStorage.setItem('htl_login_tab', 'signup');
    window.goTo('page-login');
  };
}, { once: true });