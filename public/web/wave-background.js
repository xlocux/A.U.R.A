(function () {
  "use strict";

  const canvas = document.getElementById("backgroundScope");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const SETTINGS_KEY = "aura.uiSettings";
  const ROTATE_MS = 60000;
  const FADE_MS = 1600;
  const offscreen = document.createElement("canvas");
  const off = offscreen.getContext("2d");

  let phase = 0;
  let currentEffect = null;
  let nextEffect = null;
  let fading = false;
  let fadeAlpha = 0;
  let lastSwitch = performance.now();
  let selectedEffect = readSelectedEffect();

  const PRIME_VALUES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113];
  const particles = makeParticles(72, 0.00028);
  const neural = makeParticles(34, 0.00008).map((point) => ({ ...point, pulse: Math.random() * Math.PI * 2 }));
  const primes = makePrimes();
  const mesh = Array.from({ length: 5 }, (_, index) => ({
    x: 0.15 + Math.random() * 0.7,
    y: 0.15 + Math.random() * 0.7,
    radius: 0.22 + Math.random() * 0.18,
    angle: Math.random() * Math.PI * 2,
    speed: 0.00035 + Math.random() * 0.00035,
    color: index % 2
  }));
  const flowLines = [];

  function parseColor(value, fallback) {
    const raw = String(value || "").trim();
    const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      let digits = hex[1];
      if (digits.length === 3) digits = digits.split("").map((char) => char + char).join("");
      return [parseInt(digits.slice(0, 2), 16), parseInt(digits.slice(2, 4), 16), parseInt(digits.slice(4, 6), 16)];
    }
    const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
    if (rgb) {
      const parts = rgb[1].split(",").map((part) => Number.parseFloat(part.trim()));
      if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) return parts.slice(0, 3);
    }
    return fallback;
  }

  function rgba(color, alpha) {
    return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
  }

  function palette() {
    const style = window.getComputedStyle(document.documentElement);
    const bodyStyle = window.getComputedStyle(document.body);
    return {
      accent: parseColor(style.getPropertyValue("--accent"), [67, 197, 158]),
      accent2: parseColor(style.getPropertyValue("--accent-2"), [143, 220, 195]),
      bg: parseColor(style.getPropertyValue("--bg") || bodyStyle.backgroundColor, [16, 17, 20])
    };
  }

  function readSelectedEffect() {
    try {
      const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      return settings.backgroundEffect || "random";
    } catch {
      return "random";
    }
  }

  function resize() {
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.floor(window.innerWidth * scale);
    const height = Math.floor(window.innerHeight * scale);
    canvas.width = offscreen.width = width;
    canvas.height = offscreen.height = height;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    off.setTransform(scale, 0, 0, scale, 0, 0);
  }

  function fillBase(c, colors, alpha = 0.34) {
    c.clearRect(0, 0, window.innerWidth, window.innerHeight);
    c.fillStyle = rgba(colors.bg, alpha);
    c.fillRect(0, 0, window.innerWidth, window.innerHeight);
  }

  function drawWaves(c, colors) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    fillBase(c, colors, 0.28);
    for (let y = 0; y < height; y += 18) {
      c.fillStyle = rgba(colors.accent, 0.012 + ((Math.sin((y + phase) * 0.025) + 1) * 0.014));
      c.fillRect(0, y, width, 1);
    }
    for (let band = 0; band < 5; band += 1) {
      const baseY = height * (0.16 + band * 0.16);
      c.beginPath();
      for (let x = 0; x <= width; x += 8) {
        const y = baseY
          + Math.sin((x + phase * (1.4 + band * 0.2)) * (0.012 + band * 0.002)) * (14 + band * 4)
          + Math.sin((x - phase) * 0.031) * 6;
        x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.strokeStyle = band % 2 ? rgba(colors.accent2, 0.13) : rgba(colors.accent, 0.15);
      c.lineWidth = 1.2;
      c.stroke();
    }
  }

  function drawParticles(c, colors) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    fillBase(c, colors, 0.3);
    for (let i = 0; i < particles.length; i += 1) {
      const a = particles[i];
      a.x = (a.x + a.vx + 1) % 1;
      a.y = (a.y + a.vy + 1) % 1;
      const ax = a.x * width;
      const ay = a.y * height;
      for (let j = i + 1; j < particles.length; j += 1) {
        const b = particles[j];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist < 0.18) {
          c.beginPath();
          c.moveTo(ax, ay);
          c.lineTo(b.x * width, b.y * height);
          c.strokeStyle = rgba(colors.accent, (1 - dist / 0.18) * 0.18);
          c.lineWidth = 0.75;
          c.stroke();
        }
      }
      c.beginPath();
      c.arc(ax, ay, a.radius, 0, Math.PI * 2);
      c.fillStyle = rgba(colors.accent2, 0.55);
      c.fill();
    }
  }

  function drawNeural(c, colors) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    fillBase(c, colors, 0.38);
    for (const point of neural) {
      point.pulse += 0.025;
      const pulse = (Math.sin(point.pulse) + 1) * 0.5;
      const x = point.x * width;
      const y = point.y * height;
      c.beginPath();
      c.arc(x, y, 3 + pulse * 12, 0, Math.PI * 2);
      c.strokeStyle = rgba(colors.accent, 0.06 + pulse * 0.055);
      c.stroke();
      c.fillStyle = rgba(colors.accent2, 0.28 + pulse * 0.26);
      c.fillRect(x - 1, y - 1, 2, 2);
    }
  }

  function drawGrid(c, colors) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    fillBase(c, colors, 0.38);
    const step = 45;
    for (let x = step / 2; x < width; x += step) {
      for (let y = step / 2; y < height; y += step) {
        const dist = Math.hypot(x - width / 2, y - height / 2);
        const pulse = Math.sin(dist * 0.005 - phase * 0.04);
        c.fillStyle = rgba(colors.accent, 0.02 + (pulse + 1) * 0.035);
        c.fillRect(x, y, 1.5, 1.5);
      }
    }
  }

  function drawFlow(c, colors) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    c.fillStyle = rgba(colors.bg, 0.3);
    c.fillRect(0, 0, width, height);
    if (flowLines.length < 14 && Math.random() > 0.9) {
      flowLines.push({ x: -220, y: Math.random() * height, speed: 0.5 + Math.random() * 1.5, width: 50 + Math.random() * 180, opacity: 0.045 + Math.random() * 0.10 });
    }
    for (let i = flowLines.length - 1; i >= 0; i -= 1) {
      const line = flowLines[i];
      line.x += line.speed;
      if (line.x > width) {
        flowLines.splice(i, 1);
        continue;
      }
      c.fillStyle = rgba(colors.accent, line.opacity);
      c.fillRect(line.x, line.y, line.width, 1);
    }
  }

  function drawMesh(c, colors) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    fillBase(c, colors, 0.56);
    c.save();
    c.globalCompositeOperation = "lighter";
    for (const blob of mesh) {
      blob.angle += blob.speed;
      const x = (blob.x + Math.cos(blob.angle) * 0.08) * width;
      const y = (blob.y + Math.sin(blob.angle * 1.4) * 0.07) * height;
      const radius = Math.max(width, height) * blob.radius;
      const color = blob.color ? colors.accent2 : colors.accent;
      const gradient = c.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, rgba(color, 0.095));
      gradient.addColorStop(0.42, rgba(color, 0.04));
      gradient.addColorStop(1, rgba(color, 0));
      c.fillStyle = gradient;
      c.beginPath();
      c.arc(x, y, radius, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  function drawOrbit(c, colors) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    fillBase(c, colors, 0.44);
    const cx = width * 0.5;
    const cy = height * 0.52;
    const maxRadius = Math.min(width, height) * 0.42;
    for (let i = 0; i < 6; i += 1) {
      const radius = maxRadius * (0.35 + i * 0.105);
      const start = phase * 0.004 * (i % 2 ? -1 : 1) + i * 0.65;
      c.beginPath();
      c.arc(cx, cy, radius, start, start + Math.PI * (0.22 + i * 0.025));
      c.strokeStyle = rgba(i % 2 ? colors.accent2 : colors.accent, 0.055 + i * 0.012);
      c.lineWidth = 0.8 + i * 0.1;
      c.stroke();
    }
  }

  function drawHorizon(c, colors) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    fillBase(c, colors, 0.5);
    const y = height * (0.62 + Math.sin(phase * 0.006) * 0.025);
    const glow = c.createLinearGradient(0, y - height * 0.25, 0, y + height * 0.25);
    glow.addColorStop(0, rgba(colors.accent, 0));
    glow.addColorStop(0.48, rgba(colors.accent, 0.09));
    glow.addColorStop(0.56, rgba(colors.accent2, 0.045));
    glow.addColorStop(1, rgba(colors.accent, 0));
    c.fillStyle = glow;
    c.fillRect(0, y - height * 0.25, width, height * 0.5);
    c.beginPath();
    for (let x = 0; x <= width; x += 12) {
      const yy = y + Math.sin(x * 0.008 + phase * 0.01) * 7 + Math.sin(x * 0.021 - phase * 0.006) * 3;
      x === 0 ? c.moveTo(x, yy) : c.lineTo(x, yy);
    }
    c.strokeStyle = rgba(colors.accent, 0.11);
    c.stroke();
  }

  function drawPrimes(c, colors) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    fillBase(c, colors, 0.46);
    c.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (const node of primes) {
      node.pulse += node.speed;
      node.nextSwap -= 1;
      node.glow *= 0.965;
      if (node.nextSwap <= 0) {
        node.value = PRIME_VALUES[Math.floor(Math.random() * PRIME_VALUES.length)];
        node.glow = 1;
        node.nextSwap = 90 + Math.random() * 330;
      }
      const x = node.x * width + Math.sin(phase * 0.003 + node.pulse) * 6;
      const y = node.y * height + Math.cos(phase * 0.002 + node.pulse * 1.3) * 5;
      const alpha = 0.035 + ((Math.sin(node.pulse) + 1) * 0.5) * 0.035 + node.glow * 0.2;
      c.fillStyle = rgba(node.glow > 0.25 ? colors.accent2 : colors.accent, alpha);
      c.fillText(String(node.value), x, y);
    }
  }

  const EFFECTS = {
    waves: drawWaves,
    particles: drawParticles,
    neural: drawNeural,
    grid: drawGrid,
    flow: drawFlow,
    mesh: drawMesh,
    orbit: drawOrbit,
    horizon: drawHorizon,
    primes: drawPrimes
  };
  const EFFECT_NAMES = Object.keys(EFFECTS);

  function makeParticles(count, speed) {
    return Array.from({ length: count }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * speed,
      vy: (Math.random() - 0.5) * speed,
      radius: 1 + Math.random() * 1.4
    }));
  }

  function makePrimes() {
    return Array.from({ length: 42 }, () => ({
      x: Math.random(),
      y: Math.random(),
      value: PRIME_VALUES[Math.floor(Math.random() * PRIME_VALUES.length)],
      pulse: Math.random() * Math.PI * 2,
      speed: 0.006 + Math.random() * 0.018,
      glow: Math.random() * 0.3,
      nextSwap: 80 + Math.random() * 260
    }));
  }

  function pickEffect(except = null) {
    if (selectedEffect !== "random" && EFFECTS[selectedEffect]) return EFFECTS[selectedEffect];
    let name = EFFECT_NAMES[Math.floor(Math.random() * EFFECT_NAMES.length)];
    if (except && EFFECT_NAMES.length > 1) {
      while (EFFECTS[name] === except) name = EFFECT_NAMES[Math.floor(Math.random() * EFFECT_NAMES.length)];
    }
    return EFFECTS[name];
  }

  function setEffect(effect) {
    selectedEffect = effect || "random";
    currentEffect = pickEffect();
    nextEffect = null;
    fading = false;
    lastSwitch = performance.now();
  }

  function loop(now) {
    const colors = palette();
    phase += 0.58;

    if (selectedEffect === "random" && !fading && now - lastSwitch >= ROTATE_MS) {
      nextEffect = pickEffect(currentEffect);
      fadeAlpha = 0;
      fading = true;
    }

    if (fading && nextEffect) {
      currentEffect(ctx, colors);
      nextEffect(off, colors);
      fadeAlpha = Math.min(1, fadeAlpha + 16 / FADE_MS);
      ctx.save();
      ctx.globalAlpha = fadeAlpha;
      ctx.drawImage(offscreen, 0, 0, window.innerWidth, window.innerHeight);
      ctx.restore();
      if (fadeAlpha >= 1) {
        currentEffect = nextEffect;
        nextEffect = null;
        fading = false;
        lastSwitch = now;
      }
    } else {
      currentEffect(ctx, colors);
    }

    window.requestAnimationFrame(loop);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("aura:appearance-change", () => {
    resize();
  });
  window.addEventListener("aura:background-effect", (event) => {
    setEffect(event.detail && event.detail.effect);
  });

  resize();
  currentEffect = pickEffect();
  window.requestAnimationFrame(loop);
})();
