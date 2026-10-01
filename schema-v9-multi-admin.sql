-- Line Learning App — schema v9: lets a show have more than one admin (e.g.
-- a director AND a theatre manager, both fully able to run the same show).
-- This is a DELTA script, not a full rebuild like schema.sql: run this ONE
-- FILE, once, in the Supabase dashboard's SQL Editor (same place as always)
-- AFTER schema.sql (v8) is already in place. schema.sql itself has also
-- been updated to include these same changes, so a brand-new install
-- (running schema.sql alone, from scratch) already has multi-admin built
-- in — but if you already have a working database, run THIS file instead
-- of re-running schema.sql, so today's shows, scripts, cast assignments,
-- and recordings all survive.
--
-- Unlike v8 (which only ever ADDED things), this one also updates a few
-- existing rules in place — it still does not delete or touch any of your
-- actual data (no show, script, part, or recording is affected), it just
-- teaches the database a new way to recognize "is this person allowed to
-- manage this show" that includes more than just the one original creator.
-- Safe to run on a live database.
--
-- What's new, in plain terms:
-- - Until now, a show's "admin" was always just one fixed person — whoever
--   originally created it. There was no way to add a second person with
--   full admin rights on that same show.
-- - A `show_admins` row is exactly like a `part` (see schema.sql), except
--   instead of assigning one character to one actor, it grants one person
--   full admin rights on a show. An existing admin creates an invite (with
--   a short descriptive label like "Director" or "Theatre Manager") and
--   shares the resulting link/code — just like sharing a part's link. The
--   person who opens it signs in and becomes a full admin of that show.
-- - Every admin on a show can do everything any other admin can — there is
--   no senior/junior split. The role label (e.g. "Theatre Manager") is
--   purely a human-readable tag shown in the admin list, not a different
--   permission level.
-- - The original creator of a show is still always an admin automatically,
--   exactly as before — nothing changes for a show that only ever has the
--   one admin it already had.

-- One row per additional admin a show has — either still-pending (not yet
-- claimed, user_id is null, just like an unclaimed part) or claimed
-- (user_id set to whoever claimed it). The show's original creator does
-- NOT get a row here — their admin status still comes from being that
-- show's group's creator (see is_show_admin below), so nothing needs to be
-- backfilled for shows that already exist.
create table public.show_admins (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  role_label text not null default 'Admin',
  invite_code text not null unique default substr(md5(random()::text), 1, 8),
  user_id uuid references auth.users(id),
  claimed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  -- Stops the same person ending up with two separate admin rows on the
  -- same show. Postgres treats every null as distinct from every other
  -- null, so this never blocks two different STILL-PENDING invites from
  -- existing side by side — it only kicks in once a code is actually
  -- claimed.
  unique (show_id, user_id)
);

alter table public.show_admins enable row level security;

-- No direct inserts/updates/deletes — only through the two functions below,
-- which do their own admin/ownership checks.
revoke insert, update, delete on public.show_admins from authenticated;
grant select on public.show_admins to authenticated;

-- Only a show's own admin(s) can see the admin list for that show — a cast
-- member never needs or gets this.
create policy "admins can view show admins for their shows"
  on public.show_admins for select
  using (public.is_show_admin(show_admins.show_id));

-- Updated: is_show_admin now answers true for EITHER the show's original
-- creator (via their group, exactly as before) OR anyone who has claimed an
-- admin invite for this specific show. Every other policy and function in
-- this app that cares about "is this person an admin" already calls this
-- one function rather than repeating the check inline (that's the whole
-- reason it was pulled out as its own function back in v4 — see the big
-- comment above it in schema.sql) — so updating it here is what actually
-- makes a second admin's rights take effect everywhere at once: seeing the
-- show, seeing its general invite code, uploading/replacing its script,
-- assigning and unassigning parts, and inviting further admins.
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
  ) or exists (
    select 1
    from public.show_admins sa
    where sa.show_id = target_show_id and sa.user_id = auth.uid()
  );
$$;

-- The "shows" table's own select policy previously re-checked the group
-- directly (`g.created_by = auth.uid()`) instead of calling is_show_admin —
-- that worked fine back when those two things were identical, but a second
-- admin needs this policy to go through is_show_admin like everything else
-- now does, so replaced rather than left as its own separate copy of the
-- old rule.
drop policy if exists "admins and cast can view their shows" on public.shows;
create policy "admins and cast can view their shows"
  on public.shows for select
  using (
    public.is_show_admin(shows.id)
    or public.is_show_member(shows.id)
  );

