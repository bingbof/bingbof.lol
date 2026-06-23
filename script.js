// ============================================================
// ELEMENT REFS
// ============================================================
const mobileOverlay    = document.getElementById('mobileOverlay');
const mobileDismissBtn = document.getElementById('mobileDismissBtn');

const landing       = document.getElementById('landing');
const enterBtn      = document.getElementById('enterBtn');

const intro         = document.getElementById('intro');
const introVideo    = document.getElementById('introVideo');
const skipBtn       = document.getElementById('skipBtn');

const home          = document.getElementById('home');
const bgVideo       = document.getElementById('bgVideo');
const welcome       = document.querySelector('.welcome');
const clickMeBtn    = document.getElementById('clickMeBtn');

const menuOverlay   = document.getElementById('menuOverlay');
const backBtn       = document.getElementById('backBtn');
const viewBackBtn   = document.getElementById('viewBackBtn');

const dateTimeEl    = document.getElementById('dateTime');
const dtTimeEl      = dateTimeEl && dateTimeEl.querySelector('.dt-time');
const dtDateEl      = dateTimeEl && dateTimeEl.querySelector('.dt-date');

const infoBtn       = document.getElementById('infoBtn');
const infoOverlay   = document.getElementById('infoOverlay');
const infoCloseBtn  = document.getElementById('infoCloseBtn');

const homeAudio     = document.getElementById('homeAudio');
const secretVideo   = document.getElementById('secretVideo');

// ============================================================
// CONFIG
// ============================================================
const HOME_VOLUME           = 0.5;
const CLICK_ME_REVEAL_MS    = 3000;   // delay before click-me fades in
const AUDIO_PREFS_KEY       = 'bingbof.audio';

const prefersReducedMotion  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ============================================================
// STATE
// ============================================================
let currentScreen = 'landing';   // landing | intro | home | menu
let onHome        = false;
let menuOpen      = false;
let secretActive  = false;

// volume + mute (persisted)
let userVolume = 1.0;
let isMuted    = false;

try {
  const raw = localStorage.getItem(AUDIO_PREFS_KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    if (typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1) userVolume = saved.volume;
    if (typeof saved.muted  === 'boolean') isMuted    = saved.muted;
  }
} catch (e) { /* ignore */ }

function saveAudioPrefs() {
  try {
    localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify({
      volume: userVolume, muted: isMuted,
    }));
  } catch (e) { /* ignore */ }
}

homeAudio.volume = HOME_VOLUME;

function effectiveVolume() {
  return (isMuted || userVolume === 0) ? 0 : userVolume;
}

// ============================================================
// WEB AUDIO GRAPH — lowpass + gain on homeAudio so menu opens
// can muffle the audio (and tab-blur applies the same filter)
// ============================================================
const FOCUSED_FREQ   = 22050;
const UNFOCUSED_FREQ = 700;
const UNFOCUSED_MULT = 0.7;
const RAMP_TIME      = 0.4;

let audioContext   = null;
let audioGraphReady = false;
const audioNodes   = new Map();

// kept synchronous so the whole setup lives inside the first user gesture —
// awaiting anything here breaks the iOS audio-unlock chain
function setupAudioGraph() {
  if (audioGraphReady) return;
  audioGraphReady = true;

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;

  try { audioContext = new Ctx(); }
  catch (e) { audioContext = null; return; }

  // resume and force-unlock with a silent buffer (iOS keeps the context
  // suspended until SOMETHING plays through it during a user gesture)
  try { audioContext.resume(); } catch (e) { /* ignore */ }
  try {
    const buf = audioContext.createBuffer(1, 1, 22050);
    const src = audioContext.createBufferSource();
    src.buffer = buf;
    src.connect(audioContext.destination);
    src.start(0);
  } catch (e) { /* ignore */ }

  for (const el of [homeAudio]) {
    try {
      const source = audioContext.createMediaElementSource(el);
      const filter = audioContext.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = FOCUSED_FREQ;
      filter.Q.value = 0.707;
      const gain = audioContext.createGain();
      gain.gain.value = userVolume;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(audioContext.destination);
      audioNodes.set(el, { filter, gain });
    } catch (e) {
      console.warn('Audio routing failed for', el.id, e);
    }
  }

  applyAudioFilter();
}

