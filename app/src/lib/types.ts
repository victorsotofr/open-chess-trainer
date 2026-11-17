import type { PuzzleId } from '@shared/progress'

export type Verdict = 'solution' | 'accepted' | 'slower_mate' | 'inconclusive' | 'rejected'

export interface MoveVerdict {
  v: Verdict
  score: string
  line?: string[] // engine continuation after the move (SAN)
  why?: string // reason, for rejected moves
}

export interface PlyJudgement {
  ref_score: string
  moves: Record<string, MoveVerdict> // uci -> verdict
}

export interface Exercise {
  id: PuzzleId // e.g. "lichess:00sHx"
  chapter: number
  section: string
  mode: 'guided' | 'test'
  hint: string | null
  /** position before the opponent's setup move (Lichess FEN); null for original teaching puzzles */
  initialFen: string | null
  /** the opponent's move that leads to the puzzle (UCI), animated once on start; null if none */
  setup: string | null
  fen: string // where solving starts (after the setup move)
  solution: string[] // SAN, from `fen`, incl. opponent replies
  solution_uci: string[]
  solution_text: string // shown after the puzzle
  flags: string[]
  /** "engine": precomputed Stockfish verdicts in `plies`; "reference": solution + any mate */
  judging: 'engine' | 'reference'
  plies: PlyJudgement[] // one per solver move when judging="engine"; may be empty otherwise
  rating?: number
  themes?: string[]
  gameUrl?: string
  boss?: boolean
}

export interface WorkedExample {
  id: string
  section: string
  page: number
  fen: string
  solution: string[]
  solution_uci: string[]
  answer_text: string
  /** shown inside the lesson text, at the book's diagram (not repeated under "Worked examples") */
  inline?: boolean
}

export interface Figure {
  file: string // image under /data/figures/ (part of the public pack)
  page: number
  width: number
  height: number
  source: 'image' | 'reconstructed'
  /** only for source="reconstructed": machine-verified and human-approved positions + linking moves */
  steps?: { fen: string; san?: string; uci?: string }[]
  /** how the lesson shows it: the book's own worked example (animated), approved static boards, or the picture */
  kind?: 'example' | 'static' | 'image'
  example?: string // WorkedExample.id when kind="example"
  boards?: { fen: string; arrows: string[] }[] // kind="static": placements + the book's arrows (uci-like "c3h8")
}

export interface Chapter {
  chapter: number
  name: string
  part: string
  page: number
  /** lesson text in book order; {type:"Figure", file} marks where a diagram is printed */
  paragraphs: { type: string; text?: string; page?: number; idx?: number; file?: string }[]
  examples: WorkedExample[]
  figures: Figure[]
  sections: string[]
}

export interface Book {
  chapters: Chapter[]
  exercises: Exercise[]
}
