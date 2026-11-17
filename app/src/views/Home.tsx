import { Link, useNavigate } from '@tanstack/react-router'
import { useApp } from '../app/data'
import { Credit, SectionLabel } from '../components/common'
import { startRun } from '../core/store'
import { rushBest } from '../machines/rush'
import { adoptSession, otherDeviceSessions, type RemoteSession } from '../core/sync'
import { useEffect, useState } from 'react'

export default function Home() {
  const app = useApp()
  const nav = useNavigate()
  const s = app.session
  const resume = s && s.index < s.queue.length && app.loaded ? s : null
  const resumeEx = resume ? app.loaded!.byId.get(resume.queue[resume.index]) : null
  const ch = resumeEx ? app.loaded!.book.chapters.find((c) => c.chapter === resumeEx.chapter) : null

  // another device's last *synced* checkpoint, newer than this device's session → let the user choose
  const [remote, setRemote] = useState<RemoteSession | null>(null)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if (app.auth !== 'local' && app.auth !== 'signedIn') return
    let alive = true
    otherDeviceSessions().then((list) => {
      const newest = list[0]
      if (alive && newest && (!s || newest.updatedAt > s.updatedAt) && newest.record.runId !== s?.runId) setRemote(newest)
    }).catch(() => {})
    return () => { alive = false }
  }, [app.auth, app.sync, s])
  const remoteEx = remote && app.loaded ? app.loaded.byId.get(remote.record.queue[remote.record.index]) : null

  async function startReview() {
    if (!app.loaded || !app.due.length) return
    await startRun({ kind: 'review', queue: app.due.map((e) => e.id), chapter: null, contentVersion: app.loaded.contentVersion })
    nav({ to: '/session' })
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:py-10">
      <SectionLabel n="01">Choose</SectionLabel>
      <div className="grid gap-4 md:grid-cols-2">
        <Link to="/play" className="group panel relative flex min-h-[200px] flex-col justify-between p-6 hover:border-ink">
          <div className="label">Mode A · no account needed</div>
          <div>
            <div className="pixel text-[44px] leading-none">PLAY</div>
            <div className="mt-2 text-muted">Play a game against the computer. Pick a level, take your time.</div>
          </div>
          <div className="text-[12px] uppercase tracking-[.1em] group-hover:text-accent">&gt; start a game</div>
        </Link>
        <Link to="/learn" className="group panel relative flex min-h-[200px] flex-col justify-between border-accent/60 p-6 hover:border-accent">
          <div className="label">Mode B · lessons, progress, review</div>
          <div>
            <div className="pixel text-[44px] leading-none">LEARN</div>
            <div className="mt-2 text-muted">A guided tactics course: learn an idea, see it, practise it, then spot it on your own.</div>
          </div>
          <div className="flex items-end justify-between gap-4">
            <span className="text-[12px] uppercase tracking-[.1em] group-hover:text-accent">&gt; start the course</span>
          </div>
        </Link>
      </div>
      <div className="mt-3"><Credit /></div>

      {remote && remoteEx && !dismissed && (
        <div className="mt-6 panel flex flex-wrap items-center justify-between gap-3 border-accent p-4" role="alert">
          <div className="text-[13px]">Resume your <b>{remote.device ?? 'other device'}</b> session: puzzle #{remoteEx.id} ({remote.record.index + 1}/{remote.record.queue.length}{remote.record.puzzle?.moves.length ? `, move ${remote.record.puzzle.moves.length + 1}` : ''}) — or continue this device's.</div>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={async () => { await adoptSession(remote); nav({ to: '/session' }) }}>Resume {remote.device ?? 'other'} session</button>
            <button className="btn" onClick={() => setDismissed(true)}>Continue here</button>
          </div>
        </div>
      )}
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        <div className="panel p-5">
          <div className="label mb-3">Continue</div>
          {resume && resumeEx ? (
            <>
              <div className="text-[15px]">{resume.runKind === 'review' ? 'Review session' : `Ch. ${ch?.chapter} · ${ch?.name}`}</div>
              <div className="mt-1 text-muted text-[12px]">Puzzle #{resumeEx.id} · {resume.index + 1}/{resume.queue.length}{resume.puzzle && !resume.puzzle.saved && resume.puzzle.moves.length ? ` · move ${resume.puzzle.moves.length + 1}` : ''}</div>
              <Link to="/session" className="btn btn-primary mt-4">Resume</Link>
            </>
          ) : <div className="text-muted text-[13px]">No session in progress. Pick a chapter in <Link to="/learn" className="underline">Learn</Link>.</div>}
        </div>
        <div className="panel p-5">
          <div className="label mb-3">Fix my mistakes · or rush</div>
          <div className="pixel text-[34px] leading-none">{app.due.length}</div>
          <div className="mt-1 text-muted text-[12px]">{app.due.length ? 'puzzles to fix today' : 'nothing due today'}</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn" disabled={!app.due.length} onClick={startReview}>Start review</button>
            <Link to="/rush" className="btn">Puzzle rush · best {rushBest(app.progress).best}</Link>
          </div>
        </div>
        <div className="panel p-5">
          <div className="label mb-3">Today's quests</div>
          <ul className="space-y-3">
            {app.quests.map((q) => (
              <li key={q.id}>
                <div className="flex justify-between gap-2 text-[12px]"><span className={q.done ? 'line-through text-muted' : ''}>{q.label}</span><span className="pixel">{q.progress}/{q.target}</span></div>
                <div className="mt-1 h-[3px] bg-line"><div className={`h-full ${q.done ? 'bg-good' : 'bg-accent'}`} style={{ width: `${(q.progress / q.target) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-[11px] text-faint">+15 XP each · +25 for all three</div>
        </div>
      </div>
    </div>
  )
}
