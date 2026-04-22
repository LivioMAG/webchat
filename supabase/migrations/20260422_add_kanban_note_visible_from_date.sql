alter table public.project_kanban_notes
add column if not exists visible_from_date date;

create index if not exists project_kanban_notes_project_visible_from_date_idx
on public.project_kanban_notes (project_id, visible_from_date);
