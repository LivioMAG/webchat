alter table public.project_kanban_notes
add column if not exists color text;

alter table public.project_kanban_notes
drop constraint if exists project_kanban_notes_color_check;

alter table public.project_kanban_notes
add constraint project_kanban_notes_color_check
check (color in ('green', 'blue', 'yellow', 'red'));
