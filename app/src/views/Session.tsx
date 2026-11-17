import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useActorRef, useSelector } from '@xstate/react'
import { fromPromise, type ActorRefFrom } from 'xstate'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import { Chess } from 'chess.js'
import { useApp } from '../app/data'
import { BookGate, Credit } from '../components/common'
import Board from '../components/Board'
import { runMachine } from '../machines/run'
import { puzzleSession } from '../machines/puzzleSession'
import { advanceRun, commitAttempt, endRun, loadSession, savePuzzleRecord, startRun } from '../core/store'
import { formatLine, solverMoves } from '../lib/puzzle'
import type { SessionRecord } from '@shared/session'
import type { LoadedBook } from '../machines/bookLoader'
import { play as playSound } from '../lib/sound'
import { levelInfo } from '../lib/gamify'

export default function Session() { return <BookGate><SessionGate /></BookGate> }

/** Captures the durable record once per run, then hands it to the run actor. */
function SessionGate() {
  const app = useApp()
  const [record, setRecord] = useState<SessionRecord | null | undefined>(undefined)
  // read the durable record directly (not the live query, which may lag right after startRun)
  useEffect(() => { let alive = true; void loadSession().then((r) => { if (alive) setRecord(r) }); return () => { alive = false } }, [])
  // a new run was started from this page (e.g. "Continue this chapter"): switch to it
  const liveRun = app.session?.runId
  useEffect(() => {
    if (record !== undefined && app.session && app.session.runId !== record?.runId && app.session.index < app.session.queue.length) setRecord(app.session)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRun])
  if (record === undefined) return null
  if (!record || record.index >= record.queue.length) return (
    <div className="mx-auto mt-16 max-w-md panel p-6 text-center">
      <div className="label">No session in progress</div>
      <p className="mt-2 text-muted">Start a chapter or a review.</p>
      <div className="mt-4 flex justify-center gap-2"><Link to="/learn" className="btn btn-primary">Learn</Link><Link to="/review" className="btn">Review</Link></div>
    </div>
  )
  return <Run key={record.runId} record={record} loaded={app.loaded!} />
}

const runWithStore = runMachine.provide({
  actions: { advance: (_, p) => { void advanceRun(p.index) }, finish: () => { void endRun() } },
  actors: {
    puzzleSession: puzzleSession.provide({
      actions: { persist: (_, p) => { void savePuzzleRecord(p.record) } },
      actors: { saveAttempt: fromPromise(async ({ input }) => commitAttempt(input.record, { solverMoves: input.solverMoves, mode: input.mode })) },
    }),
  },
})

function Run({ record, loaded }: { record: SessionRecord; loaded: LoadedBook }) {
  const run = useActorRef(runWithStore, { input: { record, exercises: loaded.byId } }) // stopped on unmount → child + timers cancelled
  const state = useSelector(run, (s) => s.value as string)
  const rec = useSelector(run, (s) => s.context.record)
  const child = useSelector(run, (s) => s.children.puzzle as ActorRefFrom<typeof puzzleSession> | undefined)
  const ex = loaded.byId.get(rec.queue[Math.min(rec.index, rec.queue.length - 1)])!
  const nav = useNavigate()

  if (state === 'complete') return <RunComplete rec={rec} />
  return (
    <div className="grid h-[calc(100dvh-var(--topbar)-56px)] min-h-0 grid-rows-[auto_minmax(0,1fr)] md:h-[calc(100dvh-var(--topbar))] md:grid-cols-[1fr_minmax(320px,380px)] md:grid-rows-1">
      {child
        ? <PuzzlePane key={child.id + rec.index} actor={child} rec={rec} onExit={() => { run.send({ type: 'EXIT' }); if (rec.chapter) nav({ to: '/learn/$chapter', params: { chapter: String(rec.chapter) } }); else nav({ to: '/review' }) }} />
        : <BetweenPane rec={rec} exId={ex.id} onNext={() => run.send({ type: 'NEXT' })} />}
    </div>
  )
}

function useKey(map: Record<string, () => void>) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.tagName === 'INPUT') return; map[e.key.toLowerCase()]?.() }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  })
}

function RunHeader({ rec, exId }: { rec: SessionRecord; exId: number }) {
  const app = useApp()
  const ex = app.loaded!.byId.get(exId)!
  const ch = app.loaded!.book.chapters.find((c) => c.chapter === ex.chapter)
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="label truncate">{rec.runKind === 'review' ? 'Review' : `Ch.${ex.chapter} ${ch?.name ?? ''}`} · #{ex.id}</div>
      <div className="flex gap-[3px]" aria-label={`Puzzle ${rec.index + 1} of ${rec.queue.length}`}>
        {rec.queue.length <= 40
          ? rec.queue.map((_, i) => <span key={i} className={`h-2 w-2 border ${i < rec.index ? 'border-accent bg-accent' : i === rec.index ? 'border-ink' : 'border-line-strong'}`} />)
          : <span className="pixel text-[12px]">{rec.index + 1}/{rec.queue.length}</span>}
      </div>
    </div>
  )
}

