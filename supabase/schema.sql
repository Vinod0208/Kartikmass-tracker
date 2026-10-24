-- ISKCON Dehradun Kartik Maas Sankalp Tracker
-- FRESH INSTALL ONLY: run this complete file in the SQL Editor of a NEW/EMPTY Supabase project.
-- This script creates the schema from scratch. It is not a migration.
-- Do not run against a database containing tables you need to preserve.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  role text not null default 'user' check (role in ('admin','user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text not null default 'Personal',
  unit text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint vows_name_length check (char_length(trim(name)) between 3 and 120)
);
create unique index vows_name_ci_unique on public.vows (lower(trim(name)));

create table public.user_vows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  vow_id uuid not null references public.vows(id) on delete cascade,
  program_key text not null default 'kartik',
  created_at timestamptz not null default now(),
  unique (user_id, vow_id, program_key)
);

create table public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  vow_id uuid not null references public.vows(id) on delete cascade,
  log_date date not null default current_date,
  quantity numeric(12,2) check (quantity is null or quantity >= 0),
  unit text,
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  completed boolean not null default false,
  reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, vow_id, log_date)
);

create index user_vows_user_program_idx on public.user_vows(user_id, program_key);
create index daily_logs_user_date_idx on public.daily_logs(user_id, log_date desc);
create index daily_logs_vow_date_idx on public.daily_logs(vow_id, log_date desc);

-- Create a profile for every newly registered Auth user. Role is always user at signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, ''),
    'user'
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Backfill profiles for Auth users that existed before this fresh schema was installed.
insert into public.profiles (id, full_name, email, role)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'full_name', ''),
  coalesce(u.email, ''),
  'user'
from auth.users u
on conflict (id) do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.vows enable row level security;
alter table public.user_vows enable row level security;
alter table public.daily_logs enable row level security;

-- Profiles: users can see/edit their own profile; admins can see all profiles.
create policy "profiles_select_own_or_admin"
on public.profiles for select to authenticated
using (id = (select auth.uid()) or public.is_admin());

create policy "profiles_update_own"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()) and role = 'user');

create policy "profiles_admin_update"
on public.profiles for update to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Vows are a shared library. All signed-in users can read and add vows.
create policy "vows_select_authenticated"
on public.vows for select to authenticated
using (true);

create policy "vows_insert_authenticated"
on public.vows for insert to authenticated
with check (created_by = (select auth.uid()));

create policy "vows_update_creator_or_admin"
on public.vows for update to authenticated
using (created_by = (select auth.uid()) or public.is_admin())
with check (created_by = (select auth.uid()) or public.is_admin());

create policy "vows_delete_creator_or_admin"
on public.vows for delete to authenticated
using (created_by = (select auth.uid()) or public.is_admin());

-- User vow selections remain private to the user and the admin.
create policy "user_vows_select_own_or_admin"
on public.user_vows for select to authenticated
using (user_id = (select auth.uid()) or public.is_admin());

create policy "user_vows_insert_own"
on public.user_vows for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "user_vows_delete_own_or_admin"
on public.user_vows for delete to authenticated
using (user_id = (select auth.uid()) or public.is_admin());

-- Daily logs are private to the owner and visible to authorized admins.
create policy "daily_logs_select_own_or_admin"
on public.daily_logs for select to authenticated
using (user_id = (select auth.uid()) or public.is_admin());

create policy "daily_logs_insert_own"
on public.daily_logs for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.user_vows uv
    where uv.user_id = (select auth.uid())
      and uv.vow_id = daily_logs.vow_id
      and uv.program_key = 'kartik'
  )
);

create policy "daily_logs_update_own"
on public.daily_logs for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.user_vows uv
    where uv.user_id = (select auth.uid())
      and uv.vow_id = daily_logs.vow_id
      and uv.program_key = 'kartik'
  )
);

create policy "daily_logs_delete_own_or_admin"
on public.daily_logs for delete to authenticated
using (user_id = (select auth.uid()) or public.is_admin());

-- Starter vows for the shared Kartik list.
insert into public.vows (name, description, category, unit) values
('Daily Hare Krishna Japa', 'Complete your personally chosen japa target.', 'Japa', 'rounds'),
('Read Bhagavad-gita', 'Read and reflect on Bhagavad-gita.', 'Study', 'verses'),
('Read Srimad Bhagavatam', 'Spend time reading Srimad Bhagavatam.', 'Study', 'minutes'),
('Offer a lamp (Deep Daan)', 'Offer a lamp according to temple guidance.', 'Worship', 'lamps'),
('Attend or participate in Kirtan', 'Participate in kirtan or devotional singing.', 'Kirtan', 'minutes'),
('Perform Seva', 'Perform devotional service.', 'Seva', 'minutes'),
('Attend Mangala Aarti', 'Attend Mangala Aarti, in person or as guided.', 'Worship', 'times'),
('Hear Krishna-katha', 'Listen to a devotional class or Krishna-katha.', 'Study', 'minutes')
on conflict do nothing;

-- ADMIN SETUP:
-- 1. Create the admin user through Supabase Dashboard -> Authentication -> Users.
-- 2. Copy that Auth user's UUID and run the following as a project owner in SQL Editor:
-- update public.profiles set role = 'admin' where id = 'PASTE-AUTH-USER-UUID';
-- Never let users self-select an admin role through the public signup form.
