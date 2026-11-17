/** A game against the computer: the durable record (storage + sync contract). */

export interface TimeControl { baseMs: number; incMs: number }

export interface GameRecord {
  gameId: string
  schemaVersion: 2
  status: 'active' | 'finished' | 'abandoned' | 'deleted' // deleted = tombstone, synced so every device hides it
  color: 'white' | 'black'
  level: number
  initialFen: string // standard start, or a position ("retry from this mistake")
  timeControl: TimeControl | null // null = no clock
  clocks: { white: number; black: number } | null // ms remaining, as of the last move
  moves: string[] // UCI from initialFen
  result: null | { winner: 'white' | 'black' | null; reason: string }
  startedAt: string
  updatedAt: string
  endedAt: string | null
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export const TIME_CONTROLS: { id: string; label: string; tc: TimeControl | null }[] = [
  { id: '1+0', label: '1 min', tc: { baseMs: 60_000, incMs: 0 } },
  { id: '3+0', label: '3 min', tc: { baseMs: 180_000, incMs: 0 } },
  { id: '3+2', label: '3 | 2', tc: { baseMs: 180_000, incMs: 2_000 } },
  { id: '5+0', label: '5 min', tc: { baseMs: 300_000, incMs: 0 } },
  { id: '10+0', label: '10 min', tc: { baseMs: 600_000, incMs: 0 } },
  { id: '15+10', label: '15 | 10', tc: { baseMs: 900_000, incMs: 10_000 } },
  { id: '30+0', label: '30 min', tc: { baseMs: 1_800_000, incMs: 0 } },
  { id: 'none', label: 'No clock', tc: null },
]

export function tcLabel(tc: TimeControl | null): string {
  if (!tc) return 'no clock'
  const m = Math.round(tc.baseMs / 60_000)
  return tc.incMs ? `${m}+${Math.round(tc.incMs / 1000)}` : `${m} min`
}

/** Minimal shape check for records coming from the network or an old local version. */
export function isGameRecord(x: unknown): x is GameRecord {
  const g = x as Partial<GameRecord>
  return !!g && g.schemaVersion === 2 && typeof g.gameId === 'string' && g.gameId.length <= 100 && Array.isArray(g.moves)
    && g.moves.length <= 1000 && (g.color === 'white' || g.color === 'black') && typeof g.updatedAt === 'string'
}
