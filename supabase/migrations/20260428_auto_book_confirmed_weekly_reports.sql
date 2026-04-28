-- Automatically book profile hours when weekly reports are confirmed via `controll`.
-- Booking is only applied once on transition from unconfirmed -> confirmed.

alter table public.app_profiles
add column if not exists booked_reported_hours numeric(10,2) not null default 0;

alter table public.app_profiles
add column if not exists booked_vacations_hours numeric(10,2) not null default 0;

alter table public.app_profiles
add column if not exists booked_unpaid_holiday_hours numeric(10,2) not null default 0;

create or replace function public.weekly_report_total_adjusted_hours(p_report public.weekly_reports)
returns numeric(10,2)
language sql
immutable
as $$
  select round(
    greatest(
      0,
      coalesce(
        (case
          when nullif(trim(coalesce(to_jsonb(p_report)->>'total_adjusted_work_time', '')), '') ~ '^-?[0-9]+([.,][0-9]+)?$'
            then replace(nullif(trim(coalesce(to_jsonb(p_report)->>'total_adjusted_work_time', '')), ''), ',', '.')::numeric
          else null
        end),
        (case
          when nullif(trim(coalesce(to_jsonb(p_report)->>'total_adjusted_work_minutes', '')), '') ~ '^-?[0-9]+([.,][0-9]+)?$'
            then replace(nullif(trim(coalesce(to_jsonb(p_report)->>'total_adjusted_work_minutes', '')), ''), ',', '.')::numeric / 60.0
          when nullif(trim(coalesce(to_jsonb(p_report)->>'adjusted_work_minutes', '')), '') ~ '^-?[0-9]+([.,][0-9]+)?$'
            then replace(nullif(trim(coalesce(to_jsonb(p_report)->>'adjusted_work_minutes', '')), ''), ',', '.')::numeric / 60.0
          when nullif(trim(coalesce(to_jsonb(p_report)->>'total_work_minutes', '')), '') ~ '^-?[0-9]+([.,][0-9]+)?$'
            then replace(nullif(trim(coalesce(to_jsonb(p_report)->>'total_work_minutes', '')), ''), ',', '.')::numeric / 60.0
          else null
        end),
        0
      )
    ),
    2
  )::numeric(10,2)
$$;

create or replace function public.weekly_report_book_confirmation_hours()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hours numeric(10,2);
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if public.report_is_confirmed(old.controll) then
    return new;
  end if;

  if not public.report_is_confirmed(new.controll) then
    return new;
  end if;

  v_hours := coalesce(public.weekly_report_total_adjusted_hours(new), 0);

  update public.app_profiles
  set booked_reported_hours = coalesce(booked_reported_hours, 0) + v_hours,
      reported_hours = coalesce(reported_hours, 0) + v_hours,
      booked_vacations_hours = coalesce(booked_vacations_hours, 0)
        + case when coalesce(new.abz_typ, 0) = 1 then v_hours else 0 end,
      booked_vacation_hours = coalesce(booked_vacation_hours, 0)
        + case when coalesce(new.abz_typ, 0) = 1 then v_hours else 0 end,
      booked_unpaid_holiday_hours = coalesce(booked_unpaid_holiday_hours, 0)
        + case when coalesce(new.abz_typ, 0) = 9 then v_hours else 0 end
  where id = new.profile_id;

  if not found then
    raise exception 'Profil % wurde nicht gefunden.', new.profile_id;
  end if;

  return new;
end;
$$;

drop trigger if exists weekly_report_book_confirmation_hours on public.weekly_reports;
create trigger weekly_report_book_confirmation_hours
after update of controll on public.weekly_reports
for each row
execute function public.weekly_report_book_confirmation_hours();
