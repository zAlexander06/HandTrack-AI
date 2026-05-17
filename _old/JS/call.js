/* =====================================================================
   HandTrackLIS — call.js   Full interactive video-call simulation
   ===================================================================== */
'use strict';

/* ── SHARED STATE ──────────────────────────────────────────────────── */
const STATE = {
  mic:    true,
  camera: true,
  screen: false,
  hand:   true,
  view:   'speaker',   // 'speaker' | 'grid'
  sidebar: true,
  activeSpeakerId: 'lucia',
};

/* ── PARTICIPANTS ───────────────────────────────────────────────────── */
const PARTICIPANTS = [
  { id:'lucia',  name:'Lucia Conti',        initials:'LC', color:'linear-gradient(135deg,#059669,#0d9488)', micOn:true,  present:true,  self:false },
  { id:'mario',  name:'Mario Rossi (Tu)',   initials:'MR', color:'linear-gradient(135deg,#7c3aed,#4f46e5)', micOn:true,  present:true,  self:true  },
  { id:'ale',    name:'Alessandro Ferrari', initials:'AF', color:'linear-gradient(135deg,#dc2626,#9f1239)', micOn:true,  present:false, self:false },
  { id:'giulia', name:'Giulia Toscano',     initials:'GT', color:'linear-gradient(135deg,#0284c7,#0369a1)', micOn:false, present:false, self:false },
  { id:'marco',  name:'Marco Bianchi',      initials:'MB', color:'linear-gradient(135deg,#b45309,#92400e)', micOn:true,  present:false, self:false },
];

const presentParticipants = () => PARTICIPANTS.filter(p => p.present);

/* ── TIMER ─────────────────────────────────────────────────────────── */
const Timer = (() => {
  let secs = 0, iv = null;
  const el  = () => document.getElementById('call-timer');
  const fmt = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  return {
    start() { secs=0; el().textContent=fmt(0); clearInterval(iv); iv=setInterval(()=>{ secs++; el().textContent=fmt(secs); },1000); },
    stop()  { clearInterval(iv); },
  };
})();

