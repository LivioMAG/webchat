create extension if not exists pgcrypto;

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.app_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role_label text not null default 'Monteur',
  is_admin boolean not null default false,
  is_active boolean not null default true,
  vacation_allowance_hours numeric(10,2) not null default 0,
  booked_vacation_hours numeric(10,2) not null default 0,
  carryover_overtime_hours numeric(10,2) not null default 0,
  reported_hours numeric(10,2) not null default 0,
  credited_hours numeric(10,2) not null default 0,
  weekly_hours numeric(10,2) not null default 40,
  target_revenue numeric(12,2) not null default 0,
  school_day_1 smallint,
  school_day_2 smallint,
  block_schedule jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  commission_number text not null unique,
  name text not null,
  allow_expenses boolean not null default true,
  project_lead_profile_id uuid references public.app_profiles(id) on delete set null,
  construction_lead_profile_id uuid references public.app_profiles(id) on delete set null,
  street text,
  postal_code text,
  city text,
  has_barrack boolean not null default false,
  has_lunch_break boolean not null default false,
  workday_start_time time,
  workday_end_time time,
  project_contacts jsonb not null default '[]'::jsonb,
  project_documents jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.app_profiles(id) on delete cascade,
  work_date date not null,
  year integer,
  kw integer,
  abz_typ integer not null default 0,
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

create table public.holiday_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.app_profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  request_type text not null check (request_type in ('ferien', 'militaer', 'zivildienst', 'unfall', 'krankheit', 'feiertag')),
  notes text,
  controll_pl text,
  controll_gl text,
  approval_status smallint not null default 1 check (approval_status in (0, 1, 2)),
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint holiday_requests_range_check check (end_date >= start_date)
);

create table public.request_history (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  profile_id uuid not null references public.app_profiles(id) on delete cascade,
  request text not null,
  context text not null,
  linked_weekly_report_ids jsonb not null default '[]'::jsonb
);

create table public.daily_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.app_profiles(id) on delete cascade,
  assignment_date date not null,
  project_id uuid references public.projects(id) on delete set null,
  label text not null,
  source text not null default 'manual',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint daily_assignments_unique_profile_day unique (profile_id, assignment_date)
);

create table public.platform_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  label text not null,
  is_paid boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.school_vacations (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint school_vacations_range_check check (end_date >= start_date)
);

