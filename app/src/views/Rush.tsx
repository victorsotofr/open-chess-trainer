import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useActorRef, useSelector } from '@xstate/react'
import { fromPromise, type ActorRefFrom } from 'xstate'
import { Chess } from 'chess.js'
import { useApp } from '../app/data'
import { BookGate, PAGE, PageHeader, SectionLabel } from '../components/common'
import Board from '../components/Board'
import { rushMachine, rushQueue, rushBest, RUSH_STRIKES } from '../machines/rush'
import { puzzleSession } from '../machines/puzzleSession'
import { commitAttempt } from '../core/store'
import { isUnlocked } from '../lib/gamify'
import { play as playSound } from '../lib/sound'

export default function Rush() { return <BookGate><RushView /></BookGate> }

function RushView() {
  const app = useApp()
  const runIdRef = useRef('')
  const machine = useMemo(() => rushMachine.provide({
    actors: { puzzleSession: puzzleSession.provide({
      actors: { saveAttempt: fromPromise(async ({ input }) => commitAttempt(input.record, { solverMoves: input.solverMoves, mode: input.mode, run: { runId: runIdRef.current, runKind: 'rush' } })) },
    }) },
  }), [])
  const rush = useActorRef(machine) // leaving the page stops the run (by design: not resumable)
  const state = useSelector(rush, (s) => s.value as string | Record<string, string>)
  const ctx = useSelector(rush, (s) => s.context)
  runIdRef.current = ctx.runId
  const child = useSelector(rush, (s) => s.children.puzzle as ActorRefFrom<typeof puzzleSession> | undefined)
  const { best, runs } = rushBest(app.progress)
  const running = typeof state === 'object'
  const over = state === 'over'

  const pool = useMemo(() => {
    const chapters = app.loaded!.book.chapters.filter((c) => app.byChapter.has(c.chapter))
    const stars = chapters.map((c) => app.chapterStars.get(c.chapter) ?? 0)
    return chapters.filter((_, i) => isUnlocked(i, stars, app.profile.freePlay)).flatMap((c) => app.byChapter.get(c.chapter) ?? [])
  }, [app.loaded, app.byChapter, app.chapterStars, app.profile.freePlay])

  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!running) return; const t = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(t) }, [running])
  const left = Math.max(0, ctx.endsAt - now)
  const mmss = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`

  const prevResults = useRef(0)
  useEffect(() => {
    if (ctx.results.length > prevResults.current) playSound(ctx.results.at(-1)!.ok ? 'good' : 'bad', app.profile.sound)
    prevResults.current = ctx.results.length
  }, [ctx.results, app.profile.sound])

  if (!running && !over) return (
    <div className={PAGE}>
      <PageHeader title="RUSH" sub="Solve as many puzzles as you can in 3 minutes. No hints; a wrong move costs a strike; three strikes and the run ends. Puzzles get harder as you go, drawn from the chapters you have unlocked." />
      <div className="grid grid-cols-3 gap-3">
        <div className="panel p-4"><div className="label">Personal best</div><div className="pixel mt-2 text-[34px]">{best}</div></div>
        <div className="panel p-4"><div className="label">Runs</div><div className="pixel mt-2 text-[34px]">{runs}</div></div>
        <div className="panel p-4"><div className="label">Puzzle pool</div><div className="pixel mt-2 text-[34px]">{pool.length}</div></div>
      </div>
      <p className="mt-3 text-[11px] text-faint">Missed puzzles go to Review. Unlock more chapters to widen the pool (or turn on free play in Stats).</p>
      <button className="btn btn-primary mt-6 px-6 py-3" disabled={pool.length === 0} onClick={() => rush.send({ type: 'START', queue: rushQueue(pool) })}>Start rush</button>
    </div>
  )

  if (over) {
    const newBest = ctx.score > 0 && ctx.score >= best
    const missed = ctx.results.filter((r) => !r.ok)
    return (
      <div className="mx-auto mt-12 w-full max-w-lg px-4">
        <div className="panel p-6">
          <div className="label">Rush over · {ctx.strikes >= RUSH_STRIKES ? 'three strikes' : 'time'}</div>
          <div className="pixel mt-3 text-[64px] leading-none">{ctx.score}</div>
          <div className="mt-1 text-muted">puzzles solved{newBest ? <span className="ml-2 text-accent">· new personal best</span> : <span className="ml-2">· best {best}</span>}</div>
          <div className="mt-4 flex flex-wrap gap-[3px]">{ctx.results.map((r, i) => <span key={i} className={`h-3 w-3 ${r.ok ? 'bg-accent' : 'bg-bad'}`} title={`#${r.puzzleId}`} />)}</div>
          {missed.length > 0 && <p className="mt-3 text-[12px] text-muted">Missed: {missed.map((m) => `#${m.puzzleId}`).join(', ')} — they are now in Review.</p>}
          <div className="mt-5 flex gap-2">
            <button className="btn btn-primary" onClick={() => { rush.send({ type: 'RESTART' }); rush.send({ type: 'START', queue: rushQueue(pool) }) }}>Again</button>
            <button className="btn" onClick={() => rush.send({ type: 'RESTART' })}>Done</button>
            {missed.length > 0 && <Link to="/review" className="btn btn-ghost">Review</Link>}
          </div>
        </div>
      </div>
    )
  }

  return child ? <RushBoard actor={child} timer={mmss} lowTime={left < 20_000} score={ctx.score} strikes={ctx.strikes} results={ctx.results} onQuit={() => rush.send({ type: 'QUIT' })} /> : null
}

