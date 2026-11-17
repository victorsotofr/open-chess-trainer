/**
 * HTTP API. Every progress route requires an authorized user (puzzles are a public static pack); the resolver is
 * injected (local mode → fixed local user; google mode → Better Auth session), so tests
 * exercise authorization without a real Google round-trip.
 */
import { Hono, type Context } from 'hono'
import { isGameRecord } from '../../shared/game'
import { FEEDBACK_STATUS, isFeedbackStatus, validateFeedback, type FeedbackInput, type FeedbackItem } from '../../shared/feedback'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { GitHub } from './github'
import type { Config } from './config'
import type { DB } from './db'

export interface User { id: string; email: string | null; name: string }
export type ResolveUser = (req: Request) => Promise<User | null>

interface Deps {
  config: Config
  db: DB
  resolveUser: ResolveUser
  authHandler?: (req: Request) => Promise<Response> // Better Auth (google mode)
  gh?: GitHub // optional feedback mirror
  log?: (msg: string) => void
}

interface FeedbackRow { id: string; created_at: string; updated_at: string; user_id: string | null; email: string | null; name: string | null; kind: string; status: string; message: string; context: string | null; reply: string | null; issue_url: string | null }
const toItem = (r: FeedbackRow): FeedbackItem => ({
  schemaVersion: 1, id: r.id, kind: r.kind as FeedbackItem['kind'], message: r.message, context: r.context ? JSON.parse(r.context) : null,
  createdAt: r.created_at, updatedAt: r.updated_at, status: r.status as FeedbackItem['status'], reply: r.reply, issueUrl: r.issue_url,
  user: r.user_id ? { id: r.user_id, email: r.email, name: r.name ?? '' } : null,
})
const sameSecret = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())

const isAllowed = (config: Config, u: User) =>
  config.authMode === 'local' || !config.allowedEmails || (!!u.email && config.allowedEmails.includes(u.email.toLowerCase()))

function isEvent(e: unknown): e is { attemptId: string; finishedAt: string; puzzleId: number } {
  const x = e as Record<string, unknown>
  return !!x && typeof x.attemptId === 'string' && x.attemptId.length <= 100 && typeof x.finishedAt === 'string'
    && !Number.isNaN(Date.parse(x.finishedAt)) && typeof x.puzzleId === 'number'
}

