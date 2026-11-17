import { useState } from 'react'
import { useWidth } from '../lib/useWidth'
import { useApp } from '../app/data'
import { PAGE, PageHeader, SectionLabel } from '../components/common'
import { addDays } from '@shared/progress'
import { exportProgress, importProgress, updateProfile } from '../core/store'
import { weekStats } from '../lib/gamify'
import { listGames, useLive } from '../core/store'
import { playRating, recordByLevel } from '@shared/rating'
import { LEVELS, START_FEN } from '../machines/vsComputer'
import type { GameRecord } from '@shared/game'
import { Link } from '@tanstack/react-router'

export default function Stats() {
  const app = useApp()
  const p = app.progress
  const puzzles = [...p.puzzles.values()]
  const total = app.loaded?.book.exercises.length ?? 0
  const firstTry = puzzles.length ? Math.round((100 * puzzles.filter((x) => x.firstTry).length) / puzzles.length) : null
  const [hover, setHover] = useState<string | null>(null)
  const [table, setTable] = useState(false)
  const [note, setNote] = useState('')

  // Heatmap columns are weeks; rows run Monday to Sunday.
  const weeks = 12
  const end = app.today
  const endDow = (new Date(end + 'T12:00:00Z').getUTCDay() + 6) % 7
  const start = addDays(end, -(weeks * 7 - 1) - (6 - endDow))
  const cells = Array.from({ length: weeks * 7 + (6 - endDow) + 1 }, (_, i) => addDays(start, i)).filter((d) => d <= end)
  const maxDay = Math.max(1, ...cells.map((d) => p.days.get(d) ?? 0))
  const level = (n: number) => (n === 0 ? 0 : Math.ceil((n / maxDay) * 4))

  const last30 = Array.from({ length: 30 }, (_, i) => addDays(end, i - 29))
  const xpByDay = new Map(p.xpLog.map((x) => [x.day, x.xp]))
  const maxXp = Math.max(10, ...last30.map((d) => xpByDay.get(d) ?? 0))

  const chapters = (app.loaded?.book.chapters ?? []).filter((c) => app.byChapter.has(c.chapter)).map((c) => {
    const ids = app.byChapter.get(c.chapter)!.map((e) => e.id)
    const tried = ids.map((id) => p.puzzles.get(id)).filter(Boolean)
    return { c, total: ids.length, solved: tried.length, first: tried.length ? tried.filter((x) => x!.firstTry).length / tried.length : null }
  })

  async function doExport() {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([await exportProgress()], { type: 'application/json' }))
    a.download = `chess-progress-${app.today}.json`
    a.click()
  }

  return (
    <div className={PAGE}>
      <PageHeader title="STATS" sub="Your progress through the course, your games and your rating." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Solved', `${puzzles.length}`, `of ${total}`],
          ['First try', firstTry === null ? '—' : `${firstTry}%`, 'accuracy'],
          ['Streak', `${app.streak}`, `best combo ×${p.bestCombo}`],
          ['XP', `${app.xp}`, `${app.level.title} · LV${app.level.level}`],
        ].map(([k, v, s]) => (
          <div key={k} className="panel p-4"><div className="label">{k}</div><div className="pixel mt-2 text-[34px] leading-none">{v}</div><div className="mt-1 text-[11px] text-muted">{s}</div></div>
        ))}
      </div>

      <WeekCard />
      <RatingCard />

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <SectionLabel n="03">Activity · 12 weeks</SectionLabel>
          <div className="panel p-4">
            <div className="grid grid-flow-col grid-rows-7 gap-[3px]" style={{ width: 'max-content' }} onMouseLeave={() => setHover(null)}>
              {cells.map((d) => {
                const n = p.days.get(d) ?? 0
                return <span key={d} onMouseEnter={() => setHover(`${d} · ${n} puzzle${n === 1 ? '' : 's'}`)} title={`${d}: ${n}`}
                  className="h-3 w-3 border border-line" style={{ background: n ? `color-mix(in srgb, var(--accent) ${[0, 25, 50, 75, 100][level(n)]}%, transparent)` : 'transparent' }} />
              })}
            </div>
            <div className="mt-3 flex items-center justify-between text-[11px] text-muted"><span>{hover ?? 'hover a day'}</span>
              <span className="flex items-center gap-1">less {[0, 25, 50, 75, 100].map((o) => <span key={o} className="h-2.5 w-2.5 border border-line" style={{ background: `color-mix(in srgb, var(--accent) ${o}%, transparent)` }} />)} more</span></div>
          </div>
        </section>
        <section>
          <SectionLabel n="04">XP per day · 30 days</SectionLabel>
          <div className="panel p-4">
            <svg viewBox="0 0 300 100" className="h-[120px] w-full" role="img" aria-label="XP earned per day over the last 30 days" onMouseLeave={() => setHover(null)}>
              <line x1="0" y1="99" x2="300" y2="99" stroke="var(--line)" />
              {last30.map((d, i) => {
                const v = xpByDay.get(d) ?? 0
                const h = (v / maxXp) * 92
                return (
                  <g key={d} onMouseEnter={() => setHover(`${d} · ${v} XP`)}>
                    <rect x={i * 10} y={0} width={10} height={100} fill="transparent" />
                    <rect x={i * 10 + 2} y={99 - h} width={6} height={h} rx={1} fill={d === end ? 'var(--accent)' : 'var(--ink)'} opacity={d === end ? 1 : 0.55} />
                  </g>
                )
              })}
            </svg>
            <div className="mt-1 flex justify-between text-[11px] text-muted"><span>{hover ?? `max ${maxXp} XP / day`}</span><span>today highlighted</span></div>
          </div>
        </section>
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between"><SectionLabel n="05">Chapters · first-try accuracy</SectionLabel>
          <button className="label mb-3 ml-3 hover:text-ink" onClick={() => setTable(!table)}>{table ? 'chart' : 'table'}</button></div>
        {table ? (
          <table className="w-full text-[12px]"><thead><tr className="label text-left"><th className="py-1">Chapter</th><th>Solved</th><th>First try</th></tr></thead>
            <tbody>{chapters.map(({ c, total: t, solved, first }) => <tr key={c.chapter} className="border-t border-line"><td className="py-1">{c.chapter}. {c.name}</td><td>{solved}/{t}</td><td>{first === null ? '—' : `${Math.round(first * 100)}%`}</td></tr>)}</tbody></table>
        ) : (
          <div className="space-y-1.5">
            {chapters.map(({ c, total: t, solved, first }) => (
              <div key={c.chapter} className="grid grid-cols-[minmax(120px,240px)_1fr_80px] items-center gap-3 text-[12px]">
                <span className="truncate"><span className="text-faint">{String(c.chapter).padStart(2, '0')}</span> {c.name}</span>
                <div className="relative h-3 bg-line/60">
                  <div className="absolute inset-y-0 left-0 bg-ink/25" style={{ width: `${(solved / t) * 100}%` }} title={`${solved}/${t} solved`} />
                  {first !== null && <div className="absolute inset-y-[3px] left-0 bg-accent" style={{ width: `${(solved / t) * first * 100}%` }} title={`${Math.round(first * 100)}% first try`} />}
                </div>
                <span className="text-right text-muted">{first === null ? '—' : `${Math.round(first * 100)}%`}</span>
              </div>
            ))}
            <div className="pt-1 text-[11px] text-faint">grey = solved share · blue = solved on first try</div>
          </div>
        )}
      </section>

      <section className="mt-8">
        <SectionLabel n="06">Achievements · {app.achievements.filter((a) => a.earned).length}/{app.achievements.length}</SectionLabel>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {app.achievements.map((a) => (
            <div key={a.id} className={`border p-3 ${a.earned ? 'border-accent' : 'border-line opacity-50'}`}>
              <div className="flex items-center gap-2"><span className="pixel text-[16px]">{a.earned ? '◆' : '◇'}</span><span className="text-[12px] font-semibold">{a.name}</span></div>
              <div className="mt-1 text-[11px] text-muted">{a.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 mb-6">
        <SectionLabel n="07">Settings</SectionLabel>
        <div className="panel grid gap-4 p-4 text-[12px] md:grid-cols-2">
          <label className="flex items-center gap-2">Daily goal
            <input type="number" min={1} max={50} className="w-16 border border-line-strong bg-bg px-2 py-1" value={app.profile.dailyGoal}
              onChange={(e) => updateProfile({ dailyGoal: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} /> puzzles
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={app.profile.freePlay} onChange={(e) => updateProfile({ freePlay: e.target.checked })} /> Free play (open every chapter)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={app.profile.sound} onChange={(e) => updateProfile({ sound: e.target.checked })} /> Sounds (moves, correct, mistakes)</label>
          <label className="flex items-center gap-2">Timezone
            <input className="w-56 border border-line-strong bg-bg px-2 py-1" defaultValue={app.profile.timeZone}
              onBlur={(e) => { try { new Intl.DateTimeFormat('en', { timeZone: e.target.value }); updateProfile({ timeZone: e.target.value }) } catch { setNote('Unknown timezone') } }} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={doExport}>Export progress</button>
            <label className="btn cursor-pointer">Import<input type="file" accept="application/json" className="hidden"
              onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { await importProgress(await f.text()); setNote('Progress imported (merged).') } catch (err) { setNote(String(err)) } }} /></label>
          </div>
          {note && <div className="text-info md:col-span-2">[i] {note}</div>}
        </div>
      </section>
    </div>
  )
}

function WeekCard() {
  const app = useApp()
  const tz = app.profile.timeZone
  const now = weekStats(app.progress, app.today, 0, tz)
  const prev = weekStats(app.progress, app.today, 1, tz)
  const pct = (w: { clean: number; puzzles: number }) => (w.puzzles ? Math.round((100 * w.clean) / w.puzzles) : null)
  const rows: [string, number | null, number | null, string][] = [
    ['Puzzles', now.puzzles, prev.puzzles, ''], ['First-try / clean', pct(now), pct(prev), '%'], ['XP', now.xp, prev.xp, ''], ['Active days', now.activeDays, prev.activeDays, '/7'],
  ]
  return (
    <section className="mt-8">
      <SectionLabel n="01">This week · from {now.start}</SectionLabel>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {rows.map(([k, a, b, unit]) => {
          const delta = a !== null && b !== null ? a - b : null
          return (
            <div key={k} className="panel p-4">
              <div className="label">{k}</div>
              <div className="pixel mt-2 text-[28px] leading-none">{a === null ? '—' : `${a}${unit}`}</div>
              <div className={`mt-1 text-[11px] ${delta === null || delta === 0 ? 'text-muted' : delta > 0 ? 'text-good' : 'text-bad'}`}>
                {delta === null ? 'no data last week' : delta === 0 ? '= last week' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}${unit === '%' ? ' pts' : ''} vs last week`}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function RatingCard() {
  const games = useLive(() => listGames(), [], [] as GameRecord[])
  const elo = (n: number) => LEVELS.find((l) => l.n === n)?.mid ?? 950
  const r = playRating(games, elo, START_FEN)
  const rec = recordByLevel(games, START_FEN)
  const hist = r.history
  return (
    <section className="mt-8">
      <SectionLabel n="02">Estimated rating · games vs computer</SectionLabel>
      <div className="grid gap-3 md:grid-cols-[220px_1fr]">
        <div className="panel p-4">
          <div className="label">Rating (est.)</div>
          <div className="pixel mt-2 text-[40px] leading-none">{r.games ? r.rating : '—'}{r.provisional && r.games ? <span className="text-[18px] text-muted">?</span> : null}</div>
          <div className="mt-1 text-[11px] text-muted">{r.games} rated game{r.games === 1 ? '' : 's'}{r.provisional ? ' · provisional (<10)' : ''}</div>
          <div className="mt-3 space-y-0.5 text-[11px] text-muted">
            {[...rec.entries()].sort(([a], [b]) => a - b).map(([lv, x]) => <div key={lv}>L{lv} {LEVELS[lv - 1].label}: {x.w}W {x.d}D {x.l}L</div>)}
          </div>
          {!r.games && <Link to="/play" className="btn mt-3">Play a game</Link>}
        </div>
        <div className="panel p-4">
          {hist.length === 0 ? <p className="text-[12px] text-muted">Your rating chart starts after your first finished game.</p> : (
            <RatingChart hist={hist} />
          )}
          <p className="mt-2 text-[11px] text-faint">Standard Elo against each level's approximate strength (start 800, K = 40 for your first 20 games). An estimate: the computer's levels are calibrated against engines, not people. Book puzzles are tracked separately as accuracy, not Elo.</p>
        </div>
      </div>
    </section>
  )
}

type RatingPoint = ReturnType<typeof playRating>['history'][number]


function RatingChart({ hist }: { hist: RatingPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hi, setHi] = useState<number | null>(null)
  const H = 170, L = 40, R = 10, T = 10, B = 22
  const vals = [800, ...hist.map((h) => h.rating)]
  const step = (Math.max(...vals) - Math.min(...vals)) > 250 ? 100 : 50
  const lo = Math.floor((Math.min(...vals) - 10) / step) * step, top = Math.ceil((Math.max(...vals) + 10) / step) * step
  const ticks = Array.from({ length: (top - lo) / step + 1 }, (_, i) => lo + i * step)
  const pw = Math.max(1, width - L - R), ph = H - T - B
  const x = (i: number) => L + (vals.length === 1 ? pw / 2 : (i / (vals.length - 1)) * pw)
  const y = (v: number) => T + (1 - (v - lo) / (top - lo)) * ph
  const color = (s: number) => (s === 1 ? 'var(--good)' : s === 0 ? 'var(--bad)' : 'var(--muted)')
  const xTicks = vals.length <= 12 ? vals.map((_, i) => i) : Array.from({ length: 6 }, (_, k) => Math.round((k / 5) * (vals.length - 1)))
  const h = hi !== null ? hist[hi - 1] : null
  const fmtDelta = (d: number) => (d >= 0 ? `+${d}` : `${d}`)
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={`Estimated rating after each of ${hist.length} games, from 800 to ${vals.at(-1)}`}
          onMouseLeave={() => setHi(null)}
          onMouseMove={(e) => {
            const px = e.clientX - e.currentTarget.getBoundingClientRect().left
            const i = Math.round(((px - L) / pw) * (vals.length - 1))
            setHi(i >= 1 && i < vals.length ? i : null)
          }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={width - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} strokeDasharray={t === 800 ? '4 4' : undefined} />
              <text x={L - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="10" fill="var(--faint)">{t}</text>
            </g>
          ))}
          {xTicks.map((i) => <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--faint)">{i === 0 ? 'start' : i}</text>)}
          {hi !== null && <line x1={x(hi)} x2={x(hi)} y1={T} y2={T + ph} stroke="var(--line-strong)" strokeWidth={1} />}
          <polyline fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" points={vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
          {hist.map((g, k) => (
            <circle key={g.gameId} cx={x(k + 1)} cy={y(g.rating)} r={hi === k + 1 ? 5.5 : 4} fill={color(g.score)} stroke="var(--surface)" strokeWidth={2} />
          ))}
        </svg>
      )}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span aria-live="polite">{h ? `game ${hi} · ${new Date(h.at).toLocaleDateString()} · ${h.score === 1 ? 'win' : h.score === 0 ? 'loss' : 'draw'} vs ~${h.opp} · ${fmtDelta(h.delta)} → ${h.rating}` : 'hover a game · x = games played'}</span>
        <span className="flex items-center gap-3">
          {([['win', 1], ['loss', 0], ['draw', 0.5]] as const).map(([l, s]) => <span key={l} className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: color(s) }} />{l}</span>)}
          <span className="flex items-center gap-1"><span className="inline-block w-3 border-t border-dashed border-line-strong" />start 800</span>
        </span>
      </div>
    </div>
  )
}
