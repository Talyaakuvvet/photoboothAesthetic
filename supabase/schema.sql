-- Vintage Booth — Supabase setup
-- Supabase > SQL Editor > New query > paste all of this > Run

-- 1) Storage bucket for strips and videos
--    Public = a file opens only through its exact URL. Folder names are random
--    10-character ids, and there is no list policy, so nobody can browse others' files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('booth', 'booth', true, 52428800, array['image/jpeg', 'video/mp4', 'video/webm'])
on conflict (id) do nothing;

-- Visitors may only ADD new files. No select/update/delete policy:
-- they can't list, overwrite or delete anything.
drop policy if exists "booth: anyone can upload" on storage.objects;
create policy "booth: anyone can upload"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'booth');

-- 2) One row per shared session
create table if not exists public.sessions (
  id          text primary key check (char_length(id) between 8 and 32),
  strip_path  text not null,
  video_path  text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days'
);
alter table public.sessions enable row level security;

drop policy if exists "sessions: anyone can insert" on public.sessions;
create policy "sessions: anyone can insert"
  on public.sessions for insert to anon, authenticated
  with check (
    expires_at <= now() + interval '91 days'
    and strip_path = id || '/strip.jpg'
    and (video_path is null or video_path in (id || '/video.mp4', id || '/video.webm'))
  );
-- No select policy on purpose: rows can't be listed.
-- The share page reads exactly one row through this function:

create or replace function public.get_session(sid text)
returns table (id text, strip_path text, video_path text, created_at timestamptz, expires_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select s.id, s.strip_path, s.video_path, s.created_at, s.expires_at
  from public.sessions s
  where s.id = sid and s.expires_at > now();
$$;

revoke all on function public.get_session(text) from public;
grant execute on function public.get_session(text) to anon, authenticated;
