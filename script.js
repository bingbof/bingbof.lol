const landing        = document.getElementById('landing');
const main           = document.getElementById('main');
const enterBtn       = document.getElementById('enterBtn');
const clickMeBtn     = document.getElementById('clickMeBtn');
const welcome        = document.querySelector('.welcome');
const entranceFlash  = document.getElementById('entranceFlash');
const menuScreen     = document.getElementById('menuScreen');
const entranceAudio  = document.getElementById('entranceAudio');
const homeAudio      = document.getElementById('homeAudio');
const menuAudio      = document.getElementById('menuAudio');
const bgVideo        = document.getElementById('bgVideo');
const secretVideo    = document.getElementById('secretVideo');

const ENTRANCE_VOLUME = 0.25;
const HOME_VOLUME     = 0.50;
const MENU_VOLUME     = 0.50;

// if the user prefers reduced motion, snap the slide near-instant
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const SLIDE_MS = prefersReducedMotion ? 200 : 1000;

// persisted volume + mute prefs
const AUDIO_PREFS_KEY = 'bingbof.audio';

entranceAudio.volume = ENTRANCE_VOLUME;
homeAudio.volume     = HOME_VOLUME;
menuAudio.volume     = MENU_VOLUME;

function playEntranceAudio() {
  // guard against onFirstInteraction completing AFTER the user has already
  // clicked through to the home screen (otherwise entrance audio overlays home)
  if (landing.classList.contains('hidden')) return;
  entranceAudio.play().catch(() => {});
}

// ---------- mobile-warning popup ----------
const mobileOverlay    = document.getElementById('mobileOverlay');
const mobileDismissBtn = document.getElementById('mobileDismissBtn');

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

// ---------- web audio graph: muffle when tab loses focus, user volume control ----------
const FOCUSED_FREQ    = 22050;  // pass-through
const UNFOCUSED_FREQ  =   700;  // muffled "in another room" cutoff
const UNFOCUSED_MULT  = 0.7;    // ~30% quieter when tabbed out
const RAMP_TIME       = 0.4;

let audioContext     = null;
const audioNodes     = new Map();   // element -> { filter, gain }
let audioGraphReady  = false;
let analyser         = null;
let vizData          = null;

async function setupAudioGraph() {
  if (audioGraphReady) return;
  audioGraphReady = true;

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;

  try {
    audioContext = new Ctx();
  } catch (e) {
    audioContext = null;
    return;
  }

  const elements = [entranceAudio, homeAudio, menuAudio];
  for (const el of elements) {
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

  // analyser taps the menu audio's gain so the visualizer reacts to playback.
  // larger fftSize gives more bins → log-spaced bars across the full spectrum
  // instead of only the bass dominating the left side.
  const menuNode = audioNodes.get(menuAudio);
  if (menuNode) {
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;          // 128 frequency bins
    analyser.smoothingTimeConstant = 0.78;
    menuNode.gain.connect(analyser);
    vizData = new Uint8Array(analyser.frequencyBinCount);
  }

  if (audioContext.state === 'suspended') {
    try { await audioContext.resume(); } catch (e) { /* ignore */ }
  }
  applyFocusState();
}

// ---------- volume + mute state ----------
let userVolume = 1.0;
let isMuted    = false;

// load persisted preferences (volume / mute) from localStorage if any
try {
  const raw = localStorage.getItem(AUDIO_PREFS_KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    if (typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1) {
      userVolume = saved.volume;
    }
    if (typeof saved.muted === 'boolean') isMuted = saved.muted;
  }
} catch (e) { /* ignore */ }

function saveAudioPrefs() {
  try {
    localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify({
      volume: userVolume,
      muted:  isMuted,
    }));
  } catch (e) { /* ignore */ }
}

function effectiveVolume() {
  return (isMuted || userVolume === 0) ? 0 : userVolume;
}

function applyFocusState() {
  if (!audioContext) return;
  const muffled = document.hidden || !document.hasFocus();
  const targetFreq = muffled ? UNFOCUSED_FREQ : FOCUSED_FREQ;
  const baseVol    = effectiveVolume();
  const targetGain = muffled ? baseVol * UNFOCUSED_MULT : baseVol;
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
  applyFocusState();
});
window.addEventListener('blur',  applyFocusState);
window.addEventListener('focus', applyFocusState);

async function onFirstInteraction() {
  await setupAudioGraph();
  playEntranceAudio();
}
window.addEventListener('pointerdown', onFirstInteraction, { once: true });
window.addEventListener('keydown',     onFirstInteraction, { once: true });

// ---------- secret video (triggered by 5x info-button click) ----------
let secretActive = false;

function openSecret() {
  if (secretActive) return;
  secretActive = true;

  entranceAudio.pause();
  homeAudio.pause();
  menuAudio.pause();
  bgVideo.pause();

  secretVideo.classList.remove('hidden');
  secretVideo.muted = isMuted || userVolume === 0;
  secretVideo.volume = 1.0;
  secretVideo.play().catch(() => {});

  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (req) req.call(el).catch(() => {});
}

