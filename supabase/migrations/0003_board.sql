-- Board scene per lesson and the images placed on the board.
create table public.board_saves (
  lesson_id uuid primary key references public.lessons (id) on delete cascade,
  scene jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  storage_path text not null unique,
  kind text not null check (kind in ('page', 'image')),
  mime text not null,
  size_bytes bigint not null,
  width int not null,
  height int not null,
  name text not null,
  created_at timestamptz not null default now()
);
create index files_lesson on public.files (lesson_id);

alter table public.board_saves enable row level security;
alter table public.files enable row level security;

create policy board_saves_read on public.board_saves for select to authenticated using (public.is_member());
create policy board_saves_insert on public.board_saves for insert to authenticated with check (public.is_member());
create policy board_saves_update on public.board_saves for update to authenticated
  using (public.is_member()) with check (public.is_member());

create policy files_read on public.files for select to authenticated using (public.is_member());
create policy files_insert on public.files for insert to authenticated with check (public.is_member());

-- Private bucket for board images (PDF pages as WebP, inserted pictures).
insert into storage.buckets (id, name, public)
values ('lesson-files', 'lesson-files', false)
on conflict (id) do nothing;

create policy lesson_files_read on storage.objects for select to authenticated
  using (bucket_id = 'lesson-files' and public.is_member());
create policy lesson_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'lesson-files' and public.is_member());
