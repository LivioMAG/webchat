-- Keep saldo booking in the existing confirmation trigger function:
-- Any explicitly confirmed report books reported_hours.
-- Vacation entries also book booked_vacation_hours.

create or replace function public.weekly_report_apply_confirmation_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hours numeric(10,2);
  v_is_vacation boolean;
  v_new_confirmed boolean;
  v_old_confirmed boolean;
begin
  v_new_confirmed := public.report_is_confirmed(public.weekly_report_confirmation_value(new));
  if not v_new_confirmed then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old_confirmed := public.report_is_confirmed(public.weekly_report_confirmation_value(old));
    if v_old_confirmed then
      return new;
    end if;
  end if;

  v_hours := public.weekly_report_effective_minutes(new)::numeric / 60.0;
  v_is_vacation := coalesce(new.abz_typ, 0) = 1
    or public.weekly_report_matches_keyword(new, 'ferien')
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
  v_old_confirmed boolean;
begin
  v_old_confirmed := public.report_is_confirmed(public.weekly_report_confirmation_value(old));
  if not v_old_confirmed then
    return old;
  end if;

  v_hours := public.weekly_report_effective_minutes(old)::numeric / 60.0;
  v_is_vacation := coalesce(old.abz_typ, 0) = 1
    or public.weekly_report_matches_keyword(old, 'ferien')
    or public.weekly_report_matches_keyword(old, 'fehlen');

  perform public.weekly_report_apply_profile_delta(
    old.profile_id,
    -v_hours,
    case when v_is_vacation then -v_hours else 0 end
  );
  return old;
end;
$$;
