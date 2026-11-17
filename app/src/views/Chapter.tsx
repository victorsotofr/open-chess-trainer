import type { PuzzleId } from '@shared/progress'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useApp } from '../app/data'
import { BookGate, Credit, SectionLabel, Stars } from '../components/common'
import { startRun } from '../core/store'
import { completion, stars, MEDALS } from '../lib/gamify'
import { ExampleStepper, LessonText } from '../components/Lesson'

const STEP: Record<string, string> = { 'Guided practice': '3', 'On your own': '4', 'Recognize it': '5' }
const STEP_NOTE: Record<string, string> = { 'Recognize it': 'mixed, no theme announced', Boss: 'the finale' }

export default function Chapter() { return <BookGate><ChapterView /></BookGate> }

function ChapterView() {
  const app = useApp()
  const nav = useNavigate()
  const { chapter } = useParams({ from: '/learn/$chapter' })
  const n = Number(chapter)
  const ch = app.loaded!.book.chapters.find((c) => c.chapter === n)
  const exs = app.byChapter.get(n) ?? []
  if (!ch) return <div className="p-8">Chapter not found. <Link to="/learn" className="underline">Back</Link></div>

  async function play(startId?: PuzzleId) {
    const queue = exs.map((e) => e.id)
    const first = startId ?? exs.find((e) => !app.progress.puzzles.get(e.id)?.solved)?.id ?? queue[0]
    await startRun({ kind: 'chapter', queue, chapter: n, contentVersion: app.loaded!.contentVersion, startIndex: queue.indexOf(first) })
    nav({ to: '/session' })
  }
  const started = exs.some((e) => app.progress.puzzles.get(e.id))
  // tolerate older bundles whose examples carry no moves
  const examples = (ch.examples ?? []).filter((x) => Array.isArray(x.solution_uci) && x.fen && !x.inline) // inline ones live in the lesson text
  const sections = [...new Set(exs.map((e) => e.section))] // book order (exercise ids ascend through the chapter)

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-6 lg:grid-cols-[1fr_380px]">
      <article>
        <Link to="/learn" className="label hover:text-ink">← course</Link>
        <div className="mt-3 flex flex-wrap items-baseline gap-4">
          <span className="pixel text-[40px] leading-none text-faint">{String(n).padStart(2, '0')}</span>
          <h1 className="text-[24px] font-semibold">{ch.name}</h1>
          <Stars n={app.chapterStars.get(n) ?? 0} size={18} />
        </div>
        <div className="mt-2"><Credit /></div>
        <div className="mt-6"><SectionLabel n="01">Lesson</SectionLabel></div>
        <LessonText ch={ch} />
        {examples.length > 0 && (
          <div className="mt-6">
            <SectionLabel n="02">Worked examples</SectionLabel>
            <div className="space-y-3">{examples.map((x) => <ExampleStepper key={x.id} ex={x} />)}</div>
          </div>
        )}
      </article>

      <aside className="lg:sticky lg:top-[calc(var(--topbar)+24px)] lg:self-start">
        <button className="btn btn-primary w-full justify-center py-3" onClick={() => play()}>{started ? 'Continue' : 'Start'} chapter</button>
        {(() => {
          const c = completion(exs, app.progress, ch.completeAfter ?? 12)
          return (
            <div className="mt-4 border border-line p-3" aria-label={`Chapter completion: ${c.fresh} of ${c.need} fresh solves`}>
              <div className="flex items-baseline justify-between text-[12px]">
                <span>{c.done ? '[ok] chapter complete' : 'To complete the chapter'}</span>
                <span className="pixel text-[14px]">{Math.min(c.fresh, c.need)}/{c.need}</span>
              </div>
              <div className="mt-2 h-[3px] bg-line"><div className="h-full bg-accent" style={{ width: `${Math.min(100, (c.fresh / c.need) * 100)}%` }} /></div>
              <p className="mt-2 text-[11px] text-faint">Fresh, unassisted solves in "On your own" and "Recognize it": first try, no hint. Repeating a puzzle doesn't count.</p>
            </div>
          )
        })()}
        <div className="mt-6"><SectionLabel n="03">Your path</SectionLabel></div>
        <ol className="mb-4 space-y-1 text-[12px] text-muted">
          <li><span className="text-faint">1 ·</span> Understand: read the lesson</li>
          <li><span className="text-faint">2 ·</span> See: step through the examples</li>
        </ol>
        <div className="space-y-5">
          {sections.map((sec) => {
            const list = exs.filter((e) => e.section === sec)
            const medal = MEDALS[stars(list.map((e) => e.id), app.progress)]
            const step = STEP[sec]
            return (
              <div key={sec}>
                <div className="mb-2 flex items-center justify-between text-[12px]"><span>{step ? <span className="text-faint">{step} · </span> : null}{sec}{STEP_NOTE[sec] ? <span className="text-faint"> — {STEP_NOTE[sec]}</span> : null}</span><span className={`label ${medal === 'gold' ? 'text-accent' : ''}`}>{medal !== 'none' ? medal : ''}</span></div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {list.map((e, i) => {
                    const p = app.progress.puzzles.get(e.id)
                    const boss = !!e.boss
                    const cls = !p ? 'border-line-strong text-muted' : p.firstTry ? 'border-accent bg-accent text-accent-ink' : 'border-ink/60 bg-ink/15'
                    return (
                      <button key={e.id} onClick={() => play(e.id)} title={`${sec}${e.rating ? ` · rated ${e.rating}` : ''}`}
                        className={`flex h-9 items-center justify-center border text-[11px] ${boss ? 'w-12 border-2' : 'w-9'} ${cls}`}>
                        {boss ? '♛' : e.mode === 'guided' ? 'G' : i + 1}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-5 text-[12px]"><span className="text-faint">6 · </span>Revisit: missed puzzles come back in <Link to="/review" className="underline decoration-dashed underline-offset-4">Review</Link>{app.due.length ? ` (${app.due.length} due)` : ''}</div>
        <p className="mt-4 text-[11px] text-faint">G = guided (hint available) · blue = first try · grey = solved later · ♛ = boss</p>
      </aside>
    </div>
  )
}
