export type Verdict = 'book' | 'accepted' | 'slower_mate' | 'inconclusive' | 'rejected'

export interface MoveVerdict {
  v: Verdict
  score: string
  line?: string[] // engine continuation after the move (SAN)
  why?: string // reason, for rejected moves
}

export interface PlyJudgement {
  book_score: string
  moves: Record<string, MoveVerdict> // uci -> verdict
}

export interface Exercise {
  id: number
  chapter: number
  section: string
  mode: 'guided' | 'test'
  hint: string | null
  fen: string
  solution: string[] // SAN, full line incl. opponent replies
  solution_uci: string[]
  solution_text: string // the book's solution with commentary
  page: number
  flags: string[]
  plies: PlyJudgement[] // one per solver move (solution indices 0, 2, 4, ...)
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
