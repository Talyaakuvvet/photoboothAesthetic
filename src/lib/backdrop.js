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

/* ---------- edge refinement: guided filter (He et al.) ----------
   Snaps a blurry low-res mask to the real edges of the photo (hair, shoulders, fingers). */
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w; let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}
function guidedFilter(I, p, w, h, r, eps) {
  const n = w * h, Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = boxBlur(I, w, h, r), mp = boxBlur(p, w, h, r), mIp = boxBlur(Ip, w, h, r), mII = boxBlur(II, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = mII[i] - mI[i] * mI[i], cov = mIp[i] - mI[i] * mp[i];
    a[i] = cov / (varI + eps); b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = boxBlur(a, w, h, r), mb = boxBlur(b, w, h, r), q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}
function grayOf(canvas) {
  const w = canvas.width, h = canvas.height, d = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) / 255;
  return g;
}
function resizeFloat(f, w, h, W, H) {
  if (w === W && h === H) return f;
  const out = new Float32Array(W * H), sx = (w - 1) / Math.max(1, W - 1), sy = (h - 1) / Math.max(1, H - 1);
  for (let y = 0; y < H; y++) {
    const fy = y * sy, y0 = fy | 0, y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = x * sx, x0 = fx | 0, x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const top = f[y0 * w + x0] * (1 - tx) + f[y0 * w + x1] * tx, bot = f[y1 * w + x0] * (1 - tx) + f[y1 * w + x1] * tx;
      out[y * W + x] = top * (1 - ty) + bot * ty;
    }
  }
  return out;
}
function floatToMask(f, w, h, target, lo = 0.2, hi = 0.8) {
  const c = target || mk(w, h);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const x = c.getContext("2d"), id = x.createImageData(w, h), d = id.data;
  for (let i = 0, p = 3; i < f.length; i++, p += 4) d[p] = smooth(lo, hi, f[i]) * 255;
  x.putImageData(id, 0, 0);
  return c;
}

/**
 * Turns a segmenter result into a mask canvas and closes the result.
 * guide: the image the mask belongs to (any size) - edges get snapped to it.
 * state: pass the same object every frame for the live preview to calm flicker.
 */
export function writeMask(result, target, guide, state) {
  const m = result.confidenceMasks && result.confidenceMasks[0];
  if (!m) { result.close?.(); return null; }
  const w = m.width, h = m.height, f = m.getAsFloat32Array().slice();
  result.close?.();
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
  if (personIsHigh === false) for (let i = 0; i < f.length; i++) f[i] = 1 - f[i];
  if (!guide) return floatToMask(f, w, h, target, 0.3, 0.72);

  const W = guide.width, H = guide.height;
  const r = Math.max(3, Math.round(Math.max(W, H) / 64));
  let q = guidedFilter(grayOf(guide), resizeFloat(f, w, h, W, H), W, H, r, 0.0008);
  if (state) {
    if (state.prev && state.prev.length === q.length) for (let i = 0; i < q.length; i++) q[i] = 0.6 * q[i] + 0.4 * state.prev[i];
    state.prev = q;
  }
  return floatToMask(q, W, H, target, 0.35, 0.7); // tight edge: less background fringe
}

/* ---------- high-quality portrait matting for stills (MODNet) ----------
   Loaded from a CDN only when needed; ~25 MB once, then cached by the browser. */
const TJS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js";
let mattingP = null, progressFn = null;
/** fn({ loaded: 0..1 }) while the matting model downloads */
export function onModelProgress(fn) { progressFn = fn; }

function getMatting() {
  if (!mattingP) {
    mattingP = (async () => {
      const T = await import(/* @vite-ignore */ TJS);
      T.env.allowLocalModels = false;
      const progress_callback = (e) => {
        if (e && e.status === "progress" && typeof e.progress === "number") progressFn?.({ loaded: e.progress / 100 });
        if (e && e.status === "ready") progressFn?.({ loaded: 1 });
      };
      const make = (device) => T.pipeline("background-removal", "Xenova/modnet", { device, dtype: "fp32", progress_callback });
      let run;
      if (navigator.gpu) { try { run = await make("webgpu"); } catch { run = null; } }
      if (!run) run = await make("wasm");
      return { T, run };
    })();
    mattingP.catch(() => { mattingP = null; });
  }
  return mattingP;
}

async function mattingMask(src) {
  const { T, run } = await getMatting();
  const sc = Math.min(1, 768 / Math.max(src.width, src.height));
  const small = mk(Math.round(src.width * sc), Math.round(src.height * sc));
  small.getContext("2d").drawImage(src, 0, 0, small.width, small.height);
  const out = await run(T.RawImage.fromCanvas(small));
  const img = Array.isArray(out) ? out[0] : out;
  const w = img.width, h = img.height, ch = img.channels, d = img.data;
  const f = new Float32Array(w * h);
  if (ch === 4) for (let i = 0; i < f.length; i++) f[i] = d[i * 4 + 3] / 255;
  else if (ch === 1) for (let i = 0; i < f.length; i++) f[i] = d[i] / 255;
  else throw new Error("matting output");
  return floatToMask(f, w, h, null, 0.06, 0.94); // matte is already soft and accurate; just trim the fringe
}

async function selfieMask(src) {
  const seg = await getSegmenter("IMAGE");
  const sc = Math.min(1, 512 / Math.max(src.width, src.height));
  const small = mk(Math.round(src.width * sc), Math.round(src.height * sc));
  small.getContext("2d").drawImage(src, 0, 0, small.width, small.height);
  return writeMask(seg.segment(small), null, small);
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
  let mask = null;
  try { mask = await mattingMask(src); }       // best: hair-level matte
  catch { mask = await selfieMask(src); }      // fallback: fast model + edge refinement
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