function ensureAudioContextRunning() {
  if (!audioContext || audioContext.state === 'running') return;
  audioContext.resume().catch(() => {});
}

function applyAudioFilter() {
  if (!audioContext) return;
  const tabUnfocused = document.hidden || !document.hasFocus();
  // menu open OR tab unfocused → muffled. tab unfocused also dims volume.
  const muffled    = tabUnfocused || menuOpen;
  const targetFreq = muffled ? UNFOCUSED_FREQ : FOCUSED_FREQ;
  const baseVol    = effectiveVolume();
  const targetGain = tabUnfocused ? baseVol * UNFOCUSED_MULT : baseVol;
  const t = audioContext.currentTime + RAMP_TIME;
  for (const { filter, gain } of audioNodes.values()) {
    try {
      filter.frequency.cancelScheduledValues(audioContext.currentTime);
      gain.gain.cancelScheduledValues(audioContext.currentTime);
      filter.frequency.linearRampToValueAtTime(targetFreq, t);
      gain.gain.linearRampToValueAtTime(targetGain, t);
    } catch (e) { /* ignore */ }
  }
}

document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('tab-hidden', document.hidden);
  applyAudioFilter();
});
window.addEventListener('blur',  applyAudioFilter);
window.addEventListener('focus', applyAudioFilter);

function onFirstInteraction() {
  setupAudioGraph();
}
window.addEventListener('pointerdown', onFirstInteraction, { once: true });
window.addEventListener('touchstart',  onFirstInteraction, { once: true });
window.addEventListener('keydown',     onFirstInteraction, { once: true });

// re-attempt resume on later interactions (iOS sometimes drops back to suspended)
['pointerdown', 'touchstart', 'click', 'keydown'].forEach(evt => {
  window.addEventListener(evt, ensureAudioContextRunning);
});

// ============================================================
// SCREEN TRANSITIONS
// ============================================================
function enterSite() {
  if (currentScreen !== 'landing') return;
  currentScreen = 'intro';

  setupAudioGraph();

  landing.classList.add('hidden');
  intro.classList.remove('hidden');

  // intro video plays with its own audio
  introVideo.muted = effectiveVolume() === 0;
  introVideo.currentTime = 0;
  introVideo.play().catch(() => {});
}

function endIntro() {
  if (currentScreen !== 'intro') return;
  currentScreen = 'home';
  onHome = true;

  try { introVideo.pause(); introVideo.currentTime = 0; } catch (e) { /* ignore */ }
  intro.classList.add('hidden');
  home.classList.remove('hidden');

  // start the spin from 0deg right as home appears
  if (welcome) welcome.classList.add('spinning');

  bgVideo.muted = true;
  bgVideo.loop  = true;
  bgVideo.play().catch(() => {});

  homeAudio.currentTime = 0;
  homeAudio.play().catch(() => {});

  // click-me appears after a few seconds (first time only — it stays visible after)
  setTimeout(() => {
    clickMeBtn.classList.remove('hidden-initial');
  }, CLICK_ME_REVEAL_MS);
}

introVideo.addEventListener('ended', endIntro);

function openMenu() {
  if (currentScreen !== 'home') return;
  currentScreen = 'menu';
  menuOpen = true;

  showMenuView('main');
  home.classList.add('menu-open');
  menuOverlay.classList.add('show');
  menuOverlay.setAttribute('aria-hidden', 'false');

  applyAudioFilter();
  startDateTime();
}

function closeMenu() {
  if (currentScreen !== 'menu') return;
  currentScreen = 'home';
  menuOpen = false;

  menuOverlay.classList.remove('show');
  menuOverlay.setAttribute('aria-hidden', 'true');
  home.classList.remove('menu-open');

  applyAudioFilter();
}

function showMenuView(name) {
  menuOverlay.dataset.view = name;
}

