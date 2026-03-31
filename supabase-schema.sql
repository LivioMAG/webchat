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
  vacation_allowance_hours numeric(10,2) not null default 0,
  booked_vacation_hours numeric(10,2) not null default 0,
  carryover_overtime_hours numeric(10,2) not null default 0,
  reported_hours numeric(10,2) not null default 0,
  credited_hours numeric(10,2) not null default 0,
  weekly_hours numeric(10,2) not null default 40,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.app_profiles(id) on delete cascade,
  work_date date not null,
  year integer,
  kw integer,
  project_name text,
  commission_number text not null,
  start_time time not null default '07:00',
  end_time time not null default '16:30',
  lunch_break_minutes integer not null default 60,
  additional_break_minutes integer not null default 30,
  total_work_minutes integer not null default 0,
  adjusted_work_minutes integer not null default 0,
  expenses_amount numeric(10,2) not null default 0,
  other_costs_amount numeric(10,2) not null default 0,
  expense_note text,
  notes text,
  controll text,
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
  controll_pl text,
  controll_gl text,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint holiday_requests_range_check check (end_date >= start_date)
);

create table if not exists public.request_history (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  profile_id uuid not null references public.app_profiles(id) on delete cascade,
  request text not null,
  context text not null
);

alter table public.app_profiles
add column if not exists is_admin boolean not null default false;

alter table public.app_profiles
add column if not exists vacation_allowance_hours numeric(10,2) not null default 0;

alter table public.app_profiles
add column if not exists booked_vacation_hours numeric(10,2) not null default 0;

alter table public.app_profiles
add column if not exists carryover_overtime_hours numeric(10,2) not null default 0;

alter table public.app_profiles
add column if not exists reported_hours numeric(10,2) not null default 0;

alter table public.app_profiles
add column if not exists credited_hours numeric(10,2) not null default 0;

alter table public.app_profiles
add column if not exists weekly_hours numeric(10,2) not null default 40;

alter table public.weekly_reports
add column if not exists controll text;

alter table public.weekly_reports
add column if not exists project_name text;

alter table public.weekly_reports
add column if not exists adjusted_work_minutes integer not null default 0;

alter table public.weekly_reports
add column if not exists year integer;

alter table public.weekly_reports
add column if not exists kw integer;

alter table public.holiday_requests
add column if not exists controll_pl text;

alter table public.holiday_requests
add column if not exists controll_gl text;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.app_profiles
    where id = auth.uid()
      and is_admin = true
  );
$$;

create or replace function public.build_holiday_request_history_text(request_row public.holiday_requests)
returns text
language sql
stable
as $$
  select trim(
    both ' | ' from concat_ws(
      ' | ',
      coalesce(request_row.request_type, 'Absenzantrag'),
      case
        when request_row.start_date is not null and request_row.end_date is not null
          then request_row.start_date::text || ' bis ' || request_row.end_date::text
        else null
      end,
      nullif(trim(coalesce(request_row.notes, '')), '')
    )
  );
$$;

create or replace function public.approve_holiday_request(
  p_request_id uuid,
  p_field_name text,
  p_approval_name text
)
returns public.holiday_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  current_request public.holiday_requests%rowtype;
  updated_request public.holiday_requests%rowtype;
  archive_context text;
