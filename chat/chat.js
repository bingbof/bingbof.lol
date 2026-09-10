// ============================================================
// bingbof.lol chat — standalone app served at /chat/
// (also embedded in an about:blank shell when opened via the
//  "chat" keyword on the main site)
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyBUdo0L85QuEdo6O6Z8T1Uxc9QCgtW_MMA",
  authDomain: "bingbof-chat.firebaseapp.com",
  databaseURL: "https://bingbof-chat-default-rtdb.firebaseio.com",
  projectId: "bingbof-chat",
  storageBucket: "bingbof-chat.firebasestorage.app",
  messagingSenderId: "621923304119",
  appId: "1:621923304119:web:ccf313854a226716268332",
  measurementId: "G-CKPKVWBYN5",
};

// room id (database key) -> display label + optional soft-gate password.
// the password only hides the room in the UI; see database.rules.json for
// what's actually enforced server-side.
const CHAT_ROOMS = {
  chat1: { label: 'chat',                     password: null },
  chat2: { label: 'k-pop finger heart emoji', password: 'nenebutt' },
  chat3: { label: 'Mung Bao Discussion.',     password: 'Behji' },
};

const chatOverlay       = document.getElementById('chatOverlay');
const backToSiteBtn     = document.getElementById('backToSiteBtn');
const authTitle         = document.getElementById('authTitle');
const authForm          = document.getElementById('authForm');
const authUsernameInput = document.getElementById('authUsernameInput');
const authPasswordInput = document.getElementById('authPasswordInput');
const authConfirmInput  = document.getElementById('authConfirmInput');
const authError         = document.getElementById('authError');
const authSubmitBtn     = document.getElementById('authSubmitBtn');
const authToggleBtn     = document.getElementById('authToggleBtn');
const chatWhoamiEl      = document.getElementById('chatWhoami');
const logoutBtn         = document.getElementById('logoutBtn');
const passwordForm      = document.getElementById('passwordForm');
const passwordInput     = document.getElementById('passwordInput');
const passwordError     = document.getElementById('passwordError');
const chatRoomTitle     = document.getElementById('chatRoomTitle');
const chatPresenceEl    = document.getElementById('chatPresence');
const chatMessagesEl    = document.getElementById('chatMessages');
const chatTypingEl      = document.getElementById('chatTyping');
const chatRateWarnEl    = document.getElementById('chatRateWarn');
const chatMessageForm   = document.getElementById('chatMessageForm');
const chatMessageInput  = document.getElementById('chatMessageInput');
const chatReplyBar      = document.getElementById('chatReplyBar');
const chatReplyBarWho   = document.getElementById('chatReplyBarWho');
const chatReplyBarPrev  = document.getElementById('chatReplyBarPreview');
const chatReplyCancel   = document.getElementById('chatReplyCancel');

let replyTarget      = null;   // { id, user, text } of the message being replied to
let flashTimer       = null;

// missed-message tracking (per user, per room) — mirrored to
// users/{uid}/lastRead/{roomId} in the database so it survives refresh
let lastReadMap        = {};    // roomId -> ts of newest message the user has seen
let lastReadWriteTimer = {};    // roomId -> throttle timer
let profileCreatedAt   = 0;     // baseline for rooms never opened

let chatUsername     = null;
let chatUid          = null;
let authMode         = 'login';   // 'login' | 'signup'
let currentRoom      = null;   // active room id, or null
let pendingRoom      = null;   // room id awaiting password entry
let chatMessagesRef  = null;
let chatOnValueCb    = null;
let presenceListRef  = null;
let presenceListCb   = null;
let mySessionRef     = null;

// typing indicators
const TYPING_STOP_MS    = 4000;   // silence this long => stopped typing
const TYPING_REFRESH_MS = 3000;   // while typing, refresh server ts at most this often
let myTypingRef      = null;
let typingListRef    = null;
let typingListCb     = null;
let typingActive     = false;
let typingStopTimer  = null;
let typingLastWrite  = 0;

