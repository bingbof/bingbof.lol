// ============================================================
// bingbof.lol — animated home background
//
// y2k / chrome / grunge, kept strictly monochrome so it sits under
// the orb without competing with it. Layers, bottom to top:
//
//   1. chrome haze    two drifting noise fields, upscaled to cloud
//   2. floor grid     perspective lines running toward the viewer
//   3. grain          pre-rendered noise tiles, cycled
//   4. glitch         rare horizontal slice displacement
//
// Scanlines are CSS (.bg-scan) so they stay pixel-crisp instead of
// being resampled with the canvas.
//
// CFG.intensity is the master dimmer; the per-layer alphas set the
// balance between layers. Set any alpha to 0 to drop that layer.
// ============================================================
(function () {
  const canvas = document.getElementById('bgCanvas');
  const home   = document.getElementById('home');
  if (!canvas || !canvas.getContext) return;

  const CFG = {
    fps:          30,     // the drift is slow; 60 buys nothing
    scale:        0.6,    // backing-store scale — grunge likes being soft
    intensity:    0.15,   // master dimmer for every canvas layer
    hazeContrast: 2.2,    // >1 crushes the darks, leaving bright wisps
    gridAlpha:    0.07,
    gridRows:     14,
    gridCols:     13,
    horizon:      0.60,   // fraction of height
    grainAlpha:   0.07,
    grainTiles:   4,
    glitchChance: 0.004,  // per frame
  };

  // Radial gradients were the obvious way to do the haze and the wrong one: a
  // gradient has a visible falloff edge, overlapping ones in 'lighter' make
  // bright lens shapes, and low alpha on black bands into concentric rings.
  // Noise fields have no edge to see.
  //
  // Two octaves at deliberately non-aligning resolutions — one field upscaled
  // this far still shows its own cell grid, and a second at a different size,
  // speed and direction breaks that up.
  const OCTAVES = [
    { nw: 16, nh: 9, alpha: 0.50, morphMs:  7000, drift:  0.6, sx:  0.00005, sy: 0.000040 },
    { nw:  7, nh: 4, alpha: 0.38, morphMs: 11000, drift: -0.9, sx: -0.00003, sy: 0.000045 },
  ];

  const MW = 160, MH = 90;   // intermediate step of the upscale

  const ctx = canvas.getContext('2d', { alpha: false });
  const reduced = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let w = 0, h = 0;
  let grain = [];
  let frame = 0;
  let glitchFrames = 0;
  let last = 0;

  function offscreen(cw, ch, smooth) {
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = smooth;
    if (smooth) g.imageSmoothingQuality = 'high';
    return { c: c, g: g };
  }

  const mid = offscreen(MW, MH, true);

  function randomField(n) {
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = Math.random();
    return f;
  }

  // each octave gets its own tiny canvas, pair of fields, and phase
  const octaves = OCTAVES.map(function (o) {
    const off = offscreen(o.nw, o.nh, false);
    return {
      cfg: o,
      canvas: off.c,
      ctx: off.g,
      img: off.g.createImageData(o.nw, o.nh),
      a: randomField(o.nw * o.nh),
      b: randomField(o.nw * o.nh),
      phase: 0,
      last: 0,
    };
  });

  // ---- setup ------------------------------------------------------
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * CFG.scale;
    w = Math.max(1, Math.round(window.innerWidth  * dpr));
    h = Math.max(1, Math.round(window.innerHeight * dpr));
    canvas.width  = w;
    canvas.height = h;
    ctx.imageSmoothingEnabled = true;      // reset by any size change
    ctx.imageSmoothingQuality = 'high';
    if (reduced) draw(0);
  }

  // noise is expensive per-pixel, so build a few tiles once and cycle them
  function makeGrain(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return ctx.createPattern(c, 'repeat');
  }

  // ---- layers -----------------------------------------------------
  function stepOctave(o, t) {
    const n = o.cfg.nw * o.cfg.nh;
    if (!o.last) o.last = t;
    o.phase += (t - o.last) / o.cfg.morphMs;
    o.last = t;
    while (o.phase >= 1) {
      o.phase -= 1;
      o.a = o.b;
      o.b = randomField(n);
    }
    // smoothstep, so each field arrives and leaves without a velocity jump
    const p = o.phase;
    const k = p * p * (3 - 2 * p);
    const d = o.img.data;
    for (let i = 0; i < n; i++) {
      const v = Math.pow(o.a[i] + (o.b[i] - o.a[i]) * k, CFG.hazeContrast) * 255;
      const j = i * 4;
      d[j] = d[j + 1] = d[j + 2] = v;
      d[j + 3] = 255;
    }
    o.ctx.putImageData(o.img, 0, 0);
  }

  function drawHaze(t) {
    if (!CFG.intensity) return;
    const ox = w * 0.14, oy = h * 0.14;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < octaves.length; i++) {
      const o = octaves[i];
      stepOctave(o, t);
      // upscale in two steps — going straight from 16px to full width leaves
      // bilinear diamond artefacts; the intermediate pass smooths them out
      mid.g.drawImage(o.canvas, 0, 0, MW, MH);
      ctx.globalAlpha = o.cfg.alpha * CFG.intensity;
      ctx.drawImage(
        mid.c,
        -ox + Math.sin(t * o.cfg.sx) * ox * o.cfg.drift,
        -oy + Math.cos(t * o.cfg.sy) * oy * o.cfg.drift,
        w + ox * 2, h + oy * 2
      );
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawGrid(t) {
    if (!CFG.gridAlpha) return;
    const ga = CFG.gridAlpha * CFG.intensity;
    const hz = h * CFG.horizon;
    const depth = h - hz;
    const phase = (t * 0.00018) % 1;

    ctx.lineWidth = Math.max(1, 1 * CFG.scale);
    ctx.strokeStyle = '#fff';

    // rows: y = horizon + depth/z puts them closer together toward the
    // horizon and sliding toward the viewer as the phase advances
    for (let i = 1; i <= CFG.gridRows; i++) {
      const z = i + phase;
      const y = hz + depth / z;
      if (y > h) continue;
      ctx.globalAlpha = ga * (1 - 1 / z);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // columns converging on the vanishing point
    ctx.globalAlpha = ga * 0.55;
    for (let j = -CFG.gridCols; j <= CFG.gridCols; j++) {
      ctx.beginPath();
      ctx.moveTo(w / 2 + (j / CFG.gridCols) * w * 1.6, h);
      ctx.lineTo(w / 2, hz);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawGrain() {
    if (!CFG.grainAlpha || !grain.length) return;
    const g = grain[(frame / 2 | 0) % grain.length];
    ctx.globalAlpha = CFG.grainAlpha * CFG.intensity;
    ctx.globalCompositeOperation = 'lighter';
    ctx.save();
    // nudge the pattern each frame so the grain crawls
    ctx.translate((Math.random() * 64) | 0, (Math.random() * 64) | 0);
    ctx.fillStyle = g;
    ctx.fillRect(-64, -64, w + 128, h + 128);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawGlitch() {
    const slices = 3 + ((Math.random() * 4) | 0);
    for (let i = 0; i < slices; i++) {
      const sy = (Math.random() * h) | 0;
      const sh = 4 + ((Math.random() * (h * 0.045)) | 0);
      const dx = ((Math.random() - 0.5) * w * 0.07) | 0;
      ctx.drawImage(canvas, 0, sy, w, sh, dx, sy, w, sh);
    }
  }

  // ---- loop -------------------------------------------------------
  function draw(t) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    drawHaze(t);
    drawGrid(t);
    drawGrain();
    if (glitchFrames > 0) { drawGlitch(); glitchFrames--; }
  }

  function loop(t) {
    requestAnimationFrame(loop);

    // nothing to show: landing screen, backgrounded tab, or reduced motion
    if (reduced || document.hidden) return;
    if (home && home.classList.contains('hidden')) return;

    const step = 1000 / CFG.fps;
    if (t - last < step) return;
    last = t;
    frame++;

    if (glitchFrames === 0 && Math.random() < CFG.glitchChance) {
      glitchFrames = 2 + ((Math.random() * 3) | 0);
    }
    draw(t);
  }

  for (let i = 0; i < CFG.grainTiles; i++) grain.push(makeGrain(128));
  window.addEventListener('resize', resize);
  resize();
  if (reduced) draw(0); else requestAnimationFrame(loop);
})();
