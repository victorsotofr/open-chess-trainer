/**
 * "Who was winning" over a game, from the player's side: above the line = you were better.
 * Drawn in pixels with a pawn scale; mistakes are marked; hover reads out the move; click jumps to it.
 */
import { useState } from 'react'
import { useWidth } from '../lib/useWidth'

export interface EvalPoint { cp: number } // White's point of view, centipawns (mate = ±1000)
interface Props {
  positions: (EvalPoint | null)[] // index = ply (0 = start)
  sans: string[] // sans[i] = move that led to ply i+1
  color: 'white' | 'black'
  ply: number
  issues: { i: number; kind: string }[] // 'blunder' | 'mistake'
  onJump: (ply: number) => void
}

const CAP = 500 // ±5 pawns: beyond that the game is decided anyway

export default function EvalChart({ positions, sans, color, ply, issues, onJump }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const H = 132, L = 30, R = 6, T = 8, B = 18
  const plies = Math.max(1, sans.length)
  const pw = Math.max(1, width - L - R), ph = H - T - B
  const mine = (cp: number) => (color === 'white' ? cp : -cp)
  const clip = (cp: number) => Math.max(-CAP, Math.min(CAP, cp))
  const x = (i: number) => L + (i / plies) * pw
  const y = (cp: number) => T + (1 - (clip(cp) + CAP) / (2 * CAP)) * ph
  const pts = positions.map((p, i) => (p ? [x(i), y(mine(p.cp))] as const : null)).filter((p): p is readonly [number, number] => !!p)
  const line = pts.map(([a, b]) => `${a},${b}`).join(' ')
  const zero = y(0)
  const area = pts.length ? `M${pts[0][0]},${zero} ${pts.map(([a, b]) => `L${a},${b}`).join(' ')} L${pts.at(-1)![0]},${zero} Z` : ''
  const moveNo = (i: number) => `${Math.floor((i - 1) / 2) + 1}${(i - 1) % 2 ? '…' : '.'}`
  const fmt = (cp: number) => (Math.abs(cp) >= 1000 ? (cp > 0 ? 'you have mate' : 'mate against you') : `${cp >= 0 ? '+' : '−'}${Math.abs(cp / 100).toFixed(1)}`)
  const show = hover ?? (ply > 0 ? ply : null)
  const sp = show !== null ? positions[show] : null
  // evenly spaced full-move numbers: start, then every `step` moves
  const moves = Math.ceil(plies / 2), step = Math.max(1, Math.ceil(moves / 5))
  const xTicks = [0, ...Array.from({ length: Math.floor(moves / step) }, (_, k) => Math.min(plies, (k + 1) * step * 2 - 1))]

  return (
    <div ref={ref} className="shrink-0">
      {width > 0 && (
        <svg width={width} height={H} className="block cursor-pointer select-none" role="img"
          aria-label={`Evaluation from your side over ${Math.ceil(plies / 2)} moves; above the middle line you were better`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => { const i = Math.round(((e.clientX - e.currentTarget.getBoundingClientRect().left - L) / pw) * plies); setHover(i >= 1 && i <= plies ? i : null) }}
          onClick={() => hover !== null && onJump(hover)}>
          <defs>
            <clipPath id="ev-up"><rect x={L} y={T} width={pw} height={zero - T} /></clipPath>
            <clipPath id="ev-down"><rect x={L} y={zero} width={pw} height={T + ph - zero} /></clipPath>
          </defs>
          {[CAP, CAP / 2, 0, -CAP / 2, -CAP].map((v) => (
            <g key={v}>
              <line x1={L} x2={width - R} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--line-strong)' : 'var(--line)'} strokeWidth={1} strokeDasharray={v === 0 ? undefined : '2 4'} />
              <text x={L - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize="10" fill="var(--faint)">{v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v / 100)}`}</text>
            </g>
          ))}
          <path d={area} fill="var(--good)" opacity={0.18} clipPath="url(#ev-up)" />
          <path d={area} fill="var(--bad)" opacity={0.18} clipPath="url(#ev-down)" />
          <polyline fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" points={line} />
          {xTicks.map((i) => <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--faint)">{i === 0 ? 'start' : Math.ceil(i / 2)}</text>)}
          {show !== null && <line x1={x(show)} x2={x(show)} y1={T} y2={T + ph} stroke="var(--ink)" strokeWidth={1} opacity={0.5} />}
          {issues.map((s) => { const p = positions[s.i + 1]; return p ? <circle key={s.i} cx={x(s.i + 1)} cy={y(mine(p.cp))} r={4.5} fill={s.kind === 'blunder' ? 'var(--bad)' : 'var(--info)'} stroke="var(--surface)" strokeWidth={2} /> : null })}
        </svg>
      )}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted" aria-live="polite">
        <span>{show !== null && sans[show - 1] ? <>move {moveNo(show)} <span className="text-ink">{sans[show - 1]}</span> · {sp ? <span className={mine(sp.cp) >= 0 ? 'text-good' : 'text-bad'}>{fmt(mine(sp.cp))}</span> : 'analysing…'}</> : 'hover the curve · click to jump'}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-bad" />blunder</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-info" />mistake</span>
        </span>
      </div>
      <p className="mt-1 text-[11px] text-faint">Above the line you were better, below Stockfish was. Units are pawns (+1 ≈ a pawn up).</p>
    </div>
  )
}
