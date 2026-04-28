-- Ensure confirmation booking always uses a non-zero work-time source when available.
-- Priority:
-- 1) total_adjusted_work_minutes / adjusted_work_minutes
-- 2) fallback to total_work_minutes only when adjusted minutes resolve to 0

create or replace function public.weekly_report_base_adjusted_minutes(p_report public.weekly_reports)
returns integer
language sql
immutable
as $$
  with parsed as (
    select
      greatest(
        0,
        coalesce(
          case
            when nullif(trim(coalesce(to_jsonb(p_report)->>'total_adjusted_work_minutes', '')), '') ~ '^-?[0-9]+$'
              then (nullif(trim(coalesce(to_jsonb(p_report)->>'total_adjusted_work_minutes', '')), ''))::integer
            else null
          end,
          case
            when p_report.adjusted_work_minutes is not null and p_report.adjusted_work_minutes >= 0
              then p_report.adjusted_work_minutes
            else null
          end,
          0
        )
      )::integer as adjusted_minutes,
      greatest(0, coalesce(p_report.total_work_minutes, 0))::integer as total_minutes
  )
  select case
    when adjusted_minutes = 0 and total_minutes <> 0 then total_minutes
    else adjusted_minutes
  end
  from parsed
$$;
