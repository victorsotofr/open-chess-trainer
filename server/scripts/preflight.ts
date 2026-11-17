import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { loadConfig } from '../src/config'

async function main() {
  const flags = new Set(process.argv.slice(2))
  for (const flag of flags) {
    if (!['--hosted', '--offline'].includes(flag)) throw new Error(`Unknown option: ${flag}`)
  }
  const file = join(import.meta.dirname, '..', '..', '.env')
  const env = { ...(existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}), ...process.env }
  const config = loadConfig(env)

  if (flags.has('--hosted')) {
    if (config.authMode !== 'google') throw new Error('Hosted installs require AUTH_MODE=google; local mode shares one user.')
    const url = new URL(config.baseUrl)
    if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('Set BETTER_AUTH_URL to the public HTTPS URL before deploying.')
    }
  }
  console.log(`Configuration valid; auth=${config.authMode}; feedback admin=${config.adminToken ? 'enabled' : 'disabled'}.`)
  if (!config.github) {
    console.log('GitHub mirror is disabled.')
    return
  }
  if (flags.has('--offline')) {
    console.log('GitHub mirror is configured; token access was not checked (--offline).')
    return
  }

  // Read-only checks: never create a test issue or copy feedback into GitHub.
  const headers = {
    authorization: `Bearer ${config.github.token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'open-chess-trainer-preflight',
  }
  const base = `https://api.github.com/repos/${config.github.repo}`
  const get = async (path: string) => {
    let response: Response
    try {
      response = await fetch(base + path, { headers, signal: AbortSignal.timeout(15_000) })
    } catch {
      throw new Error('GitHub could not be reached; token access remains unverified.')
    }
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}; check the token, repository and permissions.`)
    return response
  }
  const repo = await (await get('')).json() as { has_issues?: boolean }
  if (!repo.has_issues) throw new Error('Enable Issues in the GitHub repository settings.')
  await get('/issues?state=all&per_page=1')
  console.log('GitHub repository and issues are readable. Creating and updating issues still requires Issues: read and write on the token.')
}

void main().catch((error: unknown) => {
  console.error(`[preflight] ${error instanceof Error ? error.message : 'Check failed.'}`)
  process.exitCode = 1
})
