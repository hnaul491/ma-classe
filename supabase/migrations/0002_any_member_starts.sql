-- Either member (teacher or student) may start and end a lesson.
drop policy if exists lessons_insert on public.lessons;
drop policy if exists lessons_update on public.lessons;

create policy lessons_insert on public.lessons
  for insert to authenticated with check (public.is_member());

create policy lessons_update on public.lessons
  for update to authenticated
  using (public.is_member())
  with check (public.is_member());
