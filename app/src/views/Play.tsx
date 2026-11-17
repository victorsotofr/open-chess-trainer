import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useActorRef, useSelector } from '@xstate/react'
import { Chess } from 'chess.js'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import Board from '../components/Board'
import { PageHeader, SectionLabel } from '../components/common'
import { useConfirm } from '../components/Confirm'
import { LEVELS, START_FEN, sideToMove, vsComputer } from '../machines/vsComputer'
import { abandonGame, activeGame, deleteGame, listGames, saveGame, useLive } from '../core/store'
import { play as playSound } from '../lib/sound'
import { material } from '../lib/material'
import { pieceImage } from '../lib/pieceImages'
import { useApp } from '../app/data'
import { TIME_CONTROLS, tcLabel, type GameRecord, type TimeControl } from '@shared/game'
import { playRating, recordByLevel } from '@shared/rating'

export const levelElo = (n: number) => LEVELS.find((l) => l.n === n)?.mid ?? 950

type StartArgs = [color: 'white' | 'black', level: number, tc: TimeControl | null]

export default function Play() {
  // the current game (if any) is loaded once; a finished game stays on screen until "New game".
  // "Menu" leaves a running game paused (kept as active) and shows setup + history with a Resume banner.
  const [restore, setRestore] = useState<GameRecord | null | undefined>(undefined)
  const [key, setKey] = useState(0)
  const [menu, setMenu] = useState(false)
  const [autostart, setAutostart] = useState<StartArgs | null>(null) // state, not a ref read during render (StrictMode renders twice)
  const ask = useConfirm()
  useEffect(() => { void activeGame().then(setRestore) }, [key])
  if (restore === undefined) return null
  const reload = (m: boolean, start: StartArgs | null = null) => { setMenu(m); setAutostart(start); setRestore(undefined); setKey((k) => k + 1) }
  if (menu && restore) return (
    <Setup active={restore} onResume={() => reload(false)} onStart={async (...args) => {
      if (!await ask({ title: 'Abandon the game in progress?', body: 'Starting a new game abandons the paused one. It stays in your history and counts as a loss.', confirm: 'Abandon and start', danger: true })) return
      await abandonGame(restore)
      reload(false, args)
    }} />
  )
  return <Game key={key} restore={restore} autostart={autostart} onNew={() => reload(false)} onMenu={() => reload(true)} />
}

const machine = vsComputer.provide({ actions: { persist: (_, p) => { if (p.record.gameId) void saveGame(p.record) } } })

