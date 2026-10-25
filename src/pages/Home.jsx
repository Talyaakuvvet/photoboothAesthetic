import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import SettingsPanel from "../components/SettingsPanel.jsx";
import QrCard from "../components/QrCard.jsx";
import { Icon } from "../components/Icons.jsx";
import { useSettings } from "../lib/settings.jsx";
import { canvasToBlob, isIOS, loadImageFile, renderStrip, sampleFrame, saveLabel, saveToDevice, thumbOf } from "../lib/strip.js";
import { KEEP_DAYS, sharingEnabled, uploadSession } from "../lib/supabase.js";

const samples = () =>
  [0, 1, 2, 3].map((i) => {
    const c = sampleFrame(i);
    return { src: c, thumb: thumbOf(c), sample: true };
  });

export default function Home({ toast }) {
  const { settings: s, update } = useSettings();
  const navigate = useNavigate();
  const [slots, setSlots] = useState(samples);
  const [stripUrl, setStripUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState(null); // { state: "uploading" | "done", url }
  const lastCanvas = useRef(null);
  const lastBlob = useRef(null);
  const bdWarned = useRef(false);
  const galRef = useRef(null), slotRef = useRef(null), slotTarget = useRef(0);

  const active = slots.slice(0, s.count);
  const hasSamples = active.some((q) => q && q.sample);
  const full = active.every(Boolean);
  const userCount = active.filter((q) => q && !q.sample).length;

  // re-render the strip whenever photos or settings change
  const key = useMemo(() => JSON.stringify(s), [s]);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(async () => {
      const c = await renderStrip(slots.map((q) => q && q.src), s, {
        onBackdropError: () => {
          if (bdWarned.current) return;
          bdWarned.current = true;
          toast("Perde eklenemedi: yapay zeka modeli yüklenmedi. İnternet bağlantını kontrol edip tekrar dene.");
        },
      });
      if (cancelled) return;
      lastCanvas.current = c;
      lastBlob.current = null;
      canvasToBlob(c, "image/jpeg", 0.93).then((b) => { if (lastCanvas.current === c) lastBlob.current = b; });
      setStripUrl(c.toDataURL("image/jpeg", 0.9));
      setBusy(false);
    }, 60);
    setShare(null);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, key]);

  async function addFiles(fileList, fixed) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
    if (!files.length) return;
    let next = slots.map((q) => (q && q.sample ? null : q));
    let targets;
    if (fixed != null) targets = [fixed];
    else {
      targets = next.slice(0, s.count).map((q, i) => (q ? -1 : i)).filter((i) => i >= 0);
      if (targets.length < Math.min(files.length, s.count)) targets = [...Array(s.count).keys()];
    }
    let failed = 0;
    for (let k = 0; k < Math.min(files.length, targets.length); k++) {
      try { next[targets[k]] = await loadImageFile(files[k]); } catch { failed++; }
    }
    if (next.every((q) => !q)) next = samples();
    setSlots(next);
    if (failed) toast("Bir fotoğraf açılamadı. JPG veya PNG olarak tekrar dene.");
    else if (fixed == null && files.length > targets.length) toast(`Şeritte ${s.count} kare var; ilk ${s.count} fotoğraf kullanıldı.`);
  }

  function removeSlot(i) {
    const next = slots.slice();
    next[i] = null;
    setSlots(next.every((q) => !q) ? samples() : next);
  }

  async function download() {
    if (!lastCanvas.current) return;
    const blob = lastBlob.current || (await canvasToBlob(lastCanvas.current, "image/jpeg", 0.93));
    const r = await saveToDevice(blob, "photobooth-serit.jpg");
    if (r === "downloaded" && isIOS()) toast("Dosyalar'a indi. Galeriye kaydetmek için tekrar bas ve “Görüntüyü Kaydet”i seç.");
  }

  async function shareStrip() {
    if (!lastCanvas.current) return;
    setShare({ state: "uploading" });
    try {
      const strip = await canvasToBlob(lastCanvas.current, "image/jpeg", 0.92);
      const { shareUrl } = await uploadSession({ strip });
      setShare({ state: "done", url: shareUrl });
    } catch (e) {
      setShare(null);
      toast("Yükleme olmadı: " + (e.message || "bağlantını kontrol et."));
    }
  }

  const aiBusy = busy && s.backdrop && s.backdrop !== "none" && !hasSamples;
  const note = aiBusy ? "Perde ekleniyor…" : hasSamples
    ? "Örnek şerit. Kendi fotoğraflarını ekleyince değişir."
    : full ? "Şeridin hazır." : `${userCount}/${s.count} kare hazır. Sıradaki: ${active.findIndex((q) => !q) + 1}. kare.`;

  return (
    <main>
      <section className="wrap hero">
        <span className="pill"><Icon name="heart" size={16} />Gerçek kabin baskısı gibi</span>
        <h1>Birkaç kare, <em>tek şerit.</em></h1>
        <p>Kabine gir, geri sayımla poz ver ya da galeriden seç. Fotoğrafların siyah-beyaz veya sepya tonlu, grenli bir photobooth şeridine dönüşsün; çekim videosu da QR ile telefonuna gelsin.</p>
      </section>

      <section className="wrap booth" id="booth" aria-label="Fotoğraf kabini">
        <div className="panel">
          <div className="step">
            <div className="step-head"><span className="step-num">1</span><span className="step-title">Fotoğrafları ekle</span></div>
            <div className="btn-row">
              <button className="btn primary" type="button" onClick={() => navigate("/booth")}>
                <Icon name="camera" />Fotoğraf çek
              </button>
              <button className="btn" type="button" onClick={() => { galRef.current.value = ""; galRef.current.click(); }}>
                <Icon name="image" />Galeriden seç
              </button>
            </div>
            <div className="slots">
              {active.map((q, i) => (
                <div className="slot-wrap" key={i}>
                  <button type="button" className={"slot" + (q ? " filled" : "")}
                    style={q ? { backgroundImage: `url("${q.thumb}")` } : undefined}
                    aria-label={`${i + 1}. kare: ${q ? "değiştir" : "fotoğraf seç"}`}
                    onClick={() => { slotTarget.current = i; slotRef.current.value = ""; slotRef.current.click(); }}>
                    <span className="n">{i + 1}</span>
                    {q && q.sample && <span className="tag">Örnek</span>}
                  </button>
                  {q && !q.sample && (
                    <button type="button" className="slot-x" aria-label={`${i + 1}. kareyi kaldır`} onClick={() => removeSlot(i)}>×</button>
                  )}
                </div>
              ))}
            </div>
            <p className="hint">
              {hasSamples
                ? "“Fotoğraf çek” kabini açar: geri sayımla çekim yapar ve videoyu da kaydeder. Galeriden eklediklerin örneklerin yerini alır."
                : "Bir kareye dokunup değiştirebilir, × ile kaldırabilirsin."}
            </p>
            <input ref={galRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            <input ref={slotRef} type="file" accept="image/*" hidden onChange={(e) => addFiles(e.target.files, slotTarget.current)} />
          </div>

          <SettingsPanel startNum={2} />

          <div className="btn-row">
            <button className="btn primary" type="button" disabled={!full} onClick={download}><Icon name="download" />{saveLabel("Şeridi")}</button>
            <button className="btn" type="button" onClick={() => update({ seed: (Math.random() * 1e9) | 0 })}><Icon name="refresh" />Yeni baskı</button>
            {sharingEnabled && (
              <button className="btn" type="button" disabled={!full || hasSamples || share?.state === "uploading"} onClick={shareStrip}>
                <Icon name="qr" />{share?.state === "uploading" ? "Yükleniyor…" : "QR ile paylaş"}
              </button>
            )}
          </div>
          {share?.state === "done" && <QrCard url={share.url} days={KEEP_DAYS} />}
        </div>

        <div className="table">
          {stripUrl && <img className={"strip-img" + (s.dir === "h" ? " h" : "") + (busy ? " busy" : "")} src={stripUrl} alt="Photobooth şeridi önizlemesi" />}
          <p className="table-note">{note}</p>
        </div>
      </section>

      <section className="wrap how" id="nasil">
        <h2>Nasıl çalışır</h2>
        <ol>
          <li><span className="k">1</span><b>2, 3 ya da 4 kare</b><p>Kare sayısını ve yönü seç, kabinde geri sayımla çek ya da galeriden ekle.</p></li>
          <li><span className="k">2</span><b>Kabin tonu</b><p>Kontrast, gren, köşe gölgesi ve kareden kareye hafif pozlama farkı eklenir.</p></li>
          <li><span className="k">3</span><b>QR ile al</b><p>Şerit ve çekim videosu linke yüklenir; QR'ı okutan telefonuna indirir.</p></li>
        </ol>
      </section>
    </main>
  );
}
