// ============================================================
// ELEMENT REFS
// ============================================================
const mobileOverlay    = document.getElementById('mobileOverlay');
const mobileDismissBtn = document.getElementById('mobileDismissBtn');

const landing       = document.getElementById('landing');
const enterBtn      = document.getElementById('enterBtn');

const home          = document.getElementById('home');
const welcome       = document.querySelector('.welcome');
const clickMeBtn    = document.getElementById('clickMeBtn');

const menuOverlay   = document.getElementById('menuOverlay');
const backBtn       = document.getElementById('backBtn');
const viewBackBtn   = document.getElementById('viewBackBtn');

const dateTimeEl    = document.getElementById('dateTime');
const dtTimeEl      = dateTimeEl && dateTimeEl.querySelector('.dt-time');
const dtDateEl      = dateTimeEl && dateTimeEl.querySelector('.dt-date');

// ============================================================
// CONFIG
// ============================================================
const CLICK_ME_REVEAL_MS = 3000;

// ============================================================
// STATE
// ============================================================
let currentScreen = 'landing';   // landing | home | menu

// ============================================================
// SCREEN TRANSITIONS
// ============================================================
function enterSite() {
  if (currentScreen !== 'landing') return;
  currentScreen = 'home';

  landing.classList.add('hidden');
  home.classList.remove('hidden');

  if (welcome) welcome.classList.add('spinning');

  setTimeout(() => {
    clickMeBtn.classList.remove('hidden-initial');
  }, CLICK_ME_REVEAL_MS);
}

function openMenu() {
  if (currentScreen !== 'home') return;
  currentScreen = 'menu';

  showMenuView('main');
  home.classList.add('menu-open');
  menuOverlay.classList.add('show');
  menuOverlay.setAttribute('aria-hidden', 'false');

  startDateTime();
}

function closeMenu() {
  if (currentScreen !== 'menu') return;
  currentScreen = 'home';

  menuOverlay.classList.remove('show');
  menuOverlay.setAttribute('aria-hidden', 'true');
  home.classList.remove('menu-open');
}

function showMenuView(name) {
  menuOverlay.dataset.view = name;
}

enterBtn.addEventListener('click', enterSite);
clickMeBtn.addEventListener('click', openMenu);
backBtn.addEventListener('click', closeMenu);
viewBackBtn.addEventListener('click', () => showMenuView('main'));

document.querySelectorAll('.menu-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    if (view) showMenuView(view);
  });
});

// ============================================================
// DATE / TIME (top-right of menu, 12-hour)
// ============================================================
let dateTimeTick = null;

function updateDateTime() {
  if (!dtTimeEl || !dtDateEl) return;
  const now = new Date();
  dtTimeEl.textContent = now.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  });
  dtDateEl.textContent = now.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function startDateTime() {
  updateDateTime();
  if (dateTimeTick) return;
  dateTimeTick = setInterval(updateDateTime, 1000);
}

// ============================================================
// DISCORD COPY-TO-CLIPBOARD
// ============================================================
const discordBtn = document.querySelector('.discord-link');
if (discordBtn) {
  const handle   = discordBtn.querySelector('.social-handle');
  const original = handle.textContent;
  let copyTimer  = null;
  discordBtn.addEventListener('click', async () => {
    const username = discordBtn.dataset.username;
    try {
      await navigator.clipboard.writeText(username);
      handle.textContent = 'copied!';
    } catch (e) {
      handle.textContent = 'copy failed';
    }
    discordBtn.blur();
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { handle.textContent = original; }, 1800);
  });
}

// ============================================================
// TAB VISIBILITY (pauses spin animation via CSS)
// ============================================================
document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('tab-hidden', document.hidden);
});

// ============================================================
// MOBILE WARNING
// ============================================================
function isMobileDevice() {
  const ua = navigator.userAgent || '';
  const uaMobile = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const narrow   = window.innerWidth < 720;
  return uaMobile || narrow;
}

if (mobileOverlay && isMobileDevice()) {
  mobileOverlay.classList.add('show');
  mobileOverlay.setAttribute('aria-hidden', 'false');
}

if (mobileDismissBtn) {
  mobileDismissBtn.addEventListener('click', () => {
    if (!mobileOverlay) return;
    mobileOverlay.classList.remove('show');
    mobileOverlay.setAttribute('aria-hidden', 'true');
  });
}

// ============================================================
// CHAT SYSTEM
// ============================================================
// PASTE YOUR FIREBASE CONFIG BELOW (from Firebase console → Project settings → Your apps → </>)
const firebaseConfig = {
  apiKey: "AIzaSyC-r6E_TvldCSN-ZHiBeJEui910x4OV9fQ",
  authDomain: "bingbof-chat.firebaseapp.com",
  databaseURL: "https://bingbof-chat-default-rtdb.firebaseio.com",
  projectId: "bingbof-chat",
  storageBucket: "bingbof-chat.firebasestorage.app",
  messagingSenderId: "621923304119",
  appId: "1:621923304119:web:ccf313854a226716268332",
  measurementId: "G-CKPKVWBYN5",
};

