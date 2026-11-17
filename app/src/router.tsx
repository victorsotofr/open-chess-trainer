import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import Shell from './app/Shell'
import Home from './views/Home'
import Learn from './views/Learn'
import Chapter from './views/Chapter'
import Session from './views/Session'
import Review from './views/Review'
import Stats from './views/Stats'
import About from './views/About'
import Play from './views/Play'
import Rush from './views/Rush'
import GameReview from './views/GameReview'

// Routes are declared one by one so their paths stay literal types (typed <Link to>).
const root = createRootRoute({ component: Shell })
const home = createRoute({ getParentRoute: () => root, path: '/', component: Home })
const learn = createRoute({ getParentRoute: () => root, path: '/learn', component: Learn })
const chapter = createRoute({ getParentRoute: () => root, path: '/learn/$chapter', component: Chapter })
const session = createRoute({ getParentRoute: () => root, path: '/session', component: Session })
const review = createRoute({ getParentRoute: () => root, path: '/review', component: Review })
const stats = createRoute({ getParentRoute: () => root, path: '/stats', component: Stats })
const about = createRoute({ getParentRoute: () => root, path: '/about', component: About })
const play = createRoute({ getParentRoute: () => root, path: '/play', component: Play })
const playReview = createRoute({ getParentRoute: () => root, path: '/play/$gameId', component: GameReview })
const rush = createRoute({ getParentRoute: () => root, path: '/rush', component: Rush })

export const routeTree = root.addChildren([home, learn, chapter, session, review, stats, about, play, playReview, rush])
function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-xl panel p-6">
      <div className="label mb-2">Something broke</div>
      <p className="font-mono text-[12px] text-bad">[x] {error instanceof Error ? error.message : String(error)}</p>
      <p className="mt-2 text-[12px] text-muted">Your progress is saved. Try again, or go back home.</p>
      <div className="mt-4 flex gap-2"><button className="btn btn-primary" onClick={reset}>Try again</button><a className="btn" href="/">Home</a></div>
    </div>
  )
}

export const router = createRouter({ routeTree, defaultPreload: 'intent', defaultErrorComponent: RouteError })

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
