// ============================================================
// bingbof.lol — UI hover sound
//
// Loaded by index.html and 404.html. Not the chat: browsers block
// sound until the first click in a page, and with a remembered login
// the chat's selection screen is reachable with no click at all.
//
// Delegated from the document so one listener covers every control.
// ============================================================
(function () {
  const SELECTOR = '.btn, .orb-btn, .icon-btn';
  const POOL_SIZE = 4;        // so rapid hovers overlap instead of cutting each other off
  const SRC = '/audio/hover.opus';

  let volume = 0.35;          // overridden on the home page by the volume slider
  let pool = [];
  let next = 0;
  let hovered = null;

  for (let i = 0; i < POOL_SIZE; i++) {
    const a = new Audio();
    a.preload = 'auto';
    a.volume = volume;
    pool.push(a);
  }

  // fetch the file once and share it, rather than every pool element
  // requesting the same file on its own. if that fails, each element loads
  // it directly as before.
  function useSrc(url) {
    pool.forEach(function (a) { a.src = url; });
  }
  if (window.fetch && window.URL && URL.createObjectURL) {
    fetch(SRC)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then(function (blob) { useSrc(URL.createObjectURL(blob)); })
      .catch(function () { useSrc(SRC); });
  } else {
    useSrc(SRC);
  }

  function play() {
    if (!volume) return;
    const a = pool[next];
    next = (next + 1) % POOL_SIZE;
    try {
      a.currentTime = 0;
      a.volume = volume;
      const p = a.play();
      // hovering before the first click is blocked by autoplay policy —
      // that is fine, it starts working once the user has interacted
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* ignore */ }
  }

  document.addEventListener('pointerover', function (event) {
    const el = event.target.closest && event.target.closest(SELECTOR);
    // pointerover bubbles, so moving across a control's own children would
    // otherwise retrigger on every child
    if (!el || el === hovered) return;
    hovered = el;
    if (el.disabled) return;   // the orb before its reveal
    play();
  });

  document.addEventListener('pointerout', function (event) {
    const el = event.target.closest && event.target.closest(SELECTOR);
    if (el && el === hovered && !el.contains(event.relatedTarget)) hovered = null;
  });

  window.uiSound = {
    setVolume: function (v) {
      v = Number(v);
      volume = isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
    }
  };
})();