-- shows_public gains an explicit is_admin column, so the app can ask "is
-- the signed-in person an admin of this show" directly instead of guessing
-- from show.created_by (which only ever reflected the ORIGINAL creator, and
-- would have wrongly said "no" for a second admin). Adding a column at the
-- end like this is a safe change to an existing view — nothing already
-- reading invite_code/created_by/etc. is affected.
create or replace view public.shows_public
with (security_invoker = true)
as
select
  id,
  group_id,
  name,
  case when public.is_show_admin(id) then invite_code else null end as invite_code,
  created_by,
  created_at,
  public.is_show_admin(id) as is_admin
from public.shows;

grant select on public.shows_public to authenticated;

-- save_script previously repeated the "is this person the group's creator"
-- check inline instead of calling is_show_admin — updated the same way as
-- the shows policy above, for the same reason: a second admin needs this to
-- actually recognize them.
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
  if not public.is_show_admin(target_show_id) then
    raise exception 'Only that show''s admin can upload its script';
  end if;

  delete from public.scripts where show_id = target_show_id;

  insert into public.scripts (show_id, file_name, created_by)
  values (target_show_id, script_file_name, auth.uid())
  returning id into new_script_id;

  insert into public.script_lines (
    script_id, seq_index, line_type, character_name, line_text,
    act_label, scene_label, scene_seq
  )
  select
    new_script_id,
    (elem->>'seq_index')::int,
    elem->>'type',
    elem->>'character_name',
    coalesce(elem->>'text', ''),
    elem->>'act_label',
    elem->>'scene_label',
    (elem->>'scene_seq')::int
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

-- unassign_part: same change as save_script above, for the same reason.
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

  if not public.is_show_admin(target_part.show_id) then
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

-- Invite another admin to help run a show (e.g. a theatre manager alongside
-- a director) — only an existing admin of that show can do this.
-- role_label is a plain descriptive tag shown next to them in the admin
-- list (defaults to "Admin" if left blank) — it does not change what they
-- can do: every admin on a show can do everything any other admin can.
create or replace function public.create_show_admin_invite(target_show_id uuid, role_label text)
returns public.show_admins
language plpgsql
security definer
set search_path = public
as $$
declare
  new_admin public.show_admins;
  cleaned_label text;
begin
  if not public.is_show_admin(target_show_id) then
    raise exception 'Only an existing admin of this show can invite another admin';
  end if;

  cleaned_label := nullif(trim(role_label), '');

  insert into public.show_admins (show_id, role_label, created_by)
  values (target_show_id, coalesce(cleaned_label, 'Admin'), auth.uid())
  returning * into new_admin;

  return new_admin;
end;
$$;

-- Claim an admin invite using its personal code — mirrors claim_part_by_code
-- in schema.sql, but grants admin rights on the whole show rather than one
-- character's part. Also joins the show as a member (same as claiming a
-- part does), so a newly added admin shows up in member counts/lists like
-- anyone else who's joined, and so is_show_member-based checks elsewhere
-- (e.g. reading the script) work for them too even on the rare day they're
-- not acting as an admin for some reason.
create or replace function public.claim_show_admin_invite(code text)
returns public.show_admins
language plpgsql
security definer
set search_path = public
as $$
declare
  target_admin public.show_admins;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to claim an admin invite';
  end if;

  select * into target_admin from public.show_admins where invite_code = code;

  if target_admin.id is null then
    raise exception 'No admin invite found for that code';
  end if;

  if target_admin.user_id is not null and target_admin.user_id <> auth.uid() then
    raise exception 'This admin invite has already been claimed by someone else';
  end if;

  update public.show_admins
  set user_id = auth.uid(), claimed_at = now()
  where id = target_admin.id
  returning * into target_admin;

  insert into public.show_members (show_id, user_id)
  values (target_admin.show_id, auth.uid())
  on conflict do nothing;

  return target_admin;
end;
$$;

grant execute on function public.create_show_admin_invite(uuid, text) to authenticated;
grant execute on function public.claim_show_admin_invite(text) to authenticated;
