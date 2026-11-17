import EvalChart from '../components/EvalChart'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { createActor } from 'xstate'
import { Chess } from 'chess.js'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import Board from '../components/Board'
import { SectionLabel } from '../components/common'
import { useConfirm } from '../components/Confirm'
import { engineMachine, type SearchResult } from '../machines/engine'
import { LEVELS, replayMoves } from '../machines/vsComputer'
import { activeGame, db, getGame, saveGame, useLive, type GameAnalysis } from '../core/store'
import { explainMistake } from '../lib/explain'
import { tcLabel, type GameRecord } from '@shared/game'

const DEPTH = 10

export default function GameReview() {
  const { gameId } = useParams({ from: '/play/$gameId' })
  const game = useLive(() => getGame(gameId), [gameId], undefined as GameRecord | null | undefined)
  if (game === undefined) return null
  if (!game) return <div className="mx-auto mt-16 max-w-md panel p-6">Game not found. <Link to="/play" className="underline">Back to Play</Link></div>
  return <Review game={game} />
}

type Pos = GameAnalysis['positions'][number]

/** Analyse every position once (cached per game in IndexedDB). */
function useAnalysis(game: GameRecord) {
  // undefined = still loading, null = not analysed yet (distinct on purpose)
  const cached = useLive(async () => (await db.analysis.get(game.gameId)) ?? null, [game.gameId], undefined as GameAnalysis | null | undefined)
  const [live, setLive] = useState<Pos[]>([])
  const done = !!cached && cached.positions.length === game.moves.length + 1
  const loaded = cached !== undefined
  useEffect(() => {
    if (!loaded || done) return
    const a = createActor(engineMachine, { input: {} }); a.start()
    let stop = false
    const out: Pos[] = []
    void (async () => {
      for (let i = 0; i <= game.moves.length && !stop; i++) {
        const { g } = replayMoves(game.moves.slice(0, i), game.initialFen)
        if (g.isGameOver()) { out.push(null); setLive([...out]); continue }
        const id = `review:${game.gameId}:${i}`
        const r = await new Promise<SearchResult>((res) => { const sub = a.on('RESULT', (e) => { if (e.result.id === id) { sub.unsubscribe(); res(e.result) } }); a.send({ type: 'SEARCH', req: { id, fen: g.fen(), depth: DEPTH, skill: 20 } }) })
        const sign = g.turn() === 'w' ? 1 : -1
        out.push({ cp: sign * (r.score?.mate !== undefined && r.score?.mate !== null ? Math.sign(r.score.mate) * 1000 : r.score?.cp ?? 0),
          mate: r.score?.mate !== undefined && r.score?.mate !== null ? sign * r.score.mate : null, best: r.bestmove, pv: r.pv })
        setLive([...out])
      }
      if (!stop) await db.analysis.put({ gameId: game.gameId, depth: DEPTH, positions: out })
    })()
    return () => { stop = true; a.stop() }
    // keyed on identity + length: a sync touching the record must not restart the analysis
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, done, game.gameId, game.moves.length])
  return done ? cached!.positions : live
}

