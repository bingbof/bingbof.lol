// ============================================================
// ELEMENT REFS
// ============================================================
const mobileOverlay    = document.getElementById('mobileOverlay');
const mobileDismissBtn = document.getElementById('mobileDismissBtn');

const landing       = document.getElementById('landing');
const enterBtn      = document.getElementById('enterBtn');

const home          = document.getElementById('home');
const orbStage      = document.querySelector('.orb-stage');
const orbBtn        = document.getElementById('orbBtn');
const orbit         = document.getElementById('orbit');
const viewBackBtn   = document.getElementById('viewBackBtn');

const theme         = document.getElementById('theme');
const audioBar      = document.getElementById('audioBar');
const volumeSlider  = document.getElementById('volumeSlider');
const muteBtn       = document.getElementById('muteBtn');
const playPauseBtn  = document.getElementById('playPauseBtn');
const scrubber      = document.getElementById('audioScrubber');
const timeCurrent   = document.getElementById('audioCurrent');
const timeTotal     = document.getElementById('audioTotal');
const vizCanvas     = document.getElementById('vizCanvas');

const menuOverlay   = document.getElementById('menuOverlay');
const dateTimeEl    = document.getElementById('dateTime');
const dtTimeEl      = dateTimeEl && dateTimeEl.querySelector('.dt-time');
const dtDateEl      = dateTimeEl && dateTimeEl.querySelector('.dt-date');

// ============================================================
// CONFIG
// ============================================================
const ORBIT_REVEAL_MS = 3000;

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

  // this runs inside the click/keypress handler, which is the user gesture
  // browsers require before audio may start
  setupAudio();
  playTheme();

  // after a beat, "click me" scales out of the orb's centre and starts
  // circling it — the CSS animation runs on class removal. the orb stays
  // unclickable until then, so the invitation always precedes the action.
  setTimeout(() => {
    if (orbit) orbit.classList.remove('hidden-initial');
    orbBtn.disabled = false;
  }, ORBIT_REVEAL_MS);
}

function openMenu() {
  if (currentScreen !== 'home') return;
  currentScreen = 'menu';

  showMenuView('main');
  home.classList.add('menu-open');
  // the orb is now the back control, so it stays focusable — no inert here
  if (orbBtn) orbBtn.setAttribute('aria-label', 'back');
  if (audioBar) audioBar.classList.remove('hidden');
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
  if (audioBar) audioBar.classList.add('hidden');
  vizHiddenAt = performance.now();
  // the user has now seen what the orb does, so the ring stays retired
  home.classList.add('ring-retired');
  if (orbBtn) orbBtn.setAttribute('aria-label', 'click me');
  stopDateTime();
}

function showMenuView(name) {
  menuOverlay.dataset.view = name;
}

enterBtn.addEventListener('click', enterSite);
// osu!-style: the orb opens the menu, and once docked it is the only way
// back — so it steps up one level at a time, sub-view -> main -> home
function stepBack() {
  if (currentScreen !== 'menu') return;
  if (menuOverlay.dataset.view !== 'main') showMenuView('main');
  else closeMenu();
}

orbBtn.addEventListener('click', () => {
  if (currentScreen === 'home') openMenu();
  else stepBack();
});

if (viewBackBtn) viewBackBtn.addEventListener('click', () => showMenuView('main'));
document.querySelectorAll('.menu-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    if (view) showMenuView(view);
  });
});

// ============================================================
// THEME AUDIO + BEAT
// "i miss when we talked" - 2hollis. Both numbers are measured off
// the file, not assumed: a comb filter over the onset envelope peaks
// hard at 142.00 (0.421, vs <0.14 at every neighbouring tempo), with
// the first downbeat 407ms in - nearly a full beat, so it matters.
// Opus/FLAC rather than MP3 on purpose: MP3 encoder delay/padding leaves
// a gap at the loop point.
// ============================================================
const BPM            = 142;
const BEAT_MS        = 60000 / BPM;
const BEAT_OFFSET_MS = 407;
const BEAT_RESYNC_MS = 2000;
const BEAT_NAMES     = ['orb-beat', 'screen-beat'];

let beatResyncTick = null;
let lastAudioTime  = 0;

// The CSS animations run on the document timeline and the track on the audio
// clock, so they drift apart. animation-delay cannot fix that: it is measured
// from the animation's start time, so phase = (now - start - delay) % beat,
// and setting delay from currentTime alone lands on an arbitrary phase. The
// Web Animations API exposes each animation's own clock, which is the thing
// that actually needs setting.
function beatTargets() {
  // orb, home scene, menu overlay and player — the overlay and the player
  // are siblings of #home, so without them the composition stops pulsing
  // the moment the orb docks and the buttons take over the screen
  return [orbStage, home, menuOverlay, audioBar].filter(function (el) {
    return el && el.getAnimations;
  });
}

