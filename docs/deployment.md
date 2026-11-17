# Deployment

Railway runs one container for the React frontend, Hono API, Google sign-in and feedback. Stockfish runs in the visitor's browser. SQLite holds progress and feedback on a persistent volume. A separate frontend host is unnecessary.

## Refresh the local container

From the repository root, with Docker running:

```sh
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:8090/api/health
```

Compose passes `GITHUB_TOKEN`, `GITHUB_REPO` and `FEEDBACK_ADMIN_TOKEN` from the ignored `.env` file. Recreating the container loads changed variables and keeps the named database volume. Do not run `docker compose down -v`: that removes the progress database volume.

Check the configuration from `server/`:

```sh
npm run preflight
```

Use `npm run preflight -- --offline` to check configuration without network requests. The online check only reads GitHub repository metadata and the issues endpoint; it cannot prove write access. The fine-grained token needs **Issues: read and write** on the selected repository. No test issue is created.

Existing feedback is not automatically backfilled when GitHub is enabled. Inspect reports with `npm run feedback -- list` before choosing to run `npm run feedback -- mirror`. That command sends reports without an issue to GitHub. Status changes flow from the app's admin CLI to GitHub; editing an issue directly does not update the tester's status in the app.

## Railway setup

1. Create a Railway project from the GitHub repository. Use the repository root so Railway finds `Dockerfile`, `app/`, `server/` and `shared/`. The existing Dockerfile builds the frontend and starts the API; leave the build and start command overrides empty.
2. Attach **one persistent volume at `/data`**. The image stores its database at `/data/db/chess.sqlite`.
3. Set the variables below in Railway, then generate a public domain. Add that HTTPS domain to the Google OAuth client's authorized origins and add `https://YOUR-DOMAIN/api/auth/callback/google` as an authorized redirect URI. Set `BETTER_AUTH_URL` to that same origin.
4. Configure the service healthcheck to `/api/health`, with a 120-second timeout, and keep a single replica. Use the failure restart policy. Volume-backed services briefly stop during redeployments; enable volume backups before keeping important progress there.
5. Deploy, then verify Learn, Play, Google sign-in and Feedback. Do not copy the local `.env` into the image or repository: Railway variables are runtime secrets.

| Variable | Value |
| --- | --- |
| `AUTH_MODE` | `google` — local mode shares one user and is for personal local installs |
| `PORT` | `8080` |
| `BETTER_AUTH_URL` | The public HTTPS origin, without a path |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `BETTER_AUTH_SECRET` | A stable production secret; keep it across redeployments |
| `FEEDBACK_ADMIN_TOKEN` | The admin CLI secret |
| `GITHUB_TOKEN`, `GITHUB_REPO` | GitHub issue token and `owner/repo` |
| `ALLOWED_EMAILS` | Empty for a public beta (anyone can sign in), or a list of testers |
| `RAILWAY_RUN_UID` | `0` for the initial setup: Railway volumes can be root-owned, whereas the image defaults to the `node` user |

For a non-root runtime, initialize the volume ownership for UID 1000 before removing `RAILWAY_RUN_UID` and redeploying. Changing ownership in the Dockerfile alone cannot fix a newly mounted volume that hides those image directories.

The repository does not yet contain Railway project IDs or a linked deployment. A GitHub token for feedback does not authenticate the Railway CLI; deployment needs a Railway account/project connection as well.

## Check production variables

```sh
cd server
npm run preflight -- --hosted
```

The command reads the repository `.env`, overridden by environment variables. Run it with the intended production environment; a local `.env` with a localhost URL should fail the hosted check.

## Verify the hosted instance

- `/api/health` returns `{"ok":true}` and the homepage loads.
- Play starts without sign-in; Google sign-in returns to the public URL.
- Learn loads the puzzle pack without sign-in; signed-out progress requests return 401.
- A real feedback report appears in the admin CLI; a reply and status change through the CLI appear in the app. (GitHub mirroring stays off until reports have been reviewed.)
- A completed puzzle or game remains after a redeploy. Verify existing progress is preserved before treating the volume/backup setup as finished.

## Why Railway rather than Vercel here?

Vercel offers Git-based preview deployments and backend functions. It is a useful fit for frontend-focused apps and frameworks such as Next.js. Its function filesystem is not durable SQLite storage. This project already uses a long-running Node server and a local database file, so a Railway container and volume preserve its architecture and keep frontend/API on one origin.

References: [Railway Docker deployments](https://docs.railway.com/deployments/reference), [Railway volumes and permissions](https://docs.railway.com/volumes/reference), [Vercel deployments](https://vercel.com/docs/deployments), [Vercel function runtimes](https://vercel.com/docs/functions/runtimes).
