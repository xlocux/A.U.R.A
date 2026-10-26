(function () {
  'use strict';

  const canvas = document.getElementById('backgroundScope');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // ── offscreen canvas for crossfade ──────────────────────────────────────
  const off = document.createElement('canvas');
  const offCtx = off.getContext('2d');

  let phase = 0;
  let palette = readPalette();

  // A.U.R.A integration: the Appearance > Background effect select drives this engine.
  // "random" rotates through every effect with a crossfade; any other value pins one effect.
  const SETTINGS_KEY = 'aura.uiSettings';
  let selectedEffect = readSelectedEffect();
  function readSelectedEffect() {
    try { return (JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').backgroundEffect) || 'random'; }
    catch { return 'random'; }
  }

  // crossfade state
  const EFFECT_DURATION = 60000; // ms before switching
  const FADE_DURATION   = 2000;  // ms crossfade
  let currentEffect, nextEffect;
  let fadeAlpha   = 1;   // 0→1 during fade-in of next
  let isFading    = false;
  let lastSwitch  = performance.now();

  // ── colour helpers ───────────────────────────────────────────────────────
  function parseColor(value, fallback) {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      let d = hex[1];
      if (d.length === 3) d = d.split('').map(c => c + c).join('');
      return [parseInt(d.slice(0,2),16), parseInt(d.slice(2,4),16), parseInt(d.slice(4,6),16)];
    }
    const rgb = raw.match(/^rgba?\(([^)]+)\)/i);
    if (rgb) {
      const p = rgb[1].split(',').map(x => parseFloat(x.trim()));
      if (p.length >= 3 && p.slice(0,3).every(Number.isFinite)) return p.slice(0,3);
    }
    return fallback;
  }

  function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

  function readPalette() {
    const s  = window.getComputedStyle(document.documentElement);
    const bs = window.getComputedStyle(document.body);
    return {
      accent:  parseColor(s.getPropertyValue('--accent'),   [105,232,255]),
      accent2: parseColor(s.getPropertyValue('--accent-2'), [255,209,102]),
      bg:      parseColor(s.getPropertyValue('--bg') || bs.backgroundColor, [3,6,8])
    };
  }

  // ── resize ───────────────────────────────────────────────────────────────
  function resize() {
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(window.innerWidth  * scale);
    const h = Math.floor(window.innerHeight * scale);
    canvas.width  = off.width  = w;
    canvas.height = off.height = h;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    offCtx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  // ════════════════════════════════════════════════════════════════════════
  // EFFECT 1 — waves (original)
  // ════════════════════════════════════════════════════════════════════════
  function drawWaves(c, p) {
    const w = window.innerWidth, h = window.innerHeight;
    c.clearRect(0, 0, w, h);
    c.fillStyle = rgba(p.bg, 0.3);
    c.fillRect(0, 0, w, h);

    for (let y = 0; y < h; y += 18) {
      const intensity = 0.006 + ((Math.sin((y + phase) * 0.025) + 1) * 0.007);
      c.fillStyle = rgba(p.accent, intensity);
      c.fillRect(0, y, w, 1);
    }

    for (let band = 0; band < 5; band++) {
      const baseY = h * (0.18 + band * 0.15);
      c.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = baseY
          + Math.sin((x + phase * (1.4 + band * 0.2)) * (0.012 + band * 0.002)) * (18 + band * 5)
          + Math.sin((x - phase) * 0.031) * 8;
        x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      // Kept faint on purpose: strong wave lines compete with the Flow links and tiles.
      c.strokeStyle = band % 2 ? rgba(p.accent2, 0.055) : rgba(p.accent, 0.065);
      c.lineWidth = 1;
      c.stroke();
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // EFFECT 2 — Water Ripples (Sasso nell'acqua)
  // ════════════════════════════════════════════════════════════════════════
  let ripples = [];

  function drawRipples(c, p) {
    const w = window.innerWidth, h = window.innerHeight;
    c.clearRect(0, 0, w, h);
    c.fillStyle = rgba(p.bg, 0.2);
    c.fillRect(0, 0, w, h);

    if (Math.random() > 0.97) {
      ripples.push({ x: Math.random() * w, y: Math.random() * h, r: 0, a: 0.3 });
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.r += 1.5;
      r.a -= 0.004;

      if (r.a <= 0) {
        ripples.splice(i, 1);
        continue;
      }

      c.beginPath();
      c.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      c.strokeStyle = rgba(p.accent, r.a);
      c.lineWidth = 2;
      c.stroke();

      c.beginPath();
      c.arc(r.x, r.y, r.r * 0.6, 0, Math.PI * 2);
      c.strokeStyle = rgba(p.accent2, r.a * 0.5);
      c.stroke();
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // EFFECT 3 — Cyber Console (Full screen scrolling logs)
  // ════════════════════════════════════════════════════════════════════════
  let logBlocks = [];
  function drawCompilation(c, p) {
    const w = window.innerWidth, h = window.innerHeight;
    c.fillStyle = rgba(p.bg, 0.35);
    c.fillRect(0, 0, w, h);

    if (Math.random() > 0.8) {
      logBlocks.push({
        x: Math.floor(Math.random() * (w / 10)) * 10,
        y: h + 10,
        w: 20 + Math.random() * 120,
        s: 1.5 + Math.random() * 3,
        a: 0.1 + Math.random() * 0.25,
        c: Math.random() > 0.9 ? p.accent2 : p.accent
      });
    }

    for (let i = logBlocks.length - 1; i >= 0; i--) {
      const b = logBlocks[i];
      b.y -= b.s;
      if (b.y < -20) { logBlocks.splice(i, 1); continue; }

      c.fillStyle = rgba(b.c, b.a);
      c.fillRect(b.x, b.y, b.w, 2);
      
      if (Math.random() > 0.95) {
        c.fillStyle = rgba(p.accent, b.a * 0.5);
        c.fillRect(b.x + b.w + 5, b.y, 10, 2);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // EFFECT 6 — Neural Pulse (Digital Bio-Net)
  // ════════════════════════════════════════════════════════════════════════
  let neuralPoints = [];
  function drawNeuralPulse(c, p) {
    const w = window.innerWidth, h = window.innerHeight;
    c.clearRect(0, 0, w, h);
    c.fillStyle = rgba(p.bg, 0.4);
    c.fillRect(0, 0, w, h);

    if (neuralPoints.length === 0) {
      for(let i=0; i<30; i++) neuralPoints.push({x: Math.random()*w, y: Math.random()*h, r: Math.random()*Math.PI*2});
    }

    neuralPoints.forEach(pt => {
      pt.r += 0.02;
      const size = 1.5 + Math.sin(pt.r) * 0.5;
      const pulse = (Math.sin(pt.r) + 1) * 0.5;
      
      c.beginPath();
      c.arc(pt.x, pt.y, size + pulse * 10, 0, Math.PI * 2);
      c.strokeStyle = rgba(p.accent, 0.1 * pulse);
      c.stroke();
      
      c.fillStyle = rgba(p.accent2, 0.2 + 0.3 * pulse);
      c.fillRect(pt.x-1, pt.y-1, 2, 2);
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // EFFECT 7 — Binary Flow (Light Matrix alternative)
  // ════════════════════════════════════════════════════════════════════════
  let binaryColumns = [];
  function drawBinaryFlow(c, p) {
    const w = window.innerWidth, h = window.innerHeight;
    c.fillStyle = rgba(p.bg, 0.3);
    c.fillRect(0, 0, w, h);

    if (binaryColumns.length < 25 && Math.random() > 0.9) {
      binaryColumns.push({
        x: Math.random() * w,
        y: -100,
        s: 1 + Math.random() * 2,
        chars: Array.from({length: 6}, () => (Math.random() > 0.5 ? "1" : "0"))
      });
    }

    c.font = '10px monospace';
    for (let i = binaryColumns.length - 1; i >= 0; i--) {
      const s = binaryColumns[i];
      s.y += s.s;
      if (s.y > h + 100) { binaryColumns.splice(i, 1); continue; }

      s.chars.forEach((char, j) => {
        const alpha = Math.max(0, 0.25 - (j * 0.03));
        c.fillStyle = rgba(p.accent, alpha);
        c.fillText(char, s.x, s.y - (j * 15));
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // EFFECT 8 — Digital Grid Field (Subtle pulsing dots)
  // ════════════════════════════════════════════════════════════════════════
  function drawCyberGrid(c, p) {
    const w = window.innerWidth, h = window.innerHeight;
    c.clearRect(0, 0, w, h);
    c.fillStyle = rgba(p.bg, 0.4);
    c.fillRect(0, 0, w, h);

    const step = 45;
    for (let x = step / 2; x < w; x += step) {
      for (let y = step / 2; y < h; y += step) {
        const dist = Math.sqrt((x - w / 2) ** 2 + (y - h / 2) ** 2);
        const pulse = Math.sin(dist * 0.005 - phase * 0.04);
        const alpha = 0.02 + (pulse + 1) * 0.04;
        
        c.fillStyle = rgba(p.accent, alpha);
        c.fillRect(x, y, 1.5, 1.5);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // EFFECT 9 — Tech Flow Lines (Minimal data drift)
  // ════════════════════════════════════════════════════════════════════════
  let techLines = [];
  function drawTechFlow(c, p) {
    const w = window.innerWidth, h = window.innerHeight;
    c.fillStyle = rgba(p.bg, 0.3);
    c.fillRect(0, 0, w, h);

    if (techLines.length < 12 && Math.random() > 0.9) {
      techLines.push({
        x: -200,
        y: Math.random() * h,
        speed: 0.5 + Math.random() * 1.5,
        width: 50 + Math.random() * 150,
        opacity: 0.05 + Math.random() * 0.1
      });
    }

    for (let i = techLines.length - 1; i >= 0; i--) {
      const l = techLines[i];
      l.x += l.speed;
      if (l.x > w) { techLines.splice(i, 1); continue; }

      c.fillStyle = rgba(p.accent, l.opacity);
      c.fillRect(l.x, l.y, l.width, 1);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // EFFECT 4 — floating particles / constellation
  // ════════════════════════════════════════════════════════════════════════
  const PARTICLE_COUNT = 80;
  const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random(), y: Math.random(),
    vx: (Math.random() - 0.5) * 0.0003,
    vy: (Math.random() - 0.5) * 0.0003,
    r: 1 + Math.random() * 1.5
  }));

  function drawParticles(c, p) {
    const w = window.innerWidth, h = window.innerHeight;
    c.clearRect(0, 0, w, h);
    c.fillStyle = rgba(p.bg, 0.25);
    c.fillRect(0, 0, w, h);

    const LINK_DIST = 0.18;
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      a.x = (a.x + a.vx + 1) % 1;
      a.y = (a.y + a.vy + 1) % 1;
      const ax = a.x * w, ay = a.y * h;

      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < LINK_DIST) {
          const alpha = (1 - dist / LINK_DIST) * 0.22;
          c.beginPath();
          c.moveTo(ax, ay);
          c.lineTo(b.x * w, b.y * h);
          c.strokeStyle = rgba(p.accent, alpha);
          c.lineWidth = 0.8;
          c.stroke();
        }
      }

      c.beginPath();
      c.arc(ax, ay, a.r, 0, Math.PI * 2);
      c.fillStyle = rgba(p.accent2, 0.7);
      c.fill();
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // EFFECT 10 — Aurora Veil (soft luminous ribbons)
  // ════════════════════════════════════════════════════════════════════════
  function drawAuroraVeil(c, p) {
    const w = window.innerWidth, h = window.innerHeight;
    c.clearRect(0, 0, w, h);
    c.fillStyle = rgba(p.bg, 0.42);
    c.fillRect(0, 0, w, h);

    c.save();
    c.globalCompositeOperation = 'lighter';

    for (let band = 0; band < 3; band++) {
      const yBase = h * (0.18 + band * 0.22);
      const color = band % 2 ? p.accent2 : p.accent;
      const grad = c.createLinearGradient(0, yBase - 80, 0, yBase + 100);
      grad.addColorStop(0, rgba(color, 0));
      grad.addColorStop(0.5, rgba(color, 0.075));
      grad.addColorStop(1, rgba(color, 0));

      c.beginPath();
      for (let x = 0; x <= w; x += 14) {
        const y = yBase
          + Math.sin(x * 0.006 + phase * 0.012 + band) * (30 + band * 8)
          + Math.sin(x * 0.014 - phase * 0.008) * 12;
        x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }

      for (let x = w; x >= 0; x -= 14) {
        const y = yBase + 85
          + Math.sin(x * 0.006 + phase * 0.012 + band) * (22 + band * 7)
          + Math.sin(x * 0.012 - phase * 0.007) * 10;
        c.lineTo(x, y);
      }

      c.closePath();
      c.fillStyle = grad;
      c.fill();
    }

    c.restore();
  }

  // ════════════════════════════════════════════════════════════════════════
  // EFFECT 11 — Dust Drift (ambient floating specks)
  // ════════════════════════════════════════════════════════════════════════
  const DUST_COUNT = 90;
  const dust = Array.from({ length: DUST_COUNT }, () => ({
    x: Math.random(),
    y: Math.random(),
    vx: (Math.random() - 0.5) * 0.00012,
    vy: -0.00004 - Math.random() * 0.0001,
    r: 0.4 + Math.random() * 1.2,
    a: 0.04 + Math.random() * 0.14,
    tw: Math.random() * Math.PI * 2
  }));

  function drawDustDrift(c, p) {
    const w = window.innerWidth, h = window.innerHeight;
    c.clearRect(0, 0, w, h);
    c.fillStyle = rgba(p.bg, 0.36);
    c.fillRect(0, 0, w, h);

    for (const d of dust) {
      d.x = (d.x + d.vx + 1) % 1;
      d.y = (d.y + d.vy + 1) % 1;
      d.tw += 0.018;

      const alpha = d.a * (0.55 + Math.sin(d.tw) * 0.45);
      c.beginPath();
      c.arc(d.x * w, d.y * h, d.r, 0, Math.PI * 2);
      c.fillStyle = rgba(Math.random() > 0.88 ? p.accent2 : p.accent, alpha);
      c.fill();
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // EFFECT 12 — Gradient Mesh (slow breathing color fields)
  // ════════════════════════════════════════════════════════════════════════
  const MESH_BLOBS = Array.from({ length: 5 }, (_, i) => ({
    x: 0.15 + Math.random() * 0.7,
    y: 0.15 + Math.random() * 0.7,
    r: 0.22 + Math.random() * 0.22,
    angle: Math.random() * Math.PI * 2,
    speed: 0.00035 + Math.random() * 0.00035,
    which: i % 2
  }));

  function drawGradientMesh(c, p) {
    const w = window.innerWidth, h = window.innerHeight;
    c.clearRect(0, 0, w, h);
    c.fillStyle = rgba(p.bg, 0.58);
    c.fillRect(0, 0, w, h);

    c.save();
    c.globalCompositeOperation = 'lighter';

    for (const b of MESH_BLOBS) {
      b.angle += b.speed;
      const cx = (b.x + Math.cos(b.angle) * 0.08) * w;
      const cy = (b.y + Math.sin(b.angle * 1.4) * 0.07) * h;
      const radius = Math.max(w, h) * b.r;
      const color = b.which ? p.accent2 : p.accent;

      const grad = c.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, rgba(color, 0.105));
      grad.addColorStop(0.42, rgba(color, 0.045));
      grad.addColorStop(1, rgba(color, 0));

      c.fillStyle = grad;
      c.beginPath();
      c.arc(cx, cy, radius, 0, Math.PI * 2);
      c.fill();
    }

    c.restore();
  }

  // ════════════════════════════════════════════════════════════════════════
  // EFFECT 13 — Orbit Arcs (minimal slow geometry)
  // ════════════════════════════════════════════════════════════════════════
  function drawOrbitArcs(c, p) {
    const w = window.innerWidth, h = window.innerHeight;
    c.clearRect(0, 0, w, h);
    c.fillStyle = rgba(p.bg, 0.45);
    c.fillRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.52;
    const maxR = Math.min(w, h) * 0.42;

    for (let i = 0; i < 6; i++) {
      const radius = maxR * (0.35 + i * 0.105);
      const start = phase * 0.004 * (i % 2 ? -1 : 1) + i * 0.65;
      const span = Math.PI * (0.22 + i * 0.025);

      c.beginPath();
      c.arc(cx, cy, radius, start, start + span);
      c.strokeStyle = rgba(i % 2 ? p.accent2 : p.accent, 0.055 + i * 0.012);
      c.lineWidth = 0.8 + i * 0.1;
      c.stroke();
    }

    c.beginPath();
    c.arc(cx, cy, 1.5, 0, Math.PI * 2);
    c.fillStyle = rgba(p.accent, 0.18);
    c.fill();
  }

  // ════════════════════════════════════════════════════════════════════════
  // EFFECT 14 — Soft Horizon (calm glowing horizon)
  // ════════════════════════════════════════════════════════════════════════
  function drawSoftHorizon(c, p) {
    const w = window.innerWidth, h = window.innerHeight;
    c.clearRect(0, 0, w, h);
    c.fillStyle = rgba(p.bg, 0.5);
    c.fillRect(0, 0, w, h);

    const y = h * (0.62 + Math.sin(phase * 0.006) * 0.025);
    const glow = c.createLinearGradient(0, y - h * 0.25, 0, y + h * 0.25);
    glow.addColorStop(0, rgba(p.accent, 0));
    glow.addColorStop(0.48, rgba(p.accent, 0.09));
    glow.addColorStop(0.56, rgba(p.accent2, 0.045));
    glow.addColorStop(1, rgba(p.accent, 0));

    c.fillStyle = glow;
    c.fillRect(0, y - h * 0.25, w, h * 0.5);

    c.beginPath();
    for (let x = 0; x <= w; x += 12) {
      const yy = y
        + Math.sin(x * 0.008 + phase * 0.01) * 7
        + Math.sin(x * 0.021 - phase * 0.006) * 3;
      x === 0 ? c.moveTo(x, yy) : c.lineTo(x, yy);
    }
    c.strokeStyle = rgba(p.accent, 0.11);
    c.lineWidth = 1;
    c.stroke();
  }



  // ════════════════════════════════════════════════════════════════════════
  // EFFECT 15 — Temporal Lightning
  // Lampi/saette rare, brevissime e poco invasive.
  // ════════════════════════════════════════════════════════════════════════
  let lightning = null;
  let nextLightningAt = 180 + Math.random() * 420;

  function makeLightningPath(w, h) {
    const points = [];
    let x = w * (0.18 + Math.random() * 0.64);
    let y = -20;
    const targetY = h * (0.34 + Math.random() * 0.32);

    points.push({ x, y });

    while (y < targetY) {
      y += 18 + Math.random() * 34;
      x += (Math.random() - 0.5) * 42;
      points.push({ x, y });
    }

    return points;
  }

  function drawTemporalLightning(c, p) {
    const w = window.innerWidth;
    const h = window.innerHeight;

    c.clearRect(0, 0, w, h);
    c.fillStyle = rgba(p.bg, 0.48);
    c.fillRect(0, 0, w, h);

    // Base temporale: anelli sottili che suggeriscono una distorsione del tempo.
    const cx = w * 0.5;
    const cy = h * 0.52;
    const maxR = Math.min(w, h) * 0.48;

    for (let i = 0; i < 5; i++) {
      const radius = maxR * (0.25 + i * 0.13) + Math.sin(phase * 0.01 + i) * 4;
      c.beginPath();
      c.ellipse(cx, cy, radius * 1.38, radius * 0.46, Math.sin(phase * 0.004) * 0.08, 0, Math.PI * 2);
      c.strokeStyle = rgba(i % 2 ? p.accent2 : p.accent, 0.025 + i * 0.006);
      c.lineWidth = 0.75;
      c.stroke();
    }

    nextLightningAt -= 1;

    if (!lightning && nextLightningAt <= 0) {
      lightning = {
        life: 0,
        maxLife: 9 + Math.floor(Math.random() * 8),
        path: makeLightningPath(w, h),
        flash: 0.04 + Math.random() * 0.045
      };
      nextLightningAt = 240 + Math.random() * 520;
    }

    if (!lightning) return;

    lightning.life += 1;
    const t = lightning.life / lightning.maxLife;
    const alpha = Math.max(0, 1 - t) ** 1.35;

    // Flash ambientale molto contenuto, per evitare un effetto fastidioso.
    c.fillStyle = rgba(p.accent, lightning.flash * alpha);
    c.fillRect(0, 0, w, h);

    c.save();
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    c.lineJoin = 'round';

    for (let pass = 0; pass < 2; pass++) {
      c.beginPath();
      lightning.path.forEach((pt, idx) => {
        const jitter = pass === 0 ? 0 : 2.5;
        const x = pt.x + (Math.random() - 0.5) * jitter;
        const y = pt.y + (Math.random() - 0.5) * jitter;
        idx === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      });

      c.strokeStyle = pass === 0 ? rgba(p.accent, 0.22 * alpha) : rgba(p.accent2, 0.11 * alpha);
      c.lineWidth = pass === 0 ? 1.4 : 0.8;
      c.stroke();
    }

    // Piccole ramificazioni, leggere e rare.
    for (let i = 2; i < lightning.path.length - 2; i += 2) {
      if (Math.random() > 0.55) continue;
      const pt = lightning.path[i];
      const dir = Math.random() > 0.5 ? 1 : -1;
      c.beginPath();
      c.moveTo(pt.x, pt.y);
      c.lineTo(pt.x + dir * (24 + Math.random() * 40), pt.y + 16 + Math.random() * 26);
      c.strokeStyle = rgba(p.accent, 0.07 * alpha);
      c.lineWidth = 0.7;
      c.stroke();
    }

    c.restore();

    if (lightning.life >= lightning.maxLife) {
      lightning = null;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // EFFECT 16 — Prime Glow
  // Numeri primi generati a caso che si illuminano in modo soft.
  // ════════════════════════════════════════════════════════════════════════
  const PRIME_VALUES = [
    2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47,
    53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107,
    109, 113, 127, 131, 137, 139, 149, 151, 157, 163, 167,
    173, 179, 181, 191, 193, 197, 199, 211, 223, 227, 229
  ];

  const PRIME_COUNT = 42;
  const primeNodes = Array.from({ length: PRIME_COUNT }, () => ({
    x: Math.random(),
    y: Math.random(),
    value: PRIME_VALUES[Math.floor(Math.random() * PRIME_VALUES.length)],
    pulse: Math.random() * Math.PI * 2,
    speed: 0.006 + Math.random() * 0.018,
    glow: Math.random() * 0.3,
    nextSwap: 80 + Math.random() * 260
  }));

  function drawPrimeGlow(c, p) {
    const w = window.innerWidth;
    const h = window.innerHeight;

    c.clearRect(0, 0, w, h);
    c.fillStyle = rgba(p.bg, 0.46);
    c.fillRect(0, 0, w, h);

    c.font = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';

    for (const n of primeNodes) {
      n.pulse += n.speed;
      n.nextSwap -= 1;
      n.glow *= 0.965;

      if (n.nextSwap <= 0) {
        n.value = PRIME_VALUES[Math.floor(Math.random() * PRIME_VALUES.length)];
        n.glow = 1;
        n.nextSwap = 90 + Math.random() * 330;
      }

      const driftX = Math.sin(phase * 0.003 + n.pulse) * 6;
      const driftY = Math.cos(phase * 0.002 + n.pulse * 1.3) * 5;
      const x = n.x * w + driftX;
      const y = n.y * h + driftY;
      const pulse = (Math.sin(n.pulse) + 1) * 0.5;
      const alpha = 0.035 + pulse * 0.035 + n.glow * 0.22;
      const color = n.glow > 0.25 ? p.accent2 : p.accent;

      if (n.glow > 0.08) {
        const grad = c.createRadialGradient(x, y, 0, x, y, 28 + n.glow * 26);
        grad.addColorStop(0, rgba(color, 0.08 * n.glow));
        grad.addColorStop(1, rgba(color, 0));
        c.fillStyle = grad;
        c.beginPath();
        c.arc(x, y, 34 + n.glow * 18, 0, Math.PI * 2);
        c.fill();
      }

      c.fillStyle = rgba(color, alpha);
      c.fillText(String(n.value), x, y);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // effect registry & random picker
  // ════════════════════════════════════════════════════════════════════════
  // Named registry so the Appearance select can pin a specific effect (keys match the <option> values).
  const EFFECT_MAP = {
    waves:     drawWaves,
    particles: drawParticles,
    neural:    drawNeuralPulse,
    grid:      drawCyberGrid,
    flow:      drawTechFlow,
    aurora:    drawAuroraVeil,
    dust:      drawDustDrift,
    mesh:      drawGradientMesh,
    orbit:     drawOrbitArcs,
    horizon:   drawSoftHorizon,
    lightning: drawTemporalLightning,
    primes:    drawPrimeGlow
  };
  const EFFECTS = Object.values(EFFECT_MAP);

  function pickOther(current) {
    let idx;
    do { idx = Math.floor(Math.random() * EFFECTS.length); } while (EFFECTS[idx] === current);
    return EFFECTS[idx];
  }
  function pickStart() {
    if (selectedEffect !== 'random' && EFFECT_MAP[selectedEffect]) return EFFECT_MAP[selectedEffect];
    return EFFECTS[Math.floor(Math.random() * EFFECTS.length)];
  }

  // ════════════════════════════════════════════════════════════════════════
  // main loop
  // ════════════════════════════════════════════════════════════════════════
  function loop(now) {
    palette = readPalette();
    phase  += 0.7;

    const elapsed = now - lastSwitch;

    // Only rotate when the user asked for "random"; a pinned effect stays put.
    if (selectedEffect === 'random' && !isFading && elapsed >= EFFECT_DURATION) {
      isFading   = true;
      fadeAlpha  = 0;
      nextEffect = pickOther(currentEffect);
    }

    if (isFading) {
      fadeAlpha = Math.min(1, fadeAlpha + (16 / FADE_DURATION));

      // draw current into main canvas
      currentEffect(ctx, palette);

      // draw next into offscreen, then composite on top
      nextEffect(offCtx, palette);
      ctx.save();
      ctx.globalAlpha = fadeAlpha;
      ctx.drawImage(off, 0, 0, window.innerWidth, window.innerHeight);
      ctx.restore();

      if (fadeAlpha >= 1) {
        currentEffect = nextEffect;
        isFading      = false;
        lastSwitch    = now;
      }
    } else {
      currentEffect(ctx, palette);
    }

    window.requestAnimationFrame(loop);
  }

  // ── boot ─────────────────────────────────────────────────────────────────
  resize();
  window.addEventListener('resize', resize);
  // The Appearance select dispatches this event; re-pin or resume rotation live.
  window.addEventListener('aura:background-effect', (event) => {
    selectedEffect = (event.detail && event.detail.effect) || 'random';
    isFading = false;
    currentEffect = pickStart();
    lastSwitch = performance.now();
  });
  window.addEventListener('aura:appearance-change', resize);

  currentEffect = pickStart();
  window.requestAnimationFrame(loop);
})();
