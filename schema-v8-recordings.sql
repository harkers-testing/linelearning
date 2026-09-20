-- Line Learning App — schema v8: adds self-recording ("Actor A records
-- their own lines and plays them back"). This is a DELTA script, not a
-- full rebuild like schema.sql: run this ONE FILE, once, in the Supabase
-- dashboard's SQL Editor (same place as always) AFTER schema.sql (v7) is
-- already in place. It only ADDS a new table and a new function — it does
-- NOT touch groups/shows/scripts/script_lines/parts, so nothing you
-- already have (shows, uploaded scripts, cast assignments) is affected or
-- wiped. schema.sql itself has also been updated to include this same
-- block at the end, so a brand-new install (running schema.sql alone,
-- from scratch) still gets it — but if you already have a working
-- database, run THIS file instead of re-running schema.sql, precisely so
-- today's recordings (and everything else) survive future updates.
--
-- What this adds, in plain terms:
-- - A "recording" is one actor's own spoken take of one line of their own
--   dialogue. Recorded in the browser (using the microphone), saved here
--   as the audio itself (not a separate file store — see the comment on
--   the table below for why), and playable back by anyone who can already
--   read that show's script.
-- - Only the person who currently holds a character's part can record
--   that character's lines — matching how everything else in this app is
--   scoped to "your own claimed part."
-- - Re-recording a line simply replaces the previous take; there's no
--   history of old takes kept (matches the plan already written down in
--   product-spec.md section 6.3: "the newest take is what everyone
--   hears").
--
-- IMPORTANT design note — why a recording is matched by the line's exact
-- WORDING (show + character + line_text) rather than by script_lines.id:
-- every time a script is saved — uploading a new one, OR using "Edit this
-- scene" / "Include previous/next scene" on an already-saved one —
-- save_script deletes every row in script_lines and reinserts them fresh
-- (see schema.sql). That means script_lines.id is NOT a stable, permanent
-- ID for "this one line" — it's thrown away and recreated on every save,
-- even for lines nobody touched. If a recording were tied to that ID, an
-- admin fixing a typo in one scene would silently wipe out every OTHER
-- recorded line in the whole script the moment they hit Save, since
-- everything downstream gets a new ID at the same time. Matching on the
-- line's actual text instead means: a line whose wording didn't change
-- keeps its recording (even though its underlying row got recreated,
-- possibly in a different scene or with a different scene_seq), and a
-- line whose wording DID change correctly loses its old recording, since
-- that recording is of words that no longer appear in the script — which
-- is the right behavior anyway (the actor would need to re-record it to
-- match the new wording). Known, accepted trade-off: if the very same
-- character says the exact same line word-for-word more than once in the
-- script (a repeated refrain), one recording covers all of those
-- occurrences rather than each having its own — an edge case worth
-- knowing about, not worth the extra complexity of solving until it
-- actually comes up.

-- A recording holds the audio itself as text (base64-encoded), not a
-- pointer to a separate file-storage system. Deliberate for a first
-- version: it means recordings work with exactly the same "one script,
-- run it in the SQL editor" setup Andy already uses for everything else
-- here, with no separate storage bucket or access-policy language to set
-- up on top. A single spoken line is a small amount of audio (a handful
-- of seconds), so even a fully-recorded script stays well within normal
-- database limits — this can be revisited later if that ever stops being
-- true, but isn't a real concern at this app's current scale.
create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  character_name text not null,
  line_text text not null,
  audio_data text not null,
  mime_type text not null,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (show_id, character_name, line_text)
);

alter table public.recordings enable row level security;

-- No direct inserts/updates/deletes — only through save_line_recording
-- below, which checks the caller actually holds that character's part.
revoke insert, update, delete on public.recordings from authenticated;
grant select on public.recordings to authenticated;

-- Visible to that show's admin (so a director can eventually see who's
-- recorded what) or any of its cast members (so a scene partner can
-- eventually hear another actor's recorded lines) — same visibility rule
-- as the script itself. Reuses is_show_admin/is_show_member from
-- schema.sql rather than repeating the subquery (see the big comment
-- above those functions for why that matters).
create policy "admins and cast can view a show's recordings"
  on public.recordings for select
  using (public.is_show_admin(recordings.show_id) or public.is_show_member(recordings.show_id));

-- Record (or re-record) one line. audio_base64 is the raw recording,
-- base64-encoded in the browser before sending — plugs straight into an
-- <audio> element's src as a "data:" URL on the way back out, with no
-- decoding step needed on either side.
create or replace function public.save_line_recording(
  target_show_id uuid,
  target_character_name text,
  target_line_text text,
  audio_base64 text,
  audio_mime_type text
)
returns public.recordings
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.recordings;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to record a line';
  end if;

  if not exists (
    select 1 from public.parts p
    where p.show_id = target_show_id
      and p.character_name = target_character_name
      and p.claimed_by = auth.uid()
  ) then
    raise exception 'You can only record lines for a character you have claimed yourself';
  end if;

  if coalesce(audio_base64, '') = '' then
    raise exception 'No recording was captured';
  end if;

  insert into public.recordings (show_id, character_name, line_text, audio_data, mime_type, recorded_by)
  values (target_show_id, target_character_name, target_line_text, audio_base64, audio_mime_type, auth.uid())
  on conflict (show_id, character_name, line_text)
  do update set
    audio_data = excluded.audio_data,
    mime_type = excluded.mime_type,
    recorded_by = excluded.recorded_by,
    updated_at = now()
  returning * into saved;

  return saved;
end;
$$;

grant execute on function public.save_line_recording(uuid, text, text, text, text) to authenticated;
