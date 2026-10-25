import { createContext, useContext, useEffect, useState } from "react";
import { DEFAULT_SETTINGS, todayLabel } from "./strip.js";

const Ctx = createContext(null);
const KEY = "vb-settings";

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      // the date chip should always start from today
      return saved ? { ...DEFAULT_SETTINGS, ...saved, captionText: saved.captionText || todayLabel() } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  }, [settings]);
  const update = (patch) => setSettings((s) => ({ ...s, ...patch }));
  return <Ctx.Provider value={{ settings, update }}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx);
