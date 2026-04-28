-- Ensure weekly_hours supports decimal values on existing databases.
alter table public.app_profiles
alter column weekly_hours type numeric(10,2)
using weekly_hours::numeric(10,2);
