import { useMemo, useState } from 'react'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import Board from './Board'
import { applyUci } from '../core/restore'
import { formatLine } from '../lib/puzzle'
import type { Chapter, Figure, WorkedExample } from '../lib/types'

export function LessonText({ ch }: { ch: Chapter }) {
  type Block = { kind: 'p'; p: Chapter['paragraphs'][number] } | { kind: 'fig'; f: Figure }
  const byFile = new Map((ch.figures ?? []).map((f) => [f.file, f]))
  const blocks: Block[] = []
  if (ch.paragraphs.some((p) => p.type === 'Figure' && p.file)) {
    // book order: each diagram sits exactly where the book prints it
    for (const p of ch.paragraphs) {
      if (p.type !== 'Figure') blocks.push({ kind: 'p', p })
      else if (p.file && byFile.has(p.file)) blocks.push({ kind: 'fig', f: byFile.get(p.file)! })
    }
  } else {
    // older bundles: a figure goes after the last paragraph printed on or before its page
    const figs = [...(ch.figures ?? [])]
    for (const p of ch.paragraphs) {
      while (figs.length && p.page !== undefined && figs[0].page < p.page) blocks.push({ kind: 'fig', f: figs.shift()! })
      blocks.push({ kind: 'p', p })
    }
    figs.forEach((f) => blocks.push({ kind: 'fig', f }))
  }
  const examples = new Map((ch.examples ?? []).map((x) => [x.id, x]))
  return (
    <div className="font-sans text-[15px] leading-relaxed text-ink/90">
      {blocks.map((b, i) => {
        if (b.kind === 'p') return b.p.type === 'Section Header'
          ? <h3 key={i} className="mt-5 mb-1 font-mono text-[12px] uppercase tracking-[.12em] text-muted">{b.p.text}</h3>
          : b.p.type === 'List Item'
            ? <p key={i} className="mb-1.5 pl-5 -indent-4">{b.p.text}</p>
            : <p key={i} className="mb-3">{b.p.text}</p>
        const f = b.f
        const ex = f.kind === 'example' && f.example ? examples.get(f.example) : undefined
        if (ex) return <figure key={i} className="my-5 font-mono"><ExampleStepper ex={ex} figure={f} /></figure>
        if (f.kind === 'static' && f.boards?.length) return <StaticDiagram key={i} f={f} />
        if (f.source === 'reconstructed' && f.steps?.length) return <FigureStepper key={i} f={f} />
        return (
          <figure key={i} className="my-5">
            <img src={`/data/figures/${f.file}`} alt="Diagram" loading="lazy"
              className="max-w-full border border-line bg-white" style={{ width: Math.min(f.width, 640) }} />
            <figcaption className="mt-1 font-mono text-[11px] text-faint">diagram</figcaption>
          </figure>
        )
      })}
    </div>
  )
}

/** The book's original picture, on demand (every rebuilt diagram can be compared with it). */
function OriginalToggle({ f, open, onToggle }: { f: Figure; open: boolean; onToggle: () => void }) {
  return (
    <>
      {open && <img src={`/data/figures/${f.file}`} alt="Original diagram" loading="lazy"
        className="mt-3 max-w-full border border-line bg-white" style={{ width: Math.min(f.width, 560) }} />}
      <button className="text-[11px] text-faint underline decoration-dashed underline-offset-4 hover:text-ink" onClick={onToggle}>
        {open ? 'hide original diagram' : 'show original diagram'}
      </button>
    </>
  )
}

/** A diagram with no worked example in the book: its boards in the app's style, not animated. */
function StaticDiagram({ f }: { f: Figure }) {
  const [original, setOriginal] = useState(false)
  const boards = f.boards!
  return (
    <figure className="my-5 panel p-3 font-mono">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-4">
        {boards.map((b, k) => (
          <div key={k} className="flex items-center gap-3">
            {k > 0 && <span className="text-[20px] text-faint" aria-hidden>→</span>}
            <Board fen={`${b.fen} w - - 0 1`} orientation="white" interactive={false} size={boards.length > 2 ? 200 : 232} showTurn={false}
              shapes={b.arrows.map((a) => ({ orig: a.slice(0, 2) as Key, dest: a.slice(2, 4) as Key, brush: 'hint' }))} />
          </div>
        ))}
      </div>
      <figcaption className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-faint">
        <span>diagram · p. {f.page}{boards.length > 1 ? ` · ${boards.length} positions, left to right` : ''}</span>
        <OriginalToggle f={f} open={original} onToggle={() => setOriginal(!original)} />
      </figcaption>
    </figure>
  )
}