function fmt(ms: number) {
  if (ms < 10_000) return (Math.max(0, ms) / 1000).toFixed(1)
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Game({ restore, autostart, onNew, onMenu }: { restore: GameRecord | null; autostart: StartArgs | null; onNew: () => void; onMenu: () => void }) {
  const app = useApp()
  const nav = useNavigate()
  const game = useActorRef(machine, { input: { restore } }) // stopped on unmount → engine terminated, clock paused
  const ask = useConfirm()
  const value = useSelector(game, (s) => JSON.stringify(s.value))
  const c = useSelector(game, (s) => s.context)
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null)
  const inSetup = value === '"setup"'
  useEffect(() => { if (autostart && inSetup) { const [color, level, tc] = autostart; game.send({ type: 'START', color, level, tc }) } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const over = value === '"over"'
  const thinking = value.includes('thinking')
  const yourTurn = value.includes('yourTurn')

  useEffect(() => { if (c.moves.length) playSound('move', app.profile.sound) }, [c.moves.length, app.profile.sound])
  const shapes = useMemo<DrawShape[]>(() => (c.hint ? [{ orig: c.hint.slice(0, 2) as Key, dest: c.hint.slice(2, 4) as Key, brush: 'hint' }] : []), [c.hint])
  const sans = useMemo(() => { const g = new Chess(c.initialFen); return c.moves.map((u) => g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san) }, [c.moves, c.initialFen])

  // live clock display (the machine owns the real clock; this only renders it)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!c.clocks || over || inSetup) return; const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t) }, [c.clocks, over, inSetup])
  const turn = sideToMove(c.fen)
  const live = (side: 'white' | 'black') => (!c.clocks ? null : side === turn && !over ? c.clocks[side] - (now - c.turnStartedAt) : c.clocks[side])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!yourTurn) return
      if (e.key === 'h') game.send({ type: 'HINT' })
      if (e.key === 'u') game.send({ type: 'TAKEBACK' })
    }
    addEventListener('keydown', h); return () => removeEventListener('keydown', h)
  }, [yourTurn, game])

  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [sans.length])

  if (inSetup && autostart) return null
  if (inSetup) return <Setup onStart={(color, level, tc) => game.send({ type: 'START', color, level, tc })} />

  function onMove(from: string, to: string) {
    const p = new Chess(c.fen).get(from as never)
    if (p?.type === 'p' && (to[1] === '8' || to[1] === '1')) { setPromo({ from, to }); return }
    game.send({ type: 'MOVE', uci: from + to })
  }
  const level = LEVELS.find((l) => l.n === c.level)!
  const status = over ? (c.result!.winner === null ? `DRAW · ${c.result!.reason}` : c.result!.winner === c.color ? `YOU WIN · ${c.result!.reason}` : `STOCKFISH WINS · ${c.result!.reason}`)
    : thinking ? 'STOCKFISH THINKING…' : 'YOUR MOVE'
  const opp = c.color === 'white' ? 'black' : 'white'
  const mat = material(c.fen)
  const row = (side: 'white' | 'black', who: string) => {
    const ms = live(side)
    const active = side === turn && !over
    const captured = side === 'white' ? mat.whiteCaptured : mat.blackCaptured
    const lead = side === 'white' ? mat.diff : -mat.diff
    return (
      <div className={`flex items-center justify-between gap-3 border px-3 py-1.5 md:py-2 ${active ? 'border-accent' : 'border-line'}`}>
        <div className="flex min-w-0 items-center gap-2" aria-label={`${who}: captured ${captured.join(' ') || 'nothing'}${lead > 0 ? `, ahead by ${lead}` : ''}`}>
          <span className="label shrink-0">{who} {side === 'white' ? '□' : '■'}</span>
          <span className="caps" aria-hidden>{captured.map((t, i) => <i key={i} className={t === 'p' ? 'pawn' : undefined} style={{ backgroundImage: pieceImage(side === 'white' ? 'black' : 'white', t) }} />)}</span>
          {lead > 0 && <span className="pixel shrink-0 text-[15px] leading-none text-accent">+{lead}</span>}
        </div>
        {ms !== null && <span className={`pixel text-[26px] leading-none md:text-[30px] ${ms < 10_000 && active ? 'text-bad' : active ? '' : 'text-muted'}`}>{fmt(ms)}</span>}
      </div>
    )
  }

  return (
    <div className="grid h-[calc(100dvh-var(--topbar)-56px)] min-h-0 grid-rows-[auto_minmax(0,1fr)] md:h-[calc(100dvh-var(--topbar))] md:grid-cols-[1fr_minmax(320px,380px)] md:grid-rows-1">
      <div className="flex min-h-0 items-center justify-center p-3 md:p-6">
        <div className="h-[min(60dvh,calc(100vw-16px))] w-full md:h-full">
          <Board fen={c.fen} orientation={c.color} interactive={yourTurn} onMove={onMove} shapes={shapes} lastMove={c.lastMove} />
        </div>
        {promo && (
          <div className="fixed inset-0 z-30 flex items-center justify-center bg-bg/70" onClick={() => setPromo(null)}>
            <div className="panel flex gap-2 p-3" onClick={(e) => e.stopPropagation()}>
              {(['q', 'r', 'b', 'n'] as const).map((p) => (
                <button key={p} className="btn text-[22px]" onClick={() => { const pr = promo; setPromo(null); game.send({ type: 'MOVE', uci: pr.from + pr.to + p }) }}>{{ q: '♛', r: '♜', b: '♝', n: '♞' }[p]}</button>
              ))}
            </div>
          </div>
        )}
      </div>
      <aside className="flex min-h-0 flex-col gap-2 border-t border-line p-3 md:gap-3 md:border-l md:border-t-0 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="label">vs Stockfish · level {level.n} {level.label} ({level.elo}) · {tcLabel(c.tc)} · you play {c.color}</div>
          {!over && <button className="btn btn-ghost !px-2 !py-1 shrink-0" onClick={onMenu} title="Leave this game paused; resume it from the Play menu">← Menu</button>}
        </div>
        {row(opp, 'Stockfish')}
        <div className={`flex items-center gap-3 text-[15px] font-semibold md:text-[18px] tracking-[.06em] ${over && c.result!.winner === c.color ? 'text-accent' : ''}`} aria-live="polite">
          <span className="text-accent">&gt;</span>{status}
        </div>
        {row(c.color, 'You')}
        {!over ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={!yourTurn} onClick={() => game.send({ type: 'HINT' })}>Hint <kbd className="hidden text-[10px] opacity-60 md:inline">H</kbd></button>
            <button className="btn" disabled={c.moves.length === 0} onClick={() => game.send({ type: 'TAKEBACK' })}>Takeback <kbd className="hidden text-[10px] opacity-60 md:inline">U</kbd></button>
            <button className="btn" onClick={async () => { if (await ask({ title: 'Resign this game?', body: 'Stockfish wins. The game stays in your history and you can review it.', confirm: 'Resign', danger: true })) game.send({ type: 'RESIGN' }) }}>Resign</button>
            <button className="btn btn-ghost" onClick={async () => { if (await ask({ title: 'Abandon this game?', body: 'It is kept in your history and counts as a loss, like on chess.com.', confirm: 'Abandon', danger: true })) game.send({ type: 'ABANDON' }) }}>Abandon</button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => nav({ to: '/play/$gameId', params: { gameId: c.gameId } })}>Review game</button>
            <button className="btn" onClick={onNew}>New game</button>
          </div>
        )}
        <div className="label mt-1">Moves</div>
        <ol ref={listRef} className="grid min-h-0 flex-1 auto-rows-min grid-cols-[2.5em_1fr_1fr] gap-x-2 overflow-y-auto text-[13px]">
          {Array.from({ length: Math.ceil(sans.length / 2) }, (_, i) => (
            <li key={i} className="contents"><span className="text-faint">{i + 1}.</span><span>{sans[2 * i]}</span><span>{sans[2 * i + 1] ?? ''}</span></li>
          ))}
        </ol>
        <div className="hidden border-t border-dashed border-line-strong pt-2 text-[11px] text-faint md:block">
          Official Stockfish (GPLv3), WebAssembly, in your browser. Clocks pause if you leave the page.
        </div>
      </aside>
    </div>
  )
}

