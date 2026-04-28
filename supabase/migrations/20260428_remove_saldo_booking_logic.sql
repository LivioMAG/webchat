-- Remove automatic saldo booking from weekly report confirmation and absence-derived reports.

drop trigger if exists weekly_report_apply_confirmation_booking on public.weekly_reports;
drop trigger if exists weekly_report_revert_confirmation_booking on public.weekly_reports;

drop function if exists public.weekly_report_apply_confirmation_booking();
drop function if exists public.weekly_report_revert_confirmation_booking();
drop function if exists public.weekly_report_apply_profile_delta(uuid, numeric, numeric);
drop function if exists public.weekly_report_effective_minutes(public.weekly_reports);
drop function if exists public.weekly_report_base_adjusted_minutes(public.weekly_reports);
drop function if exists public.weekly_report_matches_keyword(public.weekly_reports, text);
drop function if exists public.weekly_report_should_book_reported_hours(public.weekly_reports);