begin
  if p_field_name not in ('controll_pl', 'controll_gl') then
    raise exception 'Ungültiges Freigabefeld: %', p_field_name;
  end if;

  select *
  into current_request
  from public.holiday_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Absenzgesuch % wurde nicht gefunden.', p_request_id;
  end if;

  if p_field_name = 'controll_pl' then
    update public.holiday_requests
    set controll_pl = p_approval_name
    where id = p_request_id
    returning * into updated_request;
  else
    update public.holiday_requests
    set controll_gl = p_approval_name
    where id = p_request_id
    returning * into updated_request;
  end if;

  if nullif(trim(coalesce(updated_request.controll_pl, '')), '') is not null
    and nullif(trim(coalesce(updated_request.controll_gl, '')), '') is not null then
    insert into public.weekly_reports (
      profile_id,
      work_date,
      year,
      kw,
      project_name,
      commission_number,
      start_time,
      end_time,
      lunch_break_minutes,
      additional_break_minutes,
      total_work_minutes,
      adjusted_work_minutes,
      expenses_amount,
      other_costs_amount,
      expense_note,
      notes,
      controll,
      attachments
    )
    select
      updated_request.profile_id,
      work_day::date,
      extract(isoyear from work_day)::integer,
      extract(week from work_day)::integer,
      initcap(replace(coalesce(updated_request.request_type, 'Absenz'), '_', ' ')),
      initcap(replace(coalesce(updated_request.request_type, 'Absenz'), '_', ' ')),
      '07:00'::time,
      '16:30'::time,
      60,
      30,
      480,
      480,
      0,
      0,
      '',
      format('Automatisch aus bestätigter Absenz (%s).', initcap(replace(coalesce(updated_request.request_type, 'Absenz'), '_', ' '))),
      '',
      '[]'::jsonb
    from generate_series(updated_request.start_date, updated_request.end_date, interval '1 day') as work_day
    where extract(isodow from work_day) between 1 and 5
      and not exists (
        select 1
        from public.weekly_reports existing
        where existing.profile_id = updated_request.profile_id
          and existing.work_date = work_day::date
      );

    archive_context := format(
      'Bestätigt durch PL: %s | GL: %s',
      updated_request.controll_pl,
      updated_request.controll_gl
    );

    insert into public.request_history (profile_id, request, context)
    values (
      updated_request.profile_id,
      public.build_holiday_request_history_text(updated_request),
      archive_context
    );

    delete from public.holiday_requests
    where id = updated_request.id;
  end if;

  return updated_request;
end;
$$;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  commission_number text not null,
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists projects_commission_number_idx
on public.projects (commission_number);

create table if not exists public.project_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  profile_id uuid not null references public.app_profiles(id) on delete cascade,
  assignment_type text not null check (assignment_type in ('role', 'daily')),
  role text not null check (role in ('project_lead', 'construction_lead', 'worker', 'daily_assignment')),
  assignment_date date,
  label text,
  source text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint project_assignment_role_date_check check (
    (assignment_type = 'role' and assignment_date is null and project_id is not null)
    or (assignment_type = 'daily' and assignment_date is not null)
  )
);

create unique index if not exists project_assignments_unique_role
on public.project_assignments (project_id, role)
where assignment_type = 'role' and role in ('project_lead', 'construction_lead');

create unique index if not exists project_assignments_unique_worker
on public.project_assignments (project_id, profile_id, role)
where assignment_type = 'role' and role = 'worker';

create unique index if not exists project_assignments_daily_unique
on public.project_assignments (profile_id, assignment_date, assignment_type)
where assignment_type = 'daily';

create index if not exists project_assignments_daily_date_idx
on public.project_assignments (assignment_date, profile_id);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

drop trigger if exists project_assignments_set_updated_at on public.project_assignments;
create trigger project_assignments_set_updated_at
before update on public.project_assignments
for each row execute function public.set_updated_at();

alter table public.projects enable row level security;
alter table public.project_assignments enable row level security;

drop policy if exists "projects own or admin" on public.projects;
create policy "projects own or admin"
on public.projects
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists "project_assignments own or admin" on public.project_assignments;
create policy "project_assignments own or admin"
on public.project_assignments
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

create or replace function public.reject_holiday_request(
  p_request_id uuid,
  p_context text default 'Abgelehnt'
)
returns public.holiday_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_request public.holiday_requests%rowtype;
begin
  with removed_request as (
    delete from public.holiday_requests
    where id = p_request_id
    returning *
  )
  select *
  into deleted_request
  from removed_request;

  if not found then
    raise exception 'Absenzgesuch % wurde nicht gefunden.', p_request_id;
  end if;

  insert into public.request_history (profile_id, request, context)
  values (
    deleted_request.profile_id,
    public.build_holiday_request_history_text(deleted_request),
    coalesce(nullif(trim(p_context), ''), 'Abgelehnt')
  );

  return deleted_request;