function closeSecret() {
  if (!secretActive) return;

  secretVideo.pause();
  secretVideo.currentTime = 0;
  secretVideo.muted = true;
  secretVideo.classList.add('hidden');

  const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  if (exit && document.fullscreenElement) exit.call(document).catch(() => {});

  if (onMenu) {
    menuAudio.play().catch(() => {});
  } else if (!landing.classList.contains('hidden')) {
    entranceAudio.play().catch(() => {});
  } else {
    bgVideo.muted = true;
    bgVideo.loop  = true;
    bgVideo.play().catch(() => {});
    homeAudio.play().catch(() => {});
  }

  secretActive = false;
}

if (secretVideo) secretVideo.addEventListener('ended', closeSecret);

// ---------- helpers ----------
function fadeOut(audio, ms) {
  return new Promise((resolve) => {
    const start = audio.volume;
    if (start <= 0 || audio.paused) {
      audio.pause();
      resolve();
      return;
    }
    const startTime = performance.now();
    function step(now) {
      const t = Math.min(1, (now - startTime) / ms);
      audio.volume = start * (1 - t);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        audio.pause();
        audio.volume = start;
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- screen transitions ----------
const CLICK_ME_REVEAL_MS = 3000;  // delay before click-me fades in on first visit

async function enterSite() {
  if (landing.classList.contains('hidden')) return;

  bgVideo.muted = true;
  bgVideo.loop  = true;

  // instant visual switch — no fade-to-black between entrance and home.
  // (click-me already has .hidden-initial from the HTML; we just remove it
  //  after 3s so it fades in cleanly without a flash on entry.)
  // start the logo spin from 0deg right as the home screen appears
  if (welcome) welcome.classList.add('spinning');
  landing.classList.add('hidden');
  main.classList.remove('hidden');

  // white flash that fades to reveal the home screen
  if (entranceFlash) {
    entranceFlash.classList.remove('flash');
    void entranceFlash.offsetWidth;  // restart animation if already played
    entranceFlash.classList.add('flash');
  }

  fadeOut(entranceAudio, 300);

  homeAudio.currentTime = 0;
  homeAudio.play().catch(() => {});

  setTimeout(() => {
    clickMeBtn.classList.remove('hidden-initial');
  }, CLICK_ME_REVEAL_MS);
}

let transitioning = false;
let onMenu        = false;

async function transitionToMenu() {
  if (transitioning || onMenu) return;
  transitioning = true;

  showMenuView('main');
  fadeOut(homeAudio, 400);

  // snap menu visible (it sits behind #main) then slide #main up
  menuScreen.classList.add('no-anim');
  menuScreen.classList.add('show');
  void menuScreen.offsetHeight;
  menuScreen.classList.remove('no-anim');

  main.classList.add('slide-up');
  menuAudio.currentTime = 0;
  menuAudio.play().catch(() => {});

  startParallax();
  startViz();
  startDateTime();
  startAudioProgress();

  await wait(SLIDE_MS);
  bgVideo.pause();

  onMenu = true;
  transitioning = false;
}

async function backToHome() {
  if (transitioning || !onMenu) return;
  transitioning = true;

  fadeOut(menuAudio, 400);
  bgVideo.play().catch(() => {});
  main.classList.remove('slide-up');

  await wait(SLIDE_MS);

  menuScreen.classList.remove('show');
  homeAudio.volume = HOME_VOLUME;
  homeAudio.currentTime = 0;
  homeAudio.play().catch(() => {});

  onMenu = false;
  transitioning = false;
}

// ---------- menu sub-views ----------
const backBtn     = document.getElementById('backBtn');
const viewBackBtn = document.getElementById('viewBackBtn');

function showMenuView(name) {
  menuScreen.dataset.view = name;
}

enterBtn.addEventListener('click', enterSite);
clickMeBtn.addEventListener('click', transitionToMenu);
if (backBtn)     backBtn.addEventListener('click', backToHome);
if (viewBackBtn) viewBackBtn.addEventListener('click', () => showMenuView('main'));

document.querySelectorAll('.menu-btn[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    if (view) showMenuView(view);
  });
});

// ---------- volume slider + mute toggle ----------
const muteBtn       = document.getElementById('muteBtn');
const volumeSlider  = document.getElementById('volumeSlider');

function syncVolumeUI() {
  if (volumeSlider) {
    // --vol-pct tracks the slider thumb position so the filled portion
    // stays consistent with where the user dragged it (even while muted).
    const pct = parseInt(volumeSlider.value, 10) || 0;
    volumeSlider.style.setProperty('--vol-pct', pct + '%');
  }
  if (muteBtn) {
    muteBtn.classList.toggle('muted', effectiveVolume() === 0);
  }
}

if (volumeSlider) {
  volumeSlider.value = String(Math.round(userVolume * 100));
  volumeSlider.addEventListener('input', () => {
    userVolume = parseInt(volumeSlider.value, 10) / 100;
    isMuted = false; // dragging the slider unmutes
    syncVolumeUI();
    applyFocusState();
    saveAudioPrefs();
    if (secretActive) secretVideo.muted = effectiveVolume() === 0;
  });
}

if (muteBtn) {
  muteBtn.addEventListener('click', () => {
    if (effectiveVolume() === 0) {
      // unmute (restore volume if it was zeroed out)
      isMuted = false;
      if (userVolume === 0) userVolume = 0.6;
      if (volumeSlider) volumeSlider.value = String(Math.round(userVolume * 100));
    } else {
      isMuted = true;
    }
    syncVolumeUI();
    applyFocusState();
    saveAudioPrefs();
    if (secretActive) secretVideo.muted = effectiveVolume() === 0;
    muteBtn.blur();
  });
}

syncVolumeUI();

// ---------- info overlay (5x click triggers the secret video) ----------
const infoBtn      = document.getElementById('infoBtn');
const infoOverlay  = document.getElementById('infoOverlay');
const infoCloseBtn = document.getElementById('infoCloseBtn');

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

const INFO_CLICK_WINDOW     = 2000;  // ms between presses to keep the streak
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
if (infoOverlay)  infoOverlay.addEventListener('click', (e) => {
  if (e.target === infoOverlay) closeInfoOverlay();
});

// ---------- discord username copy-to-clipboard ----------
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

// ---------- starfield ----------
function makeStars(selector, count) {
  const container = document.querySelector(selector);
  if (!container) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = (Math.random() * 100).toFixed(2) + '%';
    star.style.top  = (Math.random() * 100).toFixed(2) + '%';
    star.style.animationDelay    = (Math.random() * 4).toFixed(2) + 's';
    star.style.animationDuration = (2 + Math.random() * 4).toFixed(2) + 's';
    frag.appendChild(star);
  }
  container.appendChild(frag);
}

