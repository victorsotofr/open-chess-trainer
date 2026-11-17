/**
 * engine — Stockfish (WASM, lite single-threaded build of the official source) in a Web Worker.
 *
 *   booting ──uciok/readyok──▶ ready ──SEARCH{id}──▶ searching ──bestmove──▶ ready  (emits RESULT{id})
 *                                 ▲                     │ SEARCH{newer id}: send `stop`, drop the old result,
 *                                 └──── CANCEL ─────────┘ then run only the newest request
 *
 * Every request carries an id; a result is delivered only if its id is still current, so an
 * old analysis can never land on a new game or position.
 */
import { assign, enqueueActions, fromCallback, setup, type ActorRefFrom } from 'xstate'
import workerUrl from '../../node_modules/stockfish/bin/stockfish-18-lite-single.js?url'
import wasmUrl from '../../node_modules/stockfish/bin/stockfish-18-lite-single.wasm?url'

export interface SearchRequest {
  id: string
  fen: string
  /** engine limits */
  movetime?: number
  depth?: number
  multipv?: number
  /** strength: Skill Level 0..20, or limited Elo (UCI_LimitStrength) */
  skill?: number
  elo?: number
}

export interface SearchResult { id: string; bestmove: string; score: { cp?: number; mate?: number } | null; pv: string[] }

export interface LineSink { post: (cmd: string) => void; terminate: () => void }
/** Factory so tests can inject a fake engine. */
export type EngineFactory = (onLine: (line: string) => void) => LineSink

export const workerEngine: EngineFactory = (onLine) => {
  const w = new Worker(`${workerUrl}#${encodeURIComponent(new URL(wasmUrl, location.href).href)}`)
  w.onmessage = (e) => onLine(typeof e.data === 'string' ? e.data : String(e.data))
  return { post: (c) => w.postMessage(c), terminate: () => w.terminate() }
}

const CANCELLED = '__cancelled'

type Ctx = { factory: EngineFactory; current: SearchRequest | null; queued: SearchRequest | null; last: SearchResult | null; info: { cp?: number; mate?: number; pv: string[] } }
type Ev =
  | { type: 'SEARCH'; req: SearchRequest }
  | { type: 'CANCEL' }
  | { type: 'LINE'; line: string }

function parseInfo(line: string) {
  const score = /score (cp|mate) (-?\d+)/.exec(line)
  const pv = /\spv\s(.+)$/.exec(line)
  return { score: score ? (score[1] === 'cp' ? { cp: +score[2] } : { mate: +score[2] }) : null, pv: pv ? pv[1].trim().split(/\s+/) : null }
}

export const engineMachine = setup({
  types: {} as { context: Ctx; events: Ev; input: { factory?: EngineFactory }; emitted: { type: 'RESULT'; result: SearchResult } },
  actors: {
    worker: fromCallback<{ type: 'POST'; cmd: string }, { factory: EngineFactory }>(({ sendBack, receive, input }) => {
      const eng = input.factory((line) => sendBack({ type: 'LINE', line }))
      receive((e) => eng.post(e.cmd))
      eng.post('uci')
      return () => eng.terminate()
    }),
  },
  actions: {
    post: ({ system }, p: { cmds: string[] }) => { const w = system.get('worker'); p.cmds.forEach((cmd) => w?.send({ type: 'POST', cmd })) },
  },
  guards: {
    isUciOk: ({ event }) => event.type === 'LINE' && event.line.startsWith('uciok'),
    isReadyOk: ({ event }) => event.type === 'LINE' && event.line.startsWith('readyok'),
    isBestmove: ({ event }) => event.type === 'LINE' && event.line.startsWith('bestmove'),
    isInfo: ({ event }) => event.type === 'LINE' && event.line.startsWith('info') && / pv /.test(event.line),
    hasQueued: ({ context }) => !!context.queued,
  },
}).createMachine({
  id: 'engine',
  context: ({ input }) => ({ factory: input?.factory ?? workerEngine, current: null, queued: null, last: null, info: { pv: [] } }),
  invoke: { id: 'worker', systemId: 'worker', src: 'worker', input: ({ context }) => ({ factory: context.factory }) },
  initial: 'booting',
  states: {
    booting: {
      on: {
        LINE: [
          { guard: 'isUciOk', actions: { type: 'post', params: { cmds: ['setoption name Hash value 16', 'isready'] } } },
          { guard: 'isReadyOk', target: 'ready' },
        ],
        SEARCH: { actions: assign({ queued: ({ event }) => event.req }) }, // remember the latest; run when ready
      },
    },
    ready: {
      always: { guard: 'hasQueued', target: 'searching', actions: assign({ current: ({ context }) => context.queued, queued: null, info: { pv: [] } }) },
      on: { SEARCH: { target: 'searching', actions: assign({ current: ({ event }) => event.req, info: { pv: [] } }) } },
    },
    searching: {
      entry: { type: 'post', params: ({ context }) => {
        const r = context.current!
        const cmds = ['ucinewgame']
        if (r.elo) cmds.push('setoption name UCI_LimitStrength value true', `setoption name UCI_Elo value ${r.elo}`)
        else cmds.push('setoption name UCI_LimitStrength value false', `setoption name Skill Level value ${r.skill ?? 20}`)
        cmds.push(`setoption name MultiPV value ${r.multipv ?? 1}`, `position fen ${r.fen}`)
        const go = ['go']
        if (r.depth) go.push('depth', String(r.depth))
        if (r.movetime) go.push('movetime', String(r.movetime))
        if (!r.depth && !r.movetime) go.push('movetime', '500')
        cmds.push(go.join(' '))
        return { cmds }
      } },
      on: {
        LINE: [
          { guard: 'isInfo', actions: assign({ info: ({ context, event }) => {
            const line = (event as { line: string }).line
            if (/ multipv (\d+)/.test(line) && !/ multipv 1 /.test(line)) return context.info // track the best line only
            const p = parseInfo(line)
            return { ...(p.score ?? {}), pv: p.pv ?? context.info.pv }
          } }) },
          { guard: 'isBestmove', target: 'ready', actions: enqueueActions(({ context, event, enqueue }) => {
            const cur = context.current
            // superseded (a newer SEARCH is queued) or cancelled: drop the result silently
            if (cur && !context.queued && cur.id !== CANCELLED) {
              const result: SearchResult = { id: cur.id, bestmove: (event as { line: string }).line.split(/\s+/)[1],
                score: context.info.cp !== undefined || context.info.mate !== undefined ? { cp: context.info.cp, mate: context.info.mate } : null, pv: context.info.pv }
              enqueue.assign({ last: result })
              enqueue.emit({ type: 'RESULT', result })
            }
            enqueue.assign({ current: null })
          }) },
        ],
        SEARCH: { actions: [assign({ queued: ({ event }) => event.req }), { type: 'post', params: { cmds: ['stop'] } }] },
        CANCEL: { actions: [assign({ queued: null }), { type: 'post', params: { cmds: ['stop'] } }, assign({ current: ({ context }) => context.current && { ...context.current, id: CANCELLED } })] },
      },
    },
  },
})

export type EngineRef = ActorRefFrom<typeof engineMachine>