create table public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('kunde', 'lieferant', 'elektroplaner', 'subunternehmer', 'unternehmer')),
  company_name text,
  first_name text not null,
  last_name text not null,
  street text,
  city text,
  postal_code text,
  phone text,
  email text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.project_kanban_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'todo' check (status in ('todo', 'planned', 'in_progress', 'review', 'done')),
  position integer not null default 0,
  note_type text not null default 'text' check (note_type in ('text', 'todo', 'counter')),
  content jsonb not null default '[]'::jsonb,
  todo_items jsonb not null default '[]'::jsonb,
  todo_description text not null default '',
  counter_value integer not null default 0,
  counter_start_value integer not null default 1,
  counter_log jsonb not null default '[]'::jsonb,
  counter_description text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  color text check (color in ('green', 'blue', 'yellow', 'red')),
  visible_from_date date,
  created_by_uid uuid references public.app_profiles(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.project_dispo (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.project_dispo_layer (
  id uuid primary key default gen_random_uuid(),
  project_dispo_id uuid not null references public.project_dispo(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  position integer not null default 0,
  name text not null,
  profile_id uuid references public.app_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint project_dispo_layer_name_or_profile_check check (nullif(trim(name), '') is not null)
);

create table public.project_dispo_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  layer_id uuid not null references public.project_dispo_layer(id) on delete cascade,
  note_id uuid not null references public.project_kanban_notes(id) on delete cascade,
  week_start_date date,
  weekday smallint not null check (weekday between 0 and 6),
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.project_journal (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  content text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  created_by_uid uuid references public.app_profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_profiles
    where id = auth.uid()
      and is_admin = true
  );
$$;

create function public.build_holiday_request_history_text(request_row public.holiday_requests)
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

create function public.approve_holiday_request(
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
      abz_typ,
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
      case lower(coalesce(updated_request.request_type, ''))
        when 'ferien' then 1
        when 'fehlen' then 1
        when 'krankheit' then 2
        when 'militaer' then 3
        when 'zivildienst' then 3
        when 'unfall' then 4
        when 'feiertag' then 5
        when 'uk' then 6
        when 'ük' then 6
        when 'berufsschule' then 7
        else 0
      end,
      '07:00'::time,
      '16:30'::time,
      60,
      30,
      greatest(480, round((coalesce(profile.weekly_hours, 40) / 5.0) * 60.0)::integer),
      greatest(480, round((coalesce(profile.weekly_hours, 40) / 5.0) * 60.0)::integer),
      0,
      0,
      '',
      format('Automatisch aus bestätigter Absenz (%s).', initcap(replace(coalesce(updated_request.request_type, 'Absenz'), '_', ' '))),
      '',
      '[]'::jsonb
    from generate_series(updated_request.start_date, updated_request.end_date, interval '1 day') as work_day
    left join public.app_profiles profile
      on profile.id = updated_request.profile_id
    where extract(isodow from work_day) between 1 and 5
      and not exists (
        select 1
        from public.weekly_reports existing
        where existing.profile_id = updated_request.profile_id
          and existing.work_date = work_day::date
      );

    update public.holiday_requests
    set approval_status = 2
    where id = updated_request.id
    returning * into updated_request;
  end if;

  return updated_request;
end;
$$;

create function public.reject_holiday_request(
  p_request_id uuid,
  p_context text default 'Abgelehnt'
)
returns public.holiday_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_request public.holiday_requests%rowtype;
begin
  update public.holiday_requests
  set approval_status = 0
  where id = p_request_id
  returning * into updated_request;

  if not found then
    raise exception 'Absenzgesuch % wurde nicht gefunden.', p_request_id;
  end if;

  return updated_request;
end;
$$;

create function public.purge_user_account(
  p_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth, storage
as $$
begin
  if p_profile_id is null then
    raise exception 'Profil-ID fehlt.';
  end if;
  if not public.is_admin_user() then
    raise exception 'Nur Admin darf Benutzer restlos entfernen.';
  end if;
  if auth.uid() = p_profile_id then
    raise exception 'Eigenes Profil kann nicht gelöscht werden.';
  end if;

  delete from public.request_history where profile_id = p_profile_id;
  delete from public.holiday_requests where profile_id = p_profile_id;
  delete from public.weekly_reports where profile_id = p_profile_id;
  delete from public.daily_assignments where profile_id = p_profile_id;

  delete from auth.users
  where id = p_profile_id;
end;
$$;

create function public.report_is_confirmed(p_controll text)
returns boolean
language sql
immutable
as $$
  select nullif(trim(coalesce(p_controll, '')), '') is not null
$$;

create function public.weekly_report_matches_keyword(p_report public.weekly_reports, p_keyword text)
returns boolean
language sql
immutable
as $$
  select position(
    lower(coalesce(p_keyword, ''))
    in lower(
      concat_ws(
        ' ',
        coalesce(p_report.project_name, ''),
        coalesce(p_report.commission_number, ''),
        coalesce(p_report.notes, ''),
        coalesce(p_report.expense_note, '')
      )
    )
  ) > 0
$$;

create function public.weekly_report_base_adjusted_minutes(p_report public.weekly_reports)
returns integer
language sql
immutable
as $$
  select greatest(
    0,
    case
      when p_report.adjusted_work_minutes is not null and p_report.adjusted_work_minutes >= 0
        then p_report.adjusted_work_minutes
      else coalesce(p_report.total_work_minutes, 0)
    end
  )::integer
$$;

create function public.weekly_report_effective_minutes(p_report public.weekly_reports)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_base_minutes integer;
  v_has_holiday_minutes boolean;
begin
  v_base_minutes := public.weekly_report_base_adjusted_minutes(p_report);
  if public.weekly_report_matches_keyword(p_report, 'feiertag') then
    return v_base_minutes;
  end if;

  select exists (
    select 1
    from public.weekly_reports existing
    where existing.profile_id = p_report.profile_id
      and existing.work_date = p_report.work_date
      and existing.id <> p_report.id
      and public.weekly_report_matches_keyword(existing, 'feiertag')
  )
  into v_has_holiday_minutes;

  if v_has_holiday_minutes then
    return (v_base_minutes * 2)::integer;
  end if;

  return v_base_minutes;
end;
$$;

create function public.weekly_report_apply_profile_delta(p_profile_id uuid, p_reported_hours_delta numeric, p_booked_vacation_hours_delta numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.app_profiles
  set reported_hours = coalesce(reported_hours, 0) + coalesce(p_reported_hours_delta, 0),
      booked_vacation_hours = coalesce(booked_vacation_hours, 0) + coalesce(p_booked_vacation_hours_delta, 0)
  where id = p_profile_id;

  if not found then
    raise exception 'Profil % wurde nicht gefunden.', p_profile_id;
  end if;
end;
$$;

create function public.weekly_report_apply_confirmation_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hours numeric(10,2);
  v_is_vacation boolean;
begin
  if not public.report_is_confirmed(new.controll) then
    return new;
  end if;

  if tg_op = 'UPDATE' and public.report_is_confirmed(old.controll) then
    return new;
  end if;

  v_hours := public.weekly_report_effective_minutes(new)::numeric / 60.0;
  v_is_vacation := public.weekly_report_matches_keyword(new, 'ferien')
    or public.weekly_report_matches_keyword(new, 'fehlen');

  perform public.weekly_report_apply_profile_delta(
    new.profile_id,
    v_hours,
    case when v_is_vacation then v_hours else 0 end
  );
  return new;
end;
$$;

create function public.weekly_report_revert_confirmation_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hours numeric(10,2);
  v_is_vacation boolean;
begin
  if not public.report_is_confirmed(old.controll) then
    return old;
  end if;

  v_hours := public.weekly_report_effective_minutes(old)::numeric / 60.0;
  v_is_vacation := public.weekly_report_matches_keyword(old, 'ferien')
    or public.weekly_report_matches_keyword(old, 'fehlen');

  perform public.weekly_report_apply_profile_delta(
    old.profile_id,
    -v_hours,
    case when v_is_vacation then -v_hours else 0 end
  );
  return old;
end;
$$;

create function public.cleanup_confirmed_request_history_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linked_ids uuid[];
  v_request_type text;
  v_date_range text;
  v_start_date date;
  v_end_date date;
  v_expected_abz integer;
begin
  if old.profile_id is null then
    return old;
  end if;

  if old.context not like 'Bestätigt durch PL:%' then
    return old;
  end if;

  select array_agg(value::uuid)
  into v_linked_ids
  from jsonb_array_elements_text(coalesce(old.linked_weekly_report_ids, '[]'::jsonb));

  if coalesce(array_length(v_linked_ids, 1), 0) > 0 then
    delete from public.weekly_reports
    where profile_id = old.profile_id
      and id = any(v_linked_ids);
    return old;
  end if;

  v_request_type := lower(trim(split_part(old.request, '|', 1)));
  v_date_range := trim(split_part(old.request, '|', 2));

  if v_date_range like '% bis %' then
    if trim(split_part(v_date_range, ' bis ', 1)) ~ '^\d{4}-\d{2}-\d{2}$' then
      v_start_date := trim(split_part(v_date_range, ' bis ', 1))::date;
    end if;
    if trim(split_part(v_date_range, ' bis ', 2)) ~ '^\d{4}-\d{2}-\d{2}$' then
      v_end_date := trim(split_part(v_date_range, ' bis ', 2))::date;
    end if;
  end if;

  if v_start_date is null or v_end_date is null then
    return old;
  end if;

  v_expected_abz := case v_request_type
    when 'ferien' then 1
    when 'fehlen' then 1
    when 'krankheit' then 2
    when 'militaer' then 3
    when 'zivildienst' then 3
    when 'unfall' then 4
    when 'feiertag' then 5
    when 'uk' then 6
    when 'ük' then 6
    when 'berufsschule' then 7
    else null
  end;

  delete from public.weekly_reports
  where profile_id = old.profile_id
    and work_date between v_start_date and v_end_date
    and controll is not null
    and nullif(trim(controll), '') is not null
    and notes like 'Automatisch aus bestätigter Absenz (%)%'
    and (v_expected_abz is null or abz_typ = v_expected_abz);

  return old;
end;
$$;

create function public.prevent_confirmed_weekly_report_changes()
returns trigger
language plpgsql
as $$
declare
  v_old_payload jsonb;
  v_new_payload jsonb;
begin
  if not public.report_is_confirmed(old.controll) then
    return new;
  end if;

  v_old_payload := to_jsonb(old) - 'updated_at';
  v_new_payload := to_jsonb(new) - 'updated_at';

  if v_old_payload = v_new_payload then
    return new;
  end if;

  raise exception 'Bestätigte Wochenrapporte sind gesperrt und dürfen nicht mehr bearbeitet werden.';
end;
$$;

create index weekly_reports_profile_work_date_idx on public.weekly_reports (profile_id, work_date);
create index weekly_reports_year_kw_idx on public.weekly_reports (year, kw);
create index holiday_requests_profile_dates_idx on public.holiday_requests (profile_id, start_date, end_date);
create index request_history_profile_created_at_idx on public.request_history (profile_id, created_at desc);
create index daily_assignments_profile_date_idx on public.daily_assignments (profile_id, assignment_date);
create index crm_contacts_last_name_idx on public.crm_contacts (last_name, first_name);
create index project_kanban_notes_project_status_position_idx on public.project_kanban_notes (project_id, status, position);
create index project_kanban_notes_project_visible_from_date_idx on public.project_kanban_notes (project_id, visible_from_date);
create index project_dispo_layer_project_dispo_position_idx on public.project_dispo_layer (project_dispo_id, position);
create index project_dispo_items_layer_weekday_position_idx on public.project_dispo_items (layer_id, weekday, position);
create index project_dispo_items_layer_week_start_weekday_position_idx on public.project_dispo_items (layer_id, week_start_date, weekday, position);
create index project_dispo_items_project_idx on public.project_dispo_items (project_id);
create index project_journal_project_created_at_idx on public.project_journal (project_id, created_at desc);

create trigger set_updated_at_app_profiles
before update on public.app_profiles
for each row execute function public.set_updated_at();

create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create trigger set_updated_at_weekly_reports
before update on public.weekly_reports
for each row execute function public.set_updated_at();

create trigger prevent_confirmed_weekly_report_changes
before update on public.weekly_reports
for each row execute function public.prevent_confirmed_weekly_report_changes();

create trigger weekly_report_apply_confirmation_booking
after insert or update on public.weekly_reports
for each row execute function public.weekly_report_apply_confirmation_booking();

create trigger weekly_report_revert_confirmation_booking
after delete on public.weekly_reports
for each row execute function public.weekly_report_revert_confirmation_booking();

create trigger cleanup_confirmed_request_history_booking
after delete on public.request_history
for each row execute function public.cleanup_confirmed_request_history_booking();

create trigger set_updated_at_holiday_requests
before update on public.holiday_requests
for each row execute function public.set_updated_at();

create trigger set_updated_at_daily_assignments
before update on public.daily_assignments
for each row execute function public.set_updated_at();

create trigger set_updated_at_crm_contacts
before update on public.crm_contacts
for each row execute function public.set_updated_at();

create trigger set_updated_at_project_kanban_notes
before update on public.project_kanban_notes
for each row execute function public.set_updated_at();

create trigger set_updated_at_school_vacations
before update on public.school_vacations
for each row execute function public.set_updated_at();

create trigger set_updated_at_project_dispo
before update on public.project_dispo
for each row execute function public.set_updated_at();

create trigger set_updated_at_project_dispo_layer
before update on public.project_dispo_layer
for each row execute function public.set_updated_at();

create trigger set_updated_at_project_dispo_items
before update on public.project_dispo_items
for each row execute function public.set_updated_at();

create trigger set_updated_at_project_journal
before update on public.project_journal
for each row execute function public.set_updated_at();

alter table public.app_profiles enable row level security;
alter table public.projects enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.holiday_requests enable row level security;
alter table public.request_history enable row level security;
alter table public.daily_assignments enable row level security;
alter table public.platform_holidays enable row level security;
alter table public.school_vacations enable row level security;
alter table public.crm_contacts enable row level security;
alter table public.project_kanban_notes enable row level security;
alter table public.project_dispo enable row level security;
alter table public.project_dispo_layer enable row level security;
alter table public.project_dispo_items enable row level security;
alter table public.project_journal enable row level security;

create policy "app_profiles own or admin"
on public.app_profiles
for select
to authenticated
using (public.is_admin_user() or auth.uid() = id);

create policy "app_profiles insert own or admin"
on public.app_profiles
for insert
to authenticated
with check (public.is_admin_user() or auth.uid() = id);

create policy "app_profiles update own or admin"
on public.app_profiles
for update
to authenticated
using (public.is_admin_user() or auth.uid() = id)
with check (public.is_admin_user() or auth.uid() = id);

create policy "app_profiles delete own or admin"
on public.app_profiles
for delete
to authenticated
using (public.is_admin_user() or auth.uid() = id);

create policy "projects own or admin"
on public.projects
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

create policy "weekly_reports own or admin"
on public.weekly_reports
for all
to authenticated
using (public.is_admin_user() or auth.uid() = profile_id)
with check (public.is_admin_user() or auth.uid() = profile_id);

create policy "holiday_requests own or admin"
on public.holiday_requests
for all
to authenticated
using (public.is_admin_user() or auth.uid() = profile_id)
with check (public.is_admin_user() or auth.uid() = profile_id);

create policy "daily_assignments own or admin"
on public.daily_assignments
for all
to authenticated
using (public.is_admin_user() or auth.uid() = profile_id)
with check (public.is_admin_user() or auth.uid() = profile_id);

create policy "platform_holidays read authenticated"
on public.platform_holidays
for select
to authenticated
using (auth.role() = 'authenticated');

create policy "platform_holidays write admin"
on public.platform_holidays
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

create policy "crm_contacts admin access"
on public.crm_contacts
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

create policy "school_vacations admin access"
on public.school_vacations
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

create policy "project_kanban_notes read authenticated"
on public.project_kanban_notes
for select
to authenticated
using (true);

create policy "project_kanban_notes write admin"
on public.project_kanban_notes
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

create policy "project_dispo read authenticated"
on public.project_dispo
for select
to authenticated
using (true);

create policy "project_dispo write admin"
on public.project_dispo
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

create policy "project_dispo_layer read authenticated"
on public.project_dispo_layer
for select
to authenticated
using (true);

create policy "project_dispo_layer write admin"
on public.project_dispo_layer
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

create policy "project_dispo_items read authenticated"
on public.project_dispo_items
for select
to authenticated
using (true);

create policy "project_dispo_items write admin"
on public.project_dispo_items
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

create policy "project_journal read authenticated"
on public.project_journal
for select
to authenticated
using (true);

create policy "project_journal write admin"
on public.project_journal
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

create policy "request_history own or admin"
on public.request_history
for all
to authenticated
using (public.is_admin_user() or auth.uid() = profile_id)
with check (public.is_admin_user() or auth.uid() = profile_id);

insert into storage.buckets (id, name, public)
values ('weekly-attachments', 'weekly-attachments', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('project-kanban-attachments', 'project-kanban-attachments', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('project-journal-attachments', 'project-journal-attachments', false)
on conflict (id) do nothing;

create policy "weekly attachment read own or admin"
on storage.objects
for select
to authenticated
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
to authenticated
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

create policy "project kanban attachment read own or admin"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'project-kanban-attachments'
  and (
    public.is_admin_user()
    or auth.uid()::text = split_part(name, '/', 1)
  )
);

create policy "project kanban attachment write own or admin"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'project-kanban-attachments'
  and (
    public.is_admin_user()
    or auth.uid()::text = split_part(name, '/', 1)
  )
)
with check (
  bucket_id = 'project-kanban-attachments'
  and (
    public.is_admin_user()
    or auth.uid()::text = split_part(name, '/', 1)
  )
);

create policy "project journal attachment read own or admin"
on storage.objects
for select
to authenticated
using (bucket_id = 'project-journal-attachments');

create policy "project journal attachment write own or admin"
on storage.objects
for all
to authenticated
using (bucket_id = 'project-journal-attachments' and public.is_admin_user())
with check (bucket_id = 'project-journal-attachments' and public.is_admin_user());
