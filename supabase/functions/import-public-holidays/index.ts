import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

type PublicHoliday = {
  holiday_date: string
  label: string
  is_paid: boolean
}

type ImportRequest = {
  canton?: string
  year?: string | number
}

const OPENAI_API_KEY = 'REPLACE_WITH_TEST_API_KEY'
const OPENAI_MODEL = 'gpt-4.1-mini'
const SUPPORTED_CANTONS = new Set(['LU', 'BE', 'SO', 'ZH'])

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
    const year = Number(payload?.year)

    if (!SUPPORTED_CANTONS.has(canton)) {
      return jsonResponse({ error: 'Unsupported canton.' }, 400)
    }
    if (!isSupportedYear(year)) {
      return jsonResponse({ error: 'Unsupported year.' }, 400)
    }

    if (!OPENAI_API_KEY || OPENAI_API_KEY.startsWith('REPLACE_')) {
      return jsonResponse({ error: 'OpenAI API key is missing in function source.' }, 500)
    }

    const holidays = await researchPublicHolidays(canton, year)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return jsonResponse({ error: 'Missing Supabase environment variables.' }, 500)
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)
    const { data: existingRows, error: existingError } = await supabase
      .from('platform_holidays')
      .select('holiday_date')
    if (existingError) {
      throw existingError
    }

    const existingDates = new Set((existingRows || []).map((entry) => String(entry.holiday_date || '')))
    const rowsToInsert = holidays.filter((entry) => !existingDates.has(entry.holiday_date))

    if (rowsToInsert.length) {
      const { error: insertError } = await supabase
        .from('platform_holidays')
        .insert(rowsToInsert)
      if (insertError) {
        throw insertError
      }
    }

    return jsonResponse({
      importedCount: rowsToInsert.length,
      holidays: rowsToInsert,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return jsonResponse({ error: message }, 500)
  }
})

function isSupportedYear(year: number): boolean {
  if (!Number.isInteger(year)) {
    return false
  }
  const currentYear = new Date().getUTCFullYear()
  return year >= currentYear && year <= currentYear + 4
}

async function researchPublicHolidays(canton: string, year: number): Promise<PublicHoliday[]> {
  const prompt = [
    'Du bist ein präziser Recherche-Assistent für Schweizer Feiertage.',
    `Recherchiere gesetzliche Feiertage für den Kanton ${canton} im Jahr ${year}.`,
    'Berücksichtige ausschliesslich Daten im Format YYYY-MM-DD aus diesem Jahr.',
    'Wenn unklar ist, ob ein Feiertag bezahlt ist, setze is_paid auf false.',
    'Antworte ausschliesslich als JSON mit folgendem Schema:',
    '{"holidays":[{"holiday_date":"YYYY-MM-DD","label":"Name","is_paid":true}]}'
  ].join(' ')

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      tools: [{ type: 'web_search_preview' }],
      input: prompt,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  const text = extractResponseText(data)
  if (!text) {
    throw new Error('OpenAI response did not contain output_text.')
  }

  const parsed = parseModelJson(text)
  const rows = Array.isArray(parsed?.holidays) ? parsed.holidays : []

  const unique = new Map<string, PublicHoliday>()
  rows.forEach((entry) => {
    const holiday_date = String(entry?.holiday_date || '').trim()
    const label = String(entry?.label || 'Feiertag').trim() || 'Feiertag'
    const is_paid = entry?.is_paid === true
    if (!isIsoDate(holiday_date)) return
    if (!holiday_date.startsWith(`${year}-`)) return
    if (!isWeekdayIsoDate(holiday_date)) return
    unique.set(holiday_date, { holiday_date, label, is_paid })
  })

  return [...unique.values()].sort((left, right) => left.holiday_date.localeCompare(right.holiday_date))
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isWeekdayIsoDate(value: string): boolean {
  const day = new Date(`${value}T00:00:00Z`).getUTCDay()
  return day >= 1 && day <= 5
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const record = payload as Record<string, unknown>
  const directOutputText = typeof record.output_text === 'string' ? record.output_text.trim() : ''
  if (directOutputText) {
    return directOutputText
  }

  const outputs = Array.isArray(record.output) ? record.output : []
  const textParts: string[] = []

  outputs.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return
    }
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : []

    content.forEach((contentItem) => {
      if (!contentItem || typeof contentItem !== 'object') {
        return
      }
      const textValue = (contentItem as Record<string, unknown>).text
      if (typeof textValue === 'string' && textValue.trim()) {
        textParts.push(textValue.trim())
      }
    })
  })

  return textParts.join('\n').trim()
}

function parseModelJson(rawText: string): Record<string, unknown> {
  const trimmed = rawText.trim()
  if (!trimmed) {
    throw new Error('OpenAI response text was empty.')
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    // Continue with fallbacks below.
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1]) as Record<string, unknown>
    } catch {
      // Continue with fallbacks below.
    }
  }

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1)
    try {
      return JSON.parse(candidate) as Record<string, unknown>
    } catch {
      // Final error thrown below.
    }
  }

  throw new Error(`OpenAI response did not contain valid JSON: ${trimmed.slice(0, 180)}`)
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