// unread tab-title flasher (only for the room that's currently open)
const TITLE_IDLE  = 'bingbof';
const TITLE_ALERT = 'UNREAD MESSAGES';
let titleFlashTimer = null;
let titlePrimed     = false;
let lastSeenMsgKey  = null;
let latestMsgKey    = null;

// when cloaked, this page is an iframe inside an about:blank tab — write the
// title onto that top document so it actually shows in the tab strip
function setTabTitle(t) {
  try { (window.top || window).document.title = t; }
  catch (e) { document.title = t; }
}

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

const USER_EMAIL_DOMAIN = 'users.bingbof.lol';

let firebaseDb        = null;
let firebaseAuth      = null;
let firebaseAuthReady = false;

try {
  if (typeof firebase !== 'undefined' && firebaseConfig.apiKey !== 'REPLACE_ME') {
    firebase.initializeApp(firebaseConfig);
    firebaseDb   = firebase.database();
    firebaseAuth = firebase.auth();
    firebaseAuth.onAuthStateChanged(handleAuthState);
  }
} catch (e) {
  console.warn('firebase init failed', e);
}

// ---- "back to bingbof.lol" (bottom-left) --------------------------
if (backToSiteBtn) {
  backToSiteBtn.addEventListener('click', () => {
    const home = window.location.origin + '/';
    try { (window.top || window).location.href = home; }
    catch (e) { window.location.href = home; }
  });
}

// ---- account helpers -------------------------------------------------
// usernames are stored/compared lowercased; Firebase Auth is keyed on an
// email, so each username maps to a placeholder address that never receives
// mail. username uniqueness therefore comes free from Auth's email uniqueness.
function normalizeUsername(u) {
  return (u || '').trim().toLowerCase();
}
function isValidUsername(u) {
  return /^[a-z0-9_-]{3,20}$/.test(u);
}
function usernameToEmail(u) {
  return normalizeUsername(u) + '@' + USER_EMAIL_DOMAIN;
}

function friendlyAuthError(code) {
  switch (code) {
    case 'auth/email-already-in-use':   return 'that username is taken';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':         return 'wrong username or password';
    case 'auth/weak-password':          return 'password too weak';
    case 'auth/too-many-requests':      return 'too many attempts — wait a bit';
    case 'auth/network-request-failed': return 'network error — try again';
    default:                            return 'something went wrong — try again';
  }
}

function enterAuthedState(uid, username) {
  // ignore a late/stale callback that would wipe an already-established session
  if (!username && chatUsername && chatUid === uid) return;
  chatUid           = uid;
  chatUsername      = username || null;
  firebaseAuthReady = !!username;
  if (chatWhoamiEl) chatWhoamiEl.textContent = username || '—';
  if (username && chatOverlay.dataset.view === 'auth') showPicker();
}

function handleAuthState(user) {
  if (user) {
    firebaseDb.ref('users/' + user.uid).get()
      .then(snap => {
        const p = snap.val() || {};
        lastReadMap      = (p.lastRead && typeof p.lastRead === 'object') ? p.lastRead : {};
        profileCreatedAt = typeof p.createdAt === 'number' ? p.createdAt : 0;
        enterAuthedState(user.uid, p.username || user.displayName || null);
      })
      .catch(err => {
        console.warn('profile load failed', err);
        lastReadMap = {};
        enterAuthedState(user.uid, user.displayName || null);
      });
  } else {
    chatUid           = null;
    chatUsername      = null;
    firebaseAuthReady = false;
    lastReadMap       = {};
    profileCreatedAt  = 0;
    if (chatWhoamiEl) chatWhoamiEl.textContent = '—';
    leaveRoom();
    setAuthMode('login');
    setChatView('auth');
  }
}

function showPicker() {
  setChatView('picker');
  refreshMissedCounts();
}

