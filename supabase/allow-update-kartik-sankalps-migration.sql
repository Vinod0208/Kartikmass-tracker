-- Additive migration: allow devotees to update their Kartik vow selection after saving.
-- Existing selections and daily logs are preserved. Apply once in Supabase SQL Editor.

begin;

create or replace function public.save_kartik_sankalps(p_vow_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
  v_distinct_count integer;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to update sankalps.' using errcode = '28000';
  end if;

  if p_vow_ids is null or cardinality(p_vow_ids) = 0 then
    raise exception 'Select at least one sankalp.' using errcode = '22023';
  end if;

  select count(distinct x) into v_distinct_count
  from unnest(p_vow_ids) as x;
  if v_distinct_count <> cardinality(p_vow_ids) then
    raise exception 'Duplicate sankalps were submitted.' using errcode = '22023';
  end if;

  perform 1 from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'Your profile was not found. Please sign out and sign in again.' using errcode = 'P0002';
  end if;

  select count(*) into v_count from public.vows where id = any(p_vow_ids);
  if v_count <> cardinality(p_vow_ids) then
    raise exception 'One or more selected sankalps no longer exist. Refresh and try again.' using errcode = '22023';
  end if;

  -- Replace only this user's Kartik selections, atomically. Daily logs are preserved.
  delete from public.user_vows
  where user_id = v_user_id and program_key = 'kartik';

  insert into public.user_vows (user_id, vow_id, program_key)
  select v_user_id, x, 'kartik'
  from unnest(p_vow_ids) as x;
end;
$$;

revoke all on function public.save_kartik_sankalps(uuid[]) from public;
grant execute on function public.save_kartik_sankalps(uuid[]) to authenticated;

commit;
