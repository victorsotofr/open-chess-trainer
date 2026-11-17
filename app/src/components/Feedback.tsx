/**
 * In-app feedback: one button in the top bar → a short form (bug / idea / other) with optional
 * technical details, and a "Yours" tab where reporters see the status and your reply.
 * Sent items are kept on this device (ids only matter to the server); unsent ones retry on next load.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FEEDBACK_KINDS, MAX_MESSAGE, type FeedbackContext, type FeedbackInput, type FeedbackKind } from '@shared/feedback'
import { activeGame, db } from '../core/store'
import { recentErrors } from '../lib/errors'
import { useApp } from '../app/data'

declare const __BUILD__: string

interface Mine { id: string; kind: FeedbackKind; message: string; createdAt: string; status?: string; label?: string; reply?: string | null; updatedAt?: string; seenAt?: string }
const MINE = 'feedback.mine', OUTBOX = 'feedback.outbox'
const read = <T,>(k: string): T[] => { try { return JSON.parse(localStorage.getItem(k) ?? '[]') as T[] } catch { return [] } }
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* Storage may be blocked or full. */ } }

const PLACEHOLDER: Record<FeedbackKind, string> = {
  bug: 'What happened, and what did you expect?\ne.g. "In Rush the timer kept running after my last move."',
  idea: 'What would make this better for you?\ne.g. "Let me choose which chapters Rush draws from."',
  other: 'Anything else: a question, something confusing, something you liked…',
}
const KIND_LABEL: Record<FeedbackKind, string> = { bug: 'Bug', idea: 'Idea', other: 'Other' }

