# import-school-vacations (Supabase Edge Function)

Diese Edge Function lädt Schulferien für ein ausgewähltes Schuljahr und einen Kanton via LLM-Recherche und speichert die Zeitfenster in `school_vacations`.

## Request

`POST /functions/v1/import-school-vacations`

```json
{
  "canton": "LU",
  "schoolYear": "2026/27"
}
```

Unterstützte Kantone: `LU`, `BE`, `SO`, `ZH`  
Unterstützte Schuljahre: `2025/26` bis `2029/30`

## Response

```json
{
  "importedCount": 3,
  "ranges": [
    { "start_date": "2026-12-21", "end_date": "2027-01-03" }
  ]
}
```

## Wichtige Hinweise

- Der OpenAI API-Key ist aktuell im File `index.ts` hart codiert (`OPENAI_API_KEY`).
- Das Modell ist ebenfalls direkt im Code gesetzt (`OPENAI_MODEL = gpt-4.1-mini`).
- Die Function schreibt die gefundenen Zeiträume direkt in `school_vacations` (Insert).

## Deploy

```bash
supabase functions deploy import-school-vacations
```
