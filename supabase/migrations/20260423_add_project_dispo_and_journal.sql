create table if not exists public.project_dispo (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_dispo_layer (
  id uuid primary key default gen_random_uuid(),
  project_dispo_id uuid not null references public.project_dispo(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  position integer not null default 0,
  name text not null,
  profile_id uuid references public.app_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_dispo_layer_name_or_profile_check check (nullif(trim(name), '') is not null)
);

create table if not exists public.project_dispo_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  layer_id uuid not null references public.project_dispo_layer(id) on delete cascade,
  note_id uuid not null references public.project_kanban_notes(id) on delete cascade,
  weekday smallint not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_dispo_items_weekday_check check (weekday between 0 and 6)
);

create table if not exists public.project_journal (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  content text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  created_by_uid uuid references public.app_profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_dispo_layer_project_dispo_position_idx
on public.project_dispo_layer (project_dispo_id, position);

create index if not exists project_dispo_items_layer_weekday_position_idx
on public.project_dispo_items (layer_id, weekday, position);

create index if not exists project_dispo_items_project_idx
on public.project_dispo_items (project_id);

create index if not exists project_journal_project_created_at_idx
on public.project_journal (project_id, created_at desc);

alter table public.project_dispo enable row level security;
alter table public.project_dispo_layer enable row level security;
alter table public.project_dispo_items enable row level security;
alter table public.project_journal enable row level security;

drop policy if exists "project_dispo read authenticated" on public.project_dispo;
create policy "project_dispo read authenticated"
on public.project_dispo
for select
to authenticated
using (true);

drop policy if exists "project_dispo write admin" on public.project_dispo;
create policy "project_dispo write admin"
on public.project_dispo
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists "project_dispo_layer read authenticated" on public.project_dispo_layer;
create policy "project_dispo_layer read authenticated"
on public.project_dispo_layer
for select
to authenticated
using (true);

drop policy if exists "project_dispo_layer write admin" on public.project_dispo_layer;
create policy "project_dispo_layer write admin"
on public.project_dispo_layer
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists "project_dispo_items read authenticated" on public.project_dispo_items;
create policy "project_dispo_items read authenticated"
on public.project_dispo_items
for select
to authenticated
using (true);

drop policy if exists "project_dispo_items write admin" on public.project_dispo_items;
create policy "project_dispo_items write admin"
on public.project_dispo_items
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists "project_journal read authenticated" on public.project_journal;
create policy "project_journal read authenticated"
on public.project_journal
for select
to authenticated
using (true);

drop policy if exists "project_journal write admin" on public.project_journal;
create policy "project_journal write admin"
on public.project_journal
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

insert into storage.buckets (id, name, public)
values ('project-journal-attachments', 'project-journal-attachments', false)
on conflict (id) do nothing;

drop policy if exists "project journal attachment read own or admin" on storage.objects;
create policy "project journal attachment read own or admin"
on storage.objects
for select
to authenticated
using (bucket_id = 'project-journal-attachments');

drop policy if exists "project journal attachment write own or admin" on storage.objects;
create policy "project journal attachment write own or admin"
on storage.objects
for all
to authenticated
using (bucket_id = 'project-journal-attachments' and public.is_admin_user())
with check (bucket_id = 'project-journal-attachments' and public.is_admin_user());

drop trigger if exists set_updated_at_project_dispo on public.project_dispo;
create trigger set_updated_at_project_dispo
before update on public.project_dispo
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_project_dispo_layer on public.project_dispo_layer;
create trigger set_updated_at_project_dispo_layer
before update on public.project_dispo_layer
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_project_dispo_items on public.project_dispo_items;
create trigger set_updated_at_project_dispo_items
before update on public.project_dispo_items
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_project_journal on public.project_journal;
create trigger set_updated_at_project_journal
before update on public.project_journal
for each row execute function public.set_updated_at();
