-- Remove notes/dispo persistence artifacts.
drop table if exists public.project_disco_entries;
drop table if exists public.project_disco_layers;
drop table if exists public.notes;

delete from storage.objects where bucket_id = 'crm-note-attachments';
delete from storage.buckets where id = 'crm-note-attachments';
