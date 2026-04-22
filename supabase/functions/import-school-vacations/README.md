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

- **Testmodus:** Der OpenAI API-Key ist im File `index.ts` als Konstante vorgesehen (`OPENAI_API_KEY`) und aktuell als Platzhalter gesetzt.
- Für Produktion sollte der Schlüssel **nicht hardcoded** sein, sondern als Secret/Environment Variable gesetzt werden.
- Die Function schreibt die gefundenen Zeiträume direkt in `school_vacations` (Insert).

## Deploy

```bash
supabase functions deploy import-school-vacations
```
