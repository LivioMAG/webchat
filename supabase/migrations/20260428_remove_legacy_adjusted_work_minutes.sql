-- Remove legacy adjusted_work_minutes usage.
-- Keep only total_adjusted_work_minutes + total_work_minutes as minute sources.

alter table public.weekly_reports
add column if not exists total_adjusted_work_minutes integer not null default 0;

update public.weekly_reports
set total_adjusted_work_minutes = greatest(0, coalesce(total_adjusted_work_minutes, adjusted_work_minutes, 0))
where coalesce(total_adjusted_work_minutes, 0) = 0
  and coalesce(adjusted_work_minutes, 0) > 0;

alter table public.weekly_reports
drop column if exists adjusted_work_minutes;

create or replace function public.weekly_report_total_adjusted_hours(p_report public.weekly_reports)
returns numeric(10,2)
language sql
immutable
as $$
  with parsed as (
    select
      greatest(
        0,
        coalesce(
          case
            when nullif(trim(coalesce(to_jsonb(p_report)->>'total_adjusted_work_minutes', '')), '') ~ '^-?[0-9]+([.,][0-9]+)?$'
              then replace(nullif(trim(coalesce(to_jsonb(p_report)->>'total_adjusted_work_minutes', '')), ''), ',', '.')::numeric
            else null
          end,
          0
        )
      ) as adjusted_minutes,
      greatest(
        0,
        coalesce(
          case
            when nullif(trim(coalesce(to_jsonb(p_report)->>'total_work_minutes', '')), '') ~ '^-?[0-9]+([.,][0-9]+)?$'
              then replace(nullif(trim(coalesce(to_jsonb(p_report)->>'total_work_minutes', '')), ''), ',', '.')::numeric
            else null
          end,
          0
        )
      ) as total_minutes
  )
  select round(
    case
      when adjusted_minutes = 0 and total_minutes <> 0 then total_minutes / 60.0
      else adjusted_minutes / 60.0
    end,
    2
  )::numeric(10,2)
  from parsed
$$;
