alter table public.project_dispo_items
add column if not exists week_start_date date;

create index if not exists project_dispo_items_layer_week_start_weekday_position_idx
on public.project_dispo_items (layer_id, week_start_date, weekday, position);