/* ── CONTROLS ──────────────────────────────────────────────────────── */
const Controls = (() => {
  const SVG = {
    micOn:   `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Crect x='9' y='2' width='6' height='12' rx='3'/%3E%3Cpath d='M5 10a7 7 0 0 0 14 0M12 19v3M8 22h8'/%3E%3C/svg%3E`,
    micOff:  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cline x1='1' y1='1' x2='23' y2='23'/%3E%3Cpath d='M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6'/%3E%3Cpath d='M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v3M8 22h8'/%3E%3C/svg%3E`,
    camOn:   `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Crect x='2' y='6' width='20' height='14' rx='2'/%3E%3Ccircle cx='12' cy='13' r='3'/%3E%3C/svg%3E`,
    camOff:  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cline x1='1' y1='1' x2='23' y2='23'/%3E%3Cpath d='M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34'/%3E%3C/svg%3E`,
    handOn:  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%233b82f6' stroke-width='2'%3E%3Cpath d='M6 9V5a2 2 0 0 1 4 0v4M10 9V4a2 2 0 0 1 4 0v5M14 9V6a2 2 0 0 1 4 0v6a6 6 0 0 1-12 0V9'/%3E%3C/svg%3E`,
    handOff: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M6 9V5a2 2 0 0 1 4 0v4M10 9V4a2 2 0 0 1 4 0v5M14 9V6a2 2 0 0 1 4 0v6a6 6 0 0 1-12 0V9'/%3E%3C/svg%3E`,
  };

  function toggleMic() {
    STATE.mic = !STATE.mic;
    const btn = document.getElementById('btn-mic');
    document.getElementById('icon-mic').src = STATE.mic ? SVG.micOn : SVG.micOff;
    btn.classList.toggle('cb-muted', !STATE.mic);
    btn.dataset.tip = STATE.mic ? 'Microfono (M)' : 'Riattiva mic (M)';
    GridView.refreshSelfMic();
    showToast(STATE.mic ? '🎙 Microfono attivato' : '🔇 Microfono disattivato');
  }

  function toggleCamera() {
    STATE.camera = !STATE.camera;
    const btn        = document.getElementById('btn-cam');
    const localVid   = document.getElementById('local-video');
    const pipCamOff  = document.getElementById('pip-cam-off');
    const pipPh      = document.getElementById('pip-ph');
    document.getElementById('icon-cam').src = STATE.camera ? SVG.camOn : SVG.camOff;
    btn.classList.toggle('cb-muted', !STATE.camera);
    btn.dataset.tip = STATE.camera ? 'Fotocamera (V)' : 'Attiva camera (V)';
    if (STATE.camera) {
      pipCamOff.style.display = 'none';
      if (localVid.srcObject) {
        localVid.srcObject.getVideoTracks().forEach(t => { t.enabled = true; });
        localVid.style.display = 'block';
        pipPh.style.display    = 'none';
      } else {
        pipPh.style.display = 'flex';
      }
    } else {
      pipCamOff.style.display = 'flex';
      pipPh.style.display     = 'none';
      localVid.style.display  = 'none';
      if (localVid.srcObject) {
        localVid.srcObject.getVideoTracks().forEach(t => { t.enabled = false; });
      }
    }
    showToast(STATE.camera ? '📷 Camera attivata' : '📷 Camera disattivata');
  }

  async function toggleScreen() {
    if (STATE.screen) {
      STATE.screen = false;
      document.getElementById('btn-screen').classList.remove('cb-screen-on');
      document.getElementById('btn-screen').dataset.tip = 'Schermo (S)';
      document.getElementById('screen-banner').classList.remove('show');
      showToast('🖥 Condivisione schermo terminata');
      return;
    }
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        STATE.screen = true;
        document.getElementById('btn-screen').classList.add('cb-screen-on');
        document.getElementById('btn-screen').dataset.tip = 'Stop schermo (S)';
        document.getElementById('screen-banner').classList.add('show');
        showToast('🖥 Condivisione schermo avviata');
        stream.getVideoTracks()[0].onended = () => { if (STATE.screen) toggleScreen(); };
        return;
      } catch { /* user cancelled */ }
    }
    // Simulated fallback
    STATE.screen = true;
    document.getElementById('btn-screen').classList.add('cb-screen-on');
    document.getElementById('btn-screen').dataset.tip = 'Stop schermo (S)';
    document.getElementById('screen-banner').classList.add('show');
    showToast('🖥 Condivisione schermo avviata (simulata)');
  }

  function toggleHand() {
    STATE.hand = !STATE.hand;
    const btn = document.getElementById('btn-hand');
    document.getElementById('icon-hand').src = STATE.hand ? SVG.handOn : SVG.handOff;
    btn.classList.toggle('cb-active', STATE.hand);
    document.getElementById('lis-badge').style.opacity = STATE.hand ? '1' : '0.35';
    showToast(STATE.hand ? '✋ Tracciamento LIS attivo' : '✋ Tracciamento LIS disattivato');
  }

  function endCall() {
    Timer.stop();
    ActiveSpeaker.stop();
    showToast('📵 Chiamata terminata');
    setTimeout(() => { window.location.href = 'dashboard.html'; }, 900);
  }

  function init() {
    document.getElementById('btn-mic').addEventListener('click', toggleMic);
    document.getElementById('btn-cam').addEventListener('click', toggleCamera);
    document.getElementById('btn-screen').addEventListener('click', toggleScreen);
    document.getElementById('btn-hand').addEventListener('click', toggleHand);
    document.getElementById('btn-end').addEventListener('click', endCall);
  }

  return { init, toggleMic, toggleCamera, toggleScreen, toggleHand, endCall };
})();

/* ── GRID VIEW ─────────────────────────────────────────────────────── */
const GridView = (() => {
  const MIC_ON  = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3M8 22h8"/></svg>`;
  const MIC_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2"/></svg>`;

  function cols(n) { return n <= 2 ? '1fr 1fr' : n <= 4 ? '1fr 1fr' : '1fr 1fr 1fr'; }

  function html(p) {
    return `<div class="grid-tile in" id="tile-${p.id}" data-id="${p.id}">
      <div class="tile-ph">
        <div class="tile-avatar" style="background:${p.color};">${p.initials}</div>
      </div>
      <div class="tile-mic ${p.micOn ? '' : 'muted'}" id="tile-mic-${p.id}">${p.micOn ? MIC_ON : MIC_OFF}</div>
      <div class="tile-name">${p.name}</div>
    </div>`;
  }

  function rebuild() {
    const grid = document.getElementById('grid-view');
    const ps   = presentParticipants();
    grid.innerHTML = ps.map(html).join('');
    grid.style.gridTemplateColumns = cols(ps.length);
    ActiveSpeaker.applyHighlight();
  }

  function addTile(p) {
    const grid = document.getElementById('grid-view');
    const div  = document.createElement('div');
    div.innerHTML = html(p);
    grid.appendChild(div.firstElementChild);
    grid.style.gridTemplateColumns = cols(presentParticipants().length);
    ActiveSpeaker.applyHighlight();
  }

  function removeTile(id) {
    const tile = document.getElementById(`tile-${id}`);
    if (!tile) return;
    tile.classList.replace('in','out');
    setTimeout(() => {
      tile.remove();
      const grid = document.getElementById('grid-view');
      grid.style.gridTemplateColumns = cols(presentParticipants().length);
    }, 320);
  }

  function refreshSelfMic() {
    const el = document.getElementById('tile-mic-mario');
    if (!el) return;
    el.classList.toggle('muted', !STATE.mic);
    el.innerHTML = STATE.mic ? MIC_ON : MIC_OFF;
  }

  return { rebuild, addTile, removeTile, refreshSelfMic };
})();

