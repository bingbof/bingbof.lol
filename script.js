const landing = document.getElementById('landing');
const main = document.getElementById('main');
const enterBtn = document.getElementById('enterBtn');
const bgAudio = document.getElementById('bgAudio');
const bgVideo = document.getElementById('bgVideo');
const secretVideo = document.getElementById('secretVideo');

const cheatCode = [
  'arrowup', 'arrowup',
  'arrowdown', 'arrowdown',
  'arrowleft', 'arrowright', 'arrowleft', 'arrowright',
  'b', 'a', 's', 't', 'a', 'r', 't'
];
let cheatIndex = 0;
let secretActive = false;

function ensureBackgroundVideoSettings() {
  bgVideo.muted = true;
  bgVideo.loop = true;
}

function enterSite() {
  landing.classList.add('fade-out');
  ensureBackgroundVideoSettings();

  bgAudio.play().catch((error) => {
    console.warn('Audio playback blocked:', error);
  });

  setTimeout(() => {
    landing.classList.add('hidden');
    main.classList.remove('hidden');
    main.classList.add('visible');
  }, 800);
}

function openSecretVideoFullscreen() {
  if (secretActive) return;
  secretActive = true;

  bgAudio.pause();
  bgVideo.pause();

  secretVideo.classList.remove('hidden');
  secretVideo.muted = false;
  secretVideo.loop = false;
  secretVideo.play().catch((error) => {
    console.warn('Secret video playback blocked:', error);
  });

  const fullscreenTarget = document.documentElement;
  const requestFullscreen = fullscreenTarget.requestFullscreen || fullscreenTarget.webkitRequestFullscreen || fullscreenTarget.msRequestFullscreen;
  if (requestFullscreen) {
    requestFullscreen.call(fullscreenTarget).catch((error) => {
      console.warn('Fullscreen request blocked:', error);
    });
  }
}

enterBtn.addEventListener('click', enterSite);

window.addEventListener('keydown', (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();

  if (key === 'enter' || key === ' ') {
    enterSite();
  }

  if (secretActive) {
    return;
  }

  if (key === cheatCode[cheatIndex]) {
    cheatIndex += 1;
    if (cheatIndex === cheatCode.length) {
      openSecretVideoFullscreen();
      cheatIndex = 0;
    }
  } else {
    cheatIndex = key === cheatCode[0] ? 1 : 0;
  }
});
