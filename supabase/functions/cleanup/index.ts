// Deletes expired sessions: their files in the "booth" bucket and their rows.
// Deploy:  supabase functions deploy cleanup
// Schedule: run supabase/cron.sql once (daily at 04:00).
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let total = 0;

  for (let round = 0; round < 20; round++) {
    const { data, error } = await sb
      .from("sessions")
      .select("id, strip_path, video_path")
      .lt("expires_at", new Date().toISOString())
      .limit(200);
    if (error) return new Response(error.message, { status: 500 });
    if (!data || data.length === 0) break;

    const paths = data.flatMap((r) => [r.strip_path, r.video_path].filter(Boolean)) as string[];
    const rm = await sb.storage.from("booth").remove(paths);
    if (rm.error) return new Response(rm.error.message, { status: 500 });

    const del = await sb.from("sessions").delete().in("id", data.map((r) => r.id));
    if (del.error) return new Response(del.error.message, { status: 500 });
    total += data.length;
  }

  return Response.json({ deleted: total });
});
