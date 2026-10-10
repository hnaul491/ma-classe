create table public.chat (
  id uuid primary key,
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  author_email text not null,
  author_name text not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index chat_lesson_time on public.chat (lesson_id, created_at);

alter table public.chat enable row level security;
create policy chat_read on public.chat for select to authenticated using (public.is_member());
create policy chat_insert on public.chat for insert to authenticated
  with check (public.is_member() and author_email = lower(coalesce(auth.jwt() ->> 'email', '')));
