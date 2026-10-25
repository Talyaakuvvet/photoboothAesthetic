import { useEffect, useRef, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Booth from "./pages/Booth.jsx";
import Share from "./pages/Share.jsx";
import { Icon } from "./components/Icons.jsx";

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("vb-theme") === "dark" ? "dark" : "light"; } catch { return "light"; }
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("vb-theme", theme); } catch { /* ignore */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [toastMsg, setToastMsg] = useState("");
  const timer = useRef(0);
  const toast = (m) => { setToastMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setToastMsg(""), 3200); };
  const inBooth = useLocation().pathname.startsWith("/booth");

  return (
    <>
      {!inBooth && (
        <header className="top">
          <div className="wrap">
            <Link className="brand" to="/">
              <span className="brand-mark"><Icon name="camera" size={20} /></span>
              <span className="brand-name">Vintage Booth</span>
            </Link>
            <div className="top-right">
              <nav className="links" aria-label="Sayfa">
                <Link to="/booth">Kabin</Link>
                <a href="/#nasil">Nasıl çalışır</a>
              </nav>
              <button className="theme-btn" type="button" onClick={toggleTheme}
                aria-label={theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç"}>
                <Icon name={theme === "dark" ? "sun" : "moon"} size={19} />
              </button>
            </div>
          </div>
        </header>
      )}

      <Routes>
        <Route path="/" element={<Home toast={toast} />} />
        <Route path="/booth" element={<Booth />} />
        <Route path="/s/:id" element={<Share toast={toast} />} />
        <Route path="*" element={<Home toast={toast} />} />
      </Routes>

      {!inBooth && (
        <footer>
          <div className="wrap">
            <span>Vintage Booth</span>
            <span>Fotoğraflar cihazında işlenir; yalnızca QR ile paylaşmayı seçersen yüklenir.</span>
          </div>
        </footer>
      )}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </>
  );
}
