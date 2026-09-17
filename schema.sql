-- Line Learning App — schema v6: adds what G1.5 needs for the cast
-- member's own "My Part" screen — a personal cue_lookback_lines setting on
-- show_members (1 or 2 lines of "who says what before mine", chosen by
-- each actor for themselves, not the director) plus set_cue_lookback to
-- change it safely. Everything from v3 (scripts/parts), v4 (the
-- is_show_admin/is_show_member fix for "infinite recursion detected in
-- policy for relation shows"), and v5 (the shows_public view that keeps a
-- show's general invite code hidden from anyone but its admin) is still
-- here unchanged below.
--
-- This is additive on top of v2 (groups + shows) — nothing about groups or
-- shows changes structurally. Run the whole file, in full, the same way as always:
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

-- CASCADE on every drop below is deliberate: an older run of this file (or
-- an even earlier version, before this file existed in its current form)
-- may have left behind a policy, view, or constraint on one of these
-- objects that a plain DROP refuses to touch — Postgres's own safety net
-- against accidentally breaking something that depends on it. Since this
-- script immediately rebuilds everything from scratch right below, there's
-- nothing to protect here: CASCADE just clears out whatever's left, old
-- policy names and all, rather than stopping partway through with an error
-- like "cannot drop table group_members because other objects depend on
-- it." Safe specifically because this is still pre-launch prototyping with
-- no real cast data to lose — don't remove CASCADE later without checking
-- that's still true.
drop function if exists public.unassign_part(uuid) cascade;
drop function if exists public.claim_part_by_code(text) cascade;
drop function if exists public.save_script(uuid, text, text[], jsonb) cascade;
drop function if exists public.create_group(text) cascade;
drop function if exists public.create_show(uuid, text) cascade;
drop function if exists public.join_show_by_code(text) cascade;
drop function if exists public.join_group_by_code(text) cascade;
drop function if exists public.is_show_admin(uuid) cascade;
drop function if exists public.is_show_member(uuid) cascade;
drop function if exists public.set_cue_lookback(uuid, smallint) cascade;
drop view if exists public.shows_public cascade;

drop table if exists public.parts cascade;
drop table if exists public.script_lines cascade;
drop table if exists public.scripts cascade;
drop table if exists public.show_members cascade;
drop table if exists public.shows cascade;
drop table if exists public.group_members cascade;
drop table if exists public.groups cascade;

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
  -- How many lines of "who says what before mine" this person wants to see
  -- on their own "My Part" screen, added for the cast-member script view
  -- (G1.5). Deliberately per person, per show — not a show-wide setting —
  -- since Andy specifically wants this to be each actor's own choice.
  cue_lookback_lines smallint not null default 1 check (cue_lookback_lines in (1, 2)),
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

-- Helper functions for the policies below. Why these exist: "shows" and
-- "show_members" each need to check the other table to decide what's
-- visible (a show is visible to its members; a membership row is visible to
-- people who can see the show). Writing that as a plain subquery creates a
-- loop — checking a show re-checks show_members, which re-checks shows,
-- which re-checks show_members, forever — and Postgres stops with
-- "infinite recursion detected in policy for relation ...". This is exactly
-- the error Andy hit live (2026-09-09): it also silently broke opening a
-- show, loading "Your shows", and a personal part link finishing its
-- automatic join, since all of those read from "shows" or "show_members"
-- under the hood.
--
-- The fix: these two functions are marked `security definer`, which makes
-- their own internal table reads run as this schema's owner rather than as
-- the signed-in visitor — and table owners aren't subject to their own
-- table's row-level security by default. So calling one of these from
-- inside a policy answers the question ("is this person a member of this
-- show?") without re-triggering that other table's policy and looping.
-- Any future policy that would otherwise need to check show membership or
-- show-admin status should call these, not repeat the subquery directly.
create or replace function public.is_show_admin(target_show_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.shows s
    join public.groups g on g.id = s.group_id
    where s.id = target_show_id and g.created_by = auth.uid()
  );
$$;

create or replace function public.is_show_member(target_show_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.show_members sm
    where sm.show_id = target_show_id and sm.user_id = auth.uid()
  );
$$;

grant execute on function public.is_show_admin(uuid) to authenticated;
grant execute on function public.is_show_member(uuid) to authenticated;

-- A masked view of "shows" for the app to read from day to day, so a cast
-- member never actually receives the show's general invite code in the
-- first place — not just hidden in the interface, but never sent to their
-- browser at all. Andy flagged this 2026-09-09: that general code is meant
-- only for a director to hand to crew/an assistant director, so an actor
-- who joined via their own personal part link shouldn't be able to see it
-- (and potentially pass it on) at all. Admins still see the real code
-- (is_show_admin returns true for their own shows); everyone else gets
-- null. `security_invoker = true` is essential here: without it, a view
-- runs as its OWNER, which would bypass "shows"'s row-level security
-- entirely and leak every show in the database to every signed-in user —
-- the opposite of what this is for. With it, the view enforces exactly the
-- same row-visibility rule ("admins and cast can view their shows") as
-- querying the real table directly, and only adds the invite_code masking
-- on top.
create view public.shows_public
with (security_invoker = true)
as
select
  id,
  group_id,
  name,
  case when public.is_show_admin(id) then invite_code else null end as invite_code,
  created_by,
  created_at
from public.shows;

grant select on public.shows_public to authenticated;

-- A show is visible to its parent group's admin, or anyone who has
-- joined it as a cast member.
create policy "admins and cast can view their shows"
  on public.shows for select
  using (
    exists (select 1 from public.groups g where g.id = shows.group_id and g.created_by = auth.uid())
    or public.is_show_member(shows.id)
  );

-- Membership rows are visible to that show's admin, or to any of that
-- show's own members (kept simple for now — a cast member can currently
-- see the full member list of a show they're in, not just their own row).
create policy "admins and cast can view show membership"
  on public.show_members for select
  using (
    public.is_show_admin(show_members.show_id)
    or public.is_show_member(show_members.show_id)
  );

-- A show's script is visible to its admin or any of its cast members (cast
-- will need to read line text once recording/rehearsing screens exist).
create policy "admins and cast can view a show's script"
  on public.scripts for select
  using (
    public.is_show_admin(scripts.show_id)
    or public.is_show_member(scripts.show_id)
  );

create policy "admins and cast can view a show's script lines"
  on public.script_lines for select
  using (
    exists (
      select 1 from public.scripts sc
      where sc.id = script_lines.script_id
        and (public.is_show_admin(sc.show_id) or public.is_show_member(sc.show_id))
    )
  );

-- A show's admin can see every part (so they know who's still unassigned).
create policy "admins can view all parts in their shows"
  on public.parts for select
  using (public.is_show_admin(parts.show_id));

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

-- Let a signed-in cast member set their own personal "how many lines of
-- context before mine" preference for a show they're a member of (see the
-- cue_lookback_lines column on show_members above). Only touches the
-- caller's own row — there's no way to change anyone else's setting.
create or replace function public.set_cue_lookback(target_show_id uuid, lines smallint)
returns public.show_members
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.show_members;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to change this setting';
  end if;

  if lines not in (1, 2) then
    raise exception 'Cue lookback must be 1 or 2 lines';
  end if;

  update public.show_members
  set cue_lookback_lines = lines
  where show_id = target_show_id and user_id = auth.uid()
  returning * into updated;

  if updated.show_id is null then
    raise exception 'You are not a member of this show';
  end if;

  return updated;
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
grant execute on function public.set_cue_lookback(uuid, smallint) to authenticated;
grant execute on function public.save_script(uuid, text, text[], jsonb) to authenticated;
grant execute on function public.claim_part_by_code(text) to authenticated;
grant execute on function public.unassign_part(uuid) to authenticated;