const starScale = window.innerWidth < 700 ? 0.55 : 1;
makeStars('.stars-small',  Math.round(180 * starScale));
makeStars('.stars-medium', Math.round( 50 * starScale));
makeStars('.stars-large',  Math.round( 12 * starScale));

// ---------- cursor parallax on the menu screen ----------
const parallaxLayers = [
  { el: document.querySelector('.stars-small'),  depth:  -5 },
  { el: document.querySelector('.stars-medium'), depth: -12 },
  { el: document.querySelector('.stars-large'),  depth: -22 },
];
let parX = 0, parY = 0, parTargetX = 0, parTargetY = 0;
let parRaf = null;

window.addEventListener('mousemove', (e) => {
  parTargetX = (e.clientX / window.innerWidth  - 0.5) * 2;
  parTargetY = (e.clientY / window.innerHeight - 0.5) * 2;
});

function parallaxFrame() {
  parX += (parTargetX - parX) * 0.08;
  parY += (parTargetY - parY) * 0.08;

  for (const layer of parallaxLayers) {
    if (!layer.el) continue;
    const tx = (parX * layer.depth).toFixed(2);
    const ty = (parY * layer.depth).toFixed(2);
    layer.el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
  }

  if (menuScreen.classList.contains('show')) {
    parRaf = requestAnimationFrame(parallaxFrame);
  } else {
    parRaf = null;
  }
}

function startParallax() {
  if (parRaf) return;
  parRaf = requestAnimationFrame(parallaxFrame);
}

// ---------- date / time (top-right of menu) ----------
const dateTimeEl = document.getElementById('dateTime');
const dtTimeEl   = dateTimeEl ? dateTimeEl.querySelector('.dt-time') : null;
const dtDateEl   = dateTimeEl ? dateTimeEl.querySelector('.dt-date') : null;
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

// ---------- audio scrubber + timestamps ----------
const audioScrubber = document.getElementById('audioScrubber');
const audioCurrent  = document.getElementById('audioCurrent');
const audioTotal    = document.getElementById('audioTotal');
let audioProgressTick = null;
let isScrubbing = false;

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m + ':' + s.toString().padStart(2, '0');
}

function updateAudioProgress() {
  if (!menuAudio) return;
  const dur = menuAudio.duration;
  const cur = menuAudio.currentTime;
  if (audioCurrent) audioCurrent.textContent = formatTime(cur);
  if (audioTotal)   audioTotal.textContent   = isFinite(dur) ? formatTime(dur) : '0:00';
  if (audioScrubber && isFinite(dur) && dur > 0 && !isScrubbing) {
    const pct = (cur / dur) * 1000;  // matches scrubber range 0..1000
    audioScrubber.value = String(pct);
    audioScrubber.style.setProperty('--seek-pct', (pct / 10) + '%');
  }
}

function startAudioProgress() {
  updateAudioProgress();
  if (audioProgressTick) return;
  audioProgressTick = setInterval(() => {
    if (!menuScreen.classList.contains('show')) {
      clearInterval(audioProgressTick);
      audioProgressTick = null;
      return;
    }
    updateAudioProgress();
  }, 250);
}

