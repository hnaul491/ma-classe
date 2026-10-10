-- Save the board by merging, not overwriting: a client with a stale scene can no longer roll the
-- saved board back. Elements are merged by id with Excalidraw's rule (the same as
-- mergeSceneElements in src/features/board/merge.ts):
--   * the higher `version` wins;
--   * on a version tie, the lower `versionNonce` wins;
--   * on a full tie, the stored element stays;
--   * an element present on only one side is kept.
-- Positions follow the first occurrence: stored order first, then elements only the new scene has.

-- Pure helper: merges two element arrays. Anything that is not an object with an id is dropped.
create or replace function public.merge_board_elements(p_stored jsonb, p_incoming jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(w.el order by w.pos_side, w.pos_ord), '[]'::jsonb)
  from (
    select distinct on (e.id)
      e.el,
      first_value(e.side) over (partition by e.id order by e.side, e.ord) as pos_side,
      first_value(e.ord) over (partition by e.id order by e.side, e.ord) as pos_ord
    from (
      select
        x.el,
        x.el ->> 'id' as id,
        x.side,
        x.ord,
        case when jsonb_typeof(x.el -> 'version') = 'number' then (x.el ->> 'version')::numeric end as version,
        case when jsonb_typeof(x.el -> 'versionNonce') = 'number' then (x.el ->> 'versionNonce')::numeric end as nonce
      from (
        select s.el, 0 as side, s.ord
        from jsonb_array_elements(case when jsonb_typeof(p_stored) = 'array' then p_stored else '[]'::jsonb end)
          with ordinality as s(el, ord)
        union all
        select i.el, 1 as side, i.ord
        from jsonb_array_elements(case when jsonb_typeof(p_incoming) = 'array' then p_incoming else '[]'::jsonb end)
          with ordinality as i(el, ord)
      ) x
      where jsonb_typeof(x.el) = 'object' and jsonb_typeof(x.el -> 'id') = 'string'
    ) e
    order by e.id, e.version desc nulls last, e.nonce asc nulls last, e.side, e.ord
  ) w
$$;

-- Upserts the lesson's board in one statement, under RLS (security invoker): a new row stores the
-- scene, an existing row is merged with it. Concurrent saves serialise on the row lock, and each
-- merges into the latest stored scene.
create or replace function public.merge_board_save(p_lesson_id uuid, p_elements jsonb, p_email text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_member() then
    raise exception 'Only class members can save the board' using errcode = '42501';
  end if;

  insert into public.board_saves as b (lesson_id, scene, updated_at, updated_by)
  values (
    p_lesson_id,
    jsonb_build_object('elements', public.merge_board_elements('[]'::jsonb, p_elements)),
    now(),
    p_email
  )
  on conflict (lesson_id) do update set
    scene = jsonb_build_object('elements', public.merge_board_elements(b.scene -> 'elements', excluded.scene -> 'elements')),
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.merge_board_elements(jsonb, jsonb) from public, anon;
grant execute on function public.merge_board_elements(jsonb, jsonb) to authenticated;
revoke all on function public.merge_board_save(uuid, jsonb, text) from public, anon;
grant execute on function public.merge_board_save(uuid, jsonb, text) to authenticated;

-- Let PostgREST see the new function at once.
notify pgrst, 'reload schema';