export function createApp({ config, db, resolveUser, authHandler, gh, log = console.error }: Deps) {
  const app = new Hono<{ Variables: { user: User } }>()

  // per-client token bucket: generous for real use, stops runaway loops and abuse
  const buckets = new Map<string, { tokens: number; at: number }>()
  const RATE = { capacity: 240, perSec: 4 }
  app.use('/api/*', async (c, next) => {
    const key = c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.req.header('cf-connecting-ip') || 'local'
    const now = Date.now()
    const b = buckets.get(key) ?? { tokens: RATE.capacity, at: now }
    b.tokens = Math.min(RATE.capacity, b.tokens + ((now - b.at) / 1000) * RATE.perSec)
    b.at = now
    if (b.tokens < 1) return c.json({ error: 'too many requests' }, 429, { 'retry-after': '5' })
    b.tokens -= 1
    buckets.set(key, b)
    if (buckets.size > 50_000) buckets.clear() // memory bound
    await next()
  })

  app.get('/api/health', (c) => c.json({ ok: true }))

  if (authHandler) app.on(['GET', 'POST'], '/api/auth/*', (c) => authHandler(c.req.raw))

  app.get('/api/me', async (c) => {
    const u = await resolveUser(c.req.raw)
    return c.json({ mode: config.authMode, user: u, allowed: u ? isAllowed(config, u) : false })
  })

  // Book and progress routes require an authorized user; guest feedback is separate below.
  const guard = async (c: Context, next: () => Promise<void>) => {
    const u = await resolveUser(c.req.raw)
    if (!u) return c.json({ error: 'sign in required' }, 401)
    if (!isAllowed(config, u)) return c.json({ error: 'this account is not invited' }, 403)
    c.set('user', u)
    await next()
  }
  app.use('/api/progress', guard)
  app.use('/api/events', guard)
  app.use('/api/sessions', guard)
  app.use('/api/sessions/*', guard)
  app.use('/api/profile', guard)
  app.use('/api/games', guard)

  app.get('/api/progress', (c) => {
    const uid = c.get('user').id
    const since = Math.max(0, Number(c.req.query('since') ?? 0) || 0) // rowid cursor: only new events
    const rows = db.prepare('SELECT rowid AS seq, payload FROM events WHERE user_id = ? AND rowid > ? ORDER BY rowid LIMIT 5000').all(uid, since) as { seq: number; payload: string }[]
    const profile = db.prepare('SELECT payload FROM profiles WHERE user_id = ?').get(uid) as { payload: string } | undefined
    return c.json({ events: rows.map((r) => JSON.parse(r.payload)), cursor: rows.length ? rows[rows.length - 1].seq : since, more: rows.length === 5000,
      profile: profile ? JSON.parse(profile.payload) : null })
  })

  /** Idempotent upsert by attemptId: duplicates and retries are harmless. */
  app.post('/api/events', async (c) => {
    const uid = c.get('user').id
    const body = await c.req.json().catch(() => null) as { events?: unknown[] } | null
    if (!body || !Array.isArray(body.events) || body.events.length > 1000) return c.json({ error: 'expected {events: AttemptEvent[]}' }, 400)
    const bad = body.events.filter((e) => !isEvent(e)).length
    if (bad) return c.json({ error: `${bad} malformed events` }, 400)
    const ins = db.prepare('INSERT INTO events (user_id, attempt_id, finished_at, payload) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, attempt_id) DO NOTHING')
    let inserted = 0
    db.transaction(() => { for (const e of body.events as { attemptId: string; finishedAt: string }[]) inserted += ins.run(uid, e.attemptId, e.finishedAt, JSON.stringify(e)).changes })()
    const total = (db.prepare('SELECT COUNT(*) n FROM events WHERE user_id = ?').get(uid) as { n: number }).n
    return c.json({ acked: (body.events as { attemptId: string }[]).map((e) => e.attemptId), inserted, total })
  })

  /** Device checkpoints of the active learning session (for "resume your other device"). */
  app.get('/api/sessions', (c) => {
    const rows = db.prepare('SELECT device_id, device, updated_at, record FROM sessions_checkpoint WHERE user_id = ? ORDER BY updated_at DESC').all(c.get('user').id) as
      { device_id: string; device: string | null; updated_at: string; record: string }[]
    return c.json({ sessions: rows.map((r) => ({ deviceId: r.device_id, device: r.device, updatedAt: r.updated_at, record: JSON.parse(r.record) })) })
  })
  app.put('/api/sessions/:deviceId', async (c) => {
    const body = await c.req.json().catch(() => null) as { record?: { updatedAt?: string } | null; device?: string } | null
    if (!body || !('record' in body)) return c.json({ error: 'expected {record}' }, 400)
    const uid = c.get('user').id
    const dev = c.req.param('deviceId').slice(0, 100)
    if (body.record === null) { db.prepare('DELETE FROM sessions_checkpoint WHERE user_id = ? AND device_id = ?').run(uid, dev); return c.json({ ok: true }) }
    db.prepare(`INSERT INTO sessions_checkpoint (user_id, device_id, device, updated_at, record) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, device_id) DO UPDATE SET device = excluded.device, updated_at = excluded.updated_at, record = excluded.record
      WHERE excluded.updated_at >= sessions_checkpoint.updated_at`)
      .run(uid, dev, body.device ?? null, body.record?.updatedAt ?? new Date().toISOString(), JSON.stringify(body.record))
    return c.json({ ok: true })
  })

  /** Games vs computer: upsert, newest updatedAt wins (idempotent). */
  app.post('/api/games', async (c) => {
    const body = await c.req.json().catch(() => null) as { games?: unknown[] } | null
    if (!body || !Array.isArray(body.games) || body.games.length > 200) return c.json({ error: 'expected {games: GameRecord[]} (max 200)' }, 400)
    if (!body.games.every(isGameRecord)) return c.json({ error: 'malformed game' }, 400)
    const uid = c.get('user').id
    const ts = new Date().toISOString()
    const up = db.prepare(`INSERT INTO games (user_id, game_id, updated_at, server_ts, payload) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, game_id) DO UPDATE SET updated_at = excluded.updated_at, server_ts = excluded.server_ts, payload = excluded.payload
      WHERE excluded.updated_at > games.updated_at`)
    db.transaction(() => { for (const g of body.games as { gameId: string; updatedAt: string }[]) up.run(uid, g.gameId, g.updatedAt, ts, JSON.stringify(g)) })()
    return c.json({ acked: (body.games as { gameId: string }[]).map((g) => g.gameId) })
  })
  app.get('/api/games', (c) => {
    const since = c.req.query('since') ?? ''
    const rows = db.prepare('SELECT server_ts, payload FROM games WHERE user_id = ? AND server_ts > ? ORDER BY server_ts LIMIT 500').all(c.get('user').id, since) as { server_ts: string; payload: string }[]
    return c.json({ games: rows.map((r) => JSON.parse(r.payload)), cursor: rows.length ? rows[rows.length - 1].server_ts : since, more: rows.length === 500 })
  })

  app.put('/api/profile', async (c) => {
    const body = await c.req.json().catch(() => null) as { timeZone?: string; dailyGoal?: number } | null
    if (!body) return c.json({ error: 'expected json' }, 400)
    const p = { timeZone: typeof body.timeZone === 'string' ? body.timeZone : undefined, dailyGoal: typeof body.dailyGoal === 'number' ? body.dailyGoal : undefined }
    db.prepare('INSERT INTO profiles (user_id, payload) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload').run(c.get('user').id, JSON.stringify(p))
    return c.json({ ok: true })
  })

  // ── feedback: anyone can send (guests play too); reporters see status + reply ──
  const fbBuckets = new Map<string, { n: number; since: number }>()
  const mirror = (id: string) => {
    if (!gh) return
    const row = db.prepare('SELECT * FROM feedback WHERE id = ?').get(id) as FeedbackRow
    gh.createIssue(toItem(row))
      .then((url) => db.prepare('UPDATE feedback SET issue_url = ? WHERE id = ? AND issue_url IS NULL').run(url, id))
      .catch((e) => log(`feedback ${id}: GitHub mirror failed: ${e}`))
  }
  app.post('/api/feedback', async (c) => {
    const key = c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local'
    const now = Date.now(), b = fbBuckets.get(key)
    const win = b && now - b.since < 3_600_000 ? b : { n: 0, since: now }
    if (win.n >= 20) return c.json({ error: 'too much feedback from this address; try again in an hour' }, 429)
    const body = await c.req.json().catch(() => null) as FeedbackInput | null
    const bad = validateFeedback(body)
    if (bad) return c.json({ error: bad }, 400)
    win.n++; fbBuckets.set(key, win)
    const u = await resolveUser(c.req.raw)
    const ts = new Date().toISOString()
    const inserted = db.prepare(`INSERT INTO feedback (id, created_at, updated_at, user_id, email, name, kind, message, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`).run(body!.id, ts, ts, u?.id ?? null, u?.email ?? null, u?.name ?? null, body!.kind, body!.message.trim(), body!.context ? JSON.stringify(body!.context) : null).changes
    if (inserted) mirror(body!.id)
    return c.json({ id: body!.id, status: 'new' }, inserted ? 201 : 200)
  })
  /** status of the reporter's own items: ids are unguessable UUIDs kept on their device */
  app.post('/api/feedback/status', async (c) => {
    const body = await c.req.json().catch(() => null) as { ids?: unknown } | null
    const ids = Array.isArray(body?.ids) ? body!.ids.filter((x): x is string => typeof x === 'string').slice(0, 100) : []
    if (!ids.length) return c.json({ items: [] })
    const rows = db.prepare(`SELECT id, status, reply, updated_at FROM feedback WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Pick<FeedbackRow, 'id' | 'status' | 'reply' | 'updated_at'>[]
    return c.json({ items: rows.map((r) => ({ id: r.id, status: r.status, label: FEEDBACK_STATUS[r.status as keyof typeof FEEDBACK_STATUS], reply: r.reply, updatedAt: r.updated_at })) })
  })

  // ── admin API for you and your agents: bearer token, disabled unless FEEDBACK_ADMIN_TOKEN is set ──
  app.use('/api/admin/*', async (c, next) => {
    if (!config.adminToken) return c.json({ error: 'not found' }, 404)
    const t = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    if (!t || !sameSecret(t, config.adminToken)) return c.json({ error: 'invalid admin token' }, 401)
    await next()
  })
  app.get('/api/admin/feedback', (c) => {
    const statuses = (c.req.query('status') ?? '').split(',').filter(isFeedbackStatus)
    const limit = Math.min(500, Number(c.req.query('limit') ?? 100) || 100)
    const rows = db.prepare(`SELECT * FROM feedback ${statuses.length ? `WHERE status IN (${statuses.map(() => '?').join(',')})` : ''} ORDER BY created_at DESC LIMIT ?`).all(...statuses, limit) as FeedbackRow[]
    return c.json({ items: rows.map(toItem) })
  })
  app.get('/api/admin/feedback/:id', (c) => {
    const row = db.prepare('SELECT * FROM feedback WHERE id = ?').get(c.req.param('id')) as FeedbackRow | undefined
    return row ? c.json(toItem(row)) : c.json({ error: 'not found' }, 404)
  })
  app.patch('/api/admin/feedback/:id', async (c) => {
    const id = c.req.param('id')
    const row = db.prepare('SELECT * FROM feedback WHERE id = ?').get(id) as FeedbackRow | undefined
    if (!row) return c.json({ error: 'not found' }, 404)
    const body = await c.req.json().catch(() => ({})) as { status?: unknown; reply?: unknown; issueUrl?: unknown }
    if (body.status !== undefined && !isFeedbackStatus(body.status)) return c.json({ error: `status must be one of ${Object.keys(FEEDBACK_STATUS).join(', ')}` }, 400)
    if (body.reply !== undefined && body.reply !== null && (typeof body.reply !== 'string' || body.reply.length > 2000)) return c.json({ error: 'reply must be a string up to 2000 characters' }, 400)
    const next = { status: (body.status as string) ?? row.status, reply: body.reply === undefined ? row.reply : (body.reply as string | null), issue_url: typeof body.issueUrl === 'string' ? body.issueUrl : row.issue_url }
    db.prepare('UPDATE feedback SET status = ?, reply = ?, issue_url = ?, updated_at = ? WHERE id = ?').run(next.status, next.reply, next.issue_url, new Date().toISOString(), id)
    const item = toItem(db.prepare('SELECT * FROM feedback WHERE id = ?').get(id) as FeedbackRow)
    let github: string | undefined
    if (gh && item.issueUrl && (next.status !== row.status || next.reply !== row.reply)) {
      try { await gh.updateIssue(item as FeedbackItem & { issueUrl: string }, next.reply !== row.reply) } catch (e) { github = `GitHub update failed: ${e}` }
    }
    return c.json({ ...item, ...(github ? { warning: github } : {}) })
  })
  /** retry the GitHub mirror for items that never got an issue */
  app.post('/api/admin/feedback/mirror', (c) => {
    if (!gh) return c.json({ error: 'GitHub mirror not configured (GITHUB_TOKEN, GITHUB_REPO)' }, 400)
    const rows = db.prepare('SELECT id FROM feedback WHERE issue_url IS NULL').all() as { id: string }[]
    rows.forEach((r) => mirror(r.id))
    return c.json({ queued: rows.length })
  })

  return app
}