/* ── VIEW MANAGER ──────────────────────────────────────────────────── */
const ViewManager = (() => {
  function showSpeaker() {
    STATE.view = 'speaker';
    document.getElementById('speaker-view').style.display = 'block';
    document.getElementById('grid-view').classList.remove('visible');
    document.getElementById('view-label').textContent = 'Griglia';
    document.getElementById('btn-view').classList.remove('on');
    document.getElementById('pip-self').style.display  = 'flex';
    document.getElementById('spk-label').style.display = 'flex';
    showToast('▣ Vista relatore attiva');
  }

  function showGrid() {
    STATE.view = 'grid';
    document.getElementById('speaker-view').style.display = 'none';
    GridView.rebuild();
    document.getElementById('grid-view').classList.add('visible');
    document.getElementById('view-label').textContent = 'Relatore';
    document.getElementById('btn-view').classList.add('on');
    document.getElementById('pip-self').style.display  = 'none';
    document.getElementById('spk-label').style.display = 'none';
    showToast('⊞ Vista griglia attiva');
  }

  function toggle() { STATE.view === 'speaker' ? showGrid() : showSpeaker(); }

  function init() {
    document.getElementById('btn-view').addEventListener('click', toggle);
  }

  return { init, toggle, showSpeaker, showGrid };
})();

/* ── SIDEBAR ───────────────────────────────────────────────────────── */
const Sidebar = (() => {
  function open() {
    STATE.sidebar = true;
    document.getElementById('call-sidebar').classList.remove('closed');
    document.getElementById('btn-sidebar').classList.add('on');
  }
  function close() {
    STATE.sidebar = false;
    document.getElementById('call-sidebar').classList.add('closed');
    document.getElementById('btn-sidebar').classList.remove('on');
  }
  function toggle() { STATE.sidebar ? close() : open(); }
  function init()   { document.getElementById('btn-sidebar').addEventListener('click', toggle); }
  return { init, open, close, toggle };
})();

/* ── ACTIVE SPEAKER ────────────────────────────────────────────────── */
const ActiveSpeaker = (() => {
  let timer = null;

  function candidates() {
    return PARTICIPANTS.filter(p => p.present && !p.self && p.micOn);
  }

  function set(id) {
    STATE.activeSpeakerId = id;
    const p = PARTICIPANTS.find(x => x.id === id);
    if (!p) return;
    const names = [
      document.getElementById('spk-label'),
      document.getElementById('main-label'),
      document.getElementById('main-ph-name'),
    ];
    names.forEach(el => { if (el) el.textContent = p.name; });
    applyHighlight();
  }

  function applyHighlight() {
    document.querySelectorAll('.grid-tile').forEach(t => {
      t.classList.toggle('speaker', t.dataset.id === STATE.activeSpeakerId);
    });
    const box = document.getElementById('main-video-box');
    if (box) {
      box.classList.add('active-glow');
      setTimeout(() => box.classList.remove('active-glow'), 800);
    }
  }

  function rotate() {
    const list = candidates();
    if (!list.length) return;
    const cur  = list.findIndex(p => p.id === STATE.activeSpeakerId);
    const next = list[(cur + 1) % list.length];
    set(next.id);
  }

  function schedule() {
    timer = setTimeout(() => { rotate(); schedule(); }, 4000 + Math.random() * 3000);
  }

  function start() { clearTimeout(timer); schedule(); }
  function stop()  { clearTimeout(timer); }

  return { start, stop, set, applyHighlight };
})();

