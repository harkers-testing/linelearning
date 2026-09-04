-- Line Learning App — schema v3: adds scripts (the parsed play text) and
-- parts (one shareable invite code per character, so a director can assign
-- a role to a specific actor before that actor has even joined the app).
--
-- This is additive on top of v2 (groups + shows) — nothing about groups or
-- shows changes. Run the whole file, in full, the same way as always:
-- Supabase dashboard -> SQL Editor -> New query -> paste this whole file in
-- -> Run. This still starts by dropping everything so it can be re-run
-- cleanly from scratch — fine while this is still early testing with no
-- real cast members relying on it yet.
--
-- What's new, in plain terms:
-- - A "script" is the parsed text of one show's PDF — one script per show.
--   Only that show's admin can upload/replace it.
-- - A "part" is one character from that script, together with its own
--   personal invite code. The director shares that one code/link directly
--   with the actor playing that character (by text, email, however they
--   like) — entering it both joins the show AND assigns that character to
--   them, in one step. Our own database never stores the actor's email or
--   phone number anywhere — that link is built and sent entirely on the
--   director's own phone, outside this app.
-- - Uploading a script automatically creates a "part" row (with its own
--   ready-to-share code) for every character found — the director doesn't
--   need a separate step to create each one, just to hand them out.
-- - Cast members can only ever see the part they themselves have claimed,
--   never anyone else's — the director is the only one who can see the
--   full list (so they know who's still unassigned).

drop function if exists public.unassign_part(uuid);
drop function if exists public.claim_part_by_code(text);
drop function if exists public.save_script(uuid, text, text[], jsonb);
drop function if exists public.create_group(text);
drop function if exists public.create_show(uuid, text);
drop function if exists public.join_show_by_code(text);
drop function if exists public.join_group_by_code(text);

drop table if exists public.parts;
drop table if exists public.script_lines;
drop table if exists public.scripts;
drop table if exists public.show_members;
drop table if exists public.shows;
drop table if exists public.group_members;
drop table if exists public.groups;

create extension if not exists pgcrypto;

-- A theatre/company account. Cast members never query this table.
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- One production, belonging to one group.
create table public.shows (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  invite_code text not null unique default substr(md5(random()::text), 1, 8),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- Cast members of a specific show (anyone who has joined it, however they
-- joined — by the show's general code, or by claiming a specific part).
create table public.show_members (
  show_id uuid not null references public.shows(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (show_id, user_id)
);

-- The parsed script for a show. One per show — uploading a new one replaces
-- the old one entirely (see save_script below).
create table public.scripts (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null unique references public.shows(id) on delete cascade,
  file_name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- Every heading/direction/line of dialogue in the script, in order. Stored
-- now so future work (recording lines, running a scene) doesn't need to
-- re-parse or re-upload anything.
create table public.script_lines (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references public.scripts(id) on delete cascade,
  seq_index int not null,
  line_type text not null,       -- 'heading' | 'direction' | 'line' | 'unassigned'
  character_name text,           -- set only when line_type = 'line'
  line_text text not null default ''
);

-- One row per character found in a show's script, each with its own
-- shareable invite code. Created automatically when a script is uploaded.
create table public.parts (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  character_name text not null,
  invite_code text not null unique default substr(md5(random()::text), 1, 8),
  claimed_by uuid references auth.users(id),
  claimed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (show_id, character_name)
);

alter table public.groups enable row level security;
alter table public.shows enable row level security;
alter table public.show_members enable row level security;
alter table public.scripts enable row level security;
alter table public.script_lines enable row level security;
alter table public.parts enable row level security;

-- No direct inserts/updates/deletes anywhere — only through the functions
-- below, each of which does its own admin/membership checks.
revoke insert, update, delete on public.groups from authenticated;
revoke insert, update, delete on public.shows from authenticated;
revoke insert, update, delete on public.show_members from authenticated;
revoke insert, update, delete on public.scripts from authenticated;
revoke insert, update, delete on public.script_lines from authenticated;
revoke insert, update, delete on public.parts from authenticated;
grant select on public.groups to authenticated;
grant select on public.shows to authenticated;
grant select on public.show_members to authenticated;
grant select on public.scripts to authenticated;
grant select on public.script_lines to authenticated;
grant select on public.parts to authenticated;

-- Only a group's own admin can see that group's row.
create policy "admins can view their own groups"
  on public.groups for select
  using (created_by = auth.uid());

-- A show is visible to its parent group's admin, or anyone who has
-- joined it as a cast member.
create policy "admins and cast can view their shows"
  on public.shows for select
  using (
    exists (select 1 from public.groups g where g.id = shows.group_id and g.created_by = auth.uid())
    or exists (select 1 from public.show_members sm where sm.show_id = shows.id and sm.user_id = auth.uid())
  );

-- Membership rows are visible to that show's admin, or to any of that
-- show's own members (kept simple for now — a cast member can currently
-- see the full member list of a show they're in, not just their own row).
create policy "admins and cast can view show membership"
  on public.show_members for select
  using (
    exists (
      select 1 from public.shows s
      join public.groups g on g.id = s.group_id
      where s.id = show_members.show_id and g.created_by = auth.uid()
    )
    or exists (
      select 1 from public.show_members sm2
      where sm2.show_id = show_members.show_id and sm2.user_id = auth.uid()
    )
  );

-- A show's script is visible to its admin or any of its cast members (cast
-- will need to read line text once recording/rehearsing screens exist).
create policy "admins and cast can view a show's script"
  on public.scripts for select
  using (
    exists (
      select 1 from public.shows s
      join public.groups g on g.id = s.group_id
      where s.id = scripts.show_id and g.created_by = auth.uid()
    )
    or exists (
      select 1 from public.show_members sm
      where sm.show_id = scripts.show_id and sm.user_id = auth.uid()
    )
  );

create policy "admins and cast can view a show's script lines"
  on public.script_lines for select
  using (
    exists (
      select 1 from public.scripts sc
      join public.shows s on s.id = sc.show_id
      join public.groups g on g.id = s.group_id
      where sc.id = script_lines.script_id and g.created_by = auth.uid()
    )
    or exists (
      select 1 from public.scripts sc
      join public.show_members sm on sm.show_id = sc.show_id
      where sc.id = script_lines.script_id and sm.user_id = auth.uid()
    )
  );

-- A show's admin can see every part (so they know who's still unassigned).
create policy "admins can view all parts in their shows"
  on public.parts for select
  using (
    exists (
      select 1 from public.shows s
      join public.groups g on g.id = s.group_id
      where s.id = parts.show_id and g.created_by = auth.uid()
    )
  );

-- A cast member can only ever see the part they themselves have claimed —
-- never anyone else's, and never one still unclaimed.
create policy "members can view their own claimed part"
  on public.parts for select
  using (claimed_by = auth.uid());

-- Create a new group (a theatre/company account). Open to any signed-in
-- person for now — see the note at the top of this file about tightening
-- this later.
create or replace function public.create_group(group_name text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  new_group public.groups;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to create a group';
  end if;

  insert into public.groups (name, created_by)
  values (group_name, auth.uid())
  returning * into new_group;

  return new_group;
end;
$$;

-- Create a new show inside a group. Only that group's admin can do this.
create or replace function public.create_show(group_id uuid, show_name text)
returns public.shows
language plpgsql
security definer
set search_path = public
as $$
declare
  new_show public.shows;
begin
  if not exists (
    select 1 from public.groups g
    where g.id = create_show.group_id and g.created_by = auth.uid()
  ) then
    raise exception 'Only that group''s admin can create a show in it';
  end if;

  insert into public.shows (group_id, name, created_by)
  values (create_show.group_id, show_name, auth.uid())
  returning * into new_show;

  insert into public.show_members (show_id, user_id)
  values (new_show.id, auth.uid());

  return new_show;
end;
$$;

-- Join a show as a cast member, using its general invite code (for anyone
-- without one specific assigned part — an assistant director, tech crew,
-- and so on). A person can join any number of different shows this way.
create or replace function public.join_show_by_code(code text)
returns public.shows
language plpgsql
security definer
set search_path = public
as $$
declare
  target_show public.shows;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to join a show';
  end if;

  select * into target_show from public.shows where invite_code = code;

  if target_show.id is null then
    raise exception 'No show found for that invite code';
  end if;

  insert into public.show_members (show_id, user_id)
  values (target_show.id, auth.uid())
  on conflict do nothing;

  return target_show;
end;
$$;

-- Upload (or replace) a show's script. Only that show's admin can do this.
-- character_names is the final, admin-reviewed list of character names;
-- lines is the full parsed sequence as a JSON array of
-- {seq_index, type, character_name, text} objects. Replacing a script
-- keeps the existing invite code and claim for any character name that
-- still appears in the new script (so an actor's link keeps working),
-- drops parts for characters no longer present, and creates a fresh part
-- (with a new code) for every newly-found character name.
create or replace function public.save_script(
  target_show_id uuid,
  script_file_name text,
  character_names text[],
  lines jsonb
)
returns setof public.parts
language plpgsql
security definer
set search_path = public
as $$
declare
  new_script_id uuid;
  cname text;
begin
  if not exists (
    select 1 from public.shows s
    join public.groups g on g.id = s.group_id
    where s.id = target_show_id and g.created_by = auth.uid()
  ) then
    raise exception 'Only that show''s admin can upload its script';
  end if;

  delete from public.scripts where show_id = target_show_id;

  insert into public.scripts (show_id, file_name, created_by)
  values (target_show_id, script_file_name, auth.uid())
  returning id into new_script_id;

  insert into public.script_lines (script_id, seq_index, line_type, character_name, line_text)
  select
    new_script_id,
    (elem->>'seq_index')::int,
    elem->>'type',
    elem->>'character_name',
    coalesce(elem->>'text', '')
  from jsonb_array_elements(lines) as elem;

  -- drop parts for characters no longer in the script
  delete from public.parts
  where show_id = target_show_id
    and character_name <> all(character_names);

  -- add a part (with its own fresh invite code) for every character name
  -- that doesn't already have one
  foreach cname in array character_names loop
    insert into public.parts (show_id, character_name, created_by)
    select target_show_id, cname, auth.uid()
    where not exists (
      select 1 from public.parts p
      where p.show_id = target_show_id and p.character_name = cname
    );
  end loop;

  return query select * from public.parts where show_id = target_show_id order by character_name;
end;
$$;

-- Claim a part using its personal invite code. This both assigns that
-- character to the caller AND joins them to the show, in one step.
create or replace function public.claim_part_by_code(code text)
returns public.parts
language plpgsql
security definer
set search_path = public
as $$
declare
  target_part public.parts;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to claim a part';
  end if;

  select * into target_part from public.parts where invite_code = code;

  if target_part.id is null then
    raise exception 'No part found for that code';
  end if;

  if target_part.claimed_by is not null and target_part.claimed_by <> auth.uid() then
    raise exception 'This part has already been claimed by someone else';
  end if;

  update public.parts
  set claimed_by = auth.uid(), claimed_at = now()
  where id = target_part.id
  returning * into target_part;

  insert into public.show_members (show_id, user_id)
  values (target_part.show_id, auth.uid())
  on conflict do nothing;

  return target_part;
end;
$$;

-- Free up a part so it can be handed to someone else (the director assigned
-- the wrong person, an actor dropped out, etc). Only that show's admin can
-- do this. Issues a brand new invite code at the same time, so the old
-- link stops working.
create or replace function public.unassign_part(part_id uuid)
returns public.parts
language plpgsql
security definer
set search_path = public
as $$
declare
  target_part public.parts;
begin
  select * into target_part from public.parts where id = part_id;

  if target_part.id is null then
    raise exception 'Part not found';
  end if;

  if not exists (
    select 1 from public.shows s
    join public.groups g on g.id = s.group_id
    where s.id = target_part.show_id and g.created_by = auth.uid()
  ) then
    raise exception 'Only that show''s admin can unassign a part';
  end if;

  update public.parts
  set claimed_by = null,
      claimed_at = null,
      invite_code = substr(md5(random()::text || clock_timestamp()::text), 1, 8)
  where id = part_id
  returning * into target_part;

  return target_part;
end;
$$;

grant execute on function public.create_group(text) to authenticated;
grant execute on function public.create_show(uuid, text) to authenticated;
grant execute on function public.join_show_by_code(text) to authenticated;
grant execute on function public.save_script(uuid, text, text[], jsonb) to authenticated;
grant execute on function public.claim_part_by_code(text) to authenticated;
grant execute on function public.unassign_part(uuid) to authenticated;
