import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import SettingsPanel from "../components/SettingsPanel.jsx";
import QrCard from "../components/QrCard.jsx";
import { Icon } from "../components/Icons.jsx";
import { useSettings } from "../lib/settings.jsx";
import { canvasToBlob, renderStrip, saveBlob } from "../lib/strip.js";
import { KEEP_DAYS, sharingEnabled, uploadSession } from "../lib/supabase.js";

// Stage = what the guest sees AND what gets recorded (3:4 portrait, like a booth frame).
const SW = 720, SH = 960;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  const types = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function drawCover(ctx, video, w, h, mirror) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return false;
  const sc = Math.max(w / vw, h / vh), dw = vw * sc, dh = vh * sc;
  ctx.save();
  if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.restore();
  return true;
}

/* small sound effects (WebAudio, started from the Start tap) */
function beep(ac, freq = 880, dur = 0.12, vol = 0.22) {
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function shutter(ac) {
  const len = Math.floor(ac.sampleRate * 0.09), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = ac.createBufferSource(), g = ac.createGain();
  g.gain.value = 0.35; src.buffer = buf; src.connect(g).connect(ac.destination); src.start();
}

export default function Booth() {
  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const videoRef = useRef(null), stageRef = useRef(null);
  const streamRef = useRef(null), micRef = useRef(null), rafRef = useRef(0), wakeRef = useRef(null);
  const overlay = useRef({ count: null, countAt: 0, flashAt: -1e9, taken: 0, total: 0, msg: null });
  const abortRef = useRef(false);
  const liveRef = useRef(null); // { mod, seg } for the live AI curtain

  const [facing, setFacing] = useState("user");
  const [camTry, setCamTry] = useState(0);
  const [camError, setCamError] = useState(null);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState("setup"); // setup | shooting | processing | result
  const [withAudio, setWithAudio] = useState(false);
  const [doShare, setDoShare] = useState(sharingEnabled);
  const [result, setResult] = useState(null); // { stripUrl, stripBlob, videoUrl, videoBlob, horiz }
  const [share, setShare] = useState(null); // { state, url?, error? }

  /* ---------- camera ---------- */
  useEffect(() => {
    let stopped = false;
    async function start() {
      setReady(false); setCamError(null);
      if (!window.isSecureContext) { setCamError("Kamera sadece https adreslerinde açılır. Siteyi https üzerinden aç."); return; }
      if (!navigator.mediaDevices?.getUserMedia) { setCamError("Bu tarayıcı kameraya erişemiyor. Güncel Chrome ya da Safari dene."); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setReady(true);
      } catch (e) {
        if (e.name === "NotAllowedError") setCamError("Kamera izni verilmedi. Tarayıcının adres çubuğundaki kamera simgesinden izin verip sayfayı yenile.");
        else if (e.name === "NotFoundError" || e.name === "OverconstrainedError") setCamError("Kamera bulunamadı.");
        else setCamError("Kamera açılamadı: " + e.message);
      }
    }
    start();
    return () => {
      stopped = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing, camTry]);

  /* ---------- stage loop: live look + countdown overlay (also what gets recorded) ---------- */
  useEffect(() => {
    const cv = stageRef.current, ctx = cv.getContext("2d");
    const noise = document.createElement("canvas");
    noise.width = noise.height = 160;
    const nctx = noise.getContext("2d"), nd = nctx.createImageData(160, 160);
    for (let i = 0; i < nd.data.length; i += 4) { const v = Math.random() * 255; nd.data[i] = nd.data[i + 1] = nd.data[i + 2] = v; nd.data[i + 3] = 255; }
    nctx.putImageData(nd, 0, 0);
    const pattern = ctx.createPattern(noise, "repeat");
    const vig = ctx.createRadialGradient(SW / 2, SH * 0.45, SH * 0.3, SW / 2, SH * 0.45, SH * 0.75);
    vig.addColorStop(0, "rgba(0,0,0,0)"); vig.addColorStop(1, "rgba(0,0,0,0.55)");
    const small = document.createElement("canvas"); small.width = 192; small.height = 256;
    const sctx = small.getContext("2d");
    const frame = document.createElement("canvas"); frame.width = SW; frame.height = SH;
    const fctx = frame.getContext("2d");
    const maskCv = document.createElement("canvas"), scratch = {};
    let lastSeg = 0, hasMask = false;

    const draw = (now) => {
      const s = settingsRef.current, o = overlay.current, v = videoRef.current;
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
      ctx.fillStyle = "#120b0e"; ctx.fillRect(0, 0, SW, SH);
      const mirror = facing === "user", live = liveRef.current;
      let drawn = false;
      if (v && v.videoWidth && live && s.backdrop && s.backdrop !== "none") {
        if (now - lastSeg > 66) { // ~15 masks per second is plenty
          lastSeg = now;
          drawCover(sctx, v, 192, 256, mirror);
          try { hasMask = !!live.mod.writeMask(live.seg.segmentForVideo(small, now), maskCv); } catch { hasMask = false; }
        }
        if (hasMask) {
          drawCover(fctx, v, SW, SH, mirror);
          live.mod.compose(ctx, SW, SH, frame, maskCv, s.backdrop, s.seed, scratch);
          drawn = true;
        }
      }
      if (drawn || (v && drawCover(ctx, v, SW, SH, mirror))) {
        // live booth look (cheap blend modes, so it runs on phones)
        if (s.tone === "bw" || s.tone === "sepia") {
          ctx.globalCompositeOperation = "saturation"; ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, SW, SH);
          if (s.tone === "sepia") { ctx.globalCompositeOperation = "color"; ctx.globalAlpha = 0.6; ctx.fillStyle = "rgb(150,112,72)"; ctx.fillRect(0, 0, SW, SH); }
        } else {
          ctx.globalCompositeOperation = "saturation"; ctx.globalAlpha = 0.45; ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, SW, SH);
          ctx.globalAlpha = 0.18; ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = "rgb(255,214,190)"; ctx.fillRect(0, 0, SW, SH);
        }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = vig; ctx.fillRect(0, 0, SW, SH);
        ctx.save(); ctx.globalAlpha = 0.07; ctx.globalCompositeOperation = "overlay";
        ctx.translate((Math.random() * 160) | 0, (Math.random() * 160) | 0);
        ctx.fillStyle = pattern; ctx.fillRect(-160, -160, SW + 160, SH + 160);
        ctx.restore();
      }
      // progress dots
      if (o.total) {
        const r = 9, gap = 30, x0 = SW / 2 - ((o.total - 1) * gap) / 2;
        for (let i = 0; i < o.total; i++) {
          ctx.beginPath(); ctx.arc(x0 + i * gap, 44, r, 0, 7);
          ctx.fillStyle = i < o.taken ? "#f293b6" : "rgba(255,255,255,0.35)"; ctx.fill();
        }
      }
      // countdown number
      if (o.count != null) {
        const t = Math.min(1, (now - o.countAt) / 260), sc = 1.35 - 0.35 * t;
        ctx.save(); ctx.translate(SW / 2, SH / 2); ctx.scale(sc, sc);
        ctx.font = '500 300px "Caveat", cursive'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 24; ctx.fillStyle = "#fff";
        ctx.fillText(String(o.count), 0, 10); ctx.restore();
      }
      if (o.msg) {
        ctx.save(); ctx.font = '600 52px "Figtree", system-ui, sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 18; ctx.fillStyle = "#fff";
        ctx.fillText(o.msg, SW / 2, SH * 0.82); ctx.restore();
      }
      // flash
      const f = 1 - (now - o.flashAt) / 380;
      if (f > 0) { ctx.globalAlpha = f; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, SW, SH); ctx.globalAlpha = 1; }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [facing]);

  // live AI curtain: load the video segmenter only when a curtain is chosen
  useEffect(() => {
    if (!settings.backdrop || settings.backdrop === "none" || liveRef.current) return;
    let alive = true;
    import("../lib/backdrop.js")
      .then(async (mod) => { const seg = await mod.getSegmenter("VIDEO"); if (alive) liveRef.current = { mod, seg }; })
      .catch(() => { /* live preview stays without curtain; stills still try */ });
    return () => { alive = false; };
  }, [settings.backdrop]);

  // release everything when leaving the page
  useEffect(() => () => {
    abortRef.current = true;
    micRef.current?.getTracks().forEach((t) => t.stop());
    wakeRef.current?.release?.().catch(() => {});
  }, []);

  // object URLs of the last result
  useEffect(() => () => { if (result?.videoUrl) URL.revokeObjectURL(result.videoUrl); }, [result]);

  /* ---------- capture one clean frame (no overlays) ---------- */
  function grab() {
    const c = document.createElement("canvas");
    c.width = 900; c.height = 1200;
    drawCover(c.getContext("2d"), videoRef.current, c.width, c.height, facing === "user");
    return c;
  }

  async function startSession() {
    const s = settingsRef.current, n = s.count;
    abortRef.current = false;
    setShare(null); setResult(null);
    setPhase("shooting");
    try { wakeRef.current = await navigator.wakeLock?.request("screen"); } catch { /* optional */ }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = AC ? new AC() : null;

    // recorder: stage canvas (+ mic if asked)
    let recorder = null, chunks = [], mime = pickMime();
    if (mime !== null && stageRef.current.captureStream) {
      const tracks = [...stageRef.current.captureStream(30).getVideoTracks()];
      if (withAudio) {
        try {
          micRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
          tracks.push(...micRef.current.getAudioTracks());
        } catch { /* record silently if the mic is refused */ }
      }
      try {
        recorder = new MediaRecorder(new MediaStream(tracks), { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2_500_000 });
        recorder.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
        recorder.start(250);
      } catch { recorder = null; }
    }

    const o = overlay.current;
    Object.assign(o, { count: null, taken: 0, total: n, msg: null });
    const shots = [];
    await sleep(500);
    for (let i = 0; i < n && !abortRef.current; i++) {
      o.msg = i === 0 ? "Hazır ol!" : "Sıradaki poz!";
      await sleep(900);
      o.msg = null;
      for (const c of [3, 2, 1]) {
        if (abortRef.current) break;
        o.count = c; o.countAt = performance.now();
        if (ac) beep(ac, c === 1 ? 1175 : 880);
        await sleep(1000);
      }
      if (abortRef.current) break;
      o.count = null;
      shots.push(grab());
      o.flashAt = performance.now(); o.taken = i + 1;
      if (ac) shutter(ac);
      await sleep(800);
    }
    if (!abortRef.current) { o.msg = "Harika!"; await sleep(1100); }
    Object.assign(o, { msg: null, count: null, total: 0, taken: 0 });

    let videoBlob = null;
    if (recorder) {
      const done = new Promise((r) => (recorder.onstop = r));
      recorder.stop(); await done;
      if (chunks.length) videoBlob = new Blob(chunks, { type: (recorder.mimeType || mime || "video/webm").split(";")[0] });
    }
    micRef.current?.getTracks().forEach((t) => t.stop()); micRef.current = null;
    wakeRef.current?.release?.().catch(() => {}); wakeRef.current = null;
    ac?.close?.();

    if (abortRef.current || shots.length < n) { setPhase("setup"); return; }

    setPhase("processing");
    let bdFailed = false;
    const canvas = await renderStrip(shots, s, { onBackdropError: () => { bdFailed = true; } });
    const stripBlob = await canvasToBlob(canvas, "image/jpeg", 0.92);
    const res = {
      stripUrl: canvas.toDataURL("image/jpeg", 0.9), stripBlob, horiz: s.dir === "h",
      videoBlob, videoUrl: videoBlob ? URL.createObjectURL(videoBlob) : null,
    };
    setResult({ ...res, bdFailed });
    setPhase("result");

    if (doShare && sharingEnabled) {
      setShare({ state: "uploading" });
      try {
        const { shareUrl } = await uploadSession({ strip: stripBlob, video: videoBlob });
        setShare({ state: "done", url: shareUrl });
      } catch (e) {
        setShare({ state: "error", error: e.message || "Bağlantını kontrol et." });
      }
    }
  }

  const retryUpload = async () => {
    if (!result) return;
    setShare({ state: "uploading" });
    try {
      const { shareUrl } = await uploadSession({ strip: result.stripBlob, video: result.videoBlob });
      setShare({ state: "done", url: shareUrl });
    } catch (e) { setShare({ state: "error", error: e.message || "Bağlantını kontrol et." }); }
  };

  const shooting = phase === "shooting";
  const vidExt = result?.videoBlob?.type.includes("mp4") ? "mp4" : "webm";

  return (
    <div className={"bs" + (phase !== "setup" ? " is-shooting" : "")}>
      <div className="bs-bar">
        <Link to="/" className="bs-back"><Icon name="back" />Düzenleyici</Link>
        <span className="bs-title">Kabin</span>
        <button type="button" className="bs-icon" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
          disabled={shooting} aria-label="Kamerayı çevir"><Icon name="flip" /></button>
      </div>

      <div className="bs-main">
        <div className="bs-stage-wrap" hidden={phase === "result"}>
          <canvas ref={stageRef} width={SW} height={SH} className="bs-stage" />
          <video ref={videoRef} className="bs-video" muted playsInline autoPlay />
          {camError && (
            <div className="bs-msg">
              <p>{camError}</p>
              <button className="btn" type="button" onClick={() => setCamTry((n) => n + 1)}>Tekrar dene</button>
            </div>
          )}
          {phase === "processing" && <div className="bs-msg"><p>Şerit basılıyor…</p></div>}
          {shooting && (
            <button type="button" className="bs-cancel" onClick={() => { abortRef.current = true; }}>
              <Icon name="close" />Vazgeç
            </button>
          )}
        </div>

        {phase === "result" && result && (
          <div className="bs-result">
            <div className="bs-result-media">
              <div className="table">
                <img className={"strip-img" + (result.horiz ? " h" : "")} src={result.stripUrl} alt="Çekilen photobooth şeridi" />
              </div>
              {result.videoUrl && (
                <video className="bs-result-video" src={result.videoUrl} muted autoPlay loop playsInline controls />
              )}
            </div>
            <div className="panel bs-result-side">
              <div className="step-head"><span className="step-num">♡</span><span className="step-title">Şeridin hazır</span></div>
              {result.bdFailed && <p className="hint">Perde eklenemedi (yapay zeka modeli yüklenmedi), şerit orijinal arka planla basıldı.</p>}
              {share?.state === "uploading" && <p className="hint">QR hazırlanıyor, şerit ve video yükleniyor…</p>}
              {share?.state === "done" && <QrCard url={share.url} days={KEEP_DAYS} />}
              {share?.state === "error" && (
                <div className="bs-err">
                  <p>Yükleme olmadı: {share.error}</p>
                  <button className="btn" type="button" onClick={retryUpload}>Tekrar yükle</button>
                </div>
              )}
              <div className="btn-row">
                <button className="btn primary" type="button" onClick={() => saveBlob(result.stripBlob, "photobooth-serit.jpg")}>
                  <Icon name="download" />Şeridi indir
                </button>
                {result.videoBlob && (
                  <button className="btn" type="button" onClick={() => saveBlob(result.videoBlob, `photobooth-video.${vidExt}`)}>
                    <Icon name="video" />Videoyu indir
                  </button>
                )}
                <button className="btn" type="button" onClick={() => { setPhase("setup"); setShare(null); }}>
                  <Icon name="camera" />Tekrar çek
                </button>
              </div>
            </div>
          </div>
        )}

        {phase === "setup" && (
          <div className="panel bs-side">
            <button className="btn primary bs-start" type="button" disabled={!ready} onClick={startSession}>
              <Icon name="camera" />{ready ? `Başla · ${settings.count} kare` : "Kamera açılıyor…"}
            </button>
            <div className="row2">
              <label className="toggle">
                <input type="checkbox" checked={withAudio} onChange={(e) => setWithAudio(e.target.checked)} />
                <span className="sw" />Videoya sesi de kaydet
              </label>
              {sharingEnabled && (
                <label className="toggle">
                  <input type="checkbox" checked={doShare} onChange={(e) => setDoShare(e.target.checked)} />
                  <span className="sw" />QR ile paylaş
                </label>
              )}
            </div>
            <p className="hint">
              Her kare öncesi 3-2-1 geri sayım var. Çekim boyunca kısa bir video kaydedilir.
              {sharingEnabled && doShare ? ` QR açıksa şerit ve video bir linke yüklenir ve ${KEEP_DAYS} gün sonra silinir.` : " QR kapalıysa hiçbir şey yüklenmez, sadece bu cihazda kalır."}
            </p>
            <SettingsPanel startNum={1} />
          </div>
        )}
      </div>
    </div>
  );
}