function syncBeat() {
  if (!theme || theme.paused) return;
  const elapsed = theme.currentTime * 1000 - BEAT_OFFSET_MS;
  const pos = ((elapsed % BEAT_MS) + BEAT_MS) % BEAT_MS;
  beatTargets().forEach(function (el) {
    el.getAnimations().forEach(function (a) {
      if (BEAT_NAMES.indexOf(a.animationName) !== -1) a.currentTime = pos;
    });
  });
}

function startBeat() {
  beatTargets().forEach(function (el) {
    el.style.setProperty('--beat', BEAT_MS + 'ms');
    el.classList.add('bumping');
  });
  syncBeat();
  if (!beatResyncTick) beatResyncTick = setInterval(syncBeat, BEAT_RESYNC_MS);
}

function stopBeat() {
  beatTargets().forEach(function (el) { el.classList.remove('bumping'); });
  if (beatResyncTick) { clearInterval(beatResyncTick); beatResyncTick = null; }
}

function playTheme() {
  if (!theme) return;
  const p = theme.play();
  if (p && p.catch) {
    // a browser that refuses to start it here will allow it off any later
    // gesture, so arm one rather than leaving the page silent
    p.catch(function () {
      const retry = function () { theme.play().catch(function () {}); };
      document.addEventListener('pointerdown', retry, { once: true });
      document.addEventListener('keydown', retry, { once: true });
    });
  }
}

// ============================================================
// PLAYER UI
// ============================================================
let scrubbing  = false;
let userVolume = 0.5;
let muted      = false;

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function applyVolume() {
  if (theme) theme.volume = muted ? 0 : userVolume;
  // UI sounds ride the same control — muting the music mutes them too
  if (window.uiSound) window.uiSound.setVolume(muted ? 0 : userVolume * 0.5);
  const pct = Math.round((muted ? 0 : userVolume) * 100);
  if (volumeSlider) volumeSlider.style.setProperty('--vol-pct', pct + '%');
  if (muteBtn) {
    muteBtn.classList.toggle('muted', muted || userVolume === 0);
    muteBtn.setAttribute('aria-label', muted ? 'unmute' : 'mute');
  }
}

// the scrubber's played portion is drawn from this (see --seek-track in styles.css)
function setSeekFill(frac) {
  scrubber.style.setProperty('--seek-pct', (frac * 100).toFixed(2) + '%');
}

function syncProgress() {
  if (!theme || !isFinite(theme.duration)) return;
  if (timeCurrent) timeCurrent.textContent = fmtTime(theme.currentTime);
  if (timeTotal)   timeTotal.textContent   = fmtTime(theme.duration);
  if (scrubbing || !scrubber) return;
  const frac = theme.duration ? theme.currentTime / theme.duration : 0;
  scrubber.value = String(Math.round(frac * 1000));
  setSeekFill(frac);
}

if (volumeSlider) {
  userVolume = Number(volumeSlider.value) / 100;
  volumeSlider.addEventListener('input', function () {
    userVolume = Number(volumeSlider.value) / 100;
    muted = false;
    applyVolume();
  });
}

if (muteBtn) {
  muteBtn.addEventListener('click', function () {
    muted = !muted;
    applyVolume();
    muteBtn.blur();
  });
}

if (playPauseBtn) {
  playPauseBtn.addEventListener('click', function () {
    if (!theme) return;
    if (theme.paused) playTheme(); else theme.pause();
    playPauseBtn.blur();
  });
}

if (scrubber) {
  scrubber.addEventListener('pointerdown', function () { scrubbing = true; });
  scrubber.addEventListener('input', function () {
    const frac = Number(scrubber.value) / 1000;
    setSeekFill(frac);
    if (timeCurrent && theme && isFinite(theme.duration)) {
      timeCurrent.textContent = fmtTime(frac * theme.duration);
    }
  });
  const commitSeek = function () {
    if (!scrubbing) return;
    scrubbing = false;
    if (theme && isFinite(theme.duration)) {
      theme.currentTime = (Number(scrubber.value) / 1000) * theme.duration;
    }
  };
  scrubber.addEventListener('change', commitSeek);
  window.addEventListener('pointerup', commitSeek);
}

