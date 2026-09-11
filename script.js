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
  stopDateTime();
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

function stopDateTime() {
  if (dateTimeTick) { clearInterval(dateTimeTick); dateTimeTick = null; }
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
// CHAT — lives at /chat/. typing "chat" opens it in a blank-tab
// shell (url bar stays about:blank) with the real app in an iframe.
// ============================================================
function openChatWindow() {
  const url = window.location.origin + '/chat/';
  const w = window.open('about:blank', '_blank');
  if (!w) { window.location.href = url; return; }   // popup blocked — just go there
  try {
    w.document.write(
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<title>bingbof</title>' +
      '<link rel="icon" href="' + window.location.origin + '/favicon.ico">' +
      '<style>html,body{margin:0;height:100%;background:#000}' +
      'iframe{display:block;border:0;width:100%;height:100%}</style>' +
      '</head><body><iframe src="' + url + '"></iframe></body></html>'
    );
    w.document.close();
  } catch (e) {
    w.location.href = url;
  }
}

// ============================================================
// KEYWORD TRIGGERS + GLOBAL KEYDOWN
// ============================================================
let keyBuf = '';
function isTypingInField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();

  if (event.key === 'Escape') {
    if (currentScreen === 'menu') { closeMenu(); return; }
  }

  // keyword triggers — only when NOT typing in a field
  if (!isTypingInField() && /^[a-z0-9]$/.test(key)) {
    keyBuf = (keyBuf + key).slice(-6);
    if (keyBuf.endsWith('chat')) { keyBuf = ''; openChatWindow(); return; }
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
