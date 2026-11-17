/**
 * Optional GitHub mirror for feedback: one issue per report, labelled `feedback` + kind.
 * The app database stays the source of truth; GitHub is where you (and coding agents) work.
 * The reporter's email is never sent to GitHub.
 */
import { CLOSED_STATUSES, FEEDBACK_STATUS, feedbackMarkdown, feedbackTitle, type FeedbackItem } from '../../shared/feedback'

export interface GitHub {
  createIssue(f: FeedbackItem): Promise<string>
  /** comment the reply (if any), relabel the status, close/reopen */
  updateIssue(f: FeedbackItem & { issueUrl: string }, newReply: boolean): Promise<void>
}

export function github(cfg: { token: string; repo: string }, fetchImpl: typeof fetch = fetch): GitHub {
  const api = async (path: string, init: RequestInit = {}) => {
    const r = await fetchImpl(`https://api.github.com/repos/${cfg.repo}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${cfg.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json', 'user-agent': 'open-chess-trainer-feedback' },
    })
    if (!r.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path} → ${r.status} ${(await r.text()).slice(0, 200)}`)
    return r.json() as Promise<Record<string, unknown>>
  }
  const issueNumber = (url: string) => url.split('/').pop()
  return {
    async createIssue(f) {
      const body = `${feedbackMarkdown(f)}\n\n---\n_Sent from the in-app feedback form. Update it with \`npm run feedback -- set ${f.id} --status <status> --reply "…"\` (see .agents/skills/feedback-loop)._`
      const issue = await api('/issues', { method: 'POST', body: JSON.stringify({ title: feedbackTitle(f), body, labels: ['feedback', f.kind] }) })
      return String(issue.html_url)
    },
    async updateIssue(f, newReply) {
      const n = issueNumber(f.issueUrl), status = f.status, reply = f.reply
      if (reply && newReply) await api(`/issues/${n}/comments`, { method: 'POST', body: JSON.stringify({ body: `**Reply to the reporter** (${FEEDBACK_STATUS[status]}):\n\n${reply}` }) })
      const closed = CLOSED_STATUSES.includes(status)
      await api(`/issues/${n}`, { method: 'PATCH', body: JSON.stringify({ state: closed ? 'closed' : 'open', state_reason: closed ? (status === 'done' ? 'completed' : 'not_planned') : undefined }) })
      await api(`/issues/${n}/labels`, { method: 'PUT', body: JSON.stringify({ labels: ['feedback', f.kind, `status:${status}`] }) }).catch(() => {})
    },
  }
}
