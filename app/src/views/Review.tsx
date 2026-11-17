import type { PuzzleId } from '@shared/progress'
import { useNavigate } from '@tanstack/react-router'
import { useApp } from '../app/data'
import { BookGate, PAGE, PageHeader, SectionLabel } from '../components/common'
import Board from '../components/Board'
import { startRun } from '../core/store'
import { INTERVALS, addDays } from '@shared/progress'

export default function Review() { return <BookGate><ReviewView /></BookGate> }

function ReviewView() {
  const app = useApp()
  const nav = useNavigate()
  const inReview = [...app.progress.puzzles.values()].filter((p) => p.box > 0).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))
  const upcoming = inReview.filter((p) => p.due && p.due > app.today)
  const nextDays = Array.from({ length: 7 }, (_, i) => addDays(app.today, i + 1)).map((d) => ({ d, n: upcoming.filter((p) => p.due === d).length }))
  const maxDue = Math.max(1, ...nextDays.map((x) => x.n))

  async function start() {
    await startRun({ kind: 'review', queue: app.due.map((e) => e.id), chapter: null, contentVersion: app.loaded!.contentVersion })
    nav({ to: '/session' })
  }

  async function practise(id: PuzzleId, due: boolean) {
    await startRun({ kind: due ? 'review' : 'single', queue: [id], chapter: null, contentVersion: app.loaded!.contentVersion })
    nav({ to: '/session' })
  }

  return (
    <div className={PAGE}>
      <PageHeader title="REVIEW" sub="Puzzles you missed come back on a spaced schedule until they stick." />
      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <div className="panel flex flex-col justify-between p-6">
          <div className="label">Fix my mistakes</div>
          <div className="my-4">
            <span className="pixel text-[64px] leading-none">{app.due.length}</span>
            <span className="ml-3 text-muted">{app.due.length === 1 ? 'puzzle' : 'puzzles'} to fix today</span>
          </div>
          <p className="text-[12px] text-muted">Puzzles you missed or needed help with come back after 1, 3, 7, 16 and 35 days. Solve one cleanly to move it up a step; clear the fifth step to master it.</p>
          <button className="btn btn-primary mt-5 justify-center py-3" disabled={!app.due.length} onClick={start}>{app.due.length ? `Start review (${app.due.length})` : 'Nothing due today'}</button>
        </div>
        <div className="panel p-6">
          <div className="label mb-3">Next 7 days</div>
          {/* bars scale to the busiest day, inside a fixed plot height (count label included) */}
          <div className="flex items-end gap-2" style={{ height: 120 }}>
            {nextDays.map(({ d, n }) => (
              <div key={d} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${d}: ${n} due`}>
                <span className="pixel text-[12px]">{n || ''}</span>
                <div className="w-full bg-accent" style={{ height: Math.max(2, Math.round((n / maxDue) * 80)), opacity: n ? 1 : 0.15 }} />
                <span className="text-[10px] text-faint">{new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 text-[12px] text-muted">{inReview.length} puzzles in the review ladder</div>
        </div>
      </div>

      <div className="mt-8"><SectionLabel n="02">Mastery ladder · {inReview.length}</SectionLabel></div>
      {inReview.length > 0 && <p className="-mt-1 mb-3 text-[12px] text-muted">Every book puzzle you missed or needed help with. The bar shows its step out of {INTERVALS.length}; red ones are due today. Click a puzzle to practise it now (it only climbs a step on its due date).</p>}
      {inReview.length === 0 ? <p className="text-muted">No puzzles in review. Mistakes and hinted solves land here.</p> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {inReview.map((p) => {
            const ex = app.loaded!.byId.get(p.puzzleId)
            if (!ex) return null
            const due = p.due! <= app.today
            return (
              <button key={p.puzzleId} onClick={() => practise(p.puzzleId, due)} title={due ? 'Due today: solve it to climb a step' : `Practise now · next step on ${p.due}`}
                className={`panel block w-full p-3 text-left transition-colors hover:border-ink focus-visible:border-accent ${due ? 'border-bad/60' : ''}`}>
                <Board fen={ex.fen} orientation={ex.fen.split(' ')[1] === 'w' ? 'white' : 'black'} interactive={false} size={176} />
                <div className="mt-2 flex items-start justify-between gap-2 text-[11px]"><span className="min-w-0">#{ex.id} · {ex.section}</span><span className={`shrink-0 ${due ? 'text-bad' : 'text-muted'}`}>{due ? 'due today' : `next ${new Date(p.due + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}</span></div>
                <div className="mt-2 flex gap-1" aria-label={`Step ${p.box} of ${INTERVALS.length}`}>
                  {INTERVALS.map((_, i) => <span key={i} className={`h-1.5 flex-1 ${i < p.box - 1 ? 'bg-accent' : i === p.box - 1 ? 'bg-ink' : 'bg-line'}`} />)}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