const CHAT_PASSWORD = 'nenebutt';

const chatOverlay      = document.getElementById('chatOverlay');
const chatCloseBtn     = document.getElementById('chatCloseBtn');
const usernameForm     = document.getElementById('usernameForm');
const usernameInput    = document.getElementById('usernameInput');
const passwordForm     = document.getElementById('passwordForm');
const passwordInput    = document.getElementById('passwordInput');
const passwordError    = document.getElementById('passwordError');
const chatRoomTitle    = document.getElementById('chatRoomTitle');
const chatPresenceEl   = document.getElementById('chatPresence');
const chatMessagesEl   = document.getElementById('chatMessages');
const chatRateWarnEl   = document.getElementById('chatRateWarn');
const chatMessageForm  = document.getElementById('chatMessageForm');
const chatMessageInput = document.getElementById('chatMessageInput');

let chatOpen         = false;
let chatUsername     = null;
let currentRoom      = null;   // 'chat1' | 'chat2' | null
let chatMessagesRef  = null;
let chatOnValueCb    = null;
let presenceListRef  = null;
let presenceListCb   = null;
let mySessionRef     = null;

// per-browser-tab unique id for presence tracking
const chatSessionId = (crypto && crypto.randomUUID)
  ? crypto.randomUUID()
  : ('s' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

// rate limiter
const RATE_MIN_INTERVAL_MS = 500;
const RATE_WINDOW_MS       = 10000;
const RATE_MAX_IN_WINDOW   = 6;
let sendTimestamps = [];
let lastSendAt     = 0;
let rateWarnTimer  = null;

let firebaseDb = null;
try {
  if (typeof firebase !== 'undefined' && firebaseConfig.apiKey !== 'REPLACE_ME') {
    firebase.initializeApp(firebaseConfig);
    firebaseDb = firebase.database();
  }
} catch (e) {
  console.warn('firebase init failed', e);
}

function setChatView(view) {
  chatOverlay.dataset.view = view;
}

function openChat() {
  if (chatOpen) return;
  chatOpen = true;
  chatOverlay.classList.add('show');
  chatOverlay.setAttribute('aria-hidden', 'false');
  if (chatUsername) {
    setChatView('picker');
  } else {
    setChatView('username');
    setTimeout(() => usernameInput.focus(), 50);
  }
}

function closeChat() {
  if (!chatOpen) return;
  chatOpen = false;
  chatOverlay.classList.remove('show');
  chatOverlay.setAttribute('aria-hidden', 'true');
  leaveRoom();
}

chatCloseBtn.addEventListener('click', closeChat);

usernameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = usernameInput.value.trim();
  if (!name) return;
  chatUsername = name;
  setChatView('picker');
});

document.querySelectorAll('.chat-picker-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const room = btn.dataset.room;
    if (room === 'chat1') {
      enterRoom('chat1', 'chat 1');
    } else if (room === 'chat2') {
      passwordInput.value = '';
      passwordError.classList.add('hidden');
      setChatView('password');
      setTimeout(() => passwordInput.focus(), 50);
    }
  });
});

passwordForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (passwordInput.value === CHAT_PASSWORD) {
    passwordError.classList.add('hidden');
    enterRoom('chat2', 'chat 2');
  } else {
    passwordError.classList.remove('hidden');
    passwordInput.value = '';
    passwordInput.focus();
  }
});

document.querySelectorAll('.chat-back-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    if (target === 'picker') {
      leaveRoom();
      setChatView('picker');
    }
  });
});

function enterRoom(roomId, label) {
  currentRoom = roomId;
  chatRoomTitle.textContent = label;
  chatMessagesEl.innerHTML = '';
  chatPresenceEl.textContent = 'online: —';
  hideRateWarn();
  sendTimestamps = [];
  setChatView('room');
  setTimeout(() => chatMessageInput.focus(), 50);

  if (!firebaseDb) {
    renderSystemMessage('(firebase not configured — messages will not send)');
    return;
  }

  chatMessagesRef = firebaseDb.ref('chats/' + roomId + '/messages').limitToLast(200);
  chatOnValueCb = chatMessagesRef.on('value', (snap) => {
    chatMessagesEl.innerHTML = '';
    snap.forEach(child => {
      const msg = child.val();
      renderMessage(msg.user, msg.text, msg.ts);
    });
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  });

  joinPresence(roomId);
}

function leaveRoom() {
  if (chatMessagesRef && chatOnValueCb) {
    try { chatMessagesRef.off('value', chatOnValueCb); } catch (e) {}
  }
  chatMessagesRef = null;
  chatOnValueCb   = null;

  leavePresence();
  currentRoom = null;
}

function joinPresence(roomId) {
  if (!firebaseDb || !chatUsername) return;

  mySessionRef = firebaseDb.ref('chats/' + roomId + '/presence/' + chatSessionId);
  try {
    mySessionRef.onDisconnect().remove();
    mySessionRef.set({
      user: chatUsername,
      ts: firebase.database.ServerValue.TIMESTAMP,
    });
  } catch (e) { /* ignore */ }

  presenceListRef = firebaseDb.ref('chats/' + roomId + '/presence');
  presenceListCb = presenceListRef.on('value', (snap) => {
    const users = [];
    snap.forEach(child => {
      const v = child.val();
      if (v && v.user) users.push(v.user);
    });
    renderPresence(users);
  });
}