end;
$$;

create index if not exists weekly_reports_profile_work_date_idx on public.weekly_reports (profile_id, work_date);
create index if not exists weekly_reports_year_kw_idx on public.weekly_reports (year, kw);
create index if not exists holiday_requests_profile_dates_idx on public.holiday_requests (profile_id, start_date, end_date);
create index if not exists request_history_profile_created_at_idx on public.request_history (profile_id, created_at desc);

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

alter table public.app_profiles enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.holiday_requests enable row level security;

-- Vollzugriff nur für Profile mit is_admin = true.
drop policy if exists "app_profiles own or master" on public.app_profiles;
drop policy if exists "app_profiles select own or master" on public.app_profiles;
drop policy if exists "app_profiles insert own or master" on public.app_profiles;
drop policy if exists "app_profiles update own or master" on public.app_profiles;
drop policy if exists "app_profiles delete own or master" on public.app_profiles;
drop policy if exists "weekly_reports own or master" on public.weekly_reports;
drop policy if exists "holiday_requests own or master" on public.holiday_requests;
drop policy if exists "authenticated full access app_profiles" on public.app_profiles;
drop policy if exists "authenticated full access weekly_reports" on public.weekly_reports;
drop policy if exists "authenticated full access holiday_requests" on public.holiday_requests;
drop policy if exists "app_profiles own or admin" on public.app_profiles;
drop policy if exists "app_profiles insert own or admin" on public.app_profiles;
drop policy if exists "app_profiles update own or admin" on public.app_profiles;
drop policy if exists "app_profiles delete own or admin" on public.app_profiles;
drop policy if exists "weekly_reports own or admin" on public.weekly_reports;
drop policy if exists "holiday_requests own or admin" on public.holiday_requests;

create policy "app_profiles own or admin"
on public.app_profiles
for select
using (public.is_admin_user() or auth.uid() = id);

create policy "app_profiles insert own or admin"
on public.app_profiles
for insert
with check (public.is_admin_user() or auth.uid() = id);

create policy "app_profiles update own or admin"
on public.app_profiles
for update
using (public.is_admin_user() or auth.uid() = id)
with check (public.is_admin_user() or auth.uid() = id);

create policy "app_profiles delete own or admin"
on public.app_profiles
for delete
using (public.is_admin_user() or auth.uid() = id);

create policy "weekly_reports own or admin"
on public.weekly_reports
for all
using (public.is_admin_user() or auth.uid() = profile_id)
with check (public.is_admin_user() or auth.uid() = profile_id);

create policy "holiday_requests own or admin"
on public.holiday_requests
for all
using (public.is_admin_user() or auth.uid() = profile_id)
with check (public.is_admin_user() or auth.uid() = profile_id);

insert into storage.buckets (id, name, public)
values ('weekly-attachments', 'weekly-attachments', true)
on conflict (id) do nothing;

drop policy if exists "weekly attachment read own or master" on storage.objects;
drop policy if exists "weekly attachment write own or master" on storage.objects;
drop policy if exists "authenticated attachment read" on storage.objects;
drop policy if exists "authenticated attachment write" on storage.objects;
drop policy if exists "weekly attachment read own or admin" on storage.objects;
drop policy if exists "weekly attachment write own or admin" on storage.objects;

create policy "weekly attachment read own or admin"
on storage.objects
for select
using (
  bucket_id = 'weekly-attachments'
  and (
    public.is_admin_user()
    or auth.uid()::text = split_part(name, '/', 1)
  )
);

create policy "weekly attachment write own or admin"
on storage.objects
for all
using (
  bucket_id = 'weekly-attachments'
  and (
    public.is_admin_user()
    or auth.uid()::text = split_part(name, '/', 1)
  )
)
with check (
  bucket_id = 'weekly-attachments'
  and (
    public.is_admin_user()
    or auth.uid()::text = split_part(name, '/', 1)
  )
);
