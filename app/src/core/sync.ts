/** Network side of sync. Any network failure surfaces as OfflineError (the machine backs off). */
import { db, getMeta, getProfile, loadSession, mergeGames, setMeta } from './store'
import type { GameRecord } from '@shared/game'
import { OfflineError } from '../machines/sync'
import type { AttemptEvent } from '@shared/progress'
import type { SessionRecord } from '@shared/session'

async function api(path: string, init?: RequestInit): Promise<Response> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new OfflineError('offline')
  let r: Response
  try {
    r = await fetch(path, { credentials: 'include', headers: { 'content-type': 'application/json' }, ...init })
  } catch {
    throw new OfflineError('network unreachable')
  }
  if (r.status === 502 || r.status === 503 || r.status === 504) throw new OfflineError(`server unavailable (${r.status})`)
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → HTTP ${r.status}`)
  return r
}

export function deviceLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows PC'
  return 'this device'
}

export async function flush(): Promise<{ pushed: number; pulled: number }> {
  // 1. push the outbox; delete only what the server acknowledged
  const out = await db.outbox.toArray()
  let pushed = 0
  for (let i = 0; i < out.length; i += 500) {
    const chunk = out.slice(i, i + 500)
    const r = await api('/api/events', { method: 'POST', body: JSON.stringify({ events: chunk.map((o) => o.event) }) })
    const { acked } = (await r.json()) as { acked: string[] }
    await db.outbox.bulkDelete(acked)
    pushed += acked.length
  }
  // 2. pull only what is new since the last cursor (idempotent merge by attemptId) + shared profile
  let cursor = await getMeta<number>('eventsCursor', 0)
  let prog: { events: AttemptEvent[]; cursor: number; more: boolean; profile: { timeZone?: string; dailyGoal?: number } | null }
  let pulled = 0
  do {
    prog = (await (await api(`/api/progress?since=${cursor}`)).json())
    await db.events.bulkPut(prog.events)
    pulled += prog.events.length
    cursor = prog.cursor
    await setMeta('eventsCursor', cursor)
  } while (prog.more)
  if (prog.profile) {
    const p = await getProfile()
    const patch = { ...(prog.profile.timeZone ? { timeZone: prog.profile.timeZone } : {}), ...(prog.profile.dailyGoal ? { dailyGoal: prog.profile.dailyGoal } : {}) }
    if (Object.entries(patch).some(([k, v]) => p[k as keyof typeof p] !== v)) await db.settings.put({ ...p, ...patch })
  }
  // 3. checkpoint this device's active session (only synced checkpoints are resumable elsewhere)
  const p = await getProfile()
  const s = await loadSession()
  await api(`/api/sessions/${encodeURIComponent(p.deviceId)}`, { method: 'PUT', body: JSON.stringify({ device: deviceLabel(), record: s && s.index < s.queue.length ? s : null }) })
  // 4. games vs computer: push unsynced, pull new (newest updatedAt wins)
  const unsynced = (await db.gamesV2.toArray()).filter((g) => !g.synced && g.moves.length > 0)
  for (let i = 0; i < unsynced.length; i += 100) {
    const chunk = unsynced.slice(i, i + 100).map(({ synced: _s, ...g }) => g)
    const r = await api('/api/games', { method: 'POST', body: JSON.stringify({ games: chunk }) })
    const { acked } = (await r.json()) as { acked: string[] }
    await db.gamesV2.where('gameId').anyOf(acked).modify({ synced: true })
  }
  let gc = await getMeta<string>('gamesCursor', '')
  let gp: { games: GameRecord[]; cursor: string; more: boolean }
  do {
    gp = (await (await api(`/api/games?since=${encodeURIComponent(gc)}`)).json())
    await mergeGames(gp.games)
    gc = gp.cursor
    await setMeta('gamesCursor', gc)
  } while (gp.more)
  return { pushed: pushed + unsynced.length, pulled }
}

export interface RemoteSession { deviceId: string; device: string | null; updatedAt: string; record: SessionRecord }

export async function otherDeviceSessions(): Promise<RemoteSession[]> {
  const p = await getProfile()
  const r = await api('/api/sessions')
  const { sessions } = (await r.json()) as { sessions: RemoteSession[] }
  return sessions.filter((s) => s.deviceId !== p.deviceId && s.record && s.record.index < s.record.queue.length)
}

/** Adopt another device's last synced checkpoint as this device's session. */
export async function adoptSession(remote: RemoteSession) {
  const p = await getProfile()
  await db.sessions.put({ ...remote.record, id: 'learn', deviceId: p.deviceId, updatedAt: new Date().toISOString() })
}
