alter table public.project_kanban_notes
  alter column content drop default;

alter table public.project_kanban_notes
  alter column content type jsonb
  using (
    case
      when content is null or btrim(content) = '' then '[]'::jsonb
      when left(btrim(content), 1) = '[' then content::jsonb
      else jsonb_build_array(
        jsonb_build_object(
          'id', gen_random_uuid(),
          'author_type', 'user',
          'user_id', created_by_uid,
          'uid', created_by_uid,
          'first_name', split_part(created_by_name, ' ', 1),
          'last_name', nullif(trim(substring(created_by_name from position(' ' in created_by_name) + 1)), ''),
          'full_name', created_by_name,
          'text', content,
          'created_at', coalesce(updated_at, created_at, timezone('utc', now()))
        )
      )
    end
  );

alter table public.project_kanban_notes
  alter column content set default '[]'::jsonb;