if (audioScrubber) {
  // live seek while dragging
  audioScrubber.addEventListener('input', () => {
    isScrubbing = true;
    const pct = parseFloat(audioScrubber.value) / 10; // 0..100
    audioScrubber.style.setProperty('--seek-pct', pct + '%');
    if (menuAudio && isFinite(menuAudio.duration) && menuAudio.duration > 0) {
      menuAudio.currentTime = (pct / 100) * menuAudio.duration;
      if (audioCurrent) audioCurrent.textContent = formatTime(menuAudio.currentTime);
    }
  });
  // release: stop blocking interval-driven updates
  audioScrubber.addEventListener('change', () => { isScrubbing = false; });
  audioScrubber.addEventListener('pointerup',   () => { isScrubbing = false; });
  audioScrubber.addEventListener('keyup',       () => { isScrubbing = false; });

  // arrow-key seek: ±5s when the scrubber is focused
  audioScrubber.addEventListener('keydown', (e) => {
    if (!menuAudio || !isFinite(menuAudio.duration) || menuAudio.duration <= 0) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      menuAudio.currentTime = Math.max(0, menuAudio.currentTime - 5);
      updateAudioProgress();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      menuAudio.currentTime = Math.min(menuAudio.duration, menuAudio.currentTime + 5);
      updateAudioProgress();
    }
  });
}

if (menuAudio) {
  menuAudio.addEventListener('loadedmetadata', updateAudioProgress);
  menuAudio.addEventListener('durationchange', updateAudioProgress);
}

// ---------- play/pause toggle ----------
const playPauseBtn = document.getElementById('playPauseBtn');
if (playPauseBtn) {
  playPauseBtn.addEventListener('click', () => {
    if (!menuAudio) return;
    if (menuAudio.paused) {
      menuAudio.play().catch(() => {});
    } else {
      menuAudio.pause();
    }
    playPauseBtn.blur();
  });
}
// reflect actual menuAudio state on the button (covers programmatic pause/play too)
if (menuAudio && playPauseBtn) {
  menuAudio.addEventListener('play',  () => {
    playPauseBtn.classList.remove('paused');
    playPauseBtn.setAttribute('aria-label', 'Pause');
  });
  menuAudio.addEventListener('pause', () => {
    playPauseBtn.classList.add('paused');
    playPauseBtn.setAttribute('aria-label', 'Play');
  });
}

// ---------- audio visualizer ----------
const vizCanvas = document.getElementById('vizCanvas');
const vizCtx    = vizCanvas ? vizCanvas.getContext('2d') : null;
let vizRaf      = null;

function drawViz() {
  if (!analyser || !vizCtx || !vizCanvas || !vizData) {
    vizRaf = null;
    return;
  }
  analyser.getByteFrequencyData(vizData);

  const w = vizCanvas.width;
  const h = vizCanvas.height;
  vizCtx.clearRect(0, 0, w, h);

  const N = 14;
  const gap = 1;
  const barWidth = (w - gap * (N - 1)) / N;

  // Log-spaced bin ranges so each bar covers ~one perceptual band
  // (bass doesn't dominate every bar, treble actually visible).
  const minBin = 2;
  const maxBin = vizData.length;
  const logMin = Math.log(minBin);
  const logRange = Math.log(maxBin) - logMin;

  for (let i = 0; i < N; i++) {
    const startBin = Math.floor(Math.exp(logMin + logRange * (i / N)));
    const endBin   = Math.max(startBin + 1, Math.floor(Math.exp(logMin + logRange * ((i + 1) / N))));
    let sum = 0, count = 0;
    for (let j = startBin; j < Math.min(endBin, vizData.length); j++) {
      sum += vizData[j];
      count++;
    }
    const avg = count > 0 ? sum / count / 255 : 0;
    // gentle gamma so quieter bands still register visibly
    const scaled = Math.pow(avg, 0.65);
    const barH = Math.max(2, scaled * h);
    const x = i * (barWidth + gap);
    const y = h - barH;
    vizCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    vizCtx.fillRect(x, y, barWidth, barH);
  }

  if (menuScreen.classList.contains('show')) {
    vizRaf = requestAnimationFrame(drawViz);
  } else {
    vizRaf = null;
  }
}

function startViz() {
  if (!vizRaf) vizRaf = requestAnimationFrame(drawViz);
}

// ---------- global keydown ----------
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();

  if (event.key === 'Escape') {
    if (secretActive) { closeSecret(); return; }
    if (infoOverlay && infoOverlay.classList.contains('show')) {
      closeInfoOverlay();
      return;
    }
  }

  if (!landing.classList.contains('hidden') && (key === 'enter' || key === ' ')) {
    enterSite();
    return;
  }

  // spacebar = play/pause toggle when on the menu (skip if focus is on a
  // form control or button, since those already handle space as activation)
  if (event.code === 'Space' && onMenu && menuAudio) {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'A' || tag === 'TEXTAREA') return;
    event.preventDefault();
    if (menuAudio.paused) menuAudio.play().catch(() => {});
    else                  menuAudio.pause();
  }
});

// =====================================================================
// PHYSICS / SHAKE EASTER EGG
// Shake a detached window (desktop) or shake the device (mobile) while the
// menu is open → the buttons fall and collide. Drag them around. Restore
// the window to full-screen / stop shaking and they spring back home.
// =====================================================================
const tapAudio   = document.getElementById('tapAudio');
const crashAudio = document.getElementById('crashAudio');