function setChatView(view) {
  chatOverlay.dataset.view = view;
}

// ---- auth view (log in / create account) ---------------------------
function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === 'signup';
  if (authTitle)     authTitle.textContent     = signup ? 'create account' : 'log in';
  if (authSubmitBtn) authSubmitBtn.textContent = signup ? 'create account' : 'log in';
  if (authToggleBtn) authToggleBtn.textContent = signup ? 'have an account? log in' : 'need an account? create one';
  if (authConfirmInput) {
    authConfirmInput.hidden = !signup;
    authConfirmInput.value  = '';
  }
  if (authPasswordInput) authPasswordInput.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  hideAuthError();
}

function showAuthError(msg) {
  if (!authError) return;
  authError.textContent = msg;
  authError.classList.remove('hidden');
}
function hideAuthError() {
  if (authError) authError.classList.add('hidden');
}

if (authToggleBtn) {
  authToggleBtn.addEventListener('click', () => {
    setAuthMode(authMode === 'signup' ? 'login' : 'signup');
    if (authUsernameInput) authUsernameInput.focus();
  });
}

if (authForm) {
  authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!firebaseAuth || !firebaseDb) { showAuthError('chat backend not configured'); return; }

    const username = normalizeUsername(authUsernameInput.value);
    const password = authPasswordInput.value;

    if (!isValidUsername(username)) {
      showAuthError('username: 3–20 chars, letters/numbers/_/- only');
      return;
    }
    if (password.length < 8) {
      showAuthError('password must be at least 8 characters');
      return;
    }
    if (authMode === 'signup' && password !== authConfirmInput.value) {
      showAuthError('passwords do not match');
      return;
    }

    authSubmitBtn.disabled = true;
    hideAuthError();
    const done = () => { authSubmitBtn.disabled = false; };

    if (authMode === 'signup') {
      firebaseAuth.createUserWithEmailAndPassword(usernameToEmail(username), password)
        .then(cred => {
          const uid = cred.user.uid;
          return firebaseDb.ref('users/' + uid).set({
            username:  username,
            createdAt: firebase.database.ServerValue.TIMESTAMP,
          })
            .then(() => cred.user.updateProfile({ displayName: username }).catch(() => {}))
            .then(() => {
              done();
              authForm.reset();
              lastReadMap = {};
              profileCreatedAt = Date.now();   // fresh account: nothing "missed" yet
              enterAuthedState(uid, username);
            });
        })
        .catch(err => {
          console.warn('signup failed', err);
          done();
          showAuthError(friendlyAuthError(err && err.code));
          // roll back a half-created account so the username frees up
          if (firebaseAuth.currentUser) firebaseAuth.currentUser.delete().catch(() => {});
        });
    } else {
      firebaseAuth.signInWithEmailAndPassword(usernameToEmail(username), password)
        .then(() => { done(); authForm.reset(); })
        .catch(err => {
          console.warn('login failed', err);
          done();
          showAuthError(friendlyAuthError(err && err.code));
        });
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    if (currentRoom) leaveRoom();
    if (firebaseAuth) firebaseAuth.signOut().catch(() => {});
    setAuthMode('login');
    setChatView('auth');
  });
}

setAuthMode('login');
if (authUsernameInput) setTimeout(() => authUsernameInput.focus(), 50);

document.querySelectorAll('.chat-picker-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const room = btn.dataset.room;
    const cfg  = CHAT_ROOMS[room];
    if (!cfg) return;
    if (!cfg.password) {
      enterRoom(room, cfg.label);
      return;
    }
    pendingRoom = room;
    passwordInput.value = '';
    passwordError.classList.add('hidden');
    setChatView('password');
    setTimeout(() => passwordInput.focus(), 50);
  });
});

passwordForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const cfg = CHAT_ROOMS[pendingRoom];
  if (cfg && passwordInput.value === cfg.password) {
    passwordError.classList.add('hidden');
    const room = pendingRoom;
    pendingRoom = null;
    enterRoom(room, cfg.label);
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
      pendingRoom = null;
      leaveRoom();
      showPicker();
    }
  });
});

function enterRoom(roomId, label) {
  currentRoom = roomId;
  chatRoomTitle.textContent = label;
  chatMessagesEl.innerHTML = '';
  chatPresenceEl.textContent = 'online: —';
  hideRateWarn();
  clearReplyTarget();
  sendTimestamps = [];
  setChatView('room');
  setTimeout(() => chatMessageInput.focus(), 50);

  if (!firebaseDb) {
    renderSystemMessage('(chat backend not configured — messages will not send)');
    return;
  }
  if (!firebaseAuthReady || !chatUid) {
    renderSystemMessage('(you need to be logged in — go back and sign in)');
    return;
  }

  attachRoom(roomId);
}

function attachRoom(roomId) {
  titlePrimed    = false;
  lastSeenMsgKey = null;
  latestMsgKey   = null;

  chatMessagesRef = firebaseDb.ref('chats/' + roomId + '/messages').limitToLast(200);
  chatOnValueCb = chatMessagesRef.on('value', (snap) => {
    chatMessagesEl.innerHTML = '';
    let newestKey = null;
    let newestMsg = null;
    let prevUid = null;        // sender of the previous rendered message
    let prevAction = false;    // was the previous message a /me action?
    snap.forEach(child => {
      const msg = child.val();
      const isAction = !!(msg.text && msg.text.startsWith('/me '));
      // group real messages from the same account, back to back — but a
      // reply always starts its own group so its reference reads cleanly
      const grouped = !isAction && !prevAction && !msg.replyTo &&
                      !!msg.uid && msg.uid === prevUid;
      renderMessage(child.key, msg, grouped);
      prevUid    = isAction ? null : (msg.uid || null);
      prevAction = isAction;
      newestKey = child.key;
      newestMsg = msg;
    });
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    updateUnreadTitle(newestKey, newestMsg);
    // this room is open and on screen — keep it marked fully read so
    // messages arriving now never count as "missed" later
    markRoomRead(roomId, (newestMsg && typeof newestMsg.ts === 'number') ? newestMsg.ts : Date.now());
  }, (err) => {
    console.warn('room read denied', err);
    renderSystemMessage('(lost access to this room)');
  });

  joinPresence(roomId);
  joinTyping(roomId);
}

// ---- missed-message tracking ------------------------------------
function markRoomRead(roomId, ts) {
  if (!roomId || !chatUid || !firebaseDb) return;
  const val = ts || Date.now();
  if ((lastReadMap[roomId] || 0) >= val) return;   // only ever move forward
  lastReadMap[roomId] = val;

  if (lastReadWriteTimer[roomId]) return;           // a persist write is already scheduled
  lastReadWriteTimer[roomId] = setTimeout(() => {
    lastReadWriteTimer[roomId] = null;
    flushRoomRead(roomId);
  }, 2500);
}

function flushRoomRead(roomId) {
  if (!chatUid || !firebaseDb) return;
  const val = lastReadMap[roomId];
  if (!val) return;
  firebaseDb.ref('users/' + chatUid + '/lastRead/' + roomId).set(val).catch(() => {});
}

function refreshMissedCounts() {
  if (!firebaseDb || !chatUid) return;
  Object.keys(CHAT_ROOMS).forEach(roomId => {
    firebaseDb.ref('chats/' + roomId + '/messages').limitToLast(100).once('value')
      .then(snap => {
        const since = lastReadMap[roomId] || profileCreatedAt || 0;
        let count = 0;
        snap.forEach(child => {
          const m = child.val();
          if (m && typeof m.ts === 'number' && m.ts > since && m.uid !== chatUid) count++;
        });
        const capped = snap.numChildren() >= 100 && count >= 100;
        updateMissedBadge(roomId, count, capped);
      })
      .catch(() => {});
  });
}

