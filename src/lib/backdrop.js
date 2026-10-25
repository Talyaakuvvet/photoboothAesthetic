// AI backdrop: separates the person from the background (MediaPipe selfie
// segmenter, runs on the device) and puts a draped booth curtain behind them.
import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import { mulberry32 } from "./strip.js";

const WASM = "/mediapipe"; // copied from node_modules by scripts/copy-mediapipe.js
const MODEL =
  import.meta.env.VITE_SEGMENTER_MODEL ||
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

export const BACKDROPS = {
  none: { name: "Orijinal" },
  white: { name: "Beyaz perde", base: [246, 244, 240], depth: 0.17, swatch: "repeating-linear-gradient(90deg,#fbfaf7 0 4px,#dcd8d0 4px 7px)" },
  cream: { name: "Krem perde", base: [238, 228, 210], depth: 0.2, swatch: "repeating-linear-gradient(90deg,#f1e6d1 0 4px,#cdbb9b 4px 7px)" },
  black: { name: "Siyah perde", base: [26, 24, 23], depth: 0, swatch: "repeating-linear-gradient(90deg,#2c2a28 0 4px,#0d0c0c 4px 7px)" },
};

const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

/* ---------- segmenter (lazy, one per running mode) ---------- */
let filesetP = null;
const segP = {};
async function create(mode) {
  filesetP = filesetP || FilesetResolver.forVisionTasks(WASM);
  const fs = await filesetP;
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: mode,
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
  try { return await ImageSegmenter.createFromOptions(fs, opts("GPU")); }
  catch { return await ImageSegmenter.createFromOptions(fs, opts("CPU")); }
}
/** mode: "IMAGE" for stills, "VIDEO" for the live booth preview */
export function getSegmenter(mode = "IMAGE") {
  if (!segP[mode]) {
    segP[mode] = create(mode);
    segP[mode].catch(() => { segP[mode] = null; });
  }
  return segP[mode];
}

/* ---------- mask: person = opaque, background = transparent ---------- */
let personIsHigh = null; // decided from the first mask that clearly has a subject in the middle
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Writes the segmenter result into `target` (resized to the mask) and closes the result. */
export function writeMask(result, target) {
  const m = result.confidenceMasks && result.confidenceMasks[0];
  if (!m) { result.close?.(); return null; }
  const w = m.width, h = m.height, f = m.getAsFloat32Array();
  if (personIsHigh === null) {
    let cs = 0, cn = 0, bs = 0, bn = 0;
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) {
      const v = f[y * w + x], centre = Math.abs(x - w / 2) < w * 0.2 && y > h * 0.25 && y < h * 0.8;
      const border = x < w * 0.08 || x > w * 0.92;
      if (centre) { cs += v; cn++; } else if (border) { bs += v; bn++; }
    }
    const diff = cs / (cn || 1) - bs / (bn || 1);
    if (Math.abs(diff) > 0.2) personIsHigh = diff > 0;
  }
  const flip = personIsHigh === false;
  const c = target || mk(w, h);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const x = c.getContext("2d"), id = x.createImageData(w, h), d = id.data;
  for (let i = 0, p = 3; i < f.length; i++, p += 4) d[p] = smooth(0.3, 0.72, flip ? 1 - f[i] : f[i]) * 255;
  x.putImageData(id, 0, 0);
  result.close?.();
  return c;
}

/* ---------- curtain ---------- */
const curtainCache = new Map();
/** A draped booth curtain: vertical folds, a little light from above, darker hem. */
export function curtain(w, h, kind, seed = 1) {
  const key = `${w}x${h}:${kind}:${seed}`;
  if (curtainCache.has(key)) return curtainCache.get(key);
  const spec = BACKDROPS[kind] || BACKDROPS.white;
  const r = mulberry32(seed), c = mk(w, h), x = c.getContext("2d");
  const folds = 7 + r() * 3, p1 = r() * 6.28, p2 = r() * 6.28, p3 = r() * 6.28;
  for (let i = 0; i < w; i++) {
    const t = (i / w) * folds * Math.PI * 2;
    let s = 0.55 * (0.5 + 0.5 * Math.sin(t + p1)) + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.47 + p2)) + 0.15 * (0.5 + 0.5 * Math.sin(t * 2.3 + p3));
    s = Math.pow(s, 1.25);
    let rgb;
    if (kind === "black") {
      const hi = 34 * s; // folds catch a little light
      rgb = spec.base.map((v) => v + hi);
    } else {
      const shade = 1 - spec.depth * (1 - s);
      rgb = spec.base.map((v) => v * shade);
    }
    x.fillStyle = `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`;
    x.fillRect(i, 0, 1, h);
  }
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgba(255,255,255,0.06)"); g.addColorStop(0.6, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.14)");
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  const spot = x.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, Math.max(w, h) * 0.7);
  spot.addColorStop(0, "rgba(255,255,255,0.06)"); spot.addColorStop(1, "rgba(0,0,0,0.1)");
  x.fillStyle = spot; x.fillRect(0, 0, w, h);
  if (curtainCache.size > 24) curtainCache.clear();
  curtainCache.set(key, c);
  return c;
}

/**
 * Curtain + soft shadow + person, drawn into `ctx` at w×h. `mask` is any size.
 * Pass `scratch` ({}) to reuse work canvases between calls (live preview).
 */
export function compose(ctx, w, h, personSrc, mask, kind, seed, scratch) {
  ctx.drawImage(curtain(w, h, kind, seed), 0, 0);
  // soft contact shadow of the person on the curtain
  const sw = Math.max(8, Math.round(w / 18)), sh = Math.max(8, Math.round(h / 18));
  const s = scratch ? (scratch.s = scratch.s || mk(sw, sh)) : mk(sw, sh), sx = s.getContext("2d");
  sx.globalCompositeOperation = "source-over"; sx.clearRect(0, 0, sw, sh);
  sx.drawImage(mask, 0, 0, sw, sh);
  sx.globalCompositeOperation = "source-in";
  sx.fillStyle = kind === "black" ? "rgba(0,0,0,0.55)" : "rgba(45,32,22,0.32)";
  sx.fillRect(0, 0, sw, sh);
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(s, w * 0.025, h * 0.012, w, h);
  ctx.restore();
  // person cut out with feathered edges
  const p = scratch ? (scratch.p = scratch.p || mk(w, h)) : mk(w, h), px = p.getContext("2d");
  px.globalCompositeOperation = "source-over"; px.clearRect(0, 0, w, h);
  px.drawImage(personSrc, 0, 0, w, h);
  px.globalCompositeOperation = "destination-in";
  px.imageSmoothingEnabled = true; px.imageSmoothingQuality = "high";
  px.drawImage(mask, 0, 0, w, h);
  ctx.drawImage(p, 0, 0);
}

/* ---------- stills ---------- */
const maskCache = new WeakMap();
async function maskFor(src) {
  if (maskCache.has(src)) return maskCache.get(src);
  const seg = await getSegmenter("IMAGE");
  const sc = Math.min(1, 512 / Math.max(src.width, src.height));
  const small = mk(Math.round(src.width * sc), Math.round(src.height * sc));
  small.getContext("2d").drawImage(src, 0, 0, small.width, small.height);
  const mask = writeMask(seg.segment(small));
  if (!mask) throw new Error("mask");
  maskCache.set(src, mask);
  return mask;
}

/** Returns a new canvas: same size as `src`, background replaced by a curtain. */
export async function applyBackdrop(src, kind, seed) {
  const mask = await maskFor(src);
  const out = mk(src.width, src.height);
  compose(out.getContext("2d"), src.width, src.height, src, mask, kind, seed);
  return out;
}
