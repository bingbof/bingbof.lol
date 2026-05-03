const landing        = document.getElementById('landing');
const main           = document.getElementById('main');
const enterBtn       = document.getElementById('enterBtn');
const clickMeBtn     = document.getElementById('clickMeBtn');
const whiteScreen    = document.getElementById('whiteScreen');
const menuScreen     = document.getElementById('menuScreen');
const entranceAudio  = document.getElementById('entranceAudio');
const homeAudio      = document.getElementById('homeAudio');
const sparkleAudio   = document.getElementById('sparkleAudio');
const menuAudio      = document.getElementById('menuAudio');
const bgVideo        = document.getElementById('bgVideo');
const secretVideo    = document.getElementById('secretVideo');

const ENTRANCE_VOLUME = 0.25;
const HOME_VOLUME     = 0.50;
const SPARKLE_VOLUME  = 0.7;
const MENU_VOLUME     = 0.50;
const FADE_MS         = 800;

sparkleAudio.volume = SPARKLE_VOLUME;
menuAudio.volume    = MENU_VOLUME;

entranceAudio.volume = ENTRANCE_VOLUME;
homeAudio.volume     = HOME_VOLUME;

function playEntranceAudio() {
  entranceAudio.play().catch(() => {});
}

// ---------- web audio graph: muffle + duck audio when tab loses focus ----------
const FOCUSED_FREQ   = 22050;  // pass-through (no filtering)
const UNFOCUSED_FREQ =   700;  // muffled "in another room" cutoff
const FOCUSED_GAIN   = 1.0;
const UNFOCUSED_GAIN = 0.7;    // ~30% quieter when tabbed out
const RAMP_TIME      = 0.4;

let audioContext = null;
const audioNodes  = new Map();   // element -> { filter, gain }
let audioGraphReady = false;

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

  // Note: bgVideo is muted, secretVideo only plays during konami easter egg.
  // Routing only the four audio elements keeps the graph robust on all browsers.
  const elements = [entranceAudio, homeAudio, sparkleAudio, menuAudio];
  for (const el of elements) {
    try {
      const source = audioContext.createMediaElementSource(el);
      const filter = audioContext.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = FOCUSED_FREQ;
      filter.Q.value = 0.707;
      const gain = audioContext.createGain();
      gain.gain.value = FOCUSED_GAIN;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(audioContext.destination);
      audioNodes.set(el, { filter, gain });
    } catch (e) {
      console.warn('Audio routing failed for', el.id, e);
    }
  }

  // Awaiting resume avoids the spin-up glitch on the first audio frame.
  if (audioContext.state === 'suspended') {
    try { await audioContext.resume(); } catch (e) { /* ignore */ }
  }
  applyFocusState();
}

let isMuted = false;

function applyFocusState() {
  if (!audioContext) return;
  const muffled = document.hidden || !document.hasFocus();
  const targetFreq = muffled ? UNFOCUSED_FREQ : FOCUSED_FREQ;
  const targetGain = isMuted ? 0 : (muffled ? UNFOCUSED_GAIN : FOCUSED_GAIN);
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

// Set up the audio graph on first interaction, THEN start the entrance audio.
// Awaiting setup avoids the brief muffle that happens when an already-playing
// audio element is rerouted through a freshly-created audio context.
async function onFirstInteraction() {
  await setupAudioGraph();
  playEntranceAudio();
}
window.addEventListener('pointerdown', onFirstInteraction, { once: true });
window.addEventListener('keydown',     onFirstInteraction, { once: true });

const cheatCode = [
  'arrowup', 'arrowup',
  'arrowdown', 'arrowdown',
  'arrowleft', 'arrowright', 'arrowleft', 'arrowright',
  'b', 'a', 's', 't', 'a', 'r', 't'
];
let cheatIndex = 0;
let secretActive = false;

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

async function enterSite() {
  if (landing.classList.contains('hidden')) return;
  landing.classList.add('fade-out');

  bgVideo.muted = true;
  bgVideo.loop = true;

  await fadeOut(entranceAudio, FADE_MS);

  // measure the marquee NOW so the animation starts with correct durations
  syncMarqueeSpeed();

  landing.classList.add('hidden');
  main.classList.remove('hidden');

  homeAudio.currentTime = 0;
  homeAudio.play().catch(() => {});
}

function openSecret() {
  if (secretActive) return;
  secretActive = true;

  entranceAudio.pause();
  homeAudio.pause();
  menuAudio.pause();
  bgVideo.pause();

  secretVideo.classList.remove('hidden');
  secretVideo.muted = isMuted;
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
  } else {
    bgVideo.muted = true;
    bgVideo.loop = true;
    bgVideo.play().catch(() => {});
    homeAudio.play().catch(() => {});
  }

  secretActive = false;
  cheatIndex = 0;
}

secretVideo.addEventListener('ended', closeSecret);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let transitioning   = false;
let onMenu          = false;
let hasVisitedMenu  = false;

