-- Keep booking logic inside existing trigger functions.
drop function if exists public.weekly_report_should_book_reported_hours(public.weekly_reports);