let physicsActive    = false;
let physicsEngine    = null;
let physicsBodies    = new Map();   // DOM element -> Matter.Body
let physicsWalls     = [];
let physicsRaf       = null;
let physicsClickArmed = false;       // suppresses click after a drag

// click guard — while physics is on, the buttons fall instead of opening views.
// the sliders stay clickable (they're inside the audio-bar body which moves
// with physics, but the input still works on top of it).
document.addEventListener('click', (e) => {
  if (!physicsActive) return;
  const sliderHit = e.target.closest('input[type="range"], .mute-btn, .play-pause-btn');
  if (sliderHit) return;
  e.preventDefault();
  e.stopPropagation();
}, true);

// ---------- which DOM elements become physics bodies ----------
function getPhysicsElements() {
  const list = [];
  const push = (sel) => {
    const el = (typeof sel === 'string') ? document.querySelector(sel) : sel;
    if (el && el.getBoundingClientRect().width > 0) list.push(el);
  };

  push('#infoBtn');
  push('.audio-bar');
  push('#dateTime');

  const view = menuScreen.dataset.view;
  if (view === 'main') {
    push('#backBtn');
    document.querySelectorAll('.view-main .menu-btn').forEach(push);
  } else {
    push('#viewBackBtn');
    const active = document.querySelector('.view-' + view);
    if (active) {
      const title = active.querySelector('.view-title');
      if (title) push(title);
      active.querySelectorAll('.social-link').forEach(push);
    }
  }

  return list;
}

// ---------- engine setup ----------
function physicsInit() {
  if (typeof Matter === 'undefined') return false;
  // higher iteration counts → much better collision resolution; objects
  // stop tunnelling through each other when you push hard with the cursor
  physicsEngine = Matter.Engine.create({
    positionIterations: 10,
    velocityIterations: 8,
    constraintIterations: 4,
  });
  physicsEngine.gravity.y = 1.1;

  const w = window.innerWidth;
  const h = window.innerHeight;
  const t = 200;
  physicsWalls = [
    Matter.Bodies.rectangle(w / 2,  -t / 2,     w * 3, t, { isStatic: true }),
    Matter.Bodies.rectangle(w / 2,  h + t / 2,  w * 3, t, { isStatic: true }),
    Matter.Bodies.rectangle(-t / 2, h / 2,      t,     h * 3, { isStatic: true }),
    Matter.Bodies.rectangle(w + t / 2, h / 2,   t,     h * 3, { isStatic: true }),
  ];
  Matter.World.add(physicsEngine.world, physicsWalls);
  return true;
}

// ---------- convert each visible element into a rigid body ----------
function physicsBuildBodies(shakeImpulse) {
  const elements = getPhysicsElements();
  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    // remember original inline style so we can restore exactly
    el.dataset.physicsPrevStyle = el.getAttribute('style') || '';

    // freeze element at its current screen position
    Object.assign(el.style, {
      position: 'fixed',
      top:      rect.top + 'px',
      left:     rect.left + 'px',
      right:    'auto',
      bottom:   'auto',
      width:    rect.width + 'px',
      height:   rect.height + 'px',
      margin:   '0',
      zIndex:   '120',
    });
    el.classList.add('physics-body');

    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;
    // round elements (info button) get a real circle body so they can roll;
    // rectangles get a slight chamfer for smoother contacts
    let body;
    if (el.id === 'infoBtn' || el.classList.contains('info-btn')) {
      const radius = Math.min(rect.width, rect.height) / 2;
      body = Matter.Bodies.circle(cx, cy, radius, {
        restitution: 0.6,
        friction:    0.05,
        frictionAir: 0.012,
        density:     0.002,
      });
    } else {
      body = Matter.Bodies.rectangle(cx, cy, rect.width, rect.height, {
        restitution: 0.4,
        friction:    0.18,
        frictionAir: 0.012,
        density:     0.002,
        chamfer:     { radius: 4 },
      });
    }

    // initial kick — some random push from the shake intensity
    const ix = (Math.random() - 0.5) * shakeImpulse;
    const iy = -Math.random() * shakeImpulse * 0.4;
    Matter.Body.setVelocity(body, { x: ix, y: iy });
    Matter.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.3);

    body.physicsEl = el;
    body.physicsOriginCenter = { x: cx, y: cy };
    physicsBodies.set(el, body);
    Matter.World.add(physicsEngine.world, body);
  }
}

// ---------- main loop ----------
const PHYSICS_MAX_SPEED = 28;  // velocity clamp prevents tunnelling during a yank
function physicsClampVelocities() {
  for (const body of Matter.Composite.allBodies(physicsEngine.world)) {
    if (body.isStatic) continue;
    const vx = body.velocity.x, vy = body.velocity.y;
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > PHYSICS_MAX_SPEED) {
      const s = PHYSICS_MAX_SPEED / speed;
      Matter.Body.setVelocity(body, { x: vx * s, y: vy * s });
    }
    if (Math.abs(body.angularVelocity) > 0.6) {
      Matter.Body.setAngularVelocity(body, Math.sign(body.angularVelocity) * 0.6);
    }
  }
}

