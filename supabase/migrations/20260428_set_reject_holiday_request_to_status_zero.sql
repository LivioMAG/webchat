create or replace function public.reject_holiday_request(
  p_request_id uuid,
  p_context text default 'Abgelehnt'
)
returns public.holiday_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_request public.holiday_requests%rowtype;
begin
  update public.holiday_requests
  set approval_status = 0
  where id = p_request_id
  returning * into updated_request;

  if not found then
    raise exception 'Absenzgesuch % wurde nicht gefunden.', p_request_id;
  end if;

  return updated_request;
end;
$$;
