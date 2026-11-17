import { SOURCE } from '../app/data'
import { PAGE, PageHeader, SectionLabel } from '../components/common'

export default function About() {
  return (
    <div className={PAGE}>
      <PageHeader title="ABOUT" sub="Credits, sources and licences." />
      <div className="max-w-3xl font-sans text-[14px] leading-relaxed">
      <SectionLabel n="01">The puzzles</SectionLabel>
      <p>The puzzles come from the <a className="underline" href={SOURCE.url} target="_blank" rel="noreferrer">{SOURCE.name}</a>, released into the public domain ({SOURCE.license}). Each one was taken from a real game; the lessons and teaching positions are original to this project.</p>
      <div className="mt-8"><SectionLabel n="02">Software</SectionLabel></div>
      <ul className="list-disc space-y-1 pl-5">
        <li><b>Stockfish</b> (GPLv3), the official engine from github.com/official-stockfish/Stockfish, judges moves and plays you.</li>
        <li><b>chessground</b> (GPLv3) by lichess.org draws the board; <b>chess.js</b> (BSD-2) checks the rules.</li>
        <li>Fonts: Geist and Geist Mono (OFL), Departure Mono by Helena Zhang (OFL).</li>
      </ul>
      <p className="mt-4">This app is free software under the GNU GPLv3. Its complete corresponding source, with every dependency's licence, is in the project repository (see THIRD_PARTY.md).</p>
      </div>
    </div>
  )
}
