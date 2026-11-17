import type { ReactNode } from 'react'
import { SOURCE, useApp } from '../app/data'

/** Puzzle source credit (Lichess, CC0). */
export function Credit({ compact = false }: { compact?: boolean }) {
  return (
    <p className={`text-muted ${compact ? 'text-[11px]' : 'text-[12px]'}`}>
      Puzzles from the <a className="underline decoration-dashed underline-offset-4 hover:text-ink" href={SOURCE.url} target="_blank" rel="noreferrer">{SOURCE.name}</a> ({SOURCE.license}).
    </p>
  )
}

export const PAGE = 'mx-auto w-full max-w-6xl px-4 py-6'

export function PageHeader({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="pixel text-[34px] leading-none">{title}</h1>
        {sub && <div className="mt-2 max-w-3xl text-[12px] text-muted">{sub}</div>}
      </div>
      {right}
    </header>
  )
}

export function SectionLabel({ n, children }: { n: string; children: ReactNode }) {
  return <div className="label mb-3 flex items-center gap-3"><span className="text-faint">{n} /</span><span>{children}</span><span className="h-px flex-1 border-t border-dashed border-line-strong" /></div>
}

export function Stars({ n, size = 14 }: { n: number; size?: number }) {
  return <span aria-label={`${n} of 3 stars`} style={{ fontSize: size }} className="tracking-[2px]">{[0, 1, 2].map((i) => <span key={i} className={i < n ? 'text-accent' : 'text-line-strong'}>★</span>)}</span>
}

export function BookGate({ children }: { children: ReactNode }) {
  const app = useApp()
  if (app.bookState === 'ready') return <>{children}</>
  const box = (title: string, body: ReactNode, retry = true) => (
    <div className="mx-auto mt-16 max-w-xl panel p-6">
      <div className="label mb-2">{title}</div>
      <div className="text-[13px] leading-relaxed">{body}</div>
      {retry && <button className="btn mt-4" onClick={app.retryBook}>Retry</button>}
    </div>
  )
  if (app.bookState === 'loading') return <div className="mt-16 text-center text-muted">&gt; loading puzzles…</div>
  if (app.bookState === 'notInstalled') return box('Puzzle pack not built yet', <>
    <p>The course needs a puzzle pack (<code>/data/pack.json</code>), generated from the {SOURCE.name} by the pipeline (see README).</p>
    <p className="mt-2"><b>Play vs computer</b> works without it.</p></>)
  return box('Could not load the puzzles', <p className="text-bad">{app.bookError}</p>)
}

export function Squares({ items, size = 10 }: { items: ('empty' | 'done' | 'clean' | 'due')[]; size?: number }) {
  const cls = { empty: 'border-line-strong', done: 'bg-ink/60 border-transparent', clean: 'bg-accent border-accent', due: 'border-bad' }
  return <div className="flex flex-wrap gap-[3px]">{items.map((t, i) => <span key={i} className={`border ${cls[t]}`} style={{ width: size, height: size }} />)}</div>
}
