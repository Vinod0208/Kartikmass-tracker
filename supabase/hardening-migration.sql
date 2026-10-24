-- SAFE ADDITIVE HARDENING MIGRATION for an EXISTING Kartik Sankalp Tracker database.
-- Preserves existing profiles, vows, selections, and daily_logs. Do NOT run schema.sql again.
-- Run this file once in Supabase SQL Editor as project owner.

begin;

-- A single atomic RPC saves the initial selections. The profile row lock serializes
-- concurrent first-save attempts. Existing selections mean the choice is already locked.
create or replace function public.save_initial_kartik_sankalps(p_vow_ids uuid[])
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
    raise exception 'You must be signed in to save sankalps.' using errcode = '28000';
  end if;

  if p_vow_ids is null or cardinality(p_vow_ids) = 0 then
    raise exception 'Select at least one sankalp.' using errcode = '22023';
  end if;

  select count(distinct x) into v_distinct_count
  from unnest(p_vow_ids) as x;
  if v_distinct_count <> cardinality(p_vow_ids) then
    raise exception 'Duplicate sankalps were submitted.' using errcode = '22023';
  end if;

  -- Serialize requests for this user; transaction rolls back fully on any error.
  perform 1 from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'Your profile was not found. Please sign out and sign in again.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.user_vows
    where user_id = v_user_id and program_key = 'kartik'
  ) then
    raise exception 'Your Kartik sankalps have already been saved and cannot be changed.' using errcode = '55000';
  end if;

  select count(*) into v_count from public.vows where id = any(p_vow_ids);
  if v_count <> cardinality(p_vow_ids) then
    raise exception 'One or more selected sankalps no longer exist. Refresh and try again.' using errcode = '22023';
  end if;

  insert into public.user_vows (user_id, vow_id, program_key)
  select v_user_id, x, 'kartik'
  from unnest(p_vow_ids) as x;
end;
$$;

revoke all on function public.save_initial_kartik_sankalps(uuid[]) from public;
grant execute on function public.save_initial_kartik_sankalps(uuid[]) to authenticated;

-- Remove direct client writes to selections. Users must use the atomic RPC above.
drop policy if exists "user_vows_insert_own" on public.user_vows;
drop policy if exists "user_vows_delete_own_or_admin" on public.user_vows;
drop policy if exists "user_vows_update_own" on public.user_vows;

-- Enforce current day using the program's India timezone, even if a client tampers with requests.
drop policy if exists "daily_logs_insert_own" on public.daily_logs;
create policy "daily_logs_insert_own_today_only"
on public.daily_logs for insert to authenticated
with check (
  user_id = (select auth.uid())
  and log_date = (now() at time zone 'Asia/Kolkata')::date
  and exists (
    select 1 from public.user_vows uv
    where uv.user_id = (select auth.uid())
      and uv.vow_id = daily_logs.vow_id
      and uv.program_key = 'kartik'
  )
);

drop policy if exists "daily_logs_update_own" on public.daily_logs;
create policy "daily_logs_update_own_today_only"
on public.daily_logs for update to authenticated
using (
  user_id = (select auth.uid())
  and log_date = (now() at time zone 'Asia/Kolkata')::date
)
with check (
  user_id = (select auth.uid())
  and log_date = (now() at time zone 'Asia/Kolkata')::date
  and exists (
    select 1 from public.user_vows uv
    where uv.user_id = (select auth.uid())
      and uv.vow_id = daily_logs.vow_id
      and uv.program_key = 'kartik'
  )
);


-- Ordinary users cannot delete historical entries; admins retain report-management authority.
drop policy if exists "daily_logs_delete_own_or_admin" on public.daily_logs;
create policy "daily_logs_delete_own_today_or_admin"
on public.daily_logs for delete to authenticated
using (
  public.is_admin()
  or (
    user_id = (select auth.uid())
    and log_date = (now() at time zone 'Asia/Kolkata')::date
  )
);

-- Block changing historical rows through ordinary authenticated API requests too.
-- Existing past rows remain readable and are not modified by this migration.
create or replace function public.enforce_kartik_daily_log_day()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    if new.user_id <> auth.uid() then
      raise exception 'You can only save your own daily progress.' using errcode = '42501';
    end if;
    if new.log_date <> (now() at time zone 'Asia/Kolkata')::date then
      raise exception 'Daily sankalp progress can only be saved for today (India time).' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_kartik_daily_log_day on public.daily_logs;
create trigger enforce_kartik_daily_log_day
before insert or update on public.daily_logs
for each row execute function public.enforce_kartik_daily_log_day();

commit;

-- Verify after migration:
-- select policyname, cmd from pg_policies where schemaname='public' and tablename in ('user_vows','daily_logs');
