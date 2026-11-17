/**
 * Feedback CLI for you and your coding agents (talks to the admin API).
 *
 *   npm run feedback -- list [--status new,triaged] [--json]   newest first
 *   npm run feedback -- next                                   oldest untriaged report, as agent-ready markdown
 *   npm run feedback -- show <id|prefix>                       one report with context and reporter
 *   npm run feedback -- set <id|prefix> --status planned [--reply "text shown to the user"] [--issue <url>]
 *   npm run feedback -- export [--status new] > feedback.jsonl one JSON object per line
 *   npm run feedback -- mirror                                 retry GitHub issues for reports without one
 *
 * Config (env, or the repo's .env): FEEDBACK_URL (default http://127.0.0.1:8080), FEEDBACK_ADMIN_TOKEN.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FEEDBACK_STATUS, feedbackMarkdown, feedbackTitle, type FeedbackItem } from '../../shared/feedback'

function env(name: string): string | undefined {
  if (process.env[name]) return process.env[name]
  const file = join(import.meta.dirname, '..', '..', '.env')
  if (!existsSync(file)) return undefined
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`))
  return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') || undefined
}

const BASE = (env('FEEDBACK_URL') ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
const TOKEN = env('FEEDBACK_ADMIN_TOKEN')
const die = (msg: string): never => { console.error(msg); process.exit(1) }
if (!TOKEN) die('FEEDBACK_ADMIN_TOKEN is not set (env or .env). Generate one with: openssl rand -hex 24')

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(BASE + path, { ...init, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' } }).catch((e) => die(`Cannot reach ${BASE}: ${e.message}`))
  const body = await r.json().catch(() => ({})) as T & { error?: string }
  if (!r.ok) die(`${init.method ?? 'GET'} ${path} → ${r.status} ${body.error ?? ''}`)
  return body
}

const args = process.argv.slice(2)
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const has = (name: string) => args.includes(`--${name}`)
const list = (status?: string, limit = 500) => api<{ items: FeedbackItem[] }>(`/api/admin/feedback?limit=${limit}${status ? `&status=${status}` : ''}`).then((r) => r.items)

async function resolve(idOrPrefix?: string): Promise<FeedbackItem> {
  if (!idOrPrefix) die('Missing id (a prefix of 6+ characters is enough).')
  const all = await list()
  const hits = all.filter((f) => f.id.startsWith(idOrPrefix!))
  if (hits.length !== 1) die(hits.length ? `Ambiguous id prefix "${idOrPrefix}" (${hits.length} matches).` : `No feedback with id "${idOrPrefix}".`)
  return hits[0]
}

const cmd = args[0]
if (cmd === 'list') {
  const items = await list(flag('status'), Number(flag('limit') ?? 100))
  if (has('json')) console.log(JSON.stringify(items, null, 2))
  else if (!items.length) console.log('No feedback.')
  else for (const f of items) console.log(`${f.id.slice(0, 8)}  ${f.createdAt.slice(0, 10)}  ${f.status.padEnd(11)} ${feedbackTitle(f)}${f.issueUrl ? `  ${f.issueUrl}` : ''}`)
} else if (cmd === 'next') {
  const items = (await list('new')).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  console.log(items.length ? feedbackMarkdown(items[0], { includeReporter: true }) + `\n\n(${items.length - 1} more untriaged)` : 'Nothing untriaged.')
} else if (cmd === 'show') {
  console.log(feedbackMarkdown(await resolve(args[1]), { includeReporter: true }))
} else if (cmd === 'set') {
  const f = await resolve(args[1])
  const status = flag('status'), reply = flag('reply'), issue = flag('issue')
  if (status && !(status in FEEDBACK_STATUS)) die(`--status must be one of: ${Object.keys(FEEDBACK_STATUS).join(', ')}`)
  if (!status && reply === undefined && !issue) die('Nothing to set: use --status, --reply and/or --issue.')
  const out = await api<FeedbackItem & { warning?: string }>(`/api/admin/feedback/${f.id}`, { method: 'PATCH', body: JSON.stringify({ status, reply, issueUrl: issue }) })
  console.log(`${out.id.slice(0, 8)} → ${out.status}${out.reply ? ` · reply: ${out.reply}` : ''}${out.warning ? `\nwarning: ${out.warning}` : ''}`)
} else if (cmd === 'export') {
  for (const f of await list(flag('status'))) console.log(JSON.stringify(f))
} else if (cmd === 'mirror') {
  console.log(await api('/api/admin/feedback/mirror', { method: 'POST' }))
} else {
  console.log(readFileSync(import.meta.filename, 'utf8').split('*/')[0].replace(/^\/\*\*?|^ \* ?/gm, '').trim())
}
