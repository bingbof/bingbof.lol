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

// start entrance audio on load (browser may block until user gesture)
function playEntranceAudio() {
  entranceAudio.play().catch(() => {});
}
playEntranceAudio();
// fallback: kick it off on the first interaction if autoplay was blocked
window.addEventListener('pointerdown', playEntranceAudio, { once: true });
window.addEventListener('keydown',     playEntranceAudio, { once: true });

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
  secretVideo.muted = false;
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

let transitioning = false;
let onMenu = false;

async function transitionToMenu() {
  if (transitioning || onMenu) return;
  transitioning = true;

  fadeOut(homeAudio, 800);

  main.classList.add('slide-up');
  whiteScreen.classList.add('show');

  // 1.2s slide + ~2s hold on white
  await wait(1200 + 2000);

  sparkleAudio.currentTime = 0;
  sparkleAudio.play().catch(() => {});
  whiteScreen.classList.remove('show');

  // wait for white to fade out
  await wait(1000);

  bgVideo.pause();

  menuScreen.classList.add('show');
  menuAudio.currentTime = 0;
  menuAudio.play().catch(() => {});

  onMenu = true;
  transitioning = false;
}

enterBtn.addEventListener('click', enterSite);
clickMeBtn.addEventListener('click', transitionToMenu);

document.querySelectorAll('.menu-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    if (target) window.location.href = target + '/';
  });
});

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
