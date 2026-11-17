import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useApp } from './data'
import { updateProfile } from '../core/store'
import { FeedbackButton } from '../components/Feedback'

const NAV = [
  { to: '/play', label: 'Play' },
  { to: '/learn', label: 'Learn' },
  { to: '/rush', label: 'Rush' },
  { to: '/review', label: 'Review' },
  { to: '/stats', label: 'Stats' },
] as const

export default function Shell() {
  const app = useApp()
  const path = useRouterState({ select: (s) => s.location.pathname })
  useEffect(() => { document.documentElement.dataset.theme = app.profile.theme }, [app.profile.theme])
  const active = (to: string) => path === to || path.startsWith(to + '/') || (to === '/learn' && path === '/session')
  const goalSquares = Array.from({ length: Math.min(app.profile.dailyGoal, 10) }, (_, i) => i < app.todayCount)

  const navItems = NAV.map((n) => (
    <Link key={n.to} to={n.to} className={`px-2 py-1 uppercase tracking-[.1em] text-[12px] ${active(n.to) ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'}`}>
      <span className={active(n.to) ? '' : 'bracket'}>{n.label}</span>
      {n.to === '/review' && app.due.length > 0 && <span className="ml-1 pixel">·{app.due.length}</span>}
    </Link>
  ))

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 flex h-[var(--topbar)] shrink-0 items-center gap-3 border-b sm:gap-4 border-line bg-bg/95 px-4 backdrop-blur-0">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-[.14em] uppercase text-[13px]">
          <span className="pixel text-[18px] text-accent">♞</span> <span className="hidden sm:inline">Open Chess Trainer</span><span className="sm:hidden">OCT</span>
        </Link>
        <nav className="hidden gap-1 md:flex" aria-label="Main">{navItems}</nav>
        <div className="ml-auto flex min-w-0 items-center gap-2.5 sm:gap-4">
          <div className="hidden items-center gap-1 sm:flex" title={`Daily goal ${app.todayCount}/${app.profile.dailyGoal}`} aria-label={`Daily goal ${app.todayCount} of ${app.profile.dailyGoal}`}>
            {goalSquares.map((on, i) => <span key={i} className={`h-2.5 w-2.5 border ${on ? 'border-accent bg-accent' : 'border-line-strong'}`} />)}
          </div>
          <div className="whitespace-nowrap text-[12px] text-muted" title="Day streak"><span className="text-ink pixel">{app.streak}</span>d<span className="hidden sm:inline"> streak</span></div>
          <Link to="/stats" className="min-w-[96px] sm:min-w-[120px]" title={`${app.level.into}/${app.level.span} XP to level ${app.level.level + 1}`}>
            <div className="flex items-baseline justify-between gap-2 text-[11px] uppercase tracking-[.1em]">
              <span>{app.level.title}</span><span className="pixel text-[13px]">LV{app.level.level}</span>
            </div>
            <div className="mt-1 h-[3px] bg-line"><div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round(app.level.progress * 100)}%` }} /></div>
          </Link>
          <FeedbackButton />
          <AccountBadge />
          <button className="btn btn-ghost !px-2" aria-label="Toggle light/dark theme"
            onClick={() => updateProfile({ theme: app.profile.theme === 'dark' ? 'light' : 'dark' })}>{app.profile.theme === 'dark' ? '◐' : '◑'}</button>
        </div>
      </header>
      <AchievementToast />
      <main className="flex min-h-0 flex-1 flex-col pb-[56px] md:pb-0"><Outlet /></main>
      <nav className="fixed inset-x-0 bottom-0 z-20 flex h-[56px] items-center justify-around border-t border-line bg-bg md:hidden" aria-label="Main mobile">{navItems}</nav>
    </div>
  )
}

function AccountBadge() {
  const app = useApp()
  const dot = app.sync === 'idle' ? 'bg-good' : app.sync === 'flushing' ? 'bg-accent' : app.sync === 'paused' ? 'bg-line-strong' : 'bg-bad'
  const syncTitle = app.sync === 'idle' ? 'Synced' : app.sync === 'flushing' ? 'Syncing…' : app.sync === 'offline' ? `Offline — ${app.pending} change(s) will sync later` : app.sync === 'error' ? 'Sync error, retrying' : 'Not syncing'
  if (app.auth === 'signedOut' || app.auth === 'redirecting') return <button className="btn !py-1 text-[11px]" onClick={app.signIn}>Sign in</button>
  if (app.auth === 'noServer') return <span className="label hidden sm:inline" title="No server: guest mode, progress stays on this device">guest</span>
  if (app.auth === 'checking') return null
  const name = app.auth === 'local' ? 'local' : app.me?.user?.name?.split(' ')[0] ?? 'me'
  return (
    <span className="flex items-center gap-2 text-[11px] uppercase tracking-[.1em]" title={syncTitle}>
      <span className={`h-1.5 w-1.5 ${dot}`} aria-label={syncTitle} />
      <span className="hidden sm:inline">{name}</span>
      {app.auth === 'signedIn' && <button className="text-faint hover:text-ink" onClick={app.signOut} aria-label="Sign out">⏻</button>}
    </span>
  )
}

/** Log-line toast when an achievement is newly earned (not on first load). */
function AchievementToast() {
  const app = useApp()
  const seen = useRef<Set<string> | null>(null)
  const [toast, setToast] = useState<{ name: string; desc: string } | null>(null)
  useEffect(() => {
    const earned = new Set(app.achievements.filter((a) => a.earned).map((a) => a.id))
    const newest = app.progress.events.at(-1)
    const justNow = !!newest && Date.now() - Date.parse(newest.finishedAt) < 30_000 // earned by an attempt just finished, not by loading history
    if (seen.current && justNow) {
      const fresh = app.achievements.find((a) => a.earned && !seen.current!.has(a.id))
      if (fresh) { setToast(fresh); setTimeout(() => setToast(null), 4500) }
    }
    seen.current = earned
  }, [app.achievements, app.progress.events.length])
  if (!toast) return null
  return (
    <div className="fixed bottom-[72px] right-4 z-40 border border-accent bg-bg px-4 py-3 font-mono text-[12px] shadow-none md:bottom-6" role="status">
      <span className="pixel text-accent">◆</span> [achievement] <b>{toast.name}</b> <span className="text-muted">· {toast.desc}</span>
    </div>
  )
}
