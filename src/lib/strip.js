// Photobooth strip renderer: tone, grain, vignette, aging, layout and caption.
// Everything runs on <canvas> in the browser; nothing leaves the device here.

export const FW = 600;
export const FH = 780;
const PROC = 0.72;

export const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

export const FONTS = {
  caveat: { name: "El yazısı", family: "Caveat", weight: 500, style: "normal", size: 58, dy: 4, fb: "cursive" },
  dancing: { name: "Zarif", family: "Dancing Script", weight: 500, style: "normal", size: 50, dy: 3, fb: "cursive" },
  pacifico: { name: "Retro", family: "Pacifico", weight: 400, style: "normal", size: 40, dy: 0, fb: "cursive" },
  elite: { name: "Daktilo", family: "Special Elite", weight: 400, style: "normal", size: 38, dy: 2, fb: "monospace" },
  playfair: { name: "Klasik", family: "Playfair Display", weight: 500, style: "italic", size: 44, dy: 2, fb: "serif" },
  courier: { name: "Tarih damgası", family: "Courier Prime", weight: 400, style: "normal", size: 38, dy: 2, fb: "monospace" },
};
export const fontCss = (f, px) => `${f.style} ${f.weight} ${px}px "${f.family}", ${f.fb}`;

export function todayLabel(d = new Date()) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export const DEFAULT_SETTINGS = {
  count: 4,
  dir: "v",
  tone: "bw",
  paper: "white",
  aged: true,
  caption: false,
  captionText: todayLabel(),
  capPos: "bottom",
  capFont: "caveat",
  backdrop: "none",
  seed: 1234,
};

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const makeCanvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
};

