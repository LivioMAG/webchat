-- Align saldo columns with the new model (no overtime/carryover legacy fields).

alter table public.app_profiles
add column if not exists created_holiday_hours numeric(10,2) not null default 0;

update public.app_profiles
set booked_vacations_hours = coalesce(booked_vacations_hours, 0) + coalesce(booked_vacation_hours, 0)
where coalesce(booked_vacation_hours, 0) <> 0;

alter table public.app_profiles
  drop column if exists vacation_allowance_hours,
  drop column if exists carryover_overtime_hours,
  drop column if exists reported_hours,
  drop column if exists booked_vacation_hours;