async function transitionToMenu() {
  if (transitioning || onMenu) return;
  transitioning = true;

  // always reset to the main view when entering the menu
  showMenuView('main');

  if (hasVisitedMenu) {
    // Subsequent visits: keep the slide animation, skip the white screen + sparkle.
    // Snap the menu to full opacity instantly (it stays hidden behind #main
    // because of z-index), then slide #main up to cleanly reveal it.
    fadeOut(homeAudio, 800);

    menuScreen.classList.add('no-anim');
    menuScreen.classList.add('show');
    void menuScreen.offsetHeight;
    menuScreen.classList.remove('no-anim');

    main.classList.add('slide-up');
    menuAudio.currentTime = 0;
    menuAudio.play().catch(() => {});
    startParallax();

    // wait for the slide to complete
    await wait(1200);

    bgVideo.pause();

    onMenu = true;
    transitioning = false;
    return;
  }

  // First visit: full animation with white flash + sparkle
  fadeOut(homeAudio, 800);

  main.classList.add('slide-up');
  whiteScreen.classList.add('show');

  // 1.2s slide + ~1s hold on white
  await wait(1200 + 1000);

  sparkleAudio.currentTime = 0;
  sparkleAudio.play().catch(() => {});
  // cross-fade: white fades out and menu fades in at the same time,
  // so there's no body-black moment between them
  whiteScreen.classList.remove('show');
  menuScreen.classList.add('show');
  menuAudio.currentTime = 0;
  menuAudio.play().catch(() => {});
  startParallax();

  // wait for white to finish fading out
  await wait(1000);

  bgVideo.pause();

  hasVisitedMenu = true;
  onMenu = true;
  transitioning = false;
}

async function backToHome() {
  if (transitioning || !onMenu) return;
  transitioning = true;

  fadeOut(menuAudio, 1000);

  // resume the home video and slide #main back down (1.2s slide)
  bgVideo.play().catch(() => {});
  main.classList.remove('slide-up');

  await wait(1200);

  // hide menu (it's already covered by main, this just clears pointer events)
  menuScreen.classList.remove('show');

  homeAudio.volume = HOME_VOLUME;
  homeAudio.currentTime = 0;
  homeAudio.play().catch(() => {});

  onMenu = false;
  transitioning = false;
}

const backBtn      = document.getElementById('backBtn');
const viewBackBtn  = document.getElementById('viewBackBtn');

// menuScreen sub-views: switch via data-view attribute on #menuScreen
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

// ---------- mute toggle ----------
const muteBtn = document.getElementById('muteBtn');
if (muteBtn) {
  muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    muteBtn.classList.toggle('muted', isMuted);
    if (audioContext) {
      applyFocusState();
    } else {
      // fallback when the web audio graph couldn't be created
      for (const a of [entranceAudio, homeAudio, sparkleAudio, menuAudio]) {
        a.muted = isMuted;
      }
    }
    if (secretActive) secretVideo.muted = isMuted;
    muteBtn.blur();
  });
}

// ---------- info overlay ----------
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

if (infoBtn)      infoBtn.addEventListener('click', openInfoOverlay);
if (infoCloseBtn) infoCloseBtn.addEventListener('click', closeInfoOverlay);
if (infoOverlay)  infoOverlay.addEventListener('click', (e) => {
  if (e.target === infoOverlay) closeInfoOverlay();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && infoOverlay && infoOverlay.classList.contains('show')) {
    closeInfoOverlay();
  }
});

// discord username copy-to-clipboard
const discordBtn = document.querySelector('.discord-link');
if (discordBtn) {
  const handle  = discordBtn.querySelector('.social-handle');
  const original = handle.textContent;
  let copyTimer = null;
  discordBtn.addEventListener('click', async () => {
    const username = discordBtn.dataset.username;
    try {
      await navigator.clipboard.writeText(username);
      handle.textContent = 'copied!';
    } catch (e) {
      handle.textContent = 'copy failed';
    }
    // remove focus so the button doesn't stay highlighted in white
    discordBtn.blur();
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { handle.textContent = original; }, 1800);
  });
}

// generate the starfield for the menu screen
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

// fewer stars on small screens for performance
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
  parTargetX = (e.clientX / window.innerWidth  - 0.5) * 2; // -1..1
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

// ---------- keep marquee at a constant pixels-per-second ----------
const MARQUEE_SPEED = 90; // px/s — tweak if you want it slower/faster

function syncMarqueeSpeed() {
  const track   = document.querySelector('.marquee-track');
  const marquee = document.querySelector('.marquee');
  if (!track || !marquee) return;

  const trackWidth   = track.scrollWidth;
  const marqueeWidth = marquee.offsetWidth;
  if (!trackWidth || !marqueeWidth) return;

  // The track parks just past the marquee's right edge during the initial
  // delay, then slides in to translateX(0). 60px of buffer guarantees the
  // first character isn't already poking into the visible area.
  const slideDistance = marqueeWidth + 60;
  const slideDur      = (slideDistance / MARQUEE_SPEED).toFixed(2);

  // The infinite scroll moves -50% of the (doubled) track per cycle.
  const scrollDistance = trackWidth / 2;
  const scrollDur      = (scrollDistance / MARQUEE_SPEED).toFixed(2);

  track.style.setProperty('--slide-distance', slideDistance + 'px');
  track.style.setProperty('--slide-duration', slideDur + 's');
  track.style.setProperty('--scroll-duration', scrollDur + 's');
}

window.addEventListener('resize', syncMarqueeSpeed);

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();

  if (!landing.classList.contains('hidden') && (key === 'enter' || key === ' ')) {
    enterSite();
  }

  if (secretActive) return;

  if (key === cheatCode[cheatIndex]) {
    cheatIndex += 1;
    if (cheatIndex === cheatCode.length) {
      openSecret();
      cheatIndex = 0;
    }
  } else {
    cheatIndex = key === cheatCode[0] ? 1 : 0;
  }
});
