-- Book reported hours for auto-generated approved absences (except Feiertag).
-- Avoid double booking when such reports are later manually confirmed.

create or replace function public.weekly_report_should_book_reported_hours(p_report public.weekly_reports)
returns boolean
language sql
immutable
as $$
  select public.report_is_confirmed(coalesce(p_report.controll, ''))
    or (
      coalesce(p_report.notes, '') like 'Automatisch aus bestätigter Absenz (%)%'
      and not public.weekly_report_matches_keyword(p_report, 'feiertag')
    )
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
  v_new_should_book boolean;
  v_old_should_book boolean;
begin
  v_new_should_book := public.weekly_report_should_book_reported_hours(new);
  if not v_new_should_book then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old_should_book := public.weekly_report_should_book_reported_hours(old);
    if v_old_should_book then
      return new;
    end if;
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
  if not public.weekly_report_should_book_reported_hours(old) then
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
