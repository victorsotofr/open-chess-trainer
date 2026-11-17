import { Link } from '@tanstack/react-router'
import { useApp } from '../app/data'
import { BookGate, Credit, PAGE, PageHeader, SectionLabel, Squares, Stars } from '../components/common'
import { isUnlocked } from '../lib/gamify'

export default function Learn() {
  return <BookGate><LearnMap /></BookGate>
}

function LearnMap() {
  const app = useApp()
  const chapters = app.loaded!.book.chapters.filter((c) => app.byChapter.has(c.chapter))
  const starList = chapters.map((c) => app.chapterStars.get(c.chapter) ?? 0)
  const parts = [...new Set(chapters.map((c) => c.part))]
  return (
    <div className={PAGE}>
      <PageHeader title="LEARN" sub={<Credit />} right={app.profile.freePlay && <span className="label border border-line-strong px-2 py-1">free play on</span>} />
      {parts.map((part, pi) => (
        <section key={part} className="mb-8">
          <SectionLabel n={String(pi + 1).padStart(2, '0')}>{part}</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {chapters.filter((c) => c.part === part).map((c) => {
              const i = chapters.indexOf(c)
              const open = isUnlocked(i, starList, app.profile.freePlay)
              const exs = app.byChapter.get(c.chapter)!
              const items = exs.map((e) => { const p = app.progress.puzzles.get(e.id); return !p ? 'empty' as const : p.firstTry ? 'clean' as const : 'done' as const })
              const solved = items.filter((x) => x !== 'empty').length
              const body = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <span className="pixel text-[28px] leading-none text-faint">{String(c.chapter).padStart(2, '0')}</span>
                    {open ? <Stars n={starList[i]} /> : <span className="label">locked</span>}
                  </div>
                  <div className="mt-3 text-[14px] font-semibold">{c.name}</div>
                  <div className="mt-1 text-[11px] text-muted">{solved}/{exs.length} solved</div>
                  <div className="mt-3"><Squares items={items} size={7} /></div>
                </>
              )
              return open
                ? <Link key={c.chapter} to="/learn/$chapter" params={{ chapter: String(c.chapter) }} className="panel block p-4 hover:border-ink">{body}</Link>
                : <div key={c.chapter} className="panel block p-4 opacity-45" title="Earn ★ in the previous chapter to unlock">{body}</div>
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
