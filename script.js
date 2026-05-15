const landing        = document.getElementById('landing');
const main           = document.getElementById('main');
const enterBtn       = document.getElementById('enterBtn');
const clickMeBtn     = document.getElementById('clickMeBtn');
const menuScreen     = document.getElementById('menuScreen');
const entranceAudio  = document.getElementById('entranceAudio');
const homeAudio      = document.getElementById('homeAudio');
const menuAudio      = document.getElementById('menuAudio');
const bgVideo        = document.getElementById('bgVideo');
const secretVideo    = document.getElementById('secretVideo');

const ENTRANCE_VOLUME = 0.25;
const HOME_VOLUME     = 0.50;
const MENU_VOLUME     = 0.50;
const SLIDE_MS        = 1000;       // home <-> menu slide duration (matches CSS)

entranceAudio.volume = ENTRANCE_VOLUME;
homeAudio.volume     = HOME_VOLUME;
menuAudio.volume     = MENU_VOLUME;

function playEntranceAudio() {
  // guard against onFirstInteraction completing AFTER the user has already
  // clicked through to the home screen (otherwise entrance audio overlays home)
  if (landing.classList.contains('hidden')) return;
  entranceAudio.play().catch(() => {});
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

document.addEventListener('visibilitychange', applyFocusState);
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
  landing.classList.add('hidden');
  main.classList.remove('hidden');

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
  }
});
