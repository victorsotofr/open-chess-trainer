/** Last few runtime errors of this page load, attached to bug reports (with the user's consent). */
const MAX = 8
const recent: string[] = []
const push = (s: string) => { recent.push(`${new Date().toISOString().slice(11, 19)} ${s.replace(/\s+/g, ' ').slice(0, 300)}`); if (recent.length > MAX) recent.shift() }

export function installErrorLog() {
  addEventListener('error', (e) => push(`error: ${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`))
  addEventListener('unhandledrejection', (e) => push(`unhandled: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`))
  const orig = console.error.bind(console)
  console.error = (...a: unknown[]) => { push(`console: ${a.map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`); orig(...a) }
}
export const recentErrors = () => [...recent]
