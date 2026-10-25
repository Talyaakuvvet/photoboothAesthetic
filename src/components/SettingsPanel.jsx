import { FONTS, todayLabel } from "../lib/strip.js";
import { useSettings } from "../lib/settings.jsx";

function Seg({ label, value, options, onChange }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" aria-pressed={String(value === o.v)} onClick={() => onChange(o.v)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

const Shape = ({ v }) => (
  <span className={"shape" + (v ? " v" : "")} aria-hidden="true">
    <i /><i /><i />
  </span>
);
const Swatch = ({ bg }) => <span className="swatch" style={{ background: bg }} />;

/** Layout, tone, paper and caption controls. `startNum` sets the first step number. */
export default function SettingsPanel({ startNum = 2 }) {
  const { settings: s, update } = useSettings();
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0"), mm = String(now.getMonth() + 1).padStart(2, "0"), yy = String(now.getFullYear());
  const quick = [todayLabel(now), `${dd}.${mm}.${yy}`, `'${yy.slice(2)} ${mm} ${dd}`];

  return (
    <>
      <div className="step">
        <div className="step-head"><span className="step-num">{startNum}</span><span className="step-title">Düzen</span></div>
        <div className="row2">
          <Seg label="Kare sayısı" value={s.count} onChange={(v) => update({ count: v })}
            options={[{ v: 2, label: "2'li" }, { v: 3, label: "3'lü" }, { v: 4, label: "4'lü" }]} />
          <Seg label="Yön" value={s.dir} onChange={(v) => update({ dir: v })}
            options={[{ v: "v", label: "Dikey", icon: <Shape v /> }, { v: "h", label: "Yatay", icon: <Shape /> }]} />
        </div>
      </div>

      <div className="step">
        <div className="step-head"><span className="step-num">{startNum + 1}</span><span className="step-title">Ton</span></div>
        <Seg label="Ton" value={s.tone} onChange={(v) => update({ tone: v })}
          options={[
            { v: "bw", label: "Siyah-beyaz", icon: <Swatch bg="linear-gradient(135deg,#eee,#222)" /> },
            { v: "sepia", label: "Sepya", icon: <Swatch bg="linear-gradient(135deg,#eadcc0,#3a2a1c)" /> },
            { v: "faded", label: "Soluk renk", icon: <Swatch bg="linear-gradient(135deg,#e7c9b4,#5b6f7c)" /> },
          ]} />
      </div>

      <div className="step">
        <div className="step-head">
          <span className="step-num">{startNum + 2}</span><span className="step-title">Arka plan</span>
          <span className="ai-tag">Yapay zeka</span>
        </div>
        <Seg label="Arka plan" value={s.backdrop || "none"} onChange={(v) => update({ backdrop: v })}
          options={[
            { v: "none", label: "Orijinal" },
            { v: "white", label: "Beyaz perde", icon: <Swatch bg="repeating-linear-gradient(90deg,#fbfaf7 0 3px,#d6d1c7 3px 6px)" /> },
            { v: "cream", label: "Krem perde", icon: <Swatch bg="repeating-linear-gradient(90deg,#f1e6d1 0 3px,#c9b592 3px 6px)" /> },
            { v: "black", label: "Siyah perde", icon: <Swatch bg="repeating-linear-gradient(90deg,#34302d 0 3px,#0d0c0c 3px 6px)" /> },
          ]} />
        {s.backdrop && s.backdrop !== "none" && (
          <p className="hint">Kişiyi arka plandan ayırıp arkasına kabin perdesi koyar. Cihazında çalışır, ilk seferde birkaç saniye sürebilir. En iyi sonucu tek ya da iki kişilik, beli yukarı karelerde verir.</p>
        )}
      </div>

      <div className="step">
        <div className="step-head"><span className="step-num">{startNum + 3}</span><span className="step-title">Kağıt ve yazı</span></div>
        <div className="row2">
          <Seg label="Kağıt rengi" value={s.paper} onChange={(v) => update({ paper: v })}
            options={[{ v: "white", label: "Beyaz", icon: <Swatch bg="#ffffff" /> }, { v: "black", label: "Siyah", icon: <Swatch bg="#050505" /> }]} />
          <label className="toggle">
            <input type="checkbox" checked={s.aged} onChange={(e) => update({ aged: e.target.checked })} />
            <span className="sw" />Eskitme
          </label>
          <label className="toggle">
            <input type="checkbox" checked={s.caption} onChange={(e) => update({ caption: e.target.checked })} />
            <span className="sw" />Yazı ekle
          </label>
        </div>
        {s.caption && (
          <div className="cap-box">
            <input className="text-in" type="text" maxLength={40} aria-label="Şeride yazılacak metin"
              placeholder="Tarih, isim ya da bir not" value={s.captionText}
              onChange={(e) => update({ captionText: e.target.value })} />
            <div className="chips">
              <span className="lbl">Hızlı:</span>
              {quick.map((t) => (
                <button key={t} type="button" className="chip" onClick={() => update({ captionText: t })}>{t}</button>
              ))}
            </div>
            <Seg label="Yazının yeri" value={s.capPos} onChange={(v) => update({ capPos: v })}
              options={[{ v: "top", label: "Üstte" }, { v: "bottom", label: "Altta" }]} />
            <div className="fonts" role="group" aria-label="Yazı tipi">
              {Object.entries(FONTS).map(([k, f]) => (
                <button key={k} type="button" className="font-btn" aria-pressed={String(s.capFont === k)} onClick={() => update({ capFont: k })}>
                  <span className="smp" style={{ font: `${f.style} ${f.weight} 1.25rem "${f.family}", ${f.fb}` }}>Ekim 2026</span>
                  <span className="nm">{f.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