function RushBoard({ actor, timer, lowTime, score, strikes, results, onQuit }: {
  actor: ActorRefFrom<typeof puzzleSession>; timer: string; lowTime: boolean; score: number; strikes: number; results: { ok: boolean }[]; onQuit: () => void
}) {
  const c = useSelector(actor, (s) => s.context)
  const value = useSelector(actor, (s) => s.value as string)
  const white = c.ex.fen.split(' ')[1] === 'w'
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null)
  function onMove(from: string, to: string) {
    const p = new Chess(c.fen).get(from as never)
    if (p?.type === 'p' && (to[1] === '8' || to[1] === '1')) { setPromo({ from, to }); return }
    actor.send({ type: 'MOVE', uci: from + to })
  }
  return (
    <div className="grid h-[calc(100dvh-var(--topbar)-56px)] min-h-0 grid-rows-[auto_minmax(0,1fr)] md:h-[calc(100dvh-var(--topbar))] md:grid-cols-[1fr_minmax(300px,360px)] md:grid-rows-1">
      <div className="flex min-h-0 items-center justify-center p-3 md:p-6">
        <div className="h-[min(60dvh,calc(100vw-16px))] w-full md:h-full">
          <Board fen={c.fen} orientation={white ? 'white' : 'black'} interactive={value === 'playing'} onMove={onMove} lastMove={c.lastMove} />
        </div>
        {promo && (
          <div className="fixed inset-0 z-30 flex items-center justify-center bg-bg/70" onClick={() => setPromo(null)}>
            <div className="panel flex gap-2 p-3" onClick={(e) => e.stopPropagation()}>
              {(['q', 'r', 'b', 'n'] as const).map((p) => <button key={p} className="btn text-[22px]" onClick={() => { const pr = promo; setPromo(null); actor.send({ type: 'MOVE', uci: pr.from + pr.to + p }) }}>{{ q: '♛', r: '♜', b: '♝', n: '♞' }[p]}</button>)}
            </div>
          </div>
        )}
      </div>
      <aside className="flex min-h-0 flex-col gap-5 overflow-y-auto border-t border-line p-4 md:border-l md:border-t-0 md:p-5">
        <SectionLabel n="⏱">Rush</SectionLabel>
        <div className={`pixel text-[56px] leading-none ${lowTime ? 'text-bad' : ''}`} aria-live="off">{timer}</div>
        <div className="flex items-end justify-between">
          <div><div className="label">Score</div><div className="pixel text-[40px] leading-none text-accent">{score}</div></div>
          <div className="text-right"><div className="label">Strikes</div>
            <div className="mt-2 flex gap-1">{Array.from({ length: RUSH_STRIKES }, (_, i) => <span key={i} className={`h-4 w-4 border ${i < strikes ? 'border-bad bg-bad' : 'border-line-strong'}`} />)}</div></div>
        </div>
        <div className="text-[16px] font-semibold tracking-[.06em]"><span className="text-accent">&gt;</span> {white ? 'WHITE' : 'BLACK'} TO MOVE</div>
        <div className="flex flex-wrap gap-[3px]">{results.map((r, i) => <span key={i} className={`h-2.5 w-2.5 ${r.ok ? 'bg-accent' : 'bg-bad'}`} />)}</div>
        <div className="text-[11px] text-faint">#{c.ex.id} · {c.ex.section}</div>
        <button className="label mt-auto self-start hover:text-ink" onClick={onQuit}>■ end run</button>
      </aside>
    </div>
  )
}


