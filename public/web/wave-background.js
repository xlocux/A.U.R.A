(function () {
  "use strict";

  const canvas = document.getElementById("backgroundScope");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let phase = 0;

  function parseColor(value, fallback) {
    const raw = String(value || "").trim();
    const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      let digits = hex[1];
      if (digits.length === 3) digits = digits.split("").map((char) => char + char).join("");
      return [
        parseInt(digits.slice(0, 2), 16),
        parseInt(digits.slice(2, 4), 16),
        parseInt(digits.slice(4, 6), 16)
      ];
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

  function resize() {
    const scale = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(window.innerWidth * scale);
    canvas.height = Math.floor(window.innerHeight * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  function draw() {
    const colors = palette();
    const width = window.innerWidth;
    const height = window.innerHeight;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = rgba(colors.bg, 0.26);
    ctx.fillRect(0, 0, width, height);

    for (let y = 0; y < height; y += 18) {
      const intensity = 0.014 + ((Math.sin((y + phase) * 0.025) + 1) * 0.014);
      ctx.fillStyle = rgba(colors.accent, intensity);
      ctx.fillRect(0, y, width, 1);
    }

    for (let band = 0; band < 5; band += 1) {
      const baseY = height * (0.16 + band * 0.16);
      ctx.beginPath();
      for (let x = 0; x <= width; x += 8) {
        const y = baseY
          + Math.sin((x + phase * (1.4 + band * 0.2)) * (0.012 + band * 0.002)) * (14 + band * 4)
          + Math.sin((x - phase) * 0.031) * 6;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = band % 2 ? rgba(colors.accent2, 0.13) : rgba(colors.accent, 0.15);
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }

    phase += 0.55;
    window.requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener("resize", resize);
  window.requestAnimationFrame(draw);
})();