function leavePresence() {
  if (mySessionRef) {
    try { mySessionRef.onDisconnect().cancel(); } catch (e) {}
    try { mySessionRef.remove(); } catch (e) {}
  }
  if (presenceListRef && presenceListCb) {
    try { presenceListRef.off('value', presenceListCb); } catch (e) {}
  }
  mySessionRef    = null;
  presenceListRef = null;
  presenceListCb  = null;
}

function renderPresence(users) {
  if (!users.length) {
    chatPresenceEl.textContent = 'online: nobody';
    return;
  }
  // dedupe usernames (a person open in two tabs still counts once visually)
  const seen = new Set();
  const unique = users.filter(u => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });
  chatPresenceEl.innerHTML = '';
  const label = document.createTextNode('online: ');
  chatPresenceEl.appendChild(label);
  unique.forEach((u, i) => {
    const s = document.createElement('span');
    s.className = 'presence-user';
    s.textContent = u;
    chatPresenceEl.appendChild(s);
    if (i < unique.length - 1) chatPresenceEl.appendChild(document.createTextNode(', '));
  });
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function renderMessage(user, text, ts) {
  const li = document.createElement('li');
  li.className = 'chat-message';
  if (ts) {
    const t = document.createElement('span');
    t.className = 'chat-message-time';
    t.textContent = formatTime(ts);
    li.appendChild(t);
  }

  if (text && text.startsWith('/me ')) {
    li.classList.add('chat-message-action');
    const body = document.createElement('span');
    body.textContent = '* ' + user + ' ' + text.slice(4);
    li.appendChild(body);
  } else {
    const u = document.createElement('span');
    u.className = 'chat-message-user';
    u.textContent = user + ':';
    const txt = document.createElement('span');
    txt.textContent = ' ' + text;
    li.appendChild(u);
    li.appendChild(txt);
  }

  chatMessagesEl.appendChild(li);
}

function showRateWarn(msg) {
  chatRateWarnEl.textContent = msg;
  chatRateWarnEl.classList.remove('hidden');
  if (rateWarnTimer) clearTimeout(rateWarnTimer);
  rateWarnTimer = setTimeout(hideRateWarn, 1800);
}

function hideRateWarn() {
  chatRateWarnEl.classList.add('hidden');
  if (rateWarnTimer) { clearTimeout(rateWarnTimer); rateWarnTimer = null; }
}

function renderSystemMessage(text) {
  const li = document.createElement('li');
  li.className = 'chat-message';
  li.style.opacity = '0.5';
  li.textContent = text;
  chatMessagesEl.appendChild(li);
}

chatMessageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatMessageInput.value.trim();
  if (!text || !currentRoom || !firebaseDb || !chatUsername) return;

  const now = Date.now();
  if (now - lastSendAt < RATE_MIN_INTERVAL_MS) {
    showRateWarn('slow down...');
    return;
  }
  sendTimestamps = sendTimestamps.filter(t => now - t < RATE_WINDOW_MS);
  if (sendTimestamps.length >= RATE_MAX_IN_WINDOW) {
    const waitMs = RATE_WINDOW_MS - (now - sendTimestamps[0]);
    const secs = Math.max(1, Math.ceil(waitMs / 1000));
    showRateWarn('slow down... wait ' + secs + 's');
    return;
  }

  lastSendAt = now;
  sendTimestamps.push(now);
  hideRateWarn();

  firebaseDb.ref('chats/' + currentRoom + '/messages').push({
    user: chatUsername,
    text: text,
    ts: firebase.database.ServerValue.TIMESTAMP,
  }).catch(err => console.warn('send failed', err));
  chatMessageInput.value = '';
});

// keystroke buffer — typing "chat" anywhere (outside inputs) opens the chat
let keyBuf = '';
function isTypingInField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}


// ============================================================
// GLOBAL KEYDOWN
// ============================================================
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();

  if (event.key === 'Escape') {
    if (chatOpen) { closeChat(); return; }
    if (currentScreen === 'menu') { closeMenu(); return; }
  }

  // keyword triggers — only when NOT typing in a field, no overlay open
  if (!chatOpen && !isTypingInField() && /^[a-z0-9]$/.test(key)) {
    keyBuf = (keyBuf + key).slice(-6);
    if (keyBuf.endsWith('chat')) { keyBuf = ''; openChat(); return; }
    if (keyBuf.endsWith('404'))  { keyBuf = ''; window.location.href = '/404.html'; return; }
    if (keyBuf.endsWith('spin')) {
      keyBuf = '';
      if (welcome) welcome.classList.toggle('spinning-fast');
      return;
    }
  }

  if (currentScreen === 'landing' && (key === 'enter' || key === ' ')) {
    enterSite();
    return;
  }
});
