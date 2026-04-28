-- Fix reported hour booking for confirmations when reports use total_adjusted_work_minutes.
create or replace function public.weekly_report_base_adjusted_minutes(p_report public.weekly_reports)
returns integer
language sql
immutable
as $$
  select greatest(
    0,
    coalesce(
      (to_jsonb(p_report)->>'total_adjusted_work_minutes')::integer,
      case
        when p_report.adjusted_work_minutes is not null and p_report.adjusted_work_minutes >= 0
          then p_report.adjusted_work_minutes
        else null
      end,
      coalesce(p_report.total_work_minutes, 0)
    )
  )::integer
$$;