function physicsTick(now) {
  if (!physicsActive) { physicsRaf = null; return; }
  const dt = Math.min(physicsTick.last ? now - physicsTick.last : 16, 33);
  physicsTick.last = now;
  Matter.Engine.update(physicsEngine, dt);
  physicsClampVelocities();
  for (const [el, body] of physicsBodies) {
    const dx = body.position.x - body.physicsOriginCenter.x;
    const dy = body.position.y - body.physicsOriginCenter.y;
    el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) rotate(' + body.angle + 'rad)';
  }
  physicsRaf = requestAnimationFrame(physicsTick);
}

// ---------- collision sound (tap.mp3 with pitch + volume jitter) ----------
const TAP_VOICES = 6;
let tapPool = [];
let tapIdx  = 0;
let lastTapAt = 0;
const TAP_MIN_GAP_MS = 30;

function setPreservesPitch(audio, value) {
  // browsers diverge — set every variant
  audio.preservesPitch       = value;
  audio.mozPreservesPitch    = value;
  audio.webkitPreservesPitch = value;
}

function physicsInitTapPool() {
  if (tapPool.length || !tapAudio) return;
  for (let i = 0; i < TAP_VOICES; i++) {
    const v = tapAudio.cloneNode();
    setPreservesPitch(v, false);  // playbackRate now changes pitch, not just speed
    tapPool.push(v);
  }
}

function physicsPlayTap(intensity) {
  const now = performance.now();
  if (now - lastTapAt < TAP_MIN_GAP_MS) return;
  lastTapAt = now;
  const voice = tapPool[tapIdx];
  tapIdx = (tapIdx + 1) % TAP_VOICES;
  if (!voice) return;
  try {
    voice.pause();
    voice.currentTime = 0;
    setPreservesPitch(voice, false);  // reassert each play — some browsers reset it
    voice.playbackRate = 0.7 + Math.random() * 0.7;             // 0.7x – 1.4x → ~one octave swing
    const base = 0.25 + Math.random() * 0.45 + intensity * 0.2; // 0.25 – 0.9 jitter
    voice.volume = Math.min(0.95, base) * (isMuted ? 0 : userVolume);
    voice.play().catch(() => {});
  } catch (e) { /* ignore */ }
}

// Prime tap pool + crash audio on the first user interaction. On iOS / mobile,
// cloned <audio> elements need to be played-and-paused inside a user gesture
// or they're silently blocked when collisions try to fire them later.
let physicsAudioPrimed = false;
function primePhysicsAudio() {
  if (physicsAudioPrimed) return;
  physicsAudioPrimed = true;
  physicsInitTapPool();
  const prime = (a) => {
    if (!a) return;
    const wasMuted = a.muted;
    a.muted = true;
    const p = a.play();
    if (p && typeof p.then === 'function') {
      p.then(() => { a.pause(); a.currentTime = 0; a.muted = wasMuted; }).catch(() => { a.muted = wasMuted; });
    } else {
      a.pause(); a.currentTime = 0; a.muted = wasMuted;
    }
  };
  for (const v of tapPool) prime(v);
  prime(crashAudio);
}
['pointerdown', 'touchstart', 'keydown'].forEach(evt => {
  window.addEventListener(evt, primePhysicsAudio, { once: true, capture: true });
});

function physicsBindCollisions() {
  Matter.Events.on(physicsEngine, 'collisionStart', (event) => {
    for (const pair of event.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      const dvx = a.velocity.x - b.velocity.x;
      const dvy = a.velocity.y - b.velocity.y;
      const rel = Math.sqrt(dvx * dvx + dvy * dvy);
      if (rel > 1.4) physicsPlayTap(Math.min(rel / 5, 1));
    }
  });
}

// ---------- pointer-driven dragging (mouse + touch) ----------
let dragConstraint = null;
let dragBody = null;
let dragMoved = false;

