import { describe, expect, it } from 'vitest'
import { createApp, type User } from './app'
import { ConfigError, loadConfig, type Config } from './config'
import { openDb } from './db'

const base: Config = { authMode: 'google', port: 0, dbPath: ':memory:', staticDir: '/none', baseUrl: 'http://x', allowedEmails: ['me@example.com'] }
const ME: User = { id: 'u1', email: 'me@example.com', name: 'Me' }
const STRANGER: User = { id: 'u2', email: 'other@example.com', name: 'Other' }

function app(user: User | null, cfg: Partial<Config> = {}) {
  return createApp({ config: { ...base, ...cfg }, db: openDb(':memory:'), resolveUser: async () => user })
}
const ev = (id: string) => ({ attemptId: id, puzzleId: 'lichess:00sHx', finishedAt: '2026-11-14T10:00:00Z', result: 'clean' })
const req = (a: ReturnType<typeof app>, path: string, init?: RequestInit) => a.request(path, init)
const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('config is explicit', () => {
  it('rejects a missing AUTH_MODE', () => expect(() => loadConfig({})).toThrow(ConfigError))
  it('google mode without keys refuses to start (no silent local fallback)', () => {
    expect(() => loadConfig({ AUTH_MODE: 'google' })).toThrow(/GOOGLE_CLIENT_ID.*Refusing/)
  })
  it('local mode works without keys', () => expect(loadConfig({ AUTH_MODE: 'local' }).authMode).toBe('local'))
})

describe('authorization on every progress route', () => {
  const routes: [string, RequestInit?][] = [
    ['/api/progress'], ['/api/events', post({ events: [] })], ['/api/sessions'],
    ['/api/sessions/dev1', { method: 'PUT', body: JSON.stringify({ record: null }) }], ['/api/profile', { method: 'PUT', body: '{}' }],
    ['/api/games'], ['/api/games', post({ games: [] })],
  ]
  for (const [path, init] of routes) {
    it(`${init?.method ?? 'GET'} ${path}: 401 signed out, 403 not invited`, async () => {
      expect((await req(app(null), path, init)).status).toBe(401)
      expect((await req(app(STRANGER), path, init)).status).toBe(403)
    })
  }
  it('health and me are public', async () => {
    expect((await req(app(null), '/api/health')).status).toBe(200)
    expect(await (await req(app(null), '/api/me')).json()).toMatchObject({ user: null, allowed: false })
  })
})

describe('progress', () => {
  it('event upsert is idempotent by attemptId', async () => {
    const a = app(ME)
    const r1 = await (await req(a, '/api/events', post({ events: [ev('a1'), ev('a2')] }))).json()
    const r2 = await (await req(a, '/api/events', post({ events: [ev('a1'), ev('a2'), ev('a1')] }))).json()
    expect(r1).toMatchObject({ inserted: 2, total: 2 })
    expect(r2).toMatchObject({ inserted: 0, total: 2, acked: ['a1', 'a2', 'a1'] })
    expect((await (await req(a, '/api/progress')).json()).events).toHaveLength(2)
  })
  it('puzzle ids must be namespaced strings (lichess:<id>), never numbers', async () => {
    expect((await req(app(ME), '/api/events', post({ events: [{ ...ev('n1'), puzzleId: 27 }] }))).status).toBe(400)
    expect((await req(app(ME), '/api/events', post({ events: [{ ...ev('n2'), puzzleId: 'no-namespace' }] }))).status).toBe(400)
    expect((await req(app(ME), '/api/events', post({ events: [ev('n3')] }))).status).toBe(200)
  })
  it('rejects malformed events', async () => {
    expect((await req(app(ME), '/api/events', post({ events: [{ attemptId: 'x' }] }))).status).toBe(400)
  })
  it('users never see each other\'s events', async () => {
    const db = openDb(':memory:')
    const mk = (u: User) => createApp({ config: { ...base, allowedEmails: null }, db, resolveUser: async () => u })
    await req(mk(ME), '/api/events', post({ events: [ev('a1')] }))
    expect((await (await req(mk(STRANGER), '/api/progress')).json()).events).toHaveLength(0)
  })
  it('session checkpoints keep the newest per device', async () => {
    const a = app(ME)
    const put = (updatedAt: string, index: number) => req(a, '/api/sessions/mac', { method: 'PUT', body: JSON.stringify({ device: 'MacBook', record: { updatedAt, index } }) })
    await put('2026-11-14T10:00:00Z', 3)
    await put('2026-11-14T09:00:00Z', 1) // stale write is ignored
    const s = (await (await req(a, '/api/sessions')).json()).sessions
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ deviceId: 'mac', device: 'MacBook', record: { index: 3 } })
  })

  it('progress pulls are incremental (cursor)', async () => {
    const a = app(ME)
    await req(a, '/api/events', post({ events: [ev('c1'), ev('c2')] }))
    const p1 = await (await req(a, '/api/progress')).json()
    expect(p1.events).toHaveLength(2)
    await req(a, '/api/events', post({ events: [ev('c3')] }))
    const p2 = await (await req(a, `/api/progress?since=${p1.cursor}`)).json()
    expect(p2.events.map((e: { attemptId: string }) => e.attemptId)).toEqual(['c3'])
  })
})

