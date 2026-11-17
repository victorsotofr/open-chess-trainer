import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Chessground } from '@lichess-org/chessground'
import type { Api } from '@lichess-org/chessground/api'
import type { Key } from '@lichess-org/chessground/types'
import type { DrawShape } from '@lichess-org/chessground/draw'
import { Chess } from 'chess.js'
import '@lichess-org/chessground/assets/chessground.base.css'
import '@lichess-org/chessground/assets/chessground.cburnett.css'

export interface BoardProps {
  fen: string
  orientation: 'white' | 'black'
  interactive: boolean
  onMove?: (from: string, to: string) => void
  shapes?: DrawShape[]
  lastMove?: [string, string]
  highlight?: string[]
  flash?: { square: string; tone: 'good' | 'bad'; key: number } | null
  /** px; when omitted the board fills its container (square, coordinates included) */
  size?: number
  showTurn?: boolean
}

function dests(fen: string): Map<Key, Key[]> {
  const m = new Map<Key, Key[]>()
  for (const mv of new Chess(fen).moves({ verbose: true })) m.set(mv.from as Key, [...(m.get(mv.from as Key) ?? []), mv.to as Key])
  return m
}

const FILES = 'abcdefgh'

/**
 * Chessboard with book-style furniture: rank/file labels outside the board and the
 * □ (White) / ■ (Black) turn square at the bottom-left, as in printed chess diagrams.
 */
export default function Board({ fen, orientation, interactive, onMove, shapes = [], lastMove, highlight = [], flash, size, showTurn = true }: BoardProps) {
  const outer = useRef<HTMLDivElement>(null)
  const el = useRef<HTMLDivElement>(null)
  const api = useRef<Api | null>(null)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove
  const [fit, setFit] = useState(size ?? 320)

  useLayoutEffect(() => {
    if (size || !outer.current) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      setFit(Math.max(200, Math.floor(Math.min(width - GUTTER, height - GUTTER))))
    })
    ro.observe(outer.current)
    return () => ro.disconnect()
  }, [size])
  const px = size ?? fit

  useEffect(() => {
    if (!el.current) return
    api.current = Chessground(el.current, {
      coordinates: false,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      drawable: { enabled: true, visible: true, brushes: BRUSHES },
      movable: { free: false, showDests: true, events: { after: (o, d) => onMoveRef.current?.(o, d) } },
      premovable: { enabled: false },
    })
    return () => api.current?.destroy()
  }, [])

  useEffect(() => { api.current?.redrawAll() }, [px])

  const g = new Chess(fen)
  const turn = g.turn() === 'w' ? 'white' : 'black'
  useEffect(() => {
    const custom = new Map<Key, string>()
    highlight.forEach((s) => custom.set(s as Key, 'hint-square'))
    if (flash) custom.set(flash.square as Key, flash.tone === 'good' ? 'flash-good' : 'flash-bad')
    api.current?.set({
      fen, orientation, turnColor: turn, check: g.inCheck(), lastMove: lastMove as Key[] | undefined,
      movable: { color: interactive ? turn : undefined, dests: interactive ? dests(fen) : new Map() },
      highlight: { lastMove: true, check: true, custom },
    })
    api.current?.setAutoShapes(shapes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, orientation, interactive, shapes, lastMove, highlight, flash])

  const ranks = orientation === 'white' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8]
  const files = orientation === 'white' ? FILES.split('') : FILES.split('').reverse()
  const sq = px / 8

  return (
    <div ref={outer} className={size ? '' : 'h-full w-full flex items-center justify-center min-h-0'}>
      <div className="grid select-none" style={{ gridTemplateColumns: `${TURN}px ${LABEL}px ${px}px`, gridTemplateRows: `${px}px ${LABEL}px` }}>
        <div className="relative">
          {showTurn && (
            <div className="absolute left-0 flex items-center" style={{ top: px - sq, height: sq }} title={`${turn} to move`}
              aria-label={`${turn} to move`} data-testid="turn-square">
              {/* real chess colours (not theme ink): black square = Black to move, white square = White to move */}
              <div style={{ padding: 3, background: '#8a8a90' }}><div style={{ width: 11, height: 11, background: turn === 'black' ? '#000' : '#fff' }} /></div>
            </div>
          )}
        </div>
        <div className="flex flex-col" aria-hidden>
          {ranks.map((r) => <div key={r} className="flex items-center justify-center text-[12px] font-semibold text-muted" style={{ height: sq }}>{r}</div>)}
        </div>
        <div className="cg-wrap" style={{ width: px, height: px }}>
          <div ref={el} style={{ width: px, height: px }} />
        </div>
        <div /><div />
        <div className="flex" aria-hidden>
          {files.map((f) => <div key={f} className="flex items-center justify-center text-[12px] font-semibold text-muted" style={{ width: sq }}>{f}</div>)}
        </div>
      </div>
    </div>
  )
}

const TURN = 20
const LABEL = 18
const GUTTER = TURN + LABEL + 2

const BRUSHES = {
  green: { key: 'g', color: '#3ddc84', opacity: 0.9, lineWidth: 10 },
  red: { key: 'r', color: '#ff5f56', opacity: 0.9, lineWidth: 10 },
  blue: { key: 'b', color: '#3b82f6', opacity: 0.9, lineWidth: 10 },
  // Chessground requires a yellow slot for modifier-key drawing; preserve its existing colour.
  yellow: { key: 'y', color: '#3b82f6', opacity: 0.9, lineWidth: 10 },
  hint: { key: 'hint', color: '#3b82f6', opacity: 0.9, lineWidth: 10 },
  paleBlue: { key: 'pb', color: '#8ab4ff', opacity: 0.4, lineWidth: 15 },
  paleGreen: { key: 'pg', color: '#3ddc84', opacity: 0.4, lineWidth: 15 },
  paleRed: { key: 'pr', color: '#ff5f56', opacity: 0.4, lineWidth: 15 },
  paleGrey: { key: 'pgr', color: '#4a4a4a', opacity: 0.35, lineWidth: 15 },
  purple: { key: 'purple', color: '#68217a', opacity: 0.65, lineWidth: 10 },
  pink: { key: 'pink', color: '#ee2080', opacity: 0.5, lineWidth: 10 },
  white: { key: 'white', color: 'white', opacity: 1, lineWidth: 10 },
  paleWhite: { key: 'pwhite', color: 'white', opacity: 0.6, lineWidth: 10 },
}
