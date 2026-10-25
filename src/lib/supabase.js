import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const BUCKET = "booth";
export const KEEP_DAYS = Number(import.meta.env.VITE_KEEP_DAYS || 30);

export const supabase = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
export const sharingEnabled = Boolean(supabase);

// 10 chars from a 62-letter alphabet: unguessable enough for share links.
export function newId(len = 10) {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

const extFor = (type) => (type.includes("mp4") ? "mp4" : "webm");

/**
 * Upload a strip (and optional video) and register a share session.
 * Returns { id, shareUrl }.
 */
export async function uploadSession({ strip, video }) {
  if (!supabase) throw new Error("Paylaşım kapalı: Supabase ayarları eksik.");
  const id = newId();
  const stripPath = `${id}/strip.jpg`;
  const up1 = await supabase.storage.from(BUCKET).upload(stripPath, strip, { contentType: "image/jpeg", upsert: false });
  if (up1.error) throw up1.error;

  let videoPath = null;
  if (video) {
    const type = (video.type || "video/webm").split(";")[0];
    videoPath = `${id}/video.${extFor(type)}`;
    const up2 = await supabase.storage.from(BUCKET).upload(videoPath, video, { contentType: type, upsert: false });
    if (up2.error) throw up2.error;
  }

  const expires = new Date(Date.now() + KEEP_DAYS * 864e5).toISOString();
  const ins = await supabase.from("sessions").insert({ id, strip_path: stripPath, video_path: videoPath, expires_at: expires });
  if (ins.error) throw ins.error;

  return { id, shareUrl: `${window.location.origin}/s/${id}` };
}

/** Fetch one session by id through the get_session function (rows are not listable). */
export async function getSession(id) {
  if (!supabase) throw new Error("Paylaşım kapalı: Supabase ayarları eksik.");
  const { data, error } = await supabase.rpc("get_session", { sid: id });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const pub = (p) => (p ? supabase.storage.from(BUCKET).getPublicUrl(p).data.publicUrl : null);
  return { ...row, stripUrl: pub(row.strip_path), videoUrl: pub(row.video_path) };
}