if (theme) {
  applyVolume();

  theme.addEventListener('play', function () {
    startBeat();
    if (playPauseBtn) {
      playPauseBtn.classList.remove('paused');
      playPauseBtn.setAttribute('aria-label', 'pause');
    }
    setupAudio();
  });

  theme.addEventListener('pause', function () {
    stopBeat();
    if (playPauseBtn) {
      playPauseBtn.classList.add('paused');
      playPauseBtn.setAttribute('aria-label', 'play');
    }
  });

  theme.addEventListener('playing', syncBeat);
  theme.addEventListener('seeked',  syncBeat);
  theme.addEventListener('loadedmetadata', syncProgress);

  theme.addEventListener('timeupdate', function () {
    // 162.26s is 384.01 beats, so the loop barely shifts phase (~4ms) - but
    // catch the wrap anyway rather than waiting for the next resync tick
    if (theme.currentTime < lastAudioTime) syncBeat();
    lastAudioTime = theme.currentTime;
    syncProgress();
  });
}

// ---- web audio graph ----------------------------------------------
// src -> lowpass -> gain -> destination, with the analyser tapped off the
// gain. Routing the element through Web Audio means a suspended context
// would silence it, so this is built inside the enter gesture and any
// failure leaves the plain element audio untouched.
//
// Values carried over from the 1.2.x build (git cf707e8).
const FOCUSED_FREQ   = 22050;   // pass-through
const UNFOCUSED_FREQ = 700;     // muffled, "in another room"
const UNFOCUSED_MULT = 0.7;     // ~30% quieter while tabbed out
const RAMP_TIME      = 0.4;

let audioCtx = null, analyser = null, vizData = null, vizTick = null;
let vizCtx = null;
// the bar starts hidden, so 0 = "hidden long ago". set on close so the bars
// keep moving through the bar's 0.25s fade-out instead of freezing
let vizHiddenAt = 0;
const VIZ_FADE_MS = 300;
let muffleFilter = null, muffleGain = null;

function setupAudio() {
  if (!theme) return;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      audioCtx = new Ctx();
      const src = audioCtx.createMediaElementSource(theme);

      muffleFilter = audioCtx.createBiquadFilter();
      muffleFilter.type = 'lowpass';
      muffleFilter.frequency.value = FOCUSED_FREQ;
      muffleFilter.Q.value = 0.707;

      // this gain carries the muffle only — user volume stays on
      // theme.volume, so the slider keeps working on its own
      muffleGain = audioCtx.createGain();
      muffleGain.gain.value = 1;

      src.connect(muffleFilter);
      muffleFilter.connect(muffleGain);
      muffleGain.connect(audioCtx.destination);

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      muffleGain.connect(analyser);          // a tap, not in the path
      vizData = new Uint8Array(analyser.frequencyBinCount);
    } catch (e) {
      audioCtx = null;
      analyser = null;
      muffleFilter = null;
      muffleGain = null;
      return;
    }
  }
  if (audioCtx.state !== 'running') audioCtx.resume().catch(function () {});
  applyFocusState();
  if (!vizTick) vizTick = requestAnimationFrame(drawViz);
}

// focus only — opening the menu must NOT muffle anything
let muffledNow = null;   // null = never applied, so the first call snaps

function applyFocusState() {
  if (!audioCtx || !muffleFilter || !muffleGain) return;
  const muffled = document.hidden || !document.hasFocus();
  if (muffled === muffledNow) return;        // nothing to ramp

  const freq = muffled ? UNFOCUSED_FREQ : FOCUSED_FREQ;
  const gain = muffled ? UNFOCUSED_MULT : 1;
  const now = audioCtx.currentTime;

  try {
    if (muffledNow === null) {
      // first application: set it outright. ramping on setup is what let a
      // sliver of the filtered signal through as the track started.
      muffleFilter.frequency.setValueAtTime(freq, now);
      muffleGain.gain.setValueAtTime(gain, now);
    } else {
      // anchor at the current value before ramping — without a preceding
      // event the ramp's start value is not well defined
      muffleFilter.frequency.cancelScheduledValues(now);
      muffleGain.gain.cancelScheduledValues(now);
      muffleFilter.frequency.setValueAtTime(muffleFilter.frequency.value, now);
      muffleGain.gain.setValueAtTime(muffleGain.gain.value, now);
      muffleFilter.frequency.linearRampToValueAtTime(freq, now + RAMP_TIME);
      muffleGain.gain.linearRampToValueAtTime(gain, now + RAMP_TIME);
    }
    muffledNow = muffled;
  } catch (e) { /* ignore */ }
}

window.addEventListener('blur',  applyFocusState);
window.addEventListener('focus', applyFocusState);

