import React from 'react';
import * as Sentry from '@sentry/react';
import ReactDOM from 'react-dom/client';
// Tailwind first, and it stays first. Its utilities live in @layer, and
// unlayered CSS always outranks layered CSS regardless of import order — so
// App.css wins any conflict by construction. That is deliberate: Tailwind is
// available for new components without being able to disturb existing ones.
import './tailwind.css';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { warmBackend } from './lib/api';

// BEFORE React renders, not inside an effect. The backend takes 22.5s to boot
// from cold and 0.21s warm; the only lever we have is starting that boot during
// the dead time the user spends loading Clerk and typing their password, rather
// than after it. Every millisecond earlier this fires is a millisecond off the
// wait. It is fire-and-forget and cannot fail the app — see warmBackend.
warmBackend();

/* @sentry/react was a dependency of this app and was never initialised, so a
 * front-end crash produced nothing anywhere: no screen for the user and no
 * event for us. Gated on the DSN because a build without one must not ship a
 * transport that quietly does nothing — with no DSN, Sentry.getClient() is
 * undefined and the crash screen omits the reference id rather than printing
 * one nobody can look up.
 *
 * sendDefaultPii stays FALSE. This app carries private conversations, and an
 * error report is not consent to collect them. */
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    sendDefaultPii: false,
  });
}

/* The annotation toolbar, and it must never reach production.
 *
 * `import.meta.env.DEV` is replaced with the literal `false` at build time, so
 * this ternary folds to `null` and Rollup drops the dynamic import with it —
 * agentation is a devDependency and a prod bundle that referenced it would
 * fail to build the moment a deploy installed with --omit=dev. A plain
 * top-level import would NOT be dropped; the laziness here is load-bearing.
 *
 * The endpoint is Agent Sync: the toolbar posts annotations to the local
 * agentation-mcp server, which is what lets the agent read them as tool calls
 * instead of the user pasting markdown. With the server down the toolbar still
 * works and still copies to the clipboard, so this cannot break `npm run dev`. */
const Agentation = import.meta.env.DEV
  ? React.lazy(() => import('agentation').then((m) => ({ default: m.Agentation })))
  : null;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    {Agentation && (
      /* Outside the ErrorBoundary on purpose. A dev tool that crashes must not
         take down the app it is being used to inspect, and the boundary's job
         is to report product failures — not to swallow a toolbar's. */
      <React.Suspense fallback={null}>
        <Agentation endpoint="http://localhost:4747" />
      </React.Suspense>
    )}
  </React.StrictMode>
);
