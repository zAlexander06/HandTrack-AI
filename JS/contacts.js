// ---- CONTACTS DATA ----
const contacts = [
  { initials:'LC', name:'Lucia Conti',        email:'lucia.conti@email.it',   status:'online',  color:'linear-gradient(135deg,#059669,#0d9488)', tag:'Utente LIS', tagClass:'tag-blue'   },
  { initials:'AF', name:'Alessandro Ferrari', email:'a.ferrari@email.it',     status:'online',  color:'linear-gradient(135deg,#059669,#0d9488)', tag:'Utente LIS', tagClass:'tag-blue'   },
  { initials:'GT', name:'Giulia Toscano',     email:'giulia.t@email.it',      status:'away',    color:'linear-gradient(135deg,#dc2626,#9f1239)', tag:'Interprete', tagClass:'tag-purple' },
  { initials:'MB', name:'Marco Bianchi',      email:'marco.bianchi@email.it', status:'online',  color:'linear-gradient(135deg,#7c3aed,#4f46e5)', tag:'',           tagClass:''           },
  { initials:'PS', name:'Pietro Sala',        email:'pietro.s@email.it',      status:'offline', color:'linear-gradient(135deg,#b45309,#92400e)', tag:'Utente LIS', tagClass:'tag-blue'   },
  { initials:'VN', name:'Valentina Neri',     email:'valentina.n@email.it',   status:'online',  color:'linear-gradient(135deg,#4f46e5,#7c3aed)', tag:'',           tagClass:''           },
  { initials:'SR', name:'Sofia Romano',       email:'sofia.r@email.it',       status:'offline', color:'linear-gradient(135deg,#0284c7,#0369a1)', tag:'',           tagClass:''           },
  { initials:'DM', name:'Davide Mancini',     email:'davide.m@email.it',      status:'offline', color:'linear-gradient(135deg,#6d28d9,#5b21b6)', tag:'',           tagClass:''           },
];

let contactFilter = '';
let statusFilter  = 'all';

function renderContacts() {
  const list = document.getElementById('contacts-list');
  if (!list) return;
  const filtered = contacts.filter(c => {
    const matchText   = c.name.toLowerCase().includes(contactFilter.toLowerCase()) ||
                        c.email.toLowerCase().includes(contactFilter.toLowerCase());
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchText && matchStatus;
  });
  if (!filtered.length) {
    list.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text3);">Nessun contatto trovato</div>';
    return;
  }
  const phoneIcon = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2'%3E%3Cpath d='M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 11.9 19.79 19.79 0 0 1 1.61 3.27 2 2 0 0 1 3.58 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.56a16 16 0 0 0 6 6'/%3E%3C/svg%3E`;
  const trashIcon = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23dc2626' stroke-width='2'%3E%3Cpolyline points='3 6 5 6 21 6'/%3E%3Cpath d='M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'/%3E%3C/svg%3E`;
  list.innerHTML = filtered.map(c => `
    <div class="contact-item">
      <div class="avatar" style="background:${c.color};">${c.initials}</div>
      <div class="status-dot ${c.status === 'online' ? 'status-online' : c.status === 'away' ? 'status-away' : 'status-offline'}"></div>
      <div class="contact-info">
        <div class="contact-name">${c.name}</div>
        <div class="contact-status">${c.email} · ${c.status === 'online' ? 'Online' : c.status === 'away' ? 'Assente' : 'Offline'}</div>
      </div>
      ${c.tag ? `<span class="tag ${c.tagClass}">${c.tag}</span>` : ''}
      <button class="btn btn-success text-xs" onclick="window.location.href='waiting.html'">
        <img src="${phoneIcon}" style="width:12px;height:12px;" alt="">Chiama
      </button>
      <button class="btn btn-danger-soft text-xs" onclick="removeContact(this, '${c.name}')">
        <img src="${trashIcon}" style="width:12px;height:12px;" alt="">Rimuovi
      </button>
    </div>
  `).join('');
}

function filterContacts(val) {
  contactFilter = val;
  renderContacts();
}

function filterContactsByStatus(val) {
  statusFilter = val;
  renderContacts();
}

function removeContact(btn, name) {
  const item = btn.closest('.contact-item');
  item.style.transition = 'all 0.3s';
  item.style.opacity    = '0';
  item.style.transform  = 'translateX(20px)';
  setTimeout(() => item.remove(), 300);
  showToast(name + ' rimosso dai contatti');
}

// ---- SUGGESTED CONTACTS (add-contact page) ----
const suggestedAll = [
  { name:'Alessandro Ferrari', handle:'@a.ferrari',   tag:'Utente LIS', tagClass:'tag-blue',   color:'linear-gradient(135deg,#059669,#0d9488)', initials:'AF' },
  { name:'Giulia Toscano',     handle:'@giulia.t',    tag:'Interprete', tagClass:'tag-purple', color:'linear-gradient(135deg,#dc2626,#9f1239)', initials:'GT' },
  { name:'Valentina Neri',     handle:'@valentina.n', tag:'',           tagClass:'',           color:'linear-gradient(135deg,#7c3aed,#4f46e5)', initials:'VN' },
  { name:'Pietro Sala',        handle:'@pietro.s',    tag:'Utente LIS', tagClass:'tag-blue',   color:'linear-gradient(135deg,#b45309,#92400e)', initials:'PS' },
  { name:'Roberto De Luca',    handle:'@roberto.d',   tag:'',           tagClass:'',           color:'linear-gradient(135deg,#0284c7,#0369a1)', initials:'RL' },
];

function filterSuggestedContacts() {
  const q       = document.getElementById('contact-search').value.toLowerCase();
  const results = document.getElementById('search-results');
  const searchIcon = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.5'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.35-4.35'/%3E%3C/svg%3E`;
  if (!q) {
    results.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text3);">
      <img src="${searchIcon}" style="width:36px;height:36px;opacity:0.25;display:block;margin:0 auto 8px;">
      <div class="text-sm">Digita per cercare utenti</div></div>`;
    return;
  }
  const found = suggestedAll.filter(s => s.name.toLowerCase().includes(q) || s.handle.includes(q));
  if (!found.length) {
    results.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3);" class="text-sm">Nessun utente trovato</div>';
    return;
  }
  results.innerHTML = found.map(s => `
    <div class="contact-item">
      <div class="avatar" style="background:${s.color};">${s.initials}</div>
      <div class="contact-info">
        <div class="contact-name">${s.name}</div>
        <div class="contact-status">${s.handle}</div>
      </div>
      ${s.tag ? `<span class="tag ${s.tagClass}">${s.tag}</span>` : ''}
      <button class="btn btn-primary text-xs" onclick="addedContact(this)">+ Aggiungi</button>
    </div>
  `).join('');
}

function addedContact(btn) {
  btn.textContent  = 'Aggiunto ✓';
  btn.disabled     = true;
  btn.style.opacity = '0.6';
  showToast('Richiesta di contatto inviata');
}

document.addEventListener('DOMContentLoaded', renderContacts);
