/**
 * bookLoader — loading ─▶ ready | notInstalled (404) | error ──RETRY──▶ loading
 * Loads the public puzzle pack (static, no sign-in). contentVersion = short SHA-256 of the pack,
 * used to detect changed puzzles on resume.
 */
import { assign, fromPromise, setup } from 'xstate'
import type { Book, Exercise } from '../lib/types'
import type { PuzzleId } from '@shared/progress'

export interface LoadedBook { book: Book; byId: Map<PuzzleId, Exercise>; contentVersion: string }
class HttpError extends Error { constructor(public status: number) { super(`HTTP ${status}`) } }

export async function fetchBook(url = '/data/pack.json'): Promise<LoadedBook> {
  const r = await fetch(url)
  if (!r.ok) throw new HttpError(r.status)
  const text = await r.text()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const contentVersion = [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('')
  const book = JSON.parse(text) as Book
  return { book, byId: new Map(book.exercises.map((e) => [e.id, e])), contentVersion }
}

export const bookLoader = setup({
  types: {} as { context: { data: LoadedBook | null; error: string | null }; events: { type: 'RETRY' } },
  actors: { load: fromPromise(() => fetchBook()) },
  guards: {
    is404: ({ event }) => (event as unknown as { error: unknown }).error instanceof HttpError && ((event as unknown as { error: HttpError }).error.status === 404),
  },
}).createMachine({
  id: 'bookLoader',
  context: { data: null, error: null },
  initial: 'loading',
  states: {
    loading: {
      invoke: {
        src: 'load',
        onDone: { target: 'ready', actions: assign({ data: ({ event }) => event.output, error: null }) },
        onError: [
          { guard: 'is404', target: 'notInstalled' },
          { target: 'error', actions: assign({ error: ({ event }) => String(event.error) }) },
        ],
      },
    },
    ready: {}, // never reloads under an active session
    notInstalled: { on: { RETRY: 'loading' } },
    error: { on: { RETRY: 'loading' } },
  },
})