function physicsDragPos(e) {
  if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function physicsDragStart(e) {
  if (!physicsActive) return;
  // don't intercept slider / mute / play-pause interactions
  if (e.target.closest('input[type="range"], .mute-btn, .play-pause-btn')) return;

  const pos = physicsDragPos(e);
  const all = Matter.Composite.allBodies(physicsEngine.world);
  const hit = Matter.Query.point(all, pos).find(b => !b.isStatic);
  if (!hit) return;

  dragBody = hit;
  dragMoved = false;
  // soft constraint = less violent contact forces against neighbours
  dragConstraint = Matter.Constraint.create({
    pointA: { x: pos.x, y: pos.y },
    bodyB:  hit,
    pointB: { x: pos.x - hit.position.x, y: pos.y - hit.position.y },
    stiffness: 0.08,
    damping:   0.25,
    length:    0,
  });
  Matter.World.add(physicsEngine.world, dragConstraint);
  document.body.classList.add('physics-dragging');
  // prevent the page from accidentally scrolling on touch
  if (e.cancelable) e.preventDefault();
}

function physicsDragMove(e) {
  if (!dragConstraint) return;
  const pos = physicsDragPos(e);
  const oldA = dragConstraint.pointA;
  if (Math.abs(pos.x - oldA.x) + Math.abs(pos.y - oldA.y) > 3) dragMoved = true;
  dragConstraint.pointA.x = pos.x;
  dragConstraint.pointA.y = pos.y;
  if (e.cancelable) e.preventDefault();
}

function physicsDragEnd() {
  if (dragConstraint) Matter.World.remove(physicsEngine.world, dragConstraint);
  dragConstraint = null;
  dragBody = null;
  document.body.classList.remove('physics-dragging');
}

function physicsBindPointer() {
  window.addEventListener('mousedown',   physicsDragStart, true);
  window.addEventListener('mousemove',   physicsDragMove);
  window.addEventListener('mouseup',     physicsDragEnd);
  window.addEventListener('touchstart',  physicsDragStart, { passive: false, capture: true });
  window.addEventListener('touchmove',   physicsDragMove,  { passive: false });
  window.addEventListener('touchend',    physicsDragEnd);
}

function physicsUnbindPointer() {
  window.removeEventListener('mousedown',  physicsDragStart, true);
  window.removeEventListener('mousemove',  physicsDragMove);
  window.removeEventListener('mouseup',    physicsDragEnd);
  window.removeEventListener('touchstart', physicsDragStart, { capture: true });
  window.removeEventListener('touchmove',  physicsDragMove);
  window.removeEventListener('touchend',   physicsDragEnd);
}

// ---------- activate / restore ----------
function physicsActivate(intensity) {
  if (physicsActive) return;
  if (!onMenu) return;
  if (!physicsInit()) return;

  physicsActive = true;
  document.body.classList.add('physics-active');

  // sudden cut to music + crash
  if (menuAudio) {
    try { menuAudio.pause(); } catch (e) { /* ignore */ }
  }
  if (crashAudio) {
    try {
      crashAudio.currentTime = 0;
      // half-volume so it's a thud, not a jumpscare
      crashAudio.volume = (isMuted || userVolume === 0) ? 0 : userVolume * 0.5;
      crashAudio.play().catch(() => {});
    } catch (e) { /* ignore */ }
  }

  physicsInitTapPool();
  physicsBuildBodies(intensity || 8);
  physicsBindCollisions();
  physicsBindPointer();

  physicsTick.last = 0;
  physicsRaf = requestAnimationFrame(physicsTick);
}

function physicsRestore() {
  if (!physicsActive) return;
  physicsActive = false;
  if (physicsRaf) cancelAnimationFrame(physicsRaf);
  physicsRaf = null;

  physicsUnbindPointer();

  // spring elements back to their original DOM position
  const settled = [];
  for (const [el, body] of physicsBodies) {
    el.style.transition = 'transform 0.55s cubic-bezier(0.3, 0, 0.3, 1)';
    el.style.transform  = 'translate(0, 0) rotate(0deg)';
    settled.push(new Promise(r => setTimeout(r, 560)));
  }

  Promise.all(settled).then(() => {
    for (const [el] of physicsBodies) {
      const prev = el.dataset.physicsPrevStyle || '';
      if (prev) el.setAttribute('style', prev);
      else      el.removeAttribute('style');
      delete el.dataset.physicsPrevStyle;
      el.classList.remove('physics-body');
    }
    physicsBodies.clear();
    if (physicsEngine) {
      Matter.World.clear(physicsEngine.world, false);
      Matter.Engine.clear(physicsEngine);
      physicsEngine = null;
    }
    physicsWalls = [];
    document.body.classList.remove('physics-active');

    // resume the song where it left off (only on the menu)
    if (onMenu && menuAudio && menuAudio.paused) {
      menuAudio.play().catch(() => {});
    }
  });
}

// ---------- apply a directional impulse to every body (ongoing shake) ----------
function physicsApplyShake(forceX, forceY) {
  if (!physicsEngine) return;
  for (const body of Matter.Composite.allBodies(physicsEngine.world)) {
    if (body.isStatic) continue;
    Matter.Body.applyForce(body, body.position, {
      x: forceX * body.mass,
      y: forceY * body.mass,
    });
  }
}

// ---------- DESKTOP shake detection (poll window.screenX / screenY) ----------
let shakeLastX = (typeof window.screenX === 'number') ? window.screenX : 0;
let shakeLastY = (typeof window.screenY === 'number') ? window.screenY : 0;
let shakeSamples = [];
const SHAKE_WINDOW_MS = 600;
const SHAKE_MIN_CHANGES = 4;
const SHAKE_MIN_DISTANCE = 140;

function pollDesktopShake() {
  if (!onMenu) return;
  const sx = window.screenX;
  const sy = window.screenY;
  const dx = sx - shakeLastX;
  const dy = sy - shakeLastY;
  shakeLastX = sx;
  shakeLastY = sy;

  // if physics is already on, keep applying impulses while the user shakes
  if (physicsActive) {
    const m = Math.abs(dx) + Math.abs(dy);
    if (m > 3) {
      // opposite-direction force — objects feel inertia as the window moves
      physicsApplyShake(-dx * 0.0008, -dy * 0.0008);
    }
    return;
  }

  const now = performance.now();
  if (Math.abs(dx) + Math.abs(dy) > 1) {
    shakeSamples.push({ dx, dy, time: now });
  }
  shakeSamples = shakeSamples.filter(s => now - s.time < SHAKE_WINDOW_MS);

  let changes = 0;
  let signX = 0, signY = 0;
  let totalDist = 0;
  for (const s of shakeSamples) {
    const sX = Math.sign(s.dx);
    const sY = Math.sign(s.dy);
    if (sX !== 0 && sX !== signX) changes++;
    if (sY !== 0 && sY !== signY) changes++;
    if (sX !== 0) signX = sX;
    if (sY !== 0) signY = sY;
    totalDist += Math.sqrt(s.dx * s.dx + s.dy * s.dy);
  }

  if (changes >= SHAKE_MIN_CHANGES && totalDist > SHAKE_MIN_DISTANCE) {
    const intensity = Math.min(20, 6 + totalDist / 40);
    shakeSamples = [];
    physicsActivate(intensity);
  }
}

setInterval(pollDesktopShake, 50);

// ---------- MOBILE shake detection (DeviceMotionEvent) ----------
let mobileMotionBound = false;
let mobileMotionAccel = 0;
let mobileLastAcc = { x: 0, y: 0, z: 0 };
const MOBILE_SHAKE_THRESHOLD = 26;

function handleDeviceMotion(event) {
  if (!onMenu) return;
  const a = event.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  const dx = a.x - mobileLastAcc.x;
  const dy = a.y - mobileLastAcc.y;
  const dz = a.z - mobileLastAcc.z;
  const mag = Math.sqrt(dx * dx + dy * dy + dz * dz);
  mobileMotionAccel = mobileMotionAccel * 0.7 + mag * 0.3;
  mobileLastAcc = { x: a.x, y: a.y, z: a.z };

  // ongoing shake → apply impulse to all bodies
  if (physicsActive) {
    if (mag > 3) {
      physicsApplyShake(-dx * 0.0008, dy * 0.0008);
    }
    return;
  }

  if (mobileMotionAccel > MOBILE_SHAKE_THRESHOLD) {
    const intensity = Math.min(18, mobileMotionAccel + 8);
    mobileMotionAccel = 0;
    physicsActivate(intensity);
  }
}

function bindDeviceMotionDirect() {
  if (mobileMotionBound) return;
  window.addEventListener('devicemotion', handleDeviceMotion);
  mobileMotionBound = true;
}

// iOS 13+ requires DeviceMotionEvent.requestPermission() from a user gesture.
// We can't detect shake without permission — so we use a touch-based proxy:
// when the user's finger jitters rapidly across the screen (which happens
// when they shake the phone while touching it), we trigger the permission
// prompt. After that, devicemotion drives everything.
let motionPermAsked = false;
let touchShakeSamples = [];
const TOUCH_SHAKE_WINDOW_MS = 450;
const TOUCH_SHAKE_DISTANCE  = 380;

async function requestMotionPermissionViaShake() {
  if (motionPermAsked) return;
  motionPermAsked = true;
  if (typeof DeviceMotionEvent === 'undefined') return;
  if (typeof DeviceMotionEvent.requestPermission !== 'function') {
    bindDeviceMotionDirect();
    return;
  }
  try {
    const result = await DeviceMotionEvent.requestPermission();
    if (result === 'granted') bindDeviceMotionDirect();
  } catch (e) { /* user dismissed */ }
}

window.addEventListener('touchmove', (e) => {
  if (!onMenu) return;
  if (motionPermAsked) return;
  // Only relevant for iOS-style permission-gated motion
  if (typeof DeviceMotionEvent === 'undefined' ||
      typeof DeviceMotionEvent.requestPermission !== 'function') return;
  const t = e.touches[0];
  if (!t) return;
  const now = performance.now();
  touchShakeSamples.push({ x: t.clientX, y: t.clientY, time: now });
  touchShakeSamples = touchShakeSamples.filter(s => now - s.time < TOUCH_SHAKE_WINDOW_MS);
  let dist = 0;
  for (let i = 1; i < touchShakeSamples.length; i++) {
    const a = touchShakeSamples[i - 1];
    const b = touchShakeSamples[i];
    dist += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  }
  if (dist > TOUCH_SHAKE_DISTANCE && touchShakeSamples.length > 6) {
    requestMotionPermissionViaShake();
  }
}, { passive: true });

// On Android (and anything without the permission API), bind motion immediately.
if (typeof DeviceMotionEvent !== 'undefined' &&
    typeof DeviceMotionEvent.requestPermission !== 'function') {
  bindDeviceMotionDirect();
}

// ---------- RESTORE when window becomes maximized again ----------
function isWindowMaximized() {
  if (!screen || !screen.availWidth) return false;
  return Math.abs(window.outerWidth  - screen.availWidth)  < 40 &&
         Math.abs(window.outerHeight - screen.availHeight) < 60;
}

let restoreTimer = null;
window.addEventListener('resize', () => {
  if (!physicsActive) return;
  clearTimeout(restoreTimer);
  restoreTimer = setTimeout(() => {
    if (isWindowMaximized()) physicsRestore();
  }, 220);
});