function updateMissedBadge(roomId, count, capped) {
  const btn = document.querySelector('.chat-picker-btn[data-room="' + roomId + '"]');
  const el = btn && btn.querySelector('.chat-picker-missed');
  if (!el) return;
  if (count > 0) {
    el.textContent = (capped ? '99+' : count) + ' missed message' + (count === 1 ? '' : 's');
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

// ---- typing indicators --------------------------------------------
function joinTyping(roomId) {
  if (!firebaseDb || !chatUsername || !chatUid) return;

  if (chatTypingEl) chatTypingEl.textContent = '';
  typingActive    = false;
  typingLastWrite = 0;

  myTypingRef = firebaseDb.ref('chats/' + roomId + '/typing/' + chatSessionId);
  try { myTypingRef.onDisconnect().remove(); } catch (e) { /* ignore */ }

  typingListRef = firebaseDb.ref('chats/' + roomId + '/typing');
  typingListCb = typingListRef.on('value', (snap) => {
    const now   = Date.now();
    const names = [];
    snap.forEach(child => {
      if (child.key === chatSessionId) return;            // never show yourself (this tab)
      const v = child.val();
      if (!v || !v.user) return;
      if (v.uid === chatUid) return;                      // ...or yourself in another tab
      if (typeof v.ts === 'number' && now - v.ts > TYPING_STOP_MS + 4000) return; // stale
      if (names.indexOf(v.user) === -1) names.push(v.user);
    });
    renderTyping(names);
  });
}

function renderTyping(names) {
  if (!chatTypingEl) return;
  if (!names.length) { chatTypingEl.textContent = ''; return; }

  let label;
  if (names.length === 1)      label = names[0] + ' is typing';
  else if (names.length === 2) label = names[0] + ' and ' + names[1] + ' are typing';
  else if (names.length === 3) label = names[0] + ', ' + names[1] + ', and ' + names[2] + ' are typing';
  else                         label = 'several people are typing';

  chatTypingEl.textContent = label;
  const dots = document.createElement('span');
  dots.className = 'typing-dots';
  chatTypingEl.appendChild(dots);
}

// called on every keystroke in the message box
function handleTypingInput() {
  if (!myTypingRef || !currentRoom) return;

  if (!chatMessageInput.value) { stopTyping(); return; }

  const now = Date.now();
  // write once when typing starts, then refresh the ts at most once per
  // TYPING_REFRESH_MS so continuous typing is ~1 write / 3s, not per keystroke
  if (!typingActive || now - typingLastWrite > TYPING_REFRESH_MS) {
    typingActive    = true;
    typingLastWrite = now;
    try {
      myTypingRef.set({
        uid: chatUid,
        user: chatUsername,
        ts: firebase.database.ServerValue.TIMESTAMP,
      });
    } catch (e) { /* ignore */ }
  }

  if (typingStopTimer) clearTimeout(typingStopTimer);
  typingStopTimer = setTimeout(stopTyping, TYPING_STOP_MS);
}

function stopTyping() {
  if (typingStopTimer) { clearTimeout(typingStopTimer); typingStopTimer = null; }
  if (!typingActive) return;
  typingActive = false;
  if (myTypingRef) {
    try { myTypingRef.remove(); } catch (e) { /* ignore */ }
  }
}

function leaveTyping() {
  if (typingStopTimer) { clearTimeout(typingStopTimer); typingStopTimer = null; }
  if (myTypingRef) {
    try { myTypingRef.onDisconnect().cancel(); } catch (e) {}
    try { myTypingRef.remove(); } catch (e) {}
  }
  if (typingListRef && typingListCb) {
    try { typingListRef.off('value', typingListCb); } catch (e) {}
  }
  myTypingRef   = null;
  typingListRef = null;
  typingListCb  = null;
  typingActive  = false;
  if (chatTypingEl) chatTypingEl.textContent = '';
}

if (chatMessageInput) {
  chatMessageInput.addEventListener('input', handleTypingInput);
  chatMessageInput.addEventListener('blur', stopTyping);
}

function updateUnreadTitle(newestKey, newestMsg) {
  latestMsgKey = newestKey;

  // first snapshot after entering a room is existing history, not "new"
  if (!titlePrimed) {
    titlePrimed = true;
    lastSeenMsgKey = newestKey;
    return;
  }
  if (!newestKey || newestKey === lastSeenMsgKey) return;

  const mine = newestMsg && newestMsg.uid === chatUid;
  if (document.hidden && !mine) {
    startTitleFlash();
  } else {
    // tab is visible (or it's our own message) — treat as seen
    lastSeenMsgKey = newestKey;
    stopTitleFlash();
  }
}

function startTitleFlash() {
  if (titleFlashTimer) return;
  let alert = true;
  setTabTitle(TITLE_ALERT);
  titleFlashTimer = setInterval(() => {
    alert = !alert;
    setTabTitle(alert ? TITLE_ALERT : TITLE_IDLE);
  }, 1000);
}

function stopTitleFlash() {
  if (titleFlashTimer) {
    clearInterval(titleFlashTimer);
    titleFlashTimer = null;
  }
  setTabTitle(TITLE_IDLE);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentRoom) {
    lastSeenMsgKey = latestMsgKey;
    stopTitleFlash();
  }
});

