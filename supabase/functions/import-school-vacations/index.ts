import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

type VacationRange = {
  start_date: string
  end_date: string
}

type ImportRequest = {
  canton?: string
  schoolYear?: string
}

const OPENAI_API_KEY = 'REPLACE_WITH_TEST_API_KEY'
const SUPPORTED_CANTONS = new Set(['LU', 'BE', 'SO', 'ZH'])
const SUPPORTED_SCHOOL_YEARS = new Set(['2025/26', '2026/27', '2027/28', '2028/29', '2029/30'])

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Only POST requests are supported.' }, 405)
  }

  try {
    const payload = await req.json() as ImportRequest
    const canton = String(payload?.canton || '').trim().toUpperCase()
    const schoolYear = String(payload?.schoolYear || '').trim()

    if (!SUPPORTED_CANTONS.has(canton)) {
      return jsonResponse({ error: 'Unsupported canton.' }, 400)
    }
    if (!SUPPORTED_SCHOOL_YEARS.has(schoolYear)) {
      return jsonResponse({ error: 'Unsupported school year.' }, 400)
    }

    if (!OPENAI_API_KEY || OPENAI_API_KEY.startsWith('REPLACE_')) {
      return jsonResponse({ error: 'OpenAI API key is missing in function source.' }, 500)
    }

    const vacationRanges = await researchSchoolVacations(canton, schoolYear)
    if (!vacationRanges.length) {
      return jsonResponse({ importedCount: 0, ranges: [] })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return jsonResponse({ error: 'Missing Supabase environment variables.' }, 500)
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)
    const { data: existingRows, error: existingError } = await supabase
      .from('school_vacations')
      .select('start_date,end_date')
    if (existingError) {
      throw existingError
    }
    const existingKeys = new Set(
      (existingRows || []).map((entry) => `${entry.start_date}__${entry.end_date}`)
    )
    const rowsToInsert = vacationRanges.filter((entry) => !existingKeys.has(`${entry.start_date}__${entry.end_date}`))
    if (!rowsToInsert.length) {
      return jsonResponse({ importedCount: 0, ranges: [] })
    }

    const { error } = await supabase
      .from('school_vacations')
      .insert(rowsToInsert)
    if (error) {
      throw error
    }

    return jsonResponse({
      importedCount: rowsToInsert.length,
      ranges: rowsToInsert,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return jsonResponse({ error: message }, 500)
  }
})

async function researchSchoolVacations(canton: string, schoolYear: string): Promise<VacationRange[]> {
  const prompt = [
    'Du bist ein präziser Recherche-Assistent für Schweizer Schulferien.',
    `Recherchiere nur Berufsschul-/Schulferien für den Kanton ${canton} im Schuljahr ${schoolYear}.`,
    'Antworte ausschliesslich als JSON mit folgendem Schema:',
    '{"vacation_ranges":[{"start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD"}]}',
    'Nur bestätigte Ferienzeiträume zurückgeben. Keine zusätzlichen Felder, kein Markdown.'
  ].join(' ')

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      tools: [{ type: 'web_search_preview' }],
      input: prompt,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  const text = String(data?.output_text || '').trim()
  if (!text) {
    throw new Error('OpenAI response did not contain output_text.')
  }

  const parsed = JSON.parse(text)
  const ranges = Array.isArray(parsed?.vacation_ranges) ? parsed.vacation_ranges : []

  const normalized = ranges
    .map((entry) => ({
      start_date: String(entry?.start_date || '').trim(),
      end_date: String(entry?.end_date || '').trim(),
    }))
    .filter((entry) => isIsoDate(entry.start_date) && isIsoDate(entry.end_date) && entry.end_date >= entry.start_date)

  const unique = new Map<string, VacationRange>()
  normalized.forEach((entry) => {
    unique.set(`${entry.start_date}__${entry.end_date}`, entry)
  })

  return [...unique.values()].sort((left, right) => left.start_date.localeCompare(right.start_date))
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}
