# Wochenrapport Webplattform

Statische Desktop-Webplattform mit HTML, CSS und JavaScript für:

- Login über Supabase Auth
- zentrale Wochenrapport-Übersicht mit Wochenfilter
- separate Seite für Ferien- und Absenzanträge
- Vollzugriff auf die Web-Visualisierung nur für Profile mit `app_profiles.is_admin = true`
- kombinierten PDF-Export pro Kalenderwoche inklusive fehlender Rapporte und Bildanhängen

## Dateien

- `index.html`: Layout der Webplattform
- `style.css`: Desktop-/Responsive-Styling
- `script.js`: Login, Supabase-Integration, Datenabfragen, Rendering und PDF-Export
- `supabase-schema.sql`: Tabellen, Trigger, RLS und Storage-Policies mit Vollzugriff über `is_admin`
- `supabase-config.example.json`: Vorlage für die lokale Supabase-Konfiguration

## Lokale Nutzung

1. `supabase-config.example.json` nach `supabase-config.json` kopieren.
2. Projekt-URL und Anon-Key eintragen.
3. Die Seite über einen statischen Webserver öffnen, z. B.:
   - `python3 -m http.server 4173`
4. Dann im Browser `http://localhost:4173` öffnen.

## Hinweise

- Ohne `supabase-config.json` läuft die Oberfläche automatisch im Demo-Modus.
- Für den produktiven Einsatz muss das SQL aus `supabase-schema.sql` im Supabase-Projekt
  ausgeführt werden, damit Profile mit `is_admin = true` die Daten im Frontend vollständig
  sehen und bearbeiten können.
- Der PDF-Export nutzt `jsPDF` und `jspdf-autotable` direkt per CDN.
