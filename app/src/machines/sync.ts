/**
 * sync — pushes the local outbox and pulls server events; independent from auth.
 *
 *   paused ──ENABLE──▶ idle ──FLUSH / every 30s──▶ flushing ─┬─▶ idle      (acked entries removed from outbox)
 *     ▲                                                     ├─▶ offline   (network error) ──backoff──▶ flushing
 *     └──────────── DISABLE (signed out / no server) ───────┴─▶ error     (4xx/5xx; kept for retry) ──60s──▶ flushing
 *
 * Events are idempotent by attemptId on both sides, so retries and duplicate pushes are harmless.
 * Pending local events stay in the outbox while paused (e.g. signed out) and flush after sign-in.
 */
import { assign, fromPromise, setup } from 'xstate'

export interface SyncIO {
  /** push outbox, pull events + profile, push session checkpoint; resolves with counts */
  flush: () => Promise<{ pushed: number; pulled: number }>
}

export interface SyncContext { failures: number; lastSyncAt: string | null; lastError: string | null; pushed: number }

export class OfflineError extends Error {}

export const syncMachine = setup({
  types: {} as { context: SyncContext; events: { type: 'ENABLE' } | { type: 'DISABLE' } | { type: 'FLUSH' } },
  actors: { flush: fromPromise<{ pushed: number; pulled: number }>(async () => ({ pushed: 0, pulled: 0 })) },
  delays: {
    INTERVAL: 30_000,
    BACKOFF: ({ context }) => Math.min(60_000, 2_000 * 2 ** Math.min(context.failures, 5)),
    ERROR_RETRY: 60_000,
  },
  guards: { isOffline: ({ event }) => (event as unknown as { error: unknown }).error instanceof OfflineError },
}).createMachine({
  id: 'sync',
  context: { failures: 0, lastSyncAt: null, lastError: null, pushed: 0 },
  initial: 'paused',
  on: { DISABLE: '.paused' },
  states: {
    paused: { on: { ENABLE: 'flushing' } },
    idle: { on: { FLUSH: 'flushing' }, after: { INTERVAL: 'flushing' } },
    flushing: {
      invoke: {
        src: 'flush',
        onDone: { target: 'idle', actions: assign(({ context, event }) => ({ failures: 0, lastError: null, lastSyncAt: new Date().toISOString(), pushed: context.pushed + event.output.pushed })) },
        onError: [
          { guard: 'isOffline', target: 'offline', actions: assign(({ context }) => ({ failures: context.failures + 1, lastError: 'offline' })) },
          { target: 'error', actions: assign(({ context, event }) => ({ failures: context.failures + 1, lastError: String(event.error) })) },
        ],
      },
    },
    offline: { on: { FLUSH: 'flushing' }, after: { BACKOFF: 'flushing' } },
    error: { on: { FLUSH: 'flushing' }, after: { ERROR_RETRY: 'flushing' } },
  },
})
