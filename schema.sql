-- Line Learning App — schema v2: groups (theatres/companies) + shows
-- (individual productions).
--
-- This REPLACES the original G0 schema, which had a single "groups" table
-- that actually behaved like what's now called a "show". Since this is
-- still early testing with no real cast members using it yet, this script
-- starts by removing the old tables/functions before creating the new
-- ones. Run the whole file, in full, the same way as before: Supabase
-- dashboard -> SQL Editor -> New query -> paste this whole file in ->
-- Run. Your existing test group and its invite code will stop working
-- afterwards — that's expected, and fine since nobody real has used it.
--
-- What changed, in plain terms:
-- - A "group" is now the theatre/company level — one admin's account for
--   organizing their own productions. Cast members never see this table
--   or even know it exists.
-- - A "show" is one production — what the old "groups" table actually
--   was. A show belongs to exactly one group. Only that group's admin can
--   create a show inside it (and, from G1 onwards, upload its script and
--   assign parts).
-- - Cast members join and see shows directly, by invite code — never the
--   parent group. A person can be a member of any number of different
--   shows (e.g. acting in one production while directing another).
-- - Who can create a brand-new group is intentionally left open to any
--   signed-in person for now, while this is just being tested by you.
--   That's a one-line check to tighten later (inside create_group only)
--   without touching anything else in this file — worth doing before
--   this is ever opened up beyond people you know.

drop function if exists public.create_group(text);
drop function if exists public.join_group_by_code(text);
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

-- Cast members of a specific show.
create table public.show_members (
  show_id uuid not null references public.shows(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (show_id, user_id)
);

alter table public.groups enable row level security;
alter table public.shows enable row level security;
alter table public.show_members enable row level security;

-- No direct inserts/updates/deletes anywhere — only through the three
-- functions below, each of which does its own admin/membership checks.
revoke insert, update, delete on public.groups from authenticated;
revoke insert, update, delete on public.shows from authenticated;
revoke insert, update, delete on public.show_members from authenticated;
grant select on public.groups to authenticated;
grant select on public.shows to authenticated;
grant select on public.show_members to authenticated;

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

-- Join a show as a cast member, using its invite code. A person can join
-- any number of different shows this way.
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

grant execute on function public.create_group(text) to authenticated;
grant execute on function public.create_show(uuid, text) to authenticated;
grant execute on function public.join_show_by_code(text) to authenticated;