async function gatherContext(auth: string, theme: string): Promise<FeedbackContext> {
  const route = location.pathname
  let puzzleId: number | null = null, runKind: string | null = null, gameId: string | null = null
  try {
    if (route === '/session') {
      const s = await db.sessions.get('learn')
      puzzleId = s?.puzzle?.puzzleId ?? s?.queue[s.index] ?? null
      runKind = s?.runKind ?? null
    }
    if (route.startsWith('/play/')) gameId = route.split('/')[2] ?? null
    else if (route === '/play') gameId = (await activeGame())?.gameId ?? null
  } catch { /* context is best effort */ }
  return { route, puzzleId, runKind, gameId, build: typeof __BUILD__ === 'string' ? __BUILD__ : 'dev', viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}x`, userAgent: navigator.userAgent, theme, auth, errors: recentErrors() }
}

async function send(item: FeedbackInput): Promise<boolean> {
  try {
    const r = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item) })
    return r.ok
  } catch { return false }
}

/** Retry unsent feedback and refresh statuses; returns the number of unread updates. */
async function refresh(): Promise<number> {
  const outbox = read<FeedbackInput>(OUTBOX)
  if (outbox.length) {
    const left: FeedbackInput[] = []
    for (const it of outbox) if (!(await send(it))) left.push(it)
    write(OUTBOX, left)
  }
  const mine = read<Mine>(MINE)
  if (!mine.length) return 0
  try {
    const r = await fetch('/api/feedback/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: mine.map((m) => m.id) }) })
    if (!r.ok) return 0
    const { items } = await r.json() as { items: { id: string; status: string; label: string; reply: string | null; updatedAt: string }[] }
    const by = new Map(items.map((i) => [i.id, i]))
    const next = mine.map((m) => ({ ...m, ...(by.get(m.id) ?? {}) }))
    write(MINE, next)
    return unread(next)
  } catch { return 0 }
}
const unread = (mine: Mine[]) => mine.filter((m) => m.updatedAt && m.status !== 'new' && (!m.seenAt || m.seenAt < m.updatedAt)).length

export function FeedbackButton() {
  const [open, setOpen] = useState(false)
  const [badge, setBadge] = useState(0)
  useEffect(() => { void refresh().then(setBadge) }, [])
  useEffect(() => {
    const h = (e: Event) => { setOpen(true); (e as CustomEvent).detail && sessionStorage.setItem('feedback.kind', (e as CustomEvent).detail) }
    addEventListener('open-feedback', h); return () => removeEventListener('open-feedback', h)
  }, [])
  return (
    <>
      <button className="relative text-[11px] uppercase tracking-[.1em] text-muted hover:text-ink" onClick={() => setOpen(true)} aria-label={`Send feedback${badge ? ` (${badge} update${badge > 1 ? 's' : ''})` : ''}`} title="Report a bug or suggest an idea">
        <span className="hidden lg:inline">[ Feedback ]</span><span className="lg:hidden">[?]</span>
        {badge > 0 && <span className="absolute -right-1.5 -top-1 h-2 w-2 bg-accent" />}
      </button>
      {/* portal: the top bar is its own stacking context, the dialog must sit above the phone tab bar */}
      {open && createPortal(<FeedbackDialog onClose={() => { setOpen(false); setBadge(unread(read<Mine>(MINE))) }} startOnMine={badge > 0} />, document.body)}
    </>
  )
}

function FeedbackDialog({ onClose, startOnMine }: { onClose: () => void; startOnMine: boolean }) {
  const app = useApp()
  const [tab, setTab] = useState<'send' | 'mine'>(startOnMine ? 'mine' : 'send')
  const [kind, setKind] = useState<FeedbackKind>(() => (sessionStorage.getItem('feedback.kind') as FeedbackKind) || 'bug')
  const [message, setMessage] = useState(() => sessionStorage.getItem('feedback.draft') ?? '')
  const [attach, setAttach] = useState(true)
  const [ctx, setCtx] = useState<FeedbackContext | null>(null)
  const [state, setState] = useState<'idle' | 'sending' | { sent: string; queued: boolean }>('idle')
  const [mine, setMine] = useState<Mine[]>(() => read<Mine>(MINE))
  const box = useRef<HTMLTextAreaElement>(null)
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement)

  useEffect(() => { void gatherContext(app.auth, app.profile.theme).then(setCtx) }, [app.auth, app.profile.theme])
  useEffect(() => { try { sessionStorage.setItem('feedback.draft', message) } catch { /* ignore */ } }, [message])
  useEffect(() => { if (tab === 'send') box.current?.focus() }, [tab, kind])
  useEffect(() => {
    if (tab !== 'mine') return
    void refresh().then(() => { const now = new Date().toISOString(); const m = read<Mine>(MINE).map((x) => ({ ...x, seenAt: now })); write(MINE, m); setMine(m) })
  }, [tab])
  const close = useCallback(() => { onClose(); setTimeout(() => back.current?.focus(), 0) }, [onClose])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close() } }
    addEventListener('keydown', h); return () => removeEventListener('keydown', h)
  }, [close])

  async function submit() {
    if (!message.trim() || state === 'sending') return
    setState('sending')
    const item: FeedbackInput = { schemaVersion: 1, id: crypto.randomUUID(), kind, message: message.trim(), context: attach ? ctx ?? await gatherContext(app.auth, app.profile.theme) : null, createdAt: new Date().toISOString() }
    const ok = await send(item)
    if (!ok) write(OUTBOX, [...read<FeedbackInput>(OUTBOX), item])
    const m: Mine[] = [{ id: item.id, kind, message: item.message, createdAt: item.createdAt, status: ok ? 'new' : undefined, label: ok ? 'Received' : 'Waiting to send' }, ...read<Mine>(MINE)].slice(0, 100)
    write(MINE, m); setMine(m)
    setMessage(''); try { sessionStorage.removeItem('feedback.draft'); sessionStorage.removeItem('feedback.kind') } catch { /* ignore */ }
    setState({ sent: item.id, queued: !ok })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/75 p-0 sm:items-center sm:p-4" onMouseDown={close}>
      <div role="dialog" aria-modal="true" aria-labelledby="fb-title" className="panel flex max-h-[92dvh] w-full max-w-lg flex-col border-line-strong p-5 pb-[max(20px,env(safe-area-inset-bottom))]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="fb-title" className="pixel text-[24px] leading-none">FEEDBACK</h2>
          <div className="flex gap-1" role="tablist">
            {(['send', 'mine'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={`btn !px-2.5 !py-1 text-[11px] ${tab === t ? 'btn-primary' : ''}`} onClick={() => { setTab(t); setState('idle') }}>
                {t === 'send' ? 'Send' : `Yours · ${mine.length}`}
              </button>
            ))}
            <button className="btn btn-ghost !px-2 !py-1" onClick={close} aria-label="Close">×</button>
          </div>
        </div>

        {tab === 'send' && typeof state === 'object' ? (
          <div className="py-4">
            <div className="label text-good">{state.queued ? '[..] saved' : '[ok] sent'}</div>
            <p className="mt-2 text-[13px]">{state.queued ? 'No connection right now. It is saved on this device and will be sent automatically.' : 'Thank you. It goes straight to the developer.'} You will see its status and any reply under <b>Yours</b>.</p>
            <div className="mt-4 flex gap-2"><button className="btn" onClick={() => setState('idle')}>Send another</button><button className="btn btn-primary" onClick={close}>Done</button></div>
          </div>
        ) : tab === 'send' ? (
          <>
            <div className="mb-2 flex gap-1.5" role="radiogroup" aria-label="Type">
              {FEEDBACK_KINDS.map((k) => <button key={k} role="radio" aria-checked={kind === k} className={`btn !px-3 !py-1.5 ${kind === k ? 'btn-primary' : ''}`} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}
            </div>
            <textarea ref={box} value={message} onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE))} rows={6} placeholder={PLACEHOLDER[kind]} aria-label="Your feedback"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() } }}
              className="w-full resize-y border border-line-strong bg-bg p-3 font-sans text-[14px] leading-relaxed outline-none placeholder:text-faint focus:border-accent" />
            <div className="mt-1 flex justify-between text-[11px] text-faint"><span>{message.length > MAX_MESSAGE * 0.8 ? `${message.length}/${MAX_MESSAGE}` : ''}</span><span>⌘↵ to send</span></div>
            <label className="mt-2 flex items-start gap-2 text-[12px] text-muted">
              <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
              <span>Attach technical details (page, current puzzle or game, screen size, browser, recent errors). No personal data beyond your account.
                {attach && ctx && <details className="mt-1"><summary className="cursor-pointer text-faint hover:text-ink">see exactly what is sent</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap border border-line p-2 text-[10px] text-faint">{JSON.stringify(ctx, null, 2)}</pre></details>}
              </span>
            </label>
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-[11px] text-faint">{app.auth === 'signedIn' ? `as ${app.me?.user?.name ?? 'you'}` : 'anonymous (guest)'}</span>
              <button className="btn btn-primary" disabled={!message.trim() || state === 'sending'} onClick={() => void submit()}>{state === 'sending' ? 'Sending…' : `Send ${KIND_LABEL[kind].toLowerCase()}`}</button>
            </div>
          </>
        ) : (
          <div className="min-h-0 overflow-y-auto">
            {mine.length === 0 ? <p className="py-6 text-[13px] text-muted">Nothing sent from this device yet.</p> : (
              <ul className="space-y-2">
                {mine.map((m) => (
                  <li key={m.id} className="border border-line p-3 text-[12px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="label">{KIND_LABEL[m.kind]} · {new Date(m.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                      <span className={`label ${m.status === 'done' ? 'text-good' : m.status === 'new' || !m.status ? 'text-faint' : 'text-accent'}`}>{m.label ?? 'Waiting to send'}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap font-sans text-[13px] text-muted">{m.message}</p>
                    {m.reply && <p className="mt-2 border-l-2 border-accent pl-2 font-sans text-[13px]"><span className="label mr-1">reply</span>{m.reply}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
