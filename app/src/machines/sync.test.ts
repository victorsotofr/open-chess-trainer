import { describe, expect, it, vi } from 'vitest'
import { createActor, fromPromise, SimulatedClock } from 'xstate'
import { OfflineError, syncMachine } from './sync'

const flushTick = () => new Promise((r) => setTimeout(r, 0))

function start(flush: () => Promise<{ pushed: number; pulled: number }>) {
  const clock = new SimulatedClock()
  const actor = createActor(syncMachine.provide({ actors: { flush: fromPromise(flush) } }), { clock })
  actor.start()
  return { actor, clock }
}

describe('sync', () => {
  it('is paused until enabled (signed out keeps events in the outbox)', async () => {
    const f = vi.fn().mockResolvedValue({ pushed: 0, pulled: 0 })
    const { actor, clock } = start(f)
    clock.increment(120_000)
    expect(f).not.toHaveBeenCalled()
    actor.send({ type: 'ENABLE' }); await flushTick()
    expect(f).toHaveBeenCalledTimes(1)
    expect(actor.getSnapshot().value).toBe('idle')
  })
  it('offline → exponential backoff → recovers', async () => {
    const f = vi.fn().mockRejectedValueOnce(new OfflineError('x')).mockRejectedValueOnce(new OfflineError('x')).mockResolvedValue({ pushed: 2, pulled: 5 })
    const { actor, clock } = start(f)
    actor.send({ type: 'ENABLE' }); await flushTick()
    expect(actor.getSnapshot()).toMatchObject({ value: 'offline', context: { failures: 1 } })
    clock.increment(4_000); await flushTick() // 2s * 2^1
    expect(actor.getSnapshot()).toMatchObject({ value: 'offline', context: { failures: 2 } })
    clock.increment(8_000); await flushTick()
    expect(actor.getSnapshot()).toMatchObject({ value: 'idle', context: { failures: 0, pushed: 2 } })
  })
  it('server errors are distinct from offline and retried later', async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValue({ pushed: 0, pulled: 0 })
    const { actor, clock } = start(f)
    actor.send({ type: 'ENABLE' }); await flushTick()
    expect(actor.getSnapshot().value).toBe('error')
    clock.increment(60_000); await flushTick()
    expect(actor.getSnapshot().value).toBe('idle')
  })
  it('DISABLE pauses from any state', async () => {
    const { actor } = start(vi.fn().mockRejectedValue(new OfflineError('x')))
    actor.send({ type: 'ENABLE' }); await flushTick()
    actor.send({ type: 'DISABLE' })
    expect(actor.getSnapshot().value).toBe('paused')
  })
})
