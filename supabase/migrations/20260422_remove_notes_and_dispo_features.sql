-- Remove notes/dispo persistence artifacts.
drop table if exists public.project_disco_entries;
drop table if exists public.project_disco_layers;
drop table if exists public.notes;

-- Supabase forbids direct DELETE on storage.objects (trigger storage.protect_delete()).
-- Remove files in this bucket via the Storage API first, then optionally drop the bucket.
do $$
begin
  delete from storage.buckets where id = 'crm-note-attachments';
exception
  when foreign_key_violation then
    raise notice 'Skipping drop of storage bucket crm-note-attachments: bucket still contains objects. Delete objects via Storage API first.';
end
$$;