function Review({ game }: { game: GameRecord }) {
  const nav = useNavigate()
  const ask = useConfirm()
  const positions = useAnalysis(game)
  const [ply, setPly] = useState(game.moves.length)
  const [copied, setCopied] = useState(false)
  const frames = useMemo(() => {
    const g = new Chess(game.initialFen)
    const out: { fen: string; san?: string; last?: [string, string] }[] = [{ fen: g.fen() }]
    for (const u of game.moves) { const m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); out.push({ fen: g.fen(), san: m.san, last: [m.from, m.to] }) }
    return out
  }, [game])
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1))
      if (e.key === 'ArrowRight') setPly((p) => Math.min(frames.length - 1, p + 1))
      if (e.key === 'Home') setPly(0)
      if (e.key === 'End') setPly(frames.length - 1)
    }
    addEventListener('keydown', h); return () => removeEventListener('keydown', h)
  }, [frames.length])

  // your moves that lost ≥1.2 pawns (mistake) or ≥3 (blunder), from your side's point of view
  const mine = new Chess(game.initialFen).turn() === (game.color === 'white' ? 'w' : 'b') ? 0 : 1
  const issues = game.moves.map((u, i) => {
    if (i % 2 !== mine) return null
    const a = positions[i], b = positions[i + 1]
    if (!a || !b) return null
    const pov = game.color === 'white' ? 1 : -1
    const drop = pov * (a.cp - b.cp)
    if (drop < 120) return null
    const why = explainMistake({ fenBefore: frames[i].fen, played: u, best: a.best !== u ? a.best : null, reply: b.best || null,
      mateAfter: b.mate !== null ? pov * b.mate : null, mateBefore: a.mate !== null && pov * a.mate > 0 ? pov * a.mate : null })
    return { i, kind: drop >= 300 ? 'blunder' : 'mistake', drop, why, best: a.best }
  }).filter(Boolean) as { i: number; kind: string; drop: number; why: string; best: string }[]
  const issueAt = issues.find((x) => x.i + 1 === ply || x.i === ply)
  const shapes = useMemo<DrawShape[]>(() => {
    if (!issueAt) return []
    const played = game.moves[issueAt.i]
    return [{ orig: played.slice(0, 2) as Key, dest: played.slice(2, 4) as Key, brush: 'red' }, { orig: issueAt.best.slice(0, 2) as Key, dest: issueAt.best.slice(2, 4) as Key, brush: 'green' }]
  }, [issueAt, game.moves])
  const showFen = issueAt && ply === issueAt.i + 1 ? frames[issueAt.i].fen : frames[ply].fen // show the position before the mistake, with both arrows

  const res = game.result?.winner === null ? 'Draw' : game.result?.winner === game.color ? 'You won' : 'Stockfish won'
  const level = LEVELS.find((l) => l.n === game.level)
  const pgn = useMemo(() => {
    const date = (game.endedAt ?? game.updatedAt).slice(0, 10).replace(/-/g, '.')
    const you = 'You', sf = `Stockfish (level ${game.level})`
    const result = game.result?.winner === null ? '1/2-1/2' : game.result?.winner === 'white' ? '1-0' : game.result?.winner === 'black' ? '0-1' : '*'
    const head = [`[Event "Open Chess Trainer vs computer"]`, `[Date "${date}"]`, `[White "${game.color === 'white' ? you : sf}"]`, `[Black "${game.color === 'black' ? you : sf}"]`,
      `[Result "${result}"]`, `[TimeControl "${game.timeControl ? `${game.timeControl.baseMs / 1000}+${game.timeControl.incMs / 1000}` : '-'}"]`,
      ...(game.initialFen !== new Chess().fen() ? [`[SetUp "1"]`, `[FEN "${game.initialFen}"]`] : [])]
    const g = new Chess(game.initialFen)
    game.moves.forEach((u) => g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }))
    return `${head.join('\n')}\n\n${g.pgn({ maxWidth: 80 }).split('\n\n').pop()} ${result}\n`
  }, [game])

  async function retryFrom(i: number) {
    const fen = frames[i].fen
    const g: GameRecord = { gameId: crypto.randomUUID(), schemaVersion: 2, status: 'active', color: game.color, level: game.level, initialFen: fen, timeControl: null, clocks: null,
      moves: [], result: null, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), endedAt: null }
    const current = await activeGame()
    if (current && current.moves.length > 0 && !(await ask({ title: 'Retry from this position?', body: 'You have a game in progress. Starting here abandons it, and it counts as a loss.', confirm: 'Abandon and retry', danger: true }))) return
    if (current) await saveGame({ ...current, status: 'abandoned', result: { winner: current.color === 'white' ? 'black' : 'white', reason: 'abandoned' }, endedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    await saveGame(g)
    nav({ to: '/play' })
  }


  return (
    <div className="grid h-[calc(100dvh-var(--topbar)-56px)] min-h-0 grid-rows-[auto_minmax(0,1fr)] md:h-[calc(100dvh-var(--topbar))] md:grid-cols-[1fr_minmax(340px,420px)] md:grid-rows-1">
      <div className="flex min-h-0 flex-col items-center justify-center gap-2 p-3 md:p-6">
        <div className="h-[min(56dvh,calc(100vw-16px))] w-full md:h-[calc(100%-48px)]">
          <Board fen={showFen} orientation={game.color} interactive={false} lastMove={issueAt && ply === issueAt.i + 1 ? undefined : frames[ply].last} shapes={shapes} />
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => setPly(0)} aria-label="Start">⏮</button>
          <button className="btn" onClick={() => setPly(Math.max(0, ply - 1))} aria-label="Previous">←</button>
          <span className="pixel self-center px-2 text-[14px]">{ply}/{frames.length - 1}</span>
          <button className="btn" onClick={() => setPly(Math.min(frames.length - 1, ply + 1))} aria-label="Next">→</button>
          <button className="btn" onClick={() => setPly(frames.length - 1)} aria-label="End">⏭</button>
        </div>
      </div>
      <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-t border-line p-4 md:border-l md:border-t-0 md:p-5">
        <Link to="/play" className="label hover:text-ink">← play</Link>
        <div className="text-[18px] font-semibold tracking-[.04em]">&gt; {res.toUpperCase()} · {game.result?.reason}</div>
        <div className="label">Level {game.level} {level?.label} · {tcLabel(game.timeControl)} · you played {game.color} · {new Date(game.endedAt ?? game.updatedAt).toLocaleString()}</div>

        <SectionLabel n="01">Who was winning {positions.length < frames.length ? `· analysing ${positions.length}/${frames.length}` : ''}</SectionLabel>
        <EvalChart positions={positions} sans={frames.slice(1).map((f) => f.san ?? "")} color={game.color} ply={ply} issues={issues} onJump={setPly} />

        <SectionLabel n="02">Your mistakes</SectionLabel>
        {positions.length < frames.length && issues.length === 0 && <p className="text-[12px] text-muted">Analysing with Stockfish…</p>}
        {positions.length >= frames.length && issues.length === 0 && <p className="text-[12px] text-good">[ok] No mistakes above 1.2 pawns. Well played.</p>}
        <ul className="space-y-2">
          {issues.map((x) => (
            <li key={x.i} className={`border p-2 text-[12px] ${issueAt?.i === x.i ? 'border-accent' : 'border-line'}`}>
              <button className="w-full text-left" onClick={() => setPly(x.i + 1)}>
                <span className={x.kind === 'blunder' ? 'text-bad' : 'text-info'}>[{x.kind === 'blunder' ? '??' : '?'}] {Math.floor(x.i / 2) + 1}{x.i % 2 ? '...' : '.'}{frames[x.i + 1].san}</span>
                <span className="text-muted"> · −{(x.drop / 100).toFixed(1)}</span>
                <div className="mt-1 font-sans text-[13px] text-ink/90">{x.why}</div>
              </button>
              <button className="label mt-1 hover:text-ink" onClick={() => retryFrom(x.i)}>↻ retry from this position</button>
            </li>
          ))}
        </ul>

        <SectionLabel n="03">Moves</SectionLabel>
        <ol className="grid grid-cols-[2.5em_1fr_1fr] gap-x-2 text-[13px]">
          {Array.from({ length: Math.ceil(game.moves.length / 2) }, (_, r) => (
            <li key={r} className="contents">
              <span className="text-faint">{r + 1}.</span>
              {[2 * r + 1, 2 * r + 2].map((p) => frames[p] ? (
                <button key={p} onClick={() => setPly(p)} className={`text-left ${ply === p ? 'bg-accent px-1 text-accent-ink' : ''} ${issues.some((x) => x.i + 1 === p) ? 'text-bad' : ''}`}>{frames[p].san}</button>
              ) : <span key={p} />)}
            </li>
          ))}
        </ol>

        <div className="mt-auto flex flex-wrap gap-2 border-t border-dashed border-line-strong pt-3">
          <button className="btn" onClick={async () => { await navigator.clipboard.writeText(pgn); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? 'Copied' : 'Copy PGN'}</button>
          <button className="btn" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([pgn], { type: 'application/x-chess-pgn' })); a.download = `game-${game.gameId.slice(0, 8)}.pgn`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000) }}>Download PGN</button>
          <Link to="/play" className="btn btn-primary">New game</Link>
        </div>
      </aside>
    </div>
  )
}
