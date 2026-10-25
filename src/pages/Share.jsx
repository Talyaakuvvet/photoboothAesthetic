import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Icon } from "../components/Icons.jsx";
import { isIOS, saveLabel, saveToDevice } from "../lib/strip.js";
import { getSession } from "../lib/supabase.js";

const fmt = (iso) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });

const fetchBlob = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("download");
  return res.blob();
};

export default function Share({ toast }) {
  const { id } = useParams();
  const [state, setState] = useState({ status: "loading" });
  const [horiz, setHoriz] = useState(false);
  // fetch the files up front: iOS only opens the save sheet if the file is ready at tap time
  const blobs = useRef({});
  useEffect(() => {
    if (state.status !== "ok") return;
    const { stripUrl, videoUrl } = state.row;
    fetchBlob(stripUrl).then((b) => (blobs.current.strip = b)).catch(() => {});
    if (videoUrl) fetchBlob(videoUrl).then((b) => (blobs.current.video = b)).catch(() => {});
  }, [state]);

  useEffect(() => {
    let alive = true;
    getSession(id)
      .then((row) => alive && setState(row ? { status: "ok", row } : { status: "missing" }))
      .catch(() => alive && setState({ status: "error" }));
    return () => { alive = false; };
  }, [id]);

  if (state.status === "loading") return <main className="wrap share"><p className="hint">Yükleniyor…</p></main>;
  if (state.status !== "ok") {
    return (
      <main className="wrap share share-empty">
        <h1>{state.status === "missing" ? "Bu link artık yok" : "Açılamadı"}</h1>
        <p>{state.status === "missing" ? "Linkin süresi dolmuş ya da yanlış yazılmış olabilir." : "Bağlantını kontrol edip sayfayı yenile."}</p>
        <Link className="btn primary" to="/"><Icon name="camera" />Kendi şeridini yap</Link>
      </main>
    );
  }

  const { row } = state;
  const ext = row.video_path?.endsWith(".mp4") ? "mp4" : "webm";
  const dl = (key, url, name) => {
    const ready = blobs.current[key];
    const p = ready ? saveToDevice(ready, name) : fetchBlob(url).then((b) => saveToDevice(b, name));
    p.catch(() => toast("Kaydedilemedi. Görsele basılı tutarak kaydedebilirsin."));
  };

  return (
    <main className="wrap share">
      <header className="share-head">
        <span className="pill"><Icon name="heart" size={16} />Photobooth anın</span>
        <h1>Şeridin ve <em>çekim videon</em></h1>
        <p className="hint">{fmt(row.created_at)} · {fmt(row.expires_at)} tarihine kadar burada.</p>
      </header>
      <div className="share-grid">
        <div className="table">
          <img className={"strip-img" + (horiz ? " h" : "")} src={row.stripUrl} alt="Photobooth şeridi"
            onLoad={(e) => setHoriz(e.currentTarget.naturalWidth > e.currentTarget.naturalHeight)} />
        </div>
        <div className="share-side">
          {row.videoUrl && <video className="bs-result-video" src={row.videoUrl} autoPlay muted loop playsInline controls />}
          <div className="btn-row">
            <button className="btn primary" type="button" onClick={() => dl("strip", row.stripUrl, "photobooth-serit.jpg")}><Icon name="download" />{saveLabel("Şeridi")}</button>
            {row.videoUrl && <button className="btn" type="button" onClick={() => dl("video", row.videoUrl, `photobooth-video.${ext}`)}><Icon name="video" />{saveLabel("Videoyu")}</button>}
          </div>
          {isIOS() && <p className="hint">Açılan menüde “Görüntüyü Kaydet” ya da “Videoyu Kaydet”e bas, Fotoğraflar'a gelir.</p>}
        </div>
      </div>
    </main>
  );
}