describe('games', () => {
  const gr = (id: string, updatedAt: string, moves: string[] = ['e2e4']) => ({ gameId: id, schemaVersion: 2, status: 'finished', color: 'white', level: 3,
    initialFen: 'x', timeControl: null, clocks: null, moves, result: { winner: 'white', reason: 'checkmate' }, startedAt: updatedAt, updatedAt, endedAt: updatedAt })
  it('upsert keeps the newest version; pull is incremental and per user', async () => {
    const db = openDb(':memory:')
    const mk = (u: User) => createApp({ config: { ...base, allowedEmails: null }, db, resolveUser: async () => u })
    await req(mk(ME), '/api/games', post({ games: [gr('g1', '2026-11-14T10:00:00Z'), gr('g2', '2026-11-14T10:05:00Z')] }))
    await req(mk(ME), '/api/games', post({ games: [gr('g1', '2026-11-14T09:00:00Z', [])] })) // stale: ignored
    const all = await (await req(mk(ME), '/api/games')).json()
    expect(all.games).toHaveLength(2)
    expect(all.games.find((g: { gameId: string }) => g.gameId === 'g1').moves).toEqual(['e2e4'])
    const none = await (await req(mk(ME), `/api/games?since=${encodeURIComponent(all.cursor)}`)).json()
    expect(none.games).toHaveLength(0)
    expect((await (await req(mk(STRANGER), '/api/games')).json()).games).toHaveLength(0)
  })
  it('rejects malformed games', async () => {
    expect((await req(app(ME), '/api/games', post({ games: [{ gameId: 'x' }] }))).status).toBe(400)
  })
  it('rate limit returns 429 when a client floods', async () => {
    const a = app(ME)
    let last = 200
    for (let i = 0; i < 260; i++) last = (await req(a, '/api/health')).status
    expect(last).toBe(429)
  })
})

describe('feedback loop', () => {
  const TOKEN = 'x'.repeat(32)
  const fb = (o: Record<string, unknown> = {}) => ({ schemaVersion: 1, id: crypto.randomUUID(), kind: 'bug', message: 'Clock does not stop', createdAt: '2026-11-14T10:00:00Z',
    context: { route: '/play', build: 't', viewport: '1470x956', userAgent: 'test', theme: 'dark', auth: 'guest', errors: [] }, ...o })
  const admin = (init: RequestInit = {}) => ({ ...init, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' } })
  function setup(user: User | null = null) {
    const db = openDb(':memory:')
    const calls: string[] = []
    const gh = { createIssue: async () => { calls.push('create'); return 'https://github.com/o/r/issues/7' }, updateIssue: async (_f: unknown, reply: boolean) => { calls.push(`update reply=${reply}`) } }
    const a = createApp({ config: { ...base, adminToken: TOKEN }, db, resolveUser: async () => user, gh, log: () => {} })
    return { a, calls }
  }

  it('guests can send; retries are idempotent; invalid input is rejected', async () => {
    const { a, calls } = setup()
    const item = fb()
    expect((await a.request('/api/feedback', post(item))).status).toBe(201)
    expect((await a.request('/api/feedback', post(item))).status).toBe(200) // same id: no duplicate
    expect((await a.request('/api/feedback', post(fb({ message: '  ' })))).status).toBe(400)
    expect((await a.request('/api/feedback', post(fb({ kind: 'rant' })))).status).toBe(400)
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toEqual(['create']) // mirrored once
  })

  it('signed-in reports keep the reporter (admin only); the reporter sees status + reply', async () => {
    const { a } = setup(ME)
    const item = fb({ kind: 'idea', message: 'Add a blitz rush' })
    await a.request('/api/feedback', post(item))
    await new Promise((r) => setTimeout(r, 10))
    const got = await (await a.request(`/api/admin/feedback/${item.id}`, admin())).json()
    expect(got.user.email).toBe('me@example.com')
    expect(got.issueUrl).toBe('https://github.com/o/r/issues/7')
    const mine = await (await a.request('/api/feedback/status', post({ ids: [item.id] }))).json()
    expect(mine.items[0]).toMatchObject({ status: 'new', label: 'Received', reply: null })
    expect(JSON.stringify(mine)).not.toContain('me@example.com') // status view never exposes reporter data
  })

  it('admin API needs the token, validates status, updates the reporter view and the GitHub issue', async () => {
    const { a, calls } = setup()
    const item = fb()
    await a.request('/api/feedback', post(item))
    await new Promise((r) => setTimeout(r, 10))
    expect((await a.request('/api/admin/feedback')).status).toBe(401)
    expect((await a.request('/api/admin/feedback', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401)
    const list = await (await a.request('/api/admin/feedback?status=new', admin())).json()
    expect(list.items.map((x: { id: string }) => x.id)).toEqual([item.id])
    expect((await a.request(`/api/admin/feedback/${item.id}`, admin({ method: 'PATCH', body: JSON.stringify({ status: 'shipped' }) }))).status).toBe(400)
    const done = await (await a.request(`/api/admin/feedback/${item.id}`, admin({ method: 'PATCH', body: JSON.stringify({ status: 'done', reply: 'Fixed: clocks pause on Menu.' }) }))).json()
    expect(done.status).toBe('done')
    expect(calls).toEqual(['create', 'update reply=true'])
    const mine = await (await a.request('/api/feedback/status', post({ ids: [item.id] }))).json()
    expect(mine.items[0]).toMatchObject({ status: 'done', label: 'Done', reply: 'Fixed: clocks pause on Menu.' })
  })

  it('admin API is off (404) without FEEDBACK_ADMIN_TOKEN', async () => {
    expect((await app(ME).request('/api/admin/feedback', admin())).status).toBe(404)
  })

  it('config: short admin token and half GitHub config are refused', () => {
    expect(() => loadConfig({ AUTH_MODE: 'local', FEEDBACK_ADMIN_TOKEN: 'short' })).toThrow(ConfigError)
    expect(() => loadConfig({ AUTH_MODE: 'local', GITHUB_TOKEN: 't' })).toThrow(/GITHUB_REPO/)
    expect(loadConfig({ AUTH_MODE: 'local', GITHUB_TOKEN: 't', GITHUB_REPO: 'me/chess' }).github).toEqual({ token: 't', repo: 'me/chess' })
  })
})
