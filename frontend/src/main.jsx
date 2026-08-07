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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