enterBtn.addEventListener('click', enterSite);
skipBtn.addEventListener('click', endIntro);
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
// INFO OVERLAY + 5x INFO-CLICK → SECRET VIDEO
// ============================================================
function openInfoOverlay() {
  if (!infoOverlay) return;
  infoOverlay.classList.add('show');
  infoOverlay.setAttribute('aria-hidden', 'false');
}

function closeInfoOverlay() {
  if (!infoOverlay) return;
  infoOverlay.classList.remove('show');
  infoOverlay.setAttribute('aria-hidden', 'true');
  if (infoBtn) infoBtn.blur();
}

const INFO_CLICK_WINDOW     = 2000;
const INFO_SECRET_THRESHOLD = 5;
let infoClickCount  = 0;
let lastInfoClickAt = 0;

if (infoBtn) infoBtn.addEventListener('click', () => {
  const now = performance.now();
  if (now - lastInfoClickAt > INFO_CLICK_WINDOW) infoClickCount = 0;
  infoClickCount += 1;
  lastInfoClickAt = now;

  if (infoClickCount >= INFO_SECRET_THRESHOLD) {
    infoClickCount = 0;
    closeInfoOverlay();
    openSecret();
    infoBtn.blur();
    return;
  }
  openInfoOverlay();
});

if (infoCloseBtn) infoCloseBtn.addEventListener('click', closeInfoOverlay);
if (infoOverlay)  infoOverlay.addEventListener('click', e => {
  if (e.target === infoOverlay) closeInfoOverlay();
});

// "watch intro again" button inside the info card
const watchIntroBtn = document.getElementById('watchIntroBtn');
if (watchIntroBtn) {
  watchIntroBtn.addEventListener('click', () => {
    closeInfoOverlay();
    replayIntro();
  });
}

function replayIntro() {
  // tear down whatever's currently playing
  if (currentScreen === 'menu') closeMenu();
  try { homeAudio.pause(); } catch (e) {}
  try { bgVideo.pause();   } catch (e) {}

  home.classList.add('hidden');
  intro.classList.remove('hidden');
  currentScreen = 'intro';

  introVideo.muted = effectiveVolume() === 0;
  introVideo.currentTime = 0;
  introVideo.play().catch(() => {});
}

// ============================================================
// SECRET VIDEO (5x info clicks → fullscreen secret.mp4)
// ============================================================
function openSecret() {
  if (secretActive) return;
  secretActive = true;

  try { homeAudio.pause(); } catch (e) {}
  try { bgVideo.pause();   } catch (e) {}
  try { introVideo.pause(); } catch (e) {}

  secretVideo.classList.remove('hidden');
  secretVideo.muted  = effectiveVolume() === 0;
  secretVideo.volume = 1.0;
  secretVideo.play().catch(() => {});

  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (req) req.call(el).catch(() => {});
}

function closeSecret() {
  if (!secretActive) return;

  try { secretVideo.pause(); } catch (e) {}
  secretVideo.currentTime = 0;
  secretVideo.muted = true;
  secretVideo.classList.add('hidden');

  const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  if (exit && document.fullscreenElement) exit.call(document).catch(() => {});

  // resume whichever screen we were on
  if (onHome) {
    bgVideo.muted = true;
    bgVideo.loop  = true;
    bgVideo.play().catch(() => {});
    homeAudio.play().catch(() => {});
  }

  secretActive = false;
}

if (secretVideo) secretVideo.addEventListener('ended', closeSecret);

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
// GLOBAL KEYDOWN
// ============================================================
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();

  if (event.key === 'Escape') {
    if (secretActive) { closeSecret(); return; }
    if (infoOverlay && infoOverlay.classList.contains('show')) { closeInfoOverlay(); return; }
    if (currentScreen === 'menu')  { closeMenu(); return; }
    if (currentScreen === 'intro') { endIntro();  return; }
  }

  if (currentScreen === 'landing' && (key === 'enter' || key === ' ')) {
    enterSite();
    return;
  }
});