export function ExampleStepper({ ex, figure }: { ex: WorkedExample; figure?: Figure }) {
  const [step, setStep] = useState(0)
  const [original, setOriginal] = useState(false)
  const positions = useMemo(() => {
    const out: { fen: string; last?: [string, string] }[] = [{ fen: ex.fen }]
    for (const u of ex.solution_uci) { const m = applyUci(out.at(-1)!.fen, u); out.push({ fen: m.fen, last: [m.from, m.to] }) }
    return out
  }, [ex])
  const next = ex.solution_uci[step]
  const shapes = useMemo<DrawShape[]>(() => (next ? [{ orig: next.slice(0, 2) as Key, dest: next.slice(2, 4) as Key, brush: 'hint' }] : []), [next])
  const white = ex.fen.split(' ')[1] === 'w'
  return (
    <div className="panel flex flex-col gap-3 p-3 sm:flex-row">
      <Board fen={positions[step].fen} orientation="white" interactive={false} lastMove={positions[step].last} shapes={shapes} size={232} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-[12px]">
        <div className="label">{figure ? (figure.page ? `diagram · p. ${figure.page} · step through it` : 'worked example · step through it') : `${ex.section} · worked example${ex.page ? ` · p. ${ex.page}` : ''}`}</div>
        <div className="text-[13px]">
          {formatLine(ex.solution, white).split(' ').map((tok, i) => (
            <span key={i} className={i < step ? 'text-muted' : i === step ? 'bg-accent px-1 text-accent-ink' : ''}>{tok} </span>
          ))}
        </div>
        <div className="mt-auto flex gap-2">
          <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)} aria-label="Previous move">←</button>
          <button className="btn btn-primary" disabled={step >= ex.solution_uci.length} onClick={() => setStep(step + 1)}>{step === 0 ? 'Watch the idea' : step >= ex.solution_uci.length ? 'Done' : 'Next move'} →</button>
          {step > 0 && <button className="btn btn-ghost" onClick={() => setStep(0)}>Reset</button>}
        </div>
        {ex.answer_text && step >= ex.solution_uci.length && <p className="font-sans text-[13px] leading-relaxed text-ink/90">{ex.answer_text}</p>}
        {figure && figure.width > 0 && <div><OriginalToggle f={figure} open={original} onToggle={() => setOriginal(!original)} /></div>}
      </div>
    </div>
  )
}

/** A lesson figure rebuilt as playable steps (verified moves from the author's text). */
function FigureStepper({ f }: { f: Figure }) {
  const steps = f.steps!
  const [i, setI] = useState(0)
  const [original, setOriginal] = useState(false)
  const next = steps[i + 1]
  const shapes = useMemo<DrawShape[]>(() => (next?.uci ? [{ orig: next.uci.slice(0, 2) as Key, dest: next.uci.slice(2, 4) as Key, brush: 'hint' }] : []), [next])
  const last = steps[i].uci
  return (
    <figure className="my-5 panel p-3 font-mono">
      {original
        ? <img src={`/data/figures/${f.file}`} alt="Original diagram" className="max-w-full border border-line bg-white" style={{ width: Math.min(f.width, 560) }} />
        : (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Board fen={steps[i].fen} orientation="white" interactive={false} size={232} shapes={shapes}
              lastMove={last ? [last.slice(0, 2), last.slice(2, 4)] : undefined} />
            <div className="flex flex-1 flex-col gap-2 text-[12px]">
              <div className="label">diagram · p. {f.page} · interactive</div>
              <div className="text-[13px]">{steps.slice(1).map((s, k) => <span key={k} className={k + 1 === i ? 'bg-accent px-1 text-accent-ink' : k + 1 < i ? 'text-muted' : ''}>{s.san} </span>)}</div>
              <div className="mt-auto flex gap-2">
                <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)} aria-label="Previous">←</button>
                <button className="btn btn-primary" disabled={!next} onClick={() => setI(i + 1)}>{next ? `Play ${next.san}` : 'Done'} →</button>
              </div>
            </div>
          </div>
        )}
      <figcaption className="mt-2 flex justify-between text-[11px] text-faint">
        <span>diagram · checked move by move</span>
        <button className="underline decoration-dashed hover:text-ink" onClick={() => setOriginal(!original)}>{original ? 'interactive' : 'original'}</button>
      </figcaption>
    </figure>
  )
}
