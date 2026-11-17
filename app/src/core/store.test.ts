import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { db, commitAttempt, startRun, savePuzzleRecord, loadSession, exportProgress, importProgress, getProfile, bindOwner, getMeta } from './store'
import type { PuzzleProgressRecord } from '@shared/session'

const rec = (p: Partial<PuzzleProgressRecord> = {}): PuzzleProgressRecord => ({
  puzzleId: 't:1', puzzleKey: 'k', attemptId: 'att-1', moves: ['d5g8'], hints: 0, mistakes: 0, revealed: false, saved: false,
  startedAt: '2026-11-14T10:00:00Z', outcome: { kind: 'solved', result: 'clean', finishedAt: '2026-11-14T10:00:30Z', text: '' }, ...p,
})

beforeEach(async () => { db.close(); await Dexie.delete('open-chess-trainer'); await db.open() })

describe('store', () => {
  it('commit is idempotent per attemptId (double submit counts once)', async () => {
    await startRun({ kind: 'chapter', queue: ['t:1', 't:2'], chapter: 1, contentVersion: 'v' })
    await savePuzzleRecord(rec())
    await commitAttempt(rec(), { solverMoves: 2, mode: 'test' })
    await commitAttempt(rec(), { solverMoves: 2, mode: 'test' })
    expect(await db.events.count()).toBe(1)
    expect(await db.outbox.count()).toBe(1)
    expect((await loadSession())!.puzzle!.saved).toBe(true)
  })

  it('commit is atomic: a failure inside the transaction leaves nothing behind', async () => {
    await startRun({ kind: 'chapter', queue: ['t:1'], chapter: 1, contentVersion: 'v' })
    await savePuzzleRecord(rec())
    const bad = rec({ outcome: { kind: 'solved', result: 'clean', finishedAt: 'not-a-date', text: '' } })
    const orig = db.outbox.put.bind(db.outbox)
    db.outbox.put = (() => { throw new Error('boom') }) as typeof db.outbox.put
    await expect(commitAttempt(bad, { solverMoves: 1, mode: 'test' })).rejects.toThrow('boom')
    db.outbox.put = orig
    expect(await db.events.count()).toBe(0)
    expect((await loadSession())!.puzzle!.saved).toBe(false)
  })

  it('unsupported session schema is closed cleanly', async () => {
    await db.sessions.put({ id: 'learn', schemaVersion: 99 } as never)
    expect(await loadSession()).toBeNull()
    expect(await db.sessions.count()).toBe(0)
  })

  it('export → import is idempotent', async () => {
    await commitAttempt(rec(), { solverMoves: 1, mode: 'test' })
    const json = await exportProgress()
    await importProgress(json)
    await importProgress(json)
    expect(await db.events.count()).toBe(1)
    expect((await getProfile()).timeZone).toBeTruthy()
  })
})

describe('account ownership', () => {
  it('guest data is adopted by the first account; another account starts clean', async () => {
    await commitAttempt(rec(), { solverMoves: 1, mode: 'test' })
    expect(await bindOwner('alice')).toBe('adopted')
    expect(await db.events.count()).toBe(1) // alice keeps her guest progress (it will sync to her account)
    expect(await bindOwner('alice')).toBe('same')
    expect(await bindOwner('bob')).toBe('switched')
    expect(await db.events.count()).toBe(0) // bob never uploads alice's progress
    expect(await db.outbox.count()).toBe(0)
    expect(await getMeta('owner', null)).toBe('bob')
  })
})

describe('v1 → v2 migration', () => {
  it('turns milestone-1 attempts into events', async () => {
    db.close(); await Dexie.delete('open-chess-trainer')
    const v1 = new Dexie('open-chess-trainer')
    v1.version(1).stores({ puzzles: 'id, box, due', profile: 'id', attempts: '++id, puzzleId, at' })
    await v1.open()
    await v1.table('profile').put({ id: 'me', dailyGoal: 7, freePlay: true })
    await v1.table('attempts').bulkAdd([
      { puzzleId: 2, at: '2026-11-14T09:00:00Z', result: 'failed', mistakes: 1, hints: 0, ms: 5000, xp: 9, review: false },
      { puzzleId: 27, at: '2026-11-14T09:05:00Z', result: 'hinted', mistakes: 0, hints: 1, ms: 8000, xp: 11, review: false },
    ])
    v1.close()
    await db.open()
    const evs = await db.events.toArray()
    expect(evs.map((e) => e.puzzleId).sort()).toEqual(['legacy:2', 'legacy:27'])
    expect(await getProfile()).toMatchObject({ dailyGoal: 7, freePlay: true })
  })
})
