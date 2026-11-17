import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigError, loadConfig, type Config } from './config'
import { openDb, type DB } from './db'
import { createApp, type ResolveUser } from './app'
import { github } from './github'

async function googleAuth(config: Config, db: DB) {
  const { betterAuth } = await import('better-auth')
  const { getMigrations } = await import('better-auth/db/migration')
  const options = {
    database: db,
    secret: config.google!.secret,
    baseURL: config.baseUrl,
    socialProviders: { google: { clientId: config.google!.clientId, clientSecret: config.google!.clientSecret } },
    // own cookie names: other apps may run on the same host (127.0.0.1)
    advanced: { cookiePrefix: 'oct' },
  }
  const auth = betterAuth(options)
  const { runMigrations } = await getMigrations(options)
  await runMigrations()
  const resolveUser: ResolveUser = async (req) => {
    const s = await auth.api.getSession({ headers: req.headers })
    return s ? { id: s.user.id, email: s.user.email, name: s.user.name } : null
  }
  return { resolveUser, authHandler: (req: Request) => auth.handler(req) }
}

async function main() {
  let config: Config
  try {
    config = loadConfig(process.env)
  } catch (e) {
    if (e instanceof ConfigError) { console.error(`[config] ${e.message}`); process.exit(78) } // EX_CONFIG
    throw e
  }
  const db = openDb(config.dbPath)
  const auth = config.authMode === 'google'
    ? await googleAuth(config, db)
    : { resolveUser: (async () => ({ id: 'local', email: null, name: 'Local player' })) as ResolveUser, authHandler: undefined }
  const app = createApp({ config, db, ...auth, gh: config.github ? github(config.github) : undefined })

  // built client + SPA fallback (includes the public puzzle pack under /data)
  if (existsSync(config.staticDir)) {
    app.use('/*', serveStatic({ root: config.staticDir }))
    const index = readFileSync(join(config.staticDir, 'index.html'), 'utf8')
    app.get('*', (c) => (c.req.path.startsWith('/api/') || c.req.path.startsWith('/data/') ? c.json({ error: 'not found' }, 404) : c.html(index)))
  }
  serve({ fetch: app.fetch, port: config.port }, () =>
    console.log(`open-chess-trainer on :${config.port} · auth=${config.authMode} · db ${config.dbPath} · feedback admin ${config.adminToken ? 'on' : 'off'}${config.github ? ` · GitHub mirror → ${config.github.repo}` : ''}`))
}

void main()
