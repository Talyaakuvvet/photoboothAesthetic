import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Icon } from "../components/Icons.jsx";
import { saveBlob } from "../lib/strip.js";
import { getSession } from "../lib/supabase.js";

const fmt = (iso) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });

async function downloadUrl(url, name) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("download");
  saveBlob(await res.blob(), name);
}

export default function Share({ toast }) {
  const { id } = useParams();
  const [state, setState] = useState({ status: "loading" });
  const [horiz, setHoriz] = useState(false);

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
  const dl = (url, name) => downloadUrl(url, name).catch(() => toast("İndirilemedi. Görsele basılı tutarak kaydedebilirsin."));

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
            <button className="btn primary" type="button" onClick={() => dl(row.stripUrl, "photobooth-serit.jpg")}><Icon name="download" />Şeridi indir</button>
            {row.videoUrl && <button className="btn" type="button" onClick={() => dl(row.videoUrl, `photobooth-video.${ext}`)}><Icon name="video" />Videoyu indir</button>}
          </div>
          <p className="hint">iPhone'da videoyu açıp paylaş menüsünden “Videoyu Kaydet” ile Fotoğraflar'a ekleyebilirsin.</p>
        </div>
      </div>
    </main>
  );
}
