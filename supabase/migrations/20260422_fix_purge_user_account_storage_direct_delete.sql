-- Supabase no longer permits direct deletes from storage.objects.
-- Keep account purge focused on relational records/auth user deletion.
create or replace function public.purge_user_account(
  p_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth, storage
as $$
begin
  if p_profile_id is null then
    raise exception 'Profil-ID fehlt.';
  end if;
  if not public.is_admin_user() then
    raise exception 'Nur Admin darf Benutzer restlos entfernen.';
  end if;
  if auth.uid() = p_profile_id then
    raise exception 'Eigenes Profil kann nicht gelöscht werden.';
  end if;


  -- Remove profile-owned data explicitly (even where FK would cascade) so the
  -- behavior is deterministic and easy to reason about.
  delete from public.request_history where profile_id = p_profile_id;
  delete from public.holiday_requests where profile_id = p_profile_id;
  delete from public.weekly_reports where profile_id = p_profile_id;
  delete from public.daily_assignments where profile_id = p_profile_id;

  -- Storage files must be deleted through the Storage API (client-side/admin flow).
  delete from auth.users
  where id = p_profile_id;
end;
$$;
