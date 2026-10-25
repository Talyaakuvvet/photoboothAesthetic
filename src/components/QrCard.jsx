import { useEffect, useState } from "react";
import QRCode from "qrcode";

export default function QrCard({ url, days }) {
  const [img, setImg] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(url, { width: 520, margin: 1, color: { dark: "#3b2230", light: "#ffffff" } }).then(setImg);
  }, [url]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  return (
    <div className="qr-card">
      {img ? <img src={img} alt="Şerit ve videonun linki için QR kod" className="qr-img" /> : <div className="qr-img qr-wait" />}
      <div className="qr-text">
        <b>Telefonla okut</b>
        <p>Şerit ve çekim videosu bu linkte. {days} gün sonra otomatik silinir.</p>
        <div className="qr-link">
          <code>{url.replace(/^https?:\/\//, "")}</code>
          <button type="button" className="chip" onClick={copy}>{copied ? "Kopyalandı" : "Kopyala"}</button>
        </div>
      </div>
    </div>
  );
}
