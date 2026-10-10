create extension if not exists pgcrypto;

create table public.members (
  email text primary key check (email = lower(email)),
  role text not null unique check (role in ('teacher', 'student')),
  display_name text not null
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null check (status in ('live', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- Only one lesson can be live at a time.
create unique index lessons_one_live on public.lessons (status) where status = 'live';

create or replace function public.member_role() returns text
language sql stable security definer set search_path = public as $$
  select m.role from public.members m
  where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.member_role() is not null
$$;

revoke all on function public.member_role() from public, anon;
revoke all on function public.is_member() from public, anon;
grant execute on function public.member_role() to authenticated;
grant execute on function public.is_member() to authenticated;

alter table public.members enable row level security;
alter table public.lessons enable row level security;

create policy members_read on public.members
  for select to authenticated using (public.is_member());

create policy lessons_read on public.lessons
  for select to authenticated using (public.is_member());

create policy lessons_insert on public.lessons
  for insert to authenticated with check (public.member_role() = 'teacher');

create policy lessons_update on public.lessons
  for update to authenticated
  using (public.member_role() = 'teacher')
  with check (public.member_role() = 'teacher');
