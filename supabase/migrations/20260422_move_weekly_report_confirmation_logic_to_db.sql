-- Move weekly report confirmation/saldo logic from frontend to DB
-- NOTE: Existing column names in this project use `controll` (double l).
-- TODO: If your real DB uses `control`, rename all references accordingly.

create or replace function public.report_is_confirmed(p_controll text)
returns boolean
language sql
immutable
as $$
  select nullif(trim(coalesce(p_controll, '')), '') is not null
$$;

create or replace function public.weekly_report_confirmation_value(p_report public.weekly_reports)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(trim(coalesce(to_jsonb(p_report)->>'controll', '')), ''),
    nullif(trim(coalesce(to_jsonb(p_report)->>'control', '')), '')
  )
$$;

create or replace function public.weekly_report_matches_keyword(p_report public.weekly_reports, p_keyword text)
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

create or replace function public.weekly_report_base_adjusted_minutes(p_report public.weekly_reports)
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

create or replace function public.weekly_report_effective_minutes(p_report public.weekly_reports)
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

create or replace function public.weekly_report_apply_profile_delta(p_profile_id uuid, p_reported_hours_delta numeric, p_booked_vacation_hours_delta numeric)
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

create or replace function public.weekly_report_apply_confirmation_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hours numeric(10,2);
  v_is_vacation boolean;
begin
  if not public.report_is_confirmed(public.weekly_report_confirmation_value(new)) then
    return new;
  end if;

  if tg_op = 'UPDATE' and public.report_is_confirmed(public.weekly_report_confirmation_value(old)) then
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

create or replace function public.weekly_report_revert_confirmation_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hours numeric(10,2);
  v_is_vacation boolean;
begin
  if not public.report_is_confirmed(public.weekly_report_confirmation_value(old)) then
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

create or replace function public.prevent_confirmed_weekly_report_changes()
returns trigger
language plpgsql
as $$
declare
  v_old_payload jsonb;
  v_new_payload jsonb;
begin
  if not public.report_is_confirmed(public.weekly_report_confirmation_value(old)) then
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

drop trigger if exists prevent_confirmed_weekly_report_changes on public.weekly_reports;
create trigger prevent_confirmed_weekly_report_changes
before update on public.weekly_reports
for each row
execute function public.prevent_confirmed_weekly_report_changes();

drop trigger if exists weekly_report_apply_confirmation_booking on public.weekly_reports;
create trigger weekly_report_apply_confirmation_booking
after insert or update on public.weekly_reports
for each row
execute function public.weekly_report_apply_confirmation_booking();

drop trigger if exists weekly_report_revert_confirmation_booking on public.weekly_reports;
create trigger weekly_report_revert_confirmation_booking
after delete on public.weekly_reports
for each row
execute function public.weekly_report_revert_confirmation_booking();
