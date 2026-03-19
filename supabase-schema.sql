create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.app_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role_label text not null default 'Monteur',
  is_admin boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.app_profiles(id) on delete cascade,
  work_date date not null,
  commission_number text not null,
  start_time time not null default '07:00',
  end_time time not null default '16:30',
  lunch_break_minutes integer not null default 60,
  additional_break_minutes integer not null default 30,
  total_work_minutes integer not null default 0,
  expenses_amount numeric(10,2) not null default 0,
  other_costs_amount numeric(10,2) not null default 0,
  expense_note text,
  notes text,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.holiday_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.app_profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  request_type text not null check (request_type in ('ferien', 'militaer', 'zivildienst', 'unfall', 'krankheit', 'feiertag')),
  notes text,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint holiday_requests_range_check check (end_date >= start_date)
);

alter table public.app_profiles
add column if not exists is_admin boolean not null default false;

update public.app_profiles
set is_admin = true
where lower(role_label) in ('admin', 'administrator', 'administration', 'master admin')
   or lower(email) = 'admin@maraschow.cn';

create index if not exists weekly_reports_profile_work_date_idx on public.weekly_reports (profile_id, work_date);
create index if not exists holiday_requests_profile_dates_idx on public.holiday_requests (profile_id, start_date, end_date);

create trigger set_updated_at_app_profiles
before update on public.app_profiles
for each row
execute procedure public.set_updated_at();

create trigger set_updated_at_weekly_reports
before update on public.weekly_reports
for each row
execute procedure public.set_updated_at();

create trigger set_updated_at_holiday_requests
before update on public.holiday_requests
for each row
execute procedure public.set_updated_at();

create or replace function public.is_master_admin()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'admin@maraschow.cn';
$$;

alter table public.app_profiles enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.holiday_requests enable row level security;

-- Alte Policies bei Bedarf entfernen, bevor dieses Script erneut ausgeführt wird.
drop policy if exists "app_profiles own or master" on public.app_profiles;
drop policy if exists "app_profiles select own or master" on public.app_profiles;
drop policy if exists "app_profiles insert own or master" on public.app_profiles;
drop policy if exists "app_profiles update own or master" on public.app_profiles;
drop policy if exists "app_profiles delete own or master" on public.app_profiles;
drop policy if exists "weekly_reports own or master" on public.weekly_reports;
drop policy if exists "holiday_requests own or master" on public.holiday_requests;

create policy "app_profiles select own or master"
on public.app_profiles
for select
using (public.is_master_admin() or auth.uid() = id);

create policy "app_profiles insert own or master"
on public.app_profiles
for insert
with check (public.is_master_admin() or auth.uid() = id);

create policy "app_profiles update own or master"
on public.app_profiles
for update
using (public.is_master_admin() or auth.uid() = id)
with check (public.is_master_admin() or auth.uid() = id);

create policy "app_profiles delete own or master"
on public.app_profiles
for delete
using (public.is_master_admin() or auth.uid() = id);

create policy "weekly_reports own or master"
on public.weekly_reports
for all
using (public.is_master_admin() or auth.uid() = profile_id)
with check (public.is_master_admin() or auth.uid() = profile_id);

create policy "holiday_requests own or master"
on public.holiday_requests
for all
using (public.is_master_admin() or auth.uid() = profile_id)
with check (public.is_master_admin() or auth.uid() = profile_id);

insert into storage.buckets (id, name, public)
values ('weekly-attachments', 'weekly-attachments', true)
on conflict (id) do nothing;

drop policy if exists "weekly attachment read own or master" on storage.objects;
drop policy if exists "weekly attachment write own or master" on storage.objects;

create policy "weekly attachment read own or master"
on storage.objects
for select
using (
  bucket_id = 'weekly-attachments'
  and (
    public.is_master_admin()
    or auth.uid()::text = split_part(name, '/', 1)
  )
);

create policy "weekly attachment write own or master"
on storage.objects
for all
using (
  bucket_id = 'weekly-attachments'
  and (
    public.is_master_admin()
    or auth.uid()::text = split_part(name, '/', 1)
  )
)
with check (
  bucket_id = 'weekly-attachments'
  and (
    public.is_master_admin()
    or auth.uid()::text = split_part(name, '/', 1)
  )
);