/* ── PARTICIPANT SIMULATION ────────────────────────────────────────── */
const ParticipantSim = (() => {
  const EVENTS = [
    { delay: 18000, id:'ale',    action:'join'  },
    { delay: 45000, id:'giulia', action:'join'  },
    { delay: 80000, id:'ale',    action:'leave' },
    { delay: 95000, id:'marco',  action:'join'  },
  ];

  function badge() {
    const n = presentParticipants().length;
    document.getElementById('participant-badge').textContent =
      `${n} partecipant${n === 1 ? 'e' : 'i'}`;
  }

  function join(id) {
    const p = PARTICIPANTS.find(x => x.id === id);
    if (!p || p.present) return;
    p.present = true;
    badge();
    showToast(`👋 ${p.name} è entrato/a`);
    if (STATE.view === 'grid') GridView.addTile(p);
  }

  function leave(id) {
    const p = PARTICIPANTS.find(x => x.id === id);
    if (!p || !p.present || p.self) return;
    p.present = false;
    badge();
    showToast(`👋 ${p.name} ha lasciato la chiamata`);
    if (STATE.view === 'grid') GridView.removeTile(id);
    if (STATE.activeSpeakerId === id) ActiveSpeaker.set('lucia');
  }

  function schedule() {
    EVENTS.forEach(ev => setTimeout(() => {
      ev.action === 'join' ? join(ev.id) : leave(ev.id);
    }, ev.delay));
  }

  return { schedule, badge };
})();

/* ── DRAGGABLE PIP ─────────────────────────────────────────────────── */
const DragPIP = (() => {
  function init() {
    const pip  = document.getElementById('pip-self');
    const area = document.getElementById('video-area');
    if (!pip || !area) return;
    let dragging = false, ox = 0, oy = 0;
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

    function start(cx, cy) {
      dragging = true;
      pip.classList.add('dragging');
      const r = pip.getBoundingClientRect();
      ox = cx - r.left;
      oy = cy - r.top;
    }
    function move(cx, cy) {
      if (!dragging) return;
      const a = area.getBoundingClientRect();
      const x = clamp(cx - a.left - ox, 0, a.width  - pip.offsetWidth);
      const y = clamp(cy - a.top  - oy, 0, a.height - pip.offsetHeight);
      pip.style.bottom = 'auto';
      pip.style.right  = 'auto';
      pip.style.left   = `${x}px`;
      pip.style.top    = `${y}px`;
    }
    function end() { dragging = false; pip.classList.remove('dragging'); }

    pip.addEventListener('mousedown',   e => { e.preventDefault(); start(e.clientX, e.clientY); });
    window.addEventListener('mousemove', e => move(e.clientX, e.clientY));
    window.addEventListener('mouseup',   end);
    pip.addEventListener('touchstart',   e => { const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive:true });
    window.addEventListener('touchmove', e => { const t = e.touches[0]; move(t.clientX, t.clientY);  }, { passive:true });
    window.addEventListener('touchend',  end);
  }
  return { init };
})();

/* ── KEYBOARD SHORTCUTS ────────────────────────────────────────────── */
const Keyboard = (() => {
  const MAP = {
    m: () => Controls.toggleMic(),
    v: () => Controls.toggleCamera(),
    s: () => Controls.toggleScreen(),
    h: () => Controls.toggleHand(),
    g: () => ViewManager.toggle(),
    c: () => Sidebar.toggle(),
    q: () => Controls.endCall(),
  };
  function init() {
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const fn = MAP[e.key.toLowerCase()];
      if (fn) { e.preventDefault(); fn(); }
    });
  }
  return { init };
})();

