# import-public-holidays (Supabase Edge Function)

Diese Edge Function lädt Feiertage für ein ausgewähltes Jahr und einen Kanton via LLM-Recherche und speichert nur Montag-bis-Freitag-Einträge in `platform_holidays`.

## Request

`POST /functions/v1/import-public-holidays`

```json
{
  "canton": "LU",
  "year": 2026
}
```

Unterstützte Kantone: `LU`, `BE`, `SO`, `ZH`  
Unterstützte Jahre: aktuelles Jahr bis aktuelles Jahr + 4

## Response

```json
{
  "importedCount": 4,
  "holidays": [
    { "holiday_date": "2026-01-01", "label": "Neujahr", "is_paid": true }
  ]
}
```

## Wichtige Hinweise

- Die Function ignoriert Feiertage am Samstag/Sonntag.
- Falls unklar ist, ob ein Feiertag bezahlt ist, wird `is_paid = false` gesetzt.
- Der OpenAI API-Key ist aktuell im File `index.ts` hart codiert (`OPENAI_API_KEY`).

## Deploy

```bash
supabase functions deploy import-public-holidays
```