/* ---------- sample frames: curtain + figure ---------- */
export function sampleFrame(k) {
  const w = 480, h = 624, c = makeCanvas(w, h), x = c.getContext("2d");
  for (let i = 0; i < w; i++) {
    const s = 196 + 26 * Math.sin(i / 17 + k * 1.3) + 12 * Math.sin(i / 6.5 + k) + 6 * Math.sin(i / 2.7);
    x.fillStyle = `rgb(${s | 0},${(s * 0.97) | 0},${(s * 0.92) | 0})`;
    x.fillRect(i, 0, 1, h);
  }
  const poses = [[0, 0, 0], [-34, 18, -0.14], [28, 6, 0.12], [-6, 30, -0.05]];
  const [ox, oy, rot] = poses[k % 4];
  x.save(); x.translate(w / 2 + ox, 300 + oy); x.rotate(rot);
  x.fillStyle = "#2a2420"; x.beginPath(); x.ellipse(0, 330, 230, 200, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#1c1715"; x.beginPath(); x.ellipse(0, -10, 112, 150, 0, 0, Math.PI * 2); x.fill();
  x.fillRect(-112, -10, 224, 250);
  x.fillStyle = "#b9a596"; x.fillRect(-26, 70, 52, 90);
  x.beginPath(); x.ellipse(0, 10, 74, 96, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#1c1715"; x.beginPath(); x.ellipse(0, -62, 82, 46, 0, Math.PI, Math.PI * 2); x.fill();
  x.fillStyle = "#3b2f2a";
  if (k === 2) { x.fillRect(-36, 0, 24, 4); x.fillRect(12, 0, 24, 4); }
  else { x.beginPath(); x.arc(-26, 2, 6, 0, 7); x.arc(26, 2, 6, 0, 7); x.fill(); }
  x.fillStyle = "#7a5a52"; x.beginPath();
  if (k === 3) x.arc(4, 58, 10, 0, 7); else x.ellipse(0, 58, 20, 6, 0, 0, Math.PI);
  x.fill();
  if (k === 1 || k === 3) {
    x.fillStyle = "#b9a596"; x.beginPath();
    x.ellipse(k === 1 ? 68 : -70, 70, 30, 54, k === 1 ? -0.3 : 0.3, 0, 7); x.fill();
  }
  x.restore();
  c.__sample = true; // samples already have a curtain; skip the AI backdrop
  return c;
}

/* ---------- tone ---------- */
const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function curve(v) {
  v = clamp((v - 0.5) * 1.32 + 0.5);
  return v * v * (3 - 2 * v) * 0.45 + v * 0.55;
}
const SEPIA = [[34, 24, 16], [146, 114, 82], [240, 226, 198]];
function sepiaMap(v) {
  const a = v < 0.5 ? SEPIA[0] : SEPIA[1], b = v < 0.5 ? SEPIA[1] : SEPIA[2], t = v < 0.5 ? v * 2 : (v - 0.5) * 2;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function renderFrame(src, i, s) {
  const pw = Math.round(FW * PROC), ph = Math.round(FH * PROC);
  const c = makeCanvas(pw, ph);
  const x = c.getContext("2d", { willReadFrequently: true });
  const sw = src.width, sh = src.height, sc = Math.max(pw / sw, ph / sh), dw = sw * sc, dh = sh * sc;
  x.drawImage(src, (pw - dw) / 2, (ph - dh) * 0.35, dw, dh);
  const id = x.getImageData(0, 0, pw, ph), d = id.data;
  const rnd = mulberry32(s.seed + i * 977);
  const expo = 1 + (rnd() - 0.5) * 0.16;
  const cx = pw / 2, cy = ph * 0.44, maxr = Math.hypot(pw / 2, ph * 0.56);
  for (let py = 0, p = 0; py < ph; py++) {
    const dy = py - cy;
    for (let px = 0; px < pw; px++, p += 4) {
      const dist = Math.sqrt((px - cx) * (px - cx) + dy * dy) / maxr;
      const vig = 1 - 0.42 * Math.pow(dist, 2.3);
      const g = (rnd() - 0.5) * 0.12;
      let r = d[p] / 255, gg = d[p + 1] / 255, b = d[p + 2] / 255;
      const lum = 0.299 * r + 0.587 * gg + 0.114 * b;
      if (s.tone === "faded") {
        r = r * 0.55 + lum * 0.45; gg = gg * 0.55 + lum * 0.45; b = b * 0.55 + lum * 0.45;
        d[p] = clamp(0.07 + curve(clamp(r * expo)) * 0.88 * vig + g + 0.03) * 255;
        d[p + 1] = clamp(0.07 + curve(clamp(gg * expo)) * 0.86 * vig + g) * 255;
        d[p + 2] = clamp(0.09 + curve(clamp(b * expo)) * 0.8 * vig + g) * 255;
      } else {
        let v = curve(clamp(lum * expo));
        v = clamp((s.tone === "sepia" ? 0.05 + v * 0.93 : 0.05 + v * 0.92) * vig + g);
        if (s.tone === "sepia") { const m = sepiaMap(v); d[p] = m[0]; d[p + 1] = m[1]; d[p + 2] = m[2]; }
        else { const o = v * 255; d[p] = o + 2; d[p + 1] = o + 1; d[p + 2] = o - 2; }
      }
    }
  }
  x.putImageData(id, 0, 0);
  const out = makeCanvas(FW, FH), ox = out.getContext("2d");
  ox.imageSmoothingQuality = "high";
  ox.drawImage(c, 0, 0, FW, FH); // upscale = slight softness like a booth print
  if (s.aged) ageFrame(ox, i, s);
  return out;
}

/* ---------- aging ---------- */
function ageFrame(x, i, s) {
  const r = mulberry32(s.seed * 3 + i * 131);
  const warm = s.tone === "bw" ? "245,242,235" : "255,244,222";
  x.fillStyle = `rgba(${warm},0.07)`; x.fillRect(0, 0, FW, FH);
  const left = r() < 0.5, g = x.createLinearGradient(left ? 0 : FW, 0, left ? FW * 0.4 : FW * 0.6, 0);
  g.addColorStop(0, `rgba(${warm},${0.12 + r() * 0.14})`); g.addColorStop(1, `rgba(${warm},0)`);
  x.fillStyle = g; x.fillRect(0, 0, FW, FH);
  if (r() < 0.5) {
    const top = r() < 0.5, gb = x.createLinearGradient(0, top ? 0 : FH, 0, top ? FH * 0.22 : FH * 0.78);
    gb.addColorStop(0, `rgba(20,14,8,${0.15 + r() * 0.15})`); gb.addColorStop(1, "rgba(20,14,8,0)");
    x.fillStyle = gb; x.fillRect(0, 0, FW, FH);
  }
  if (r() < 0.65) {
    const bx = r() * FW, by = r() * FH, rad = 70 + r() * 150, rg = x.createRadialGradient(bx, by, rad * 0.55, bx, by, rad);
    rg.addColorStop(0, "rgba(110,80,45,0.04)"); rg.addColorStop(0.85, `rgba(110,80,45,${0.1 + r() * 0.1})`); rg.addColorStop(1, "rgba(110,80,45,0)");
    x.fillStyle = rg; x.fillRect(0, 0, FW, FH);
  }
  const n = 1 + ((r() * 4) | 0);
  for (let k = 0; k < n; k++) {
    x.strokeStyle = `rgba(255,255,255,${0.18 + r() * 0.3})`; x.lineWidth = 0.6 + r() * 1.1;
    const sx = r() * FW, sy = r() * FH * 0.5, len = FH * (0.2 + r() * 0.6), drift = (r() - 0.5) * 0.25, wob = r() * 6;
    x.beginPath(); x.moveTo(sx, sy);
    for (let t = 0; t < len; t += 12) x.lineTo(sx + t * drift + Math.sin(t / 40) * wob, sy + t);
    x.stroke();
  }
  if (r() < 0.35) {
    x.strokeStyle = "rgba(15,10,6,0.45)"; x.lineWidth = 1.2; x.beginPath();
    const hx = r() * FW, hy = r() * FH; x.moveTo(hx, hy);
    x.bezierCurveTo(hx + (r() - 0.5) * 120, hy + (r() - 0.5) * 120, hx + (r() - 0.5) * 120, hy + (r() - 0.5) * 120, hx + (r() - 0.5) * 90, hy + (r() - 0.5) * 90);
    x.stroke();
  }
  for (let k = 0; k < 55; k++) {
    x.fillStyle = r() < 0.7 ? `rgba(255,255,255,${0.3 + r() * 0.55})` : `rgba(0,0,0,${0.3 + r() * 0.45})`;
    x.beginPath(); x.arc(r() * FW, r() * FH, 0.5 + r() * r() * 3.2, 0, 7); x.fill();
  }
}

function ageStrip(x, W, H, black, seed) {
  const r = mulberry32(seed * 7 + 3);
  for (let k = 0; k < 26; k++) {
    const sx = r() * W, sy = r() * H, rad = 3 + r() * 16, rg = x.createRadialGradient(sx, sy, 0, sx, sy, rad);
    rg.addColorStop(0, black ? `rgba(120,105,85,${0.03 + r() * 0.05})` : `rgba(130,90,40,${0.02 + r() * 0.04})`);
    rg.addColorStop(1, "rgba(130,90,40,0)");
    x.fillStyle = rg; x.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
  }
  const e = black ? "95,88,78," : "105,72,32,", d = 22;
  [[0, 0, d, 0, 0, 0, d, H], [W, 0, W - d, 0, W - d, 0, d, H], [0, 0, 0, d, 0, 0, W, d], [0, H, 0, H - d, 0, H - d, W, d]].forEach(
    ([x0, y0, x1, y1, rx, ry, rw, rh]) => {
      const g = x.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, `rgba(${e}0.12)`); g.addColorStop(1, `rgba(${e}0)`);
      x.fillStyle = g; x.fillRect(rx, ry, rw, rh);
    }
  );
  const wide = W > H;
  for (let k = 0; k < 14; k++) {
    const edge = r() < 0.5 ? 0 : wide ? H : W, along = r() * (wide ? W : H);
    x.fillStyle = black ? "rgba(210,200,185,0.2)" : "rgba(255,252,244,0.85)";
    x.beginPath();
    if (wide) x.ellipse(along, edge, 4 + r() * 10, 1.5 + r() * 3, 0, 0, 7);
    else x.ellipse(edge, along, 1.5 + r() * 3, 4 + r() * 10, 0, 0, 7);
    x.fill();
  }
  const at = (wide ? W : H) * (0.25 + r() * 0.5), tilt = (r() - 0.5) * 40;
  const line = (off) => {
    x.beginPath();
    if (wide) { x.moveTo(at + off, 0); x.lineTo(at + tilt + off, H); }
    else { x.moveTo(0, at + off); x.lineTo(W, at + tilt + off); }
    x.stroke();
  };
  x.lineWidth = 2; x.strokeStyle = "rgba(255,255,255,0.1)"; line(0);
  x.lineWidth = 1.5; x.strokeStyle = black ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.08)"; line(2.5);
}

function emptyFrame(i, dark) {
  const c = makeCanvas(FW, FH), x = c.getContext("2d");
  x.fillStyle = dark ? "#2a2826" : "#d9d5ce"; x.fillRect(0, 0, FW, FH);
  x.fillStyle = dark ? "#55514c" : "#a8a39b";
  x.font = '500 120px "Caveat", cursive'; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(String(i + 1), FW / 2, FH / 2);
  return c;
}

/** Swap backgrounds for a curtain when the backdrop option is on. Never throws. */
async function withBackdrops(sources, s, onError) {
  const kind = s.backdrop || "none";
  if (kind === "none" || !sources.some((q) => q && !q.__sample)) return sources;
  let mod;
  try { mod = await import("./backdrop.js"); } catch (e) { onError?.(e); return sources; }
  const out = [];
  for (const src of sources) {
    if (!src || src.__sample) { out.push(src); continue; }
    try { out.push(await mod.applyBackdrop(src, kind, s.seed)); }
    catch (e) { onError?.(e); return sources; }
  }
  return out;
}

/**
 * Compose a strip. `sources` is an array of canvases/images (null = empty frame).
 * opts.onBackdropError is called if the AI backdrop could not run (the strip is still made).
 * Returns a canvas.
 */
export async function renderStrip(sources, s, opts = {}) {
  sources = await withBackdrops(sources.slice(0, s.count), s, opts.onBackdropError);
  const font = FONTS[s.capFont] || FONTS.caveat;
  try {
    await Promise.all([document.fonts.load(fontCss(font, font.size)), document.fonts.load('500 60px "Caveat"')]);
  } catch (e) { /* fallback font is fine */ }
  const MS = 16, M = 22, G = 10;
  const text = (s.captionText || "").trim();
  const capH = s.caption && text ? 78 : 0;
  const top = s.capPos === "top" ? capH : 0;
  const n = s.count, horiz = s.dir === "h";
  const W = horiz ? M * 2 + FW * n + G * (n - 1) : FW + MS * 2;
  const H = horiz ? MS * 2 + FH + capH : M * 2 + FH * n + G * (n - 1) + capH;
  const c = makeCanvas(W, H), x = c.getContext("2d");
  const black = s.paper === "black";
  x.fillStyle = black ? "#050505" : "#ffffff"; x.fillRect(0, 0, W, H);
  const rnd = mulberry32(s.seed + 5);
  for (let k = 0; k < 2600; k++) {
    x.fillStyle = black ? `rgba(255,255,255,${rnd() * 0.015})` : `rgba(80,60,40,${rnd() * 0.015})`;
    x.fillRect(rnd() * W, rnd() * H, 2, 2);
  }
  for (let i = 0; i < n; i++) {
    const src = sources[i];
    const fx = horiz ? M + i * (FW + G) : MS, fy = (horiz ? MS : M + i * (FH + G)) + top;
    x.drawImage(src ? renderFrame(src, i, s) : emptyFrame(i, black), fx, fy);
    x.strokeStyle = black ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.32)"; x.lineWidth = 2;
    x.strokeRect(fx + 1, fy + 1, FW - 2, FH - 2);
  }
  if (s.aged) ageStrip(x, W, H, black, s.seed);
  if (capH) {
    const mg = horiz ? MS : M, band = mg + capH;
    let size = font.size; x.font = fontCss(font, size);
    const maxW = W - 2 * Math.max(mg, 24);
    while (x.measureText(text).width > maxW && size > 18) { size -= 2; x.font = fontCss(font, size); }
    x.globalAlpha = s.aged ? 0.88 : 1;
    x.fillStyle = black ? "#ece7df" : "#2d2925"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(text, W / 2, top ? band / 2 + font.dy : H - band / 2 + font.dy);
    x.globalAlpha = 1;
  }
  return c;
}

export const canvasToBlob = (c, type = "image/jpeg", q = 0.92) =>
  new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), type, q));

/** Load a user file into a downscaled canvas plus a small thumbnail URL. */
export function loadImageFile(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const sc = Math.min(1, 1500 / Math.max(im.naturalWidth, im.naturalHeight));
      const c = makeCanvas(Math.round(im.naturalWidth * sc), Math.round(im.naturalHeight * sc));
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res({ src: c, thumb: thumbOf(c), sample: false });
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("load")); };
    im.src = url;
  });
}

export function thumbOf(c) {
  const ts = 220 / Math.max(c.width, c.height);
  const t = makeCanvas(Math.round(c.width * ts), Math.round(c.height * ts));
  t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
  return t.toDataURL("image/jpeg", 0.75);
}

/** Save a blob as a file (works on the user's own domain, unlike sandboxed previews). */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