function drawViz() {
  vizTick = requestAnimationFrame(drawViz);
  if (!analyser || !vizCanvas || document.hidden) return;
  // nothing to paint while the audio bar is fully hidden (the home screen)
  if (audioBar && audioBar.classList.contains('hidden') &&
      performance.now() - vizHiddenAt > VIZ_FADE_MS) return;
  const g = vizCtx || (vizCtx = vizCanvas.getContext('2d'));
  const w = vizCanvas.width, h = vizCanvas.height;
  analyser.getByteFrequencyData(vizData);
  g.clearRect(0, 0, w, h);
  const bars = 16;
  const bw = w / bars;
  g.fillStyle = '#fff';
  for (let i = 0; i < bars; i++) {
    // low bins carry most of the energy, so sample logarithmically
    const idx = Math.floor(Math.pow(i / bars, 1.7) * vizData.length);
    const v = vizData[idx] / 255;
    const bh = Math.max(1, v * h);
    g.fillRect(i * bw, h - bh, Math.max(1, bw - 1.5), bh);
  }
}

// ============================================================
// POINTER PARALLAX (home screen and menu; off on the landing screen)
// ============================================================
const plxOrb  = document.querySelector('.plx-orb');
const plxRing = document.querySelector('.plx-ring');
const plxMenu = document.querySelector('.menu-panel');
const plxDockRing = document.querySelector('.plx-dock-ring');

const PLX_MAX   = 16;     // px of travel at the edge of the viewport
const PLX_DIR   = -1;     // -1 drifts away from the cursor, +1 follows it
const PLX_ORB   = 1.0;
const PLX_RING  = 1.55;   // the ring outruns the orb — that gap is the depth
const PLX_MENU  = 1.2;    // the menu buttons, a touch nearer than the orb
const PLX_FIELD = 0.35;   // the vignette, barely moving at all
const PLX_EASE  = 0.085;  // per-frame approach to the target

let plxTargetX = 0, plxTargetY = 0;
let plxX = 0, plxY = 0;
let plxTick = null;

const plxReduced = window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function plxFrame() {
  plxX += (plxTargetX - plxX) * PLX_EASE;
  plxY += (plxTargetY - plxY) * PLX_EASE;

  const shift = (el, k) => {
    if (el) el.style.transform =
      'translate3d(' + (plxX * k).toFixed(2) + 'px,' + (plxY * k).toFixed(2) + 'px,0)';
  };
  shift(plxOrb, PLX_ORB);
  shift(plxRing, PLX_RING);
  shift(plxDockRing, PLX_RING);
  shift(plxMenu, PLX_MENU);
  if (home) {
    home.style.setProperty('--plx-x', (plxX * PLX_FIELD).toFixed(2) + 'px');
    home.style.setProperty('--plx-y', (plxY * PLX_FIELD).toFixed(2) + 'px');
  }

  // settle and stop; the next pointer move restarts the loop
  if (Math.abs(plxTargetX - plxX) < 0.05 && Math.abs(plxTargetY - plxY) < 0.05) {
    plxX = plxTargetX;
    plxY = plxTargetY;
    plxTick = null;
    return;
  }
  plxTick = requestAnimationFrame(plxFrame);
}

function plxAim(x, y) {
  if (plxReduced) return;
  plxTargetX = x;
  plxTargetY = y;
  if (!plxTick) plxTick = requestAnimationFrame(plxFrame);
}

window.addEventListener('pointermove', (event) => {
  // runs on the home screen and in the menu — only the landing gate is off
  if (currentScreen === 'landing') return;
  const nx = (event.clientX / window.innerWidth  - 0.5) * 2;   // -1 .. 1
  const ny = (event.clientY / window.innerHeight - 0.5) * 2;
  plxAim(nx * PLX_MAX * PLX_DIR, ny * PLX_MAX * PLX_DIR);
});

// ease back to centre when the cursor leaves the window entirely
window.addEventListener('pointerout', (event) => {
  if (!event.relatedTarget) plxAim(0, 0);
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
// TAB VISIBILITY (pauses the orbit via CSS)
// ============================================================
document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('tab-hidden', document.hidden);
  applyFocusState();
  // animations are throttled while backgrounded; the audio isn't
  if (!document.hidden) syncBeat();
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
      '<link rel="icon" href="' + window.location.origin + '/img/orb.png">' +
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
    if (currentScreen === 'menu') { stepBack(); return; }
  }

  // keyword triggers — only when NOT typing in a field
  if (!isTypingInField() && /^[a-z0-9]$/.test(key)) {
    keyBuf = (keyBuf + key).slice(-6);
    if (keyBuf.endsWith('chat')) { keyBuf = ''; openChatWindow(); return; }
    if (keyBuf.endsWith('404'))  { keyBuf = ''; window.location.href = '/404.html'; return; }
    if (keyBuf.endsWith('spin')) {
      keyBuf = '';
      document.querySelectorAll('.orbit-spin').forEach(el => el.classList.toggle('orbit-fast'));
      return;
    }
  }

  if (currentScreen === 'landing' && (key === 'enter' || key === ' ')) {
    enterSite();
    return;
  }
});
