/**
 * In-app feedback: the contract shared by the app (sends), the server (stores, mirrors to GitHub)
 * and the admin CLI (agents triage, reply, close). Versioned like the other durable formats.
 */
export const FEEDBACK_KINDS = ['bug', 'idea', 'other'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

/** Lifecycle, as the reporter sees it (label) and as agents set it (key). */
export const FEEDBACK_STATUS = {
  new: 'Received',
  triaged: 'Seen',
  planned: 'Planned',
  in_progress: 'In progress',
  done: 'Done',
  wontfix: 'Not planned',
  duplicate: 'Duplicate',
} as const
export type FeedbackStatus = keyof typeof FEEDBACK_STATUS
export const isFeedbackStatus = (s: unknown): s is FeedbackStatus => typeof s === 'string' && s in FEEDBACK_STATUS
/** Statuses that end the loop (the GitHub mirror closes the issue). */
export const CLOSED_STATUSES: FeedbackStatus[] = ['done', 'wontfix', 'duplicate']

/** Attached automatically (the user can untick it). Never contains book content or progress data. */
export interface FeedbackContext {
  route: string
  puzzleId?: string | null
  runKind?: string | null
  gameId?: string | null
  build: string
  viewport: string
  userAgent: string
  theme: string
  auth: string
  /** last few runtime errors on this page load, newest last */
  errors: string[]
}

export interface FeedbackInput {
  schemaVersion: 1
  id: string // client-generated UUID: retries are idempotent
  kind: FeedbackKind
  message: string
  context: FeedbackContext | null
  createdAt: string
}

export interface FeedbackItem extends FeedbackInput {
  status: FeedbackStatus
  reply: string | null // shown to the reporter in the app
  issueUrl: string | null
  updatedAt: string
  user: { id: string; email: string | null; name: string } | null // admin view only
}

export const MAX_MESSAGE = 4000
export const MAX_CONTEXT_BYTES = 8000

/** null when valid, else a short reason (400). */
export function validateFeedback(x: unknown): string | null {
  const f = x as Partial<FeedbackInput>
  if (!f || typeof f !== 'object') return 'body must be an object'
  if (f.schemaVersion !== 1) return 'unsupported schemaVersion'
  if (typeof f.id !== 'string' || !/^[0-9a-f-]{16,64}$/i.test(f.id)) return 'id must be a UUID'
  if (!FEEDBACK_KINDS.includes(f.kind as FeedbackKind)) return `kind must be one of ${FEEDBACK_KINDS.join(', ')}`
  if (typeof f.message !== 'string' || !f.message.trim()) return 'message is empty'
  if (f.message.length > MAX_MESSAGE) return `message is longer than ${MAX_MESSAGE} characters`
  if (typeof f.createdAt !== 'string' || Number.isNaN(Date.parse(f.createdAt))) return 'createdAt must be an ISO date'
  if (f.context !== null && (typeof f.context !== 'object' || JSON.stringify(f.context).length > MAX_CONTEXT_BYTES)) return 'context too large'
  return null
}

/** One-line title for lists and GitHub issues. */
export function feedbackTitle(f: Pick<FeedbackInput, 'kind' | 'message'>) {
  const line = f.message.trim().split('\n')[0].replace(/\s+/g, ' ')
  return `[${f.kind}] ${line.length > 72 ? line.slice(0, 71) + '…' : line}`
}

/** Markdown an agent can act on directly: the report, its context, and how to close the loop. */
export function feedbackMarkdown(f: FeedbackItem | FeedbackInput, opts: { includeReporter?: boolean } = {}) {
  const it = f as Partial<FeedbackItem>
  const c = f.context
  const rows: [string, string | number | null | undefined][] = c ? [
    ['page', c.route], ['puzzle', c.puzzleId], ['run', c.runKind], ['game', c.gameId], ['build', c.build],
    ['viewport', c.viewport], ['theme', c.theme], ['auth', c.auth], ['browser', c.userAgent],
  ] : []
  return [
    `**${f.kind}** · ${f.createdAt.slice(0, 16).replace('T', ' ')} UTC${it.status ? ` · status \`${it.status}\`` : ''}`,
    '',
    f.message.split('\n').map((l) => `> ${l}`).join('\n'),
    '',
    c ? ['| context | |', '|---|---|', ...rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, '\\|')} |`)].join('\n') : '_No technical details attached._',
    c?.errors.length ? `\nRecent errors:\n\`\`\`\n${c.errors.join('\n')}\n\`\`\`` : '',
    opts.includeReporter && it.user ? `\nReporter: ${it.user.name}${it.user.email ? ` <${it.user.email}>` : ''}` : '',
    it.reply ? `\nReply shown to the reporter: ${it.reply}` : '',
    `\nFeedback id: \`${f.id}\``,
  ].filter((s) => s !== '').join('\n')
}
