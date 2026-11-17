/** Explicit configuration. Anything ambiguous is a startup error, never a silent fallback. */
export class ConfigError extends Error {}

export interface Config {
  authMode: 'local' | 'google'
  port: number
  dbPath: string
  staticDir: string
  baseUrl: string
  allowedEmails: string[] | null // null = anyone who signs in
  google?: { clientId: string; clientSecret: string; secret: string }
  /** bearer token for /api/admin/* (agents, CLI); unset = admin API disabled (404) */
  adminToken?: string
  /** optional: mirror each feedback to a GitHub issue */
  github?: { token: string; repo: string }
}

function optional(env: Record<string, string | undefined>): Pick<Config, 'adminToken' | 'github'> {
  const adminToken = env.FEEDBACK_ADMIN_TOKEN || undefined
  if (adminToken && adminToken.length < 24) throw new ConfigError('FEEDBACK_ADMIN_TOKEN must be at least 24 characters (openssl rand -hex 24).')
  const token = env.GITHUB_TOKEN, repo = env.GITHUB_REPO
  if (!!token !== !!repo) throw new ConfigError('Set both GITHUB_TOKEN and GITHUB_REPO (owner/name) to mirror feedback to GitHub issues, or neither.')
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new ConfigError('GITHUB_REPO must look like owner/name.')
  return { adminToken, github: token && repo ? { token, repo } : undefined }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const mode = env.AUTH_MODE
  if (mode !== 'local' && mode !== 'google') {
    throw new ConfigError(`AUTH_MODE must be "local" or "google" (got ${mode === undefined ? 'nothing' : JSON.stringify(mode)}). It is never inferred.`)
  }
  const base = {
    authMode: mode,
    port: Number(env.PORT ?? 8080),
    dbPath: env.DB_PATH ?? './var/db/chess.sqlite',
    staticDir: env.STATIC_DIR ?? '../app/dist',
    baseUrl: env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT ?? 8080}`,
    allowedEmails: env.ALLOWED_EMAILS ? env.ALLOWED_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : null,
    ...optional(env),
  } satisfies Omit<Config, 'google'>
  if (mode === 'local') return base
  const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL'].filter((k) => !env[k])
  if (missing.length) {
    throw new ConfigError(`AUTH_MODE=google requires ${missing.join(', ')}. See README "Google sign-in". Refusing to start instead of falling back to local mode.`)
  }
  return { ...base, google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET!, secret: env.BETTER_AUTH_SECRET! } }
}
