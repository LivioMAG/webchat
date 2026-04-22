alter table public.platform_holidays enable row level security;

drop policy if exists "platform_holidays read authenticated" on public.platform_holidays;
drop policy if exists "platform_holidays write admin" on public.platform_holidays;

create policy "platform_holidays read authenticated"
on public.platform_holidays
for select
using (auth.role() = 'authenticated');

create policy "platform_holidays write admin"
on public.platform_holidays
for all
using (public.is_admin_user())
with check (public.is_admin_user());
