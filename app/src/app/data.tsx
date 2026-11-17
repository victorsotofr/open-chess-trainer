import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useActorRef, useSelector } from '@xstate/react'
import { fromPromise } from 'xstate'
import { bookLoader, type LoadedBook } from '../machines/bookLoader'
import { authMachine, type Me } from '../machines/auth'
import { syncMachine } from '../machines/sync'
import { flush } from '../core/sync'
import { bindOwner } from '../core/store'
import { db, getProfile, loadSession, useLive, defaultProfile, type Profile } from '../core/store'
import { dayIn, fold, isDue, liveStreak, type Progress } from '@shared/progress'
import { achievements, levelInfo, questsFor, questXp, stars, type Quest } from '../lib/gamify'
import type { SessionRecord } from '@shared/session'
import type { Exercise } from '../lib/types'

export interface AppData {
  bookState: 'loading' | 'ready' | 'notInstalled' | 'error'
  bookError: string | null
  retryBook: () => void
  loaded: LoadedBook | null
  profile: Profile
  progress: Progress
  today: string
  xp: number // events + quests
  level: ReturnType<typeof levelInfo>
  streak: number
  todayCount: number
  quests: Quest[]
  due: Exercise[]
  session: SessionRecord | null
  byChapter: Map<number, Exercise[]>
  chapterStars: Map<number, number>
  goalDays: number
  achievements: ReturnType<typeof achievements>
  auth: 'checking' | 'local' | 'signedIn' | 'notInvited' | 'signedOut' | 'redirecting' | 'signingOut' | 'noServer'
  me: Me | null
  signIn: () => void
  signOut: () => void
  sync: 'paused' | 'idle' | 'flushing' | 'offline' | 'error'
  pending: number // events waiting in the outbox
  syncNow: () => void
}

const Ctx = createContext<AppData | null>(null)

export function AppDataProvider({ children }: { children: ReactNode }) {
  const loader = useActorRef(bookLoader)
  const authRef = useActorRef(authMachine)
  const syncRef = useActorRef(syncMachine.provide({ actors: { flush: fromPromise(() => flush()) } }))
  const auth = useSelector(authRef, (s) => s.value as AppData['auth'])
  const me = useSelector(authRef, (s) => s.context.me)
  const sync = useSelector(syncRef, (s) => s.value as AppData['sync'])
  const pending = useLive(() => db.outbox.count(), [], 0)
  // finished/abandoned games sync right away; games in progress ride the periodic flush
  const pendingGames = useLive(() => db.gamesV2.filter((g) => !g.synced && g.status !== 'active').count(), [], 0)

  // auth drives sync and book access (independent machines, wired here)
  useEffect(() => {
    if (auth === 'local' || auth === 'signedIn') {
      const uid = auth === 'local' ? 'local' : me?.user?.id
      // bind local data to this account before any sync (never mix two people's progress)
      void (uid ? bindOwner(uid) : Promise.resolve()).then(() => { syncRef.send({ type: 'ENABLE' }); loader.send({ type: 'RETRY' }) })
    } else syncRef.send({ type: 'DISABLE' })
  }, [auth, me?.user?.id, syncRef, loader])
  // flush soon after a new attempt lands in the outbox, and when the network returns
  useEffect(() => { if (pending > 0 || pendingGames > 0) syncRef.send({ type: 'FLUSH' }) }, [pending, pendingGames, syncRef])
  useEffect(() => {
    const on = () => syncRef.send({ type: 'FLUSH' })
    addEventListener('online', on)
    return () => removeEventListener('online', on)
  }, [syncRef])
  const bookState = useSelector(loader, (s) => s.value as AppData['bookState'])
  const loaded = useSelector(loader, (s) => s.context.data)
  const bookError = useSelector(loader, (s) => s.context.error)

  // live queries must be read-only; the default profile is created once at startup
  useEffect(() => { void getProfile() }, [])
  const stored = useLive(() => db.settings.get('profile'), [], undefined)
  const profile = useMemo(() => stored ?? defaultProfile({ deviceId: 'pending' }), [stored])
  const events = useLive(() => db.events.toArray(), [], [])
  const session = useLive(loadSession, [], null)

  const value = useMemo<AppData>(() => {
    const tz = profile.timeZone
    const progress = fold(events, tz)
    const today = dayIn(new Date().toISOString(), tz)
    const xp = progress.xp + questXp(progress, tz)
    const exercises = loaded?.book.exercises ?? []
    const byChapter = new Map<number, Exercise[]>()
    exercises.forEach((e) => byChapter.set(e.chapter, [...(byChapter.get(e.chapter) ?? []), e]))
    byChapter.forEach((v) => v.sort((a, b) => a.id - b.id))
    const chapterStars = new Map([...byChapter].map(([c, xs]) => [c, stars(xs.map((x) => x.id), progress)]))
    const goalDays = [...progress.events.reduce((m, e) => m.set(dayIn(e.finishedAt, tz), Math.max(m.get(dayIn(e.finishedAt, tz)) ?? 0, e.dailyGoal)), new Map<string, number>())]
      .filter(([d, goal]) => (progress.days.get(d) ?? 0) >= goal).length
    return {
      bookState, bookError, retryBook: () => loader.send({ type: 'RETRY' }), loaded, profile, progress, today, xp,
      level: levelInfo(xp), streak: liveStreak(progress, today), todayCount: progress.days.get(today) ?? 0,
      quests: questsFor(today, progress, tz),
      due: exercises.filter((e) => { const p = progress.puzzles.get(e.id); return !!p && isDue(p, today) }),
      session, byChapter, chapterStars, goalDays, achievements: achievements(progress, exercises, goalDays, tz),
      auth, me, signIn: () => authRef.send({ type: 'SIGN_IN' }), signOut: () => authRef.send({ type: 'SIGN_OUT' }),
      sync, pending, syncNow: () => syncRef.send({ type: 'FLUSH' }),
    }
  }, [bookState, bookError, loaded, profile, events, session, loader, auth, me, sync, pending, authRef, syncRef])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppData {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppDataProvider')
  return v
}

/** Where the puzzles come from (public domain, CC0). */
export const SOURCE = {
  name: 'Lichess puzzle database',
  license: 'CC0',
  url: 'https://database.lichess.org/#puzzles',
}
