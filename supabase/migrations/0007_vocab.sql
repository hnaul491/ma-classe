-- Vocabulary: written by the teacher during a lesson (or on /vocab), editable by both members.
create table if not exists public.vocab (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid references public.lessons (id) on delete set null,
  french text not null check (char_length(btrim(french)) between 1 and 200),
  meaning_vi text not null default '' check (char_length(meaning_vi) <= 500),
  meaning_en text not null default '' check (char_length(meaning_en) <= 500),
  example text not null default '' check (char_length(example) <= 1000),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vocab_lesson on public.vocab (lesson_id, created_at);
create index if not exists vocab_created on public.vocab (created_at desc);

-- The server's clock decides which edit is newer; who wrote it and when it was created never change.
create or replace function public.vocab_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  return new;
end $$;
drop trigger if exists vocab_touch on public.vocab;
create trigger vocab_touch before update on public.vocab for each row execute function public.vocab_touch();

alter table public.vocab enable row level security;
drop policy if exists vocab_read on public.vocab;
drop policy if exists vocab_insert on public.vocab;
drop policy if exists vocab_update on public.vocab;
drop policy if exists vocab_delete on public.vocab;
create policy vocab_read on public.vocab for select to authenticated using (public.is_member());
create policy vocab_insert on public.vocab for insert to authenticated
  with check (public.member_role() = 'teacher' and created_by = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy vocab_update on public.vocab for update to authenticated
  using (public.is_member()) with check (public.is_member());
create policy vocab_delete on public.vocab for delete to authenticated using (public.member_role() = 'teacher');
