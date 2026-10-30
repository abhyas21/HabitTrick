import { readFile } from 'node:fs/promises'

const source = (await readFile('.env.local', 'utf8')).replace(/^\uFEFF/, '')
const env = Object.fromEntries(source.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
  const index = line.indexOf('=')
  return [line.slice(0, index), line.slice(index + 1)]
}))
const base = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY
if (!base || !key) throw new Error('Supabase URL or public key is missing in .env.local')

const checks = [
  ['habits', 'id,user_id,name,sort_order,created_at,updated_at'],
  ['habits', 'sector_id'],
  ['habit_completions', 'id,user_id,habit_id,completion_date,created_at,updated_at'],
  ['sectors', 'id,user_id,name,sort_order'],
]
for (const [table, columns] of checks) {
  const response = await fetch(`${base}/rest/v1/${table}?select=${columns}&limit=0`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  })
  console.log(`${table}(${columns}): HTTP ${response.status}`)
}