function Setup({ onStart, active, onResume }: { onStart: (color: 'white' | 'black', level: number, tc: TimeControl | null) => void; active?: GameRecord; onResume?: () => void }) {
  const games = useLive(() => listGames(), [], [] as GameRecord[])
  const rating = playRating(games, levelElo, START_FEN)
  const rec = recordByLevel(games, START_FEN)
  const lastLevel = games.find((g) => g.status !== 'active')?.level
  const [color, setColor] = useState<'white' | 'black' | 'random'>('white')
  const [level, setLevel] = useState(3)
  const [tcId, setTcId] = useState(() => { try { return localStorage.getItem('play.tc') ?? '10+0' } catch { return '10+0' } })
  useEffect(() => { if (lastLevel) setLevel(lastLevel) }, [lastLevel])
  // nudge: 2+ wins and a winning record at this level → suggest the next one
  const r = rec.get(level)
  const suggestion = r && r.w >= 2 && r.w > r.l && level < 8 ? LEVELS[level] : null
  const tc = TIME_CONTROLS.find((t) => t.id === tcId) ?? TIME_CONTROLS[4]
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName !== 'BUTTON') if (onResume) onResume(); else onStart(color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color, level, tc.tc) }
    addEventListener('keydown', h); return () => removeEventListener('keydown', h)
  }, [color, level, tc, onStart, onResume])

  const start = () => onStart(color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color, level, tc.tc)
  const lv = LEVELS.find((l) => l.n === level)!
  return (
    <div className={`mx-auto grid w-full max-w-6xl gap-x-6 px-4 py-6 pb-28 md:h-[calc(100dvh-var(--topbar))] md:grid-cols-[1fr_320px] ${active ? 'md:grid-rows-[auto_auto_minmax(0,1fr)]' : 'md:grid-rows-[auto_minmax(0,1fr)]'} md:pb-5`}>
      <div className="md:col-span-2"><PageHeader title="PLAY" sub="vs Stockfish · no account needed · signed in, games sync across devices" /></div>
      {active && onResume && (
        <div className="panel mb-5 flex flex-wrap items-center justify-between gap-3 border-accent px-4 py-3 md:col-span-2">
          <div className="text-[13px]"><span className="label mr-3 text-accent">Paused</span>Level {active.level} · {tcLabel(active.timeControl)} · you play {active.color} · move {Math.ceil(active.moves.length / 2) || 1}</div>
          <button className="btn btn-primary" onClick={onResume}>Resume game <kbd className="text-[10px] opacity-60">↵</kbd></button>
        </div>
      )}
      <div className="flex min-h-0 flex-col gap-4">
        <div>
          <SectionLabel n="01">Time</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {TIME_CONTROLS.map((t) => (
              <button key={t.id} className={`btn !px-3 !py-1.5 ${tcId === t.id ? 'btn-primary' : ''}`}
                onClick={() => { setTcId(t.id); try { localStorage.setItem('play.tc', t.id) } catch { /* Storage may be blocked or full; the selection still applies in memory. */ } }}>{t.label}</button>
            ))}
          </div>
        </div>
        <div>
          <SectionLabel n="02">Colour</SectionLabel>
          <div className="flex gap-1.5">
            {(['white', 'black', 'random'] as const).map((c) => (
              <button key={c} className={`btn !px-3 !py-1.5 ${color === c ? 'btn-primary' : ''}`} onClick={() => setColor(c)}>{c === 'white' ? '□ White' : c === 'black' ? '■ Black' : '? Random'}</button>
            ))}
          </div>
        </div>
        <div>
          <SectionLabel n="03">Level</SectionLabel>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {LEVELS.map((l) => {
              const lr = rec.get(l.n)
              return (
                <button key={l.n} onClick={() => setLevel(l.n)} className={`border px-3 py-2 text-left ${level === l.n ? 'border-accent bg-accent/10' : 'border-line hover:border-ink'}`}>
                  <div className="flex items-baseline gap-2"><span className="pixel text-[18px] leading-none">{l.n}</span><span className="truncate text-[12px]">{l.label}</span></div>
                  <div className="mt-1 flex justify-between text-[11px] text-muted"><span>{l.elo}</span>{lr && <span className="text-faint">{lr.w}-{lr.d}-{lr.l}</span>}</div>
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-faint">Rough Elo: 5–7 use Stockfish's Elo setting, 1–4 and 8 are estimates (engine Elo ≠ chess.com Elo).</p>
          {suggestion && <p className="mt-1 text-[12px] text-good">[ok] You are beating level {level}. Ready for level {suggestion.n} ({suggestion.label})?</p>}
        </div>
        <div className="fixed inset-x-0 bottom-[56px] z-10 border-t border-line bg-bg p-3 md:static md:border-0 md:bg-transparent md:p-0">
          <button className="btn btn-primary w-full justify-center py-4 text-[14px]" onClick={start}>
            Start game · {tc.label} · {color} · level {lv.n} {lv.label} <kbd className="text-[10px] opacity-60">↵</kbd>
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-col gap-4">
        <Link to="/stats" className="panel block px-4 py-3 hover:border-ink" title="Estimated from your results against each level's approximate Elo">
          <div className="label">Est. rating vs computer</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="pixel text-[30px] leading-none">{rating.games ? rating.rating : '—'}{rating.provisional && rating.games ? <span className="text-[14px] text-muted">?</span> : null}</span>
            <span className="text-[11px] text-muted">{rating.games} rated game{rating.games === 1 ? '' : 's'} · chart in Stats</span>
          </div>
        </Link>
        <History games={games} />
      </div>
    </div>
  )
}

function History({ games }: { games: GameRecord[] }) {
  const ask = useConfirm()
  const done = games.filter((g) => g.status !== 'active')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SectionLabel n="04">History · {done.length}</SectionLabel>
      {done.length === 0 ? <p className="text-[12px] text-muted">Your finished games will appear here, ready to review.</p> : (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {done.slice(0, 50).map((g) => {
            const res = g.result?.winner === null ? 'draw' : g.result?.winner === g.color ? 'win' : 'loss'
            return (
              <li key={g.gameId} className="group relative">
                <button className="absolute right-0 top-0 z-[1] hidden h-full px-2 text-faint hover:text-bad group-hover:block group-focus-within:block" aria-label="Delete this game"
                  onClick={async () => { if (await ask({ title: 'Delete this game?', body: 'It is removed from your history and rating on all your devices.', confirm: 'Delete', danger: true })) await deleteGame(g) }}>×</button>
                <Link to="/play/$gameId" params={{ gameId: g.gameId }} className="flex items-center justify-between gap-2 border border-line px-3 py-2 text-[12px] hover:border-ink">
                  <span className={`w-10 font-semibold uppercase ${res === 'win' ? 'text-good' : res === 'loss' ? 'text-bad' : 'text-muted'}`}>{res}</span>
                  <span className="flex-1 truncate text-muted">L{g.level} · {tcLabel(g.timeControl)} · {g.color === 'white' ? '□' : '■'} · {g.result?.reason}</span>
                  <span className="text-faint">{new Date(g.endedAt ?? g.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
