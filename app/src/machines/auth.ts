/**
 * auth — who is using the app. Independent from sync (you can be signed in and offline).
 *
 *   checking ─┬─ local          (server in AUTH_MODE=local: one implicit local user)
 *             ├─ signedIn       (google session, invited)
 *             ├─ notInvited     (google session, email not in ALLOWED_EMAILS)
 *             ├─ signedOut      (google mode, no session) ──SIGN_IN──▶ redirect to Google
 *             └─ noServer       (static build / server unreachable: guest only) ──(30s)──▶ checking
 */
import { assign, fromPromise, setup } from 'xstate'

export interface Me { mode: 'local' | 'google'; user: { id: string; email: string | null; name: string } | null; allowed: boolean }

export const authMachine = setup({
  types: {} as { context: { me: Me | null }; events: { type: 'SIGN_IN' } | { type: 'SIGN_OUT' } | { type: 'RECHECK' } },
  actors: {
    fetchMe: fromPromise<Me>(async () => {
      const r = await fetch('/api/me', { credentials: 'include' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    }),
    signIn: fromPromise<void>(async () => {
      const r = await fetch('/api/auth/sign-in/social', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'google', callbackURL: location.pathname === '/' ? '/learn' : location.pathname }) })
      const { url } = await r.json()
      location.href = url
    }),
    signOut: fromPromise<void>(async () => { await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' }) }),
  },
  delays: { RECHECK_DELAY: 30_000 },
  guards: {
    isLocal: ({ event }) => (event as unknown as { output: Me }).output.mode === 'local',
    isSignedIn: ({ event }) => { const m = (event as unknown as { output: Me }).output; return !!m.user && m.allowed },
    isNotInvited: ({ event }) => { const m = (event as unknown as { output: Me }).output; return !!m.user && !m.allowed },
  },
}).createMachine({
  id: 'auth',
  context: { me: null },
  initial: 'checking',
  states: {
    checking: {
      invoke: {
        src: 'fetchMe',
        onDone: [
          { guard: 'isLocal', target: 'local', actions: assign({ me: ({ event }) => event.output }) },
          { guard: 'isSignedIn', target: 'signedIn', actions: assign({ me: ({ event }) => event.output }) },
          { guard: 'isNotInvited', target: 'notInvited', actions: assign({ me: ({ event }) => event.output }) },
          { target: 'signedOut', actions: assign({ me: ({ event }) => event.output }) },
        ],
        onError: 'noServer',
      },
    },
    local: { on: { RECHECK: 'checking' } },
    signedIn: { on: { SIGN_OUT: 'signingOut', RECHECK: 'checking' } },
    notInvited: { on: { SIGN_OUT: 'signingOut' } },
    signedOut: { on: { SIGN_IN: 'redirecting', RECHECK: 'checking' } },
    redirecting: { invoke: { src: 'signIn', onError: 'signedOut' } },
    signingOut: { invoke: { src: 'signOut', onDone: 'checking', onError: 'checking' } },
    noServer: { after: { RECHECK_DELAY: 'checking' }, on: { RECHECK: 'checking' } },
  },
})