// best-effort: persist read position if the tab is closed while in a room
window.addEventListener('pagehide', () => {
  if (currentRoom) flushRoomRead(currentRoom);
});

function leaveRoom() {
  if (chatMessagesRef && chatOnValueCb) {
    try { chatMessagesRef.off('value', chatOnValueCb); } catch (e) {}
  }
  chatMessagesRef = null;
  chatOnValueCb   = null;

  stopTitleFlash();
  titlePrimed    = false;
  lastSeenMsgKey = null;
  latestMsgKey   = null;

  // persist the read position for the room we're leaving, now
  if (currentRoom) {
    if (lastReadWriteTimer[currentRoom]) {
      clearTimeout(lastReadWriteTimer[currentRoom]);
      lastReadWriteTimer[currentRoom] = null;
    }
    flushRoomRead(currentRoom);
  }

  clearReplyTarget();
  leaveTyping();
  leavePresence();
  currentRoom = null;
}

function joinPresence(roomId) {
  if (!firebaseDb || !chatUsername || !chatUid) return;

  mySessionRef = firebaseDb.ref('chats/' + roomId + '/presence/' + chatSessionId);
  try {
    mySessionRef.onDisconnect().remove();
    mySessionRef.set({
      uid: chatUid,
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

function renderMessage(key, msg, grouped) {
  const user = msg.user;
  const text = msg.text;

  const li = document.createElement('li');
  li.className = 'chat-message';
  li.dataset.key  = key || '';
  li.dataset.user = user || '';
  li.dataset.text = text || '';

  // hover "reply" affordance — clicks handled via delegation on the list
  const replyBtn = document.createElement('button');
  replyBtn.type = 'button';
  replyBtn.className = 'chat-msg-reply-btn';
  replyBtn.textContent = 'reply';
  li.appendChild(replyBtn);

  // /me actions are always standalone italic lines, never grouped
  if (text && text.startsWith('/me ')) {
    li.classList.add('chat-message-action');
    const body = document.createElement('span');
    body.className = 'chat-message-text';
    body.textContent = '* ' + user + ' ' + text.slice(4);
    li.appendChild(body);
    chatMessagesEl.appendChild(li);
    return;
  }

  // reference to the message this one is replying to
  if (msg.replyTo && msg.replyTo.id) {
    const ref = document.createElement('button');
    ref.type = 'button';
    ref.className = 'chat-reply-ref';
    ref.dataset.target = msg.replyTo.id;
    const ru = document.createElement('span');
    ru.className = 'chat-reply-ref-user';
    ru.textContent = msg.replyTo.user || 'someone';
    const rt = document.createElement('span');
    rt.className = 'chat-reply-ref-text';
    rt.textContent = msg.replyTo.text || '';
    ref.appendChild(ru);
    ref.appendChild(rt);
    li.appendChild(ref);
  }

  if (grouped) {
    li.classList.add('chat-message-cont');
  } else {
    li.classList.add('chat-message-first');
    const head = document.createElement('div');
    head.className = 'chat-message-headline';
    const u = document.createElement('span');
    u.className = 'chat-message-user';
    u.textContent = user;
    head.appendChild(u);
    if (msg.ts) {
      const t = document.createElement('span');
      t.className = 'chat-message-time';
      t.textContent = formatTime(msg.ts);
      head.appendChild(t);
    }
    li.appendChild(head);
  }

  const body = document.createElement('span');
  body.className = 'chat-message-text';
  body.textContent = text;
  li.appendChild(body);

  chatMessagesEl.appendChild(li);
}

// ---- replies ------------------------------------------------------
function previewText(t) {
  t = (t || '').replace(/\s+/g, ' ').trim();
  return t.length > 200 ? t.slice(0, 200) : t;
}

function setReplyTarget(id, user, text) {
  if (!id) return;
  replyTarget = { id: id, user: (user || 'someone').slice(0, 40), text: previewText(text) };
  if (chatReplyBarWho)  chatReplyBarWho.textContent  = replyTarget.user;
  if (chatReplyBarPrev) chatReplyBarPrev.textContent = replyTarget.text;
  if (chatReplyBar)     chatReplyBar.classList.remove('hidden');
  if (chatMessageInput) chatMessageInput.focus();
}

function clearReplyTarget() {
  replyTarget = null;
  if (chatReplyBar) chatReplyBar.classList.add('hidden');
}

function scrollToMessage(key) {
  if (!key) return;
  const sel = '[data-key="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]';
  const el = chatMessagesEl.querySelector(sel);
  if (!el) return;
  chatMessagesEl.querySelectorAll('.chat-message-flash')
    .forEach(x => x.classList.remove('chat-message-flash'));
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  void el.offsetWidth;                 // restart the animation if already flashing
  el.classList.add('chat-message-flash');
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    el.classList.remove('chat-message-flash');
  }, 1600);
}

if (chatMessagesEl) {
  chatMessagesEl.addEventListener('click', (e) => {
    const ref = e.target.closest('.chat-reply-ref');
    if (ref) { scrollToMessage(ref.dataset.target); return; }
    const rb = e.target.closest('.chat-msg-reply-btn');
    if (rb) {
      const li = rb.closest('.chat-message');
      if (li) setReplyTarget(li.dataset.key, li.dataset.user, li.dataset.text);
    }
  });
}

if (chatReplyCancel) chatReplyCancel.addEventListener('click', clearReplyTarget);
if (chatMessageInput) {
  chatMessageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && replyTarget) { e.preventDefault(); clearReplyTarget(); }
  });
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
  if (!text || !currentRoom || !firebaseDb || !firebaseAuthReady || !chatUsername || !chatUid) return;

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

  const payload = {
    uid: chatUid,
    user: chatUsername,
    text: text,
    ts: firebase.database.ServerValue.TIMESTAMP,
  };
  if (replyTarget) {
    payload.replyTo = {
      id:   replyTarget.id,
      user: replyTarget.user,
      text: replyTarget.text,
    };
  }

  firebaseDb.ref('chats/' + currentRoom + '/messages').push(payload)
    .catch(err => console.warn('send failed', err));
  chatMessageInput.value = '';
  clearReplyTarget();
  stopTyping();
});