/* ── SUBTITLE SIMULATION ───────────────────────────────────────────── */
const Subtitles = (() => {
  const PHRASES = [
    { speaker:'lucia', text:'Ho preparato alcune slide da mostrarvi.' },
    { speaker:'mario', text:'Perfetto, sono pronto.' },
    { speaker:'lucia', text:'Il progetto è nella fase finale.' },
    { speaker:'mario', text:'Quanti gesti dobbiamo ancora catalogare?' },
    { speaker:'lucia', text:'Ne mancano circa venti, poi siamo a posto.' },
    { speaker:'mario', text:'Ottimo, ce la facciamo entro venerdì.' },
    { speaker:'lucia', text:'La precisione è migliorata notevolmente.' },
    { speaker:'mario', text:'Il modello raggiunge il 94% di accuratezza.' },
    { speaker:'lucia', text:'Dobbiamo testarlo con più utenti reali.' },
    { speaker:'mario', text:'Ho già contattato l\'associazione.' },
  ];
  const LIVE = [
    'Riconoscendo gesto…',
    '✋ Gesto LIS in elaborazione',
    '🤙 Segnale acquisito',
    'Analisi movimento in corso…',
    '✌️ Gesto identificato',
    'Classificazione in corso…',
  ];
  let phraseIdx = 0, liveIdx = 0;
  const now = () => { const d=new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
  const SPEAKER_COLOR = { lucia:'#2563eb', mario:'#7c3aed' };

  function addEntry({ speaker, text }) {
    const list  = document.getElementById('subtitles-list');
    const isMe  = speaker === 'mario';
    const p     = PARTICIPANTS.find(x => x.id === speaker);
    if (!p || !p.present) return;
    const entry = document.createElement('div');
    entry.className = 'subtitle-entry';
    if (isMe) entry.style.borderLeftColor = '#7c3aed';
    entry.innerHTML = `<div class="subtitle-speaker" style="color:${SPEAKER_COLOR[speaker] || '#2563eb'};">${p.name} — ${now()}</div>
      <div class="subtitle-text">${text}</div>`;
    list.appendChild(entry);
    list.scrollTop = list.scrollHeight;
  }

  function tickLive() {
    const el = document.getElementById('live-subtitle');
    if (el) el.textContent = LIVE[liveIdx++ % LIVE.length];
  }

  function schedule() {
    setInterval(tickLive, 2500);
    (function next() {
      addEntry(PHRASES[phraseIdx++ % PHRASES.length]);
      setTimeout(next, 7000 + Math.random() * 5000);
    })();
  }

  return { schedule };
})();

/* ── CHAT ──────────────────────────────────────────────────────────── */
const Chat = (() => {
  const REPLIES = [
    'Sì, ho capito!', 'Perfetto, grazie.', 'Ok, procedo.',
    'Posso rivedere quel punto?', 'Concordo pienamente.',
    'Ottima idea!', 'Ho un\'altra domanda.', 'Va bene, ci vediamo dopo.',
  ];
  let rIdx = 0;

  function append(text, self) {
    const msgs = document.getElementById('chat-messages');
    const row  = document.createElement('div');
    row.className = 'chat-msg';
    if (self) row.style.flexDirection = 'row-reverse';
    row.innerHTML = self
      ? `<div class="avatar" style="width:28px;height:28px;font-size:11px;flex-shrink:0;">MR</div>
         <div class="chat-bubble own">${text}</div>`
      : `<div class="avatar" style="width:28px;height:28px;font-size:11px;background:linear-gradient(135deg,#059669,#0d9488);flex-shrink:0;">LC</div>
         <div class="chat-bubble">${text}</div>`;
    msgs.appendChild(row);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function simulateReply() {
    const typing = document.getElementById('typing-area');
    typing.style.display = 'flex';
    document.getElementById('chat-messages').scrollTop = 9999;
    setTimeout(() => {
      typing.style.display = 'none';
      append(REPLIES[rIdx++ % REPLIES.length], false);
    }, 1400 + Math.random() * 1000);
  }

  function send() {
    const input = document.getElementById('chat-input');
    const text  = input.value.trim();
    if (!text) return;
    append(text, true);
    input.value = '';
    if (Math.random() < 0.45) setTimeout(simulateReply, 700);
  }

  function init() {
    document.getElementById('chat-send').addEventListener('click', send);
    document.getElementById('chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
  }

  return { init };
})();

/* ── WEBCAM ────────────────────────────────────────────────────────── */
const Camera = (() => {
  async function init() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:false });
      const vid    = document.getElementById('local-video');
      vid.srcObject      = stream;
      vid.style.display  = 'block';
      document.getElementById('pip-ph').style.display = 'none';
      showToast('📷 Webcam locale attiva');
    } catch { /* no permission — placeholder stays */ }
  }
  return { init };
})();

/* ── PANEL TAB SWITCH (called from HTML) ───────────────────────────── */
function switchCallTab(tab) {
  const sub = tab === 'subtitles';
  document.getElementById('panel-subtitles').style.display = sub  ? 'flex' : 'none';
  document.getElementById('panel-chat').style.display      = !sub ? 'flex' : 'none';
  document.getElementById('tab-sub').classList.toggle('active',  sub);
  document.getElementById('tab-chat').classList.toggle('active', !sub);
}

/* ── KEYBOARD HINT ─────────────────────────────────────────────────── */
function showKeyboardHint() {
  const hint = document.getElementById('kbd-hint');
  setTimeout(() => hint.classList.add('show'),   800);
  setTimeout(() => hint.classList.remove('show'), 5000);
}

/* ── INIT ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  Timer.start();
  Controls.init();
  ViewManager.init();
  Sidebar.init();
  DragPIP.init();
  Keyboard.init();
  Chat.init();
  ParticipantSim.schedule();
  ParticipantSim.badge();
  ActiveSpeaker.start();
  Subtitles.schedule();
  showKeyboardHint();
  Camera.init();
});