const HINTS = ['Hint', 'Show the piece', 'Show the move']

function PuzzlePane({ actor, rec, onExit }: { actor: ActorRefFrom<typeof puzzleSession>; rec: SessionRecord; onExit: () => void }) {
  const app = useApp()
  const snap = useSelector(actor, (s) => s)
  const c = snap.context
  const ex = c.ex
  const value = snap.value as string
  const solverWhite = ex.fen.split(' ')[1] === 'w'
  const toMove = new Chess(c.fen).turn() === 'w' ? 'WHITE' : 'BLACK'
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null)
  const playing = value === 'playing'
  const book = ex.solution_uci[2 * c.k]

  const shapes = useMemo<DrawShape[]>(() => {
    const s: DrawShape[] = []
    if (c.feedback?.arrow) s.push({ orig: c.feedback.arrow[0] as Key, dest: c.feedback.arrow[1] as Key, brush: 'red' })
    if (c.hints >= 3 && playing && book) s.push({ orig: book.slice(0, 2) as Key, dest: book.slice(2, 4) as Key, brush: 'hint' })
    return s
  }, [c.feedback, c.hints, playing, book])
  const highlight = useMemo(() => (c.hints >= 2 && playing && book ? [book.slice(0, 2)] : []), [c.hints, playing, book])
  // sounds follow state transitions (off unless enabled in settings)
  useEffect(() => {
    const on = app.profile.sound
    if (value === 'wrong') playSound('bad', on)
    else if (value === 'replying' || value === 'saving') playSound('good', on)
    else if (value === 'playing' && c.lastMove) playSound('move', on) // the opponent's reply just landed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const flash = useMemo(() => (c.pending ? { square: c.pending.to, tone: (value === 'wrong' ? 'bad' : 'good') as 'good' | 'bad', key: c.moves.length + c.mistakes } : null),
    [c.pending, value, c.moves.length, c.mistakes])

  function onMove(from: string, to: string) {
    const p = new Chess(c.fen).get(from as never)
    if (p?.type === 'p' && (to[1] === '8' || to[1] === '1')) { setPromo({ from, to }); return }
    actor.send({ type: 'MOVE', uci: from + to })
  }
  useKey({ h: () => actor.send({ type: 'HINT' }), enter: () => value === 'wrong' && actor.send({ type: 'RETRY' }), r: () => value === 'wrong' && actor.send({ type: 'RETRY' }) })

  const status = value === 'wrong' ? 'MISTAKE' : value === 'replying' ? `${toMove} REPLIES…` : value === 'revealing' ? 'BOOK MOVE…' : value === 'saving' || value === 'finishing' ? 'SAVING…' : `${toMove} TO MOVE`

  return (
    <>
      <div className={`flex min-h-0 items-center justify-center p-3 md:p-6 ${value === 'wrong' ? 'shake' : ''}`} >
        <div className="h-[min(60dvh,calc(100vw-16px))] w-full md:h-full">
          <Board fen={c.fen} orientation={solverWhite ? 'white' : 'black'} interactive={playing} onMove={onMove}
            shapes={shapes} lastMove={c.lastMove} highlight={highlight} flash={flash} />
        </div>
        {promo && (
          <div className="fixed inset-0 z-30 flex items-center justify-center bg-bg/70" onClick={() => setPromo(null)}>
            <div className="panel flex gap-2 p-3" onClick={(e) => e.stopPropagation()}>
              {(['q', 'r', 'b', 'n'] as const).map((p) => (
                <button key={p} className="btn text-[22px]" onClick={() => { const pr = promo; setPromo(null); actor.send({ type: 'MOVE', uci: pr.from + pr.to + p }) }}>
                  {{ q: '♛', r: '♜', b: '♝', n: '♞' }[p]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-t border-line p-4 md:border-l md:border-t-0 md:p-5">
        <RunHeader rec={rec} exId={ex.id} />
        <div>
          <div className="label">{ex.section} · {ex.mode}</div>
          <div className="mt-2 flex items-center gap-3 text-[20px] font-semibold tracking-[.06em]" aria-live="polite">
            <span className="text-accent">&gt;</span>{status}
          </div>
          <div className="mt-1 text-[12px] text-muted">{solverMoves(ex) > 1 ? `Find the ${solverMoves(ex)}-move combination.` : 'Find the best move.'}{c.k > 0 ? ` Move ${c.k + 1} of ${solverMoves(ex)}.` : ''}</div>
        </div>
        {c.hints >= 1 && <div className="border-l-2 border-accent bg-surface-2 p-3 font-sans text-[13px]">{ex.hint ?? `Theme: ${ex.section}.`}</div>}
        {c.feedback && (
          <div className={`font-mono text-[12px] leading-relaxed ${c.feedback.tone === 'bad' ? 'text-bad' : c.feedback.tone === 'good' ? 'text-good' : 'text-info'}`}>
            [{c.feedback.tone === 'bad' ? 'x' : c.feedback.tone === 'good' ? 'ok' : 'i'}] {c.feedback.text}
          </div>
        )}
        {value === 'saveFailed' && <div className="text-bad text-[12px]">[x] Could not save: {c.saveError} <button className="btn ml-2" onClick={() => actor.send({ type: 'RETRY_SAVE' })}>Retry save</button></div>}
        <div className="flex flex-wrap gap-2">
          {value === 'wrong' && <button className="btn btn-primary" onClick={() => actor.send({ type: 'RETRY' })}>Try again <kbd className="text-[10px] opacity-60">↵</kbd></button>}
          {playing && c.hints < 3 && <button className="btn" onClick={() => actor.send({ type: 'HINT' })}>{HINTS[c.hints]}{c.hints > 0 ? ' · −XP' : ''} <kbd className="text-[10px] opacity-60">H</kbd></button>}
        </div>
        <div className="mt-auto space-y-2 border-t border-dashed border-line-strong pt-3 text-[11px] text-muted">
          <div className="flex justify-between"><span>mistakes {c.mistakes} · hints {c.hints}</span><span>combo ×{comboOf(app, rec)}</span></div>
          <Credit compact />
          <button className="label hover:text-ink" onClick={onExit}>← leave session (progress is saved)</button>
        </div>
      </aside>
    </>
  )
}

function comboOf(app: ReturnType<typeof useApp>, rec: SessionRecord) {
  const evs = app.progress.events.filter((e) => e.runId === rec.runId)
  const last = evs.at(-1)
  return last ? app.progress.perEvent.get(last.attemptId)?.combo ?? 0 : 0
}

function BetweenPane({ rec, exId, onNext }: { rec: SessionRecord; exId: number; onNext: () => void }) {
  const app = useApp()
  const ex = app.loaded!.byId.get(exId)!
  // the child persisted the finished puzzle to the durable record; read it live
  const puzzle = (app.session?.runId === rec.runId ? app.session.puzzle : rec.puzzle) ?? null
  const attemptId = puzzle?.puzzleId === exId ? puzzle.attemptId : undefined
  const ev = attemptId ? app.progress.perEvent.get(attemptId) : undefined
  const result = puzzle?.puzzleId === exId ? puzzle.outcome : null
  const solverWhite = ex.fen.split(' ')[1] === 'w'
  const end = (() => { let f = ex.fen; for (const u of ex.solution_uci) { const g = new Chess(f); g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); f = g.fen() } return f })()
  useKey({ enter: onNext, n: onNext })
  const last = rec.index + 1 >= rec.queue.length
  return (
    <>
      <div className="flex min-h-0 items-center justify-center p-3 md:p-6">
        <div className="h-[min(60dvh,calc(100vw-16px))] w-full md:h-full">
          <Board fen={result?.kind === 'alternative' ? ex.fen : end} orientation={solverWhite ? 'white' : 'black'} interactive={false} showTurn={false} />
        </div>
      </div>
      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-t border-line p-4 md:border-l md:border-t-0 md:p-5">
        <RunHeader rec={rec} exId={ex.id} />
        <div>
          <div className={`text-[20px] font-semibold tracking-[.06em] ${result?.result === 'clean' ? 'text-accent' : ''}`}>&gt; {result?.result === 'clean' ? 'CLEAN SOLVE' : result?.result === 'hinted' ? 'SOLVED WITH HELP' : 'SOLVED AFTER A MISTAKE'}</div>
          {ev && <div className="mt-2 pixel text-[30px] leading-none">+{ev.xp + ev.bonus} XP{ev.combo >= 3 ? <span className="ml-3 text-accent">×{ev.combo}</span> : null}</div>}
          {ev && levelInfo(app.xp - ev.xp - ev.bonus).level < app.level.level && (
            <div className="mt-2 pixel text-[18px] text-accent" role="status">▲ LEVEL {app.level.level} · {app.level.title.toUpperCase()}</div>
          )}
          {ev?.bonus ? <div className="mt-1 text-[12px] text-good">[ok] daily goal reached +{ev.bonus}</div> : null}
          {result?.result !== 'clean' && <div className="mt-2 text-[12px] text-muted">It will come back in Review tomorrow.</div>}
          {result?.kind === 'alternative' && <div className="mt-2 text-[12px] text-good">[ok] {result.text}</div>}
        </div>
        <div className="border-t border-dashed border-line-strong pt-3">
          <div className="label mb-1">Book line</div>
          <div className="text-[13px]">{formatLine(ex.solution, solverWhite)}</div>
          <div className="mt-2 font-sans text-[13px] leading-relaxed text-ink/85">{ex.solution_text}</div>
        </div>
        <button className="btn btn-primary justify-center py-3" onClick={onNext} autoFocus>{last ? 'Finish session' : 'Next puzzle'} <kbd className="text-[10px] opacity-60">↵</kbd></button>
        <div className="mt-auto border-t border-dashed border-line-strong pt-3"><Credit compact /></div>
      </aside>
    </>
  )
}

function RunComplete({ rec }: { rec: SessionRecord }) {
  const app = useApp()
  const nav = useNavigate()
  const evs = app.progress.events.filter((e) => e.runId === rec.runId)
  const clean = evs.filter((e) => e.result === 'clean').length
  const xp = evs.reduce((s, e) => { const p = app.progress.perEvent.get(e.attemptId); return s + (p ? p.xp + p.bonus : 0) }, 0)
  const chapters = app.loaded!.book.chapters.filter((c) => app.byChapter.has(c.chapter))
  const idx = chapters.findIndex((c) => c.chapter === rec.chapter)
  const next = idx >= 0 ? chapters[idx + 1] : undefined
  const starsHere = rec.chapter ? app.chapterStars.get(rec.chapter) ?? 0 : 0
  const nextOpen = !!next && (app.profile.freePlay || starsHere >= 1)
  const left = rec.chapter ? (app.byChapter.get(rec.chapter) ?? []).filter((e) => !app.progress.puzzles.get(e.id)?.solved) : []

  async function continueChapter() {
    const exs = app.byChapter.get(rec.chapter!) ?? []
    const queue = exs.map((e) => e.id)
    await startRun({ kind: 'chapter', queue, chapter: rec.chapter, contentVersion: app.loaded!.contentVersion, startIndex: queue.indexOf(left[0].id) })
    nav({ to: '/session' })
  }
  async function reviewNow() {
    await startRun({ kind: 'review', queue: app.due.map((e) => e.id), chapter: null, contentVersion: app.loaded!.contentVersion })
    nav({ to: '/session' })
  }
  return (
    <div className="mx-auto mt-16 w-full max-w-lg panel p-6">
      <div className="label">{rec.runKind === 'review' ? 'Review complete' : 'Session complete'}</div>
      <div className="mt-3 grid grid-cols-3 gap-4 text-center">
        <div><div className="pixel text-[30px]">{evs.length}</div><div className="label">puzzles</div></div>
        <div><div className="pixel text-[30px] text-accent">{clean}</div><div className="label">clean</div></div>
        <div><div className="pixel text-[30px]">+{xp}</div><div className="label">xp</div></div>
      </div>
      {rec.chapter && (
        <div className="mt-5 border-t border-dashed border-line-strong pt-4 text-[12px]">
          {nextOpen
            ? <>Next up: <b>{String(next!.chapter).padStart(2, '0')} · {next!.name}</b></>
            : next ? <>Earn ★ in this chapter to unlock <b>{next.name}</b>: {left.length} puzzle{left.length === 1 ? '' : 's'} left.</>
            : <>That was the last chapter of the course.</>}
        </div>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {rec.chapter && nextOpen && <Link to="/learn/$chapter" params={{ chapter: String(next!.chapter) }} className="btn btn-primary">Next chapter →</Link>}
        {rec.chapter && left.length > 0 && <button className={`btn ${nextOpen ? '' : 'btn-primary'}`} onClick={continueChapter}>Continue this chapter ({left.length})</button>}
        {app.due.length > 0 && <button className="btn" onClick={reviewNow}>Fix {app.due.length} mistake{app.due.length === 1 ? '' : 's'}</button>}
        {rec.chapter ? <Link to="/learn/$chapter" params={{ chapter: String(rec.chapter) }} className="btn">Chapter page</Link> : <Link to="/review" className="btn">Review</Link>}
        <Link to="/" className="btn btn-ghost">Home</Link>
      </div>
    </div>
  )
}
