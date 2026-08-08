import { Component } from "react";
import * as Sentry from "@sentry/react";

/**
 * The screen that appears instead of a white page.
 *
 * A thrown render error in React unmounts the ENTIRE tree. Without a boundary
 * the user is left looking at an empty document with no message, no way back,
 * and nothing in any log — @sentry/react was a dependency of this app and was
 * never initialised, so front-end crashes have been invisible.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not offer to "retry" the render.
 * A component that threw on this state will throw again on the same state, so
 * a retry button that re-renders the same tree is a button that does nothing
 * twice. Reload re-runs the app from a clean state, and Start a new chat
 * escapes a single poisoned conversation without discarding the others.
 *
 * THE ERROR TEXT IS SHOWN. Not a stack — a stack is noise to a user and can
 * leak internals — but the message and the Sentry event id, so a support
 * request carries something findable instead of "it broke".
 */
export default class ErrorBoundary extends Component {
  state = { error: null, eventId: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // captureException returns the id even when no DSN is configured; it is
    // only useful to a user when one is, so it is rendered conditionally.
    const eventId = Sentry.captureException(error, {
      contexts: { react: { componentStack: info?.componentStack } },
    });
    this.setState({ eventId });
    console.error("[ErrorBoundary]", error);
  }

  render() {
    const { error, eventId } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash-root" role="alert">
        <div className="crash-card">
          <h1 className="crash-title">Something broke on our side.</h1>
          <p className="crash-body">
            This screen failed to draw. Your chats are saved on the server and were not
            affected, so reloading is safe.
          </p>
          <p className="crash-detail">{String(error?.message || error)}</p>
          <div className="crash-actions">
            <button className="crash-btn primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button className="crash-btn" onClick={() => { window.location.href = "/"; }}>
              Start a new chat
            </button>
          </div>
          {eventId && Sentry.getClient() ? (
            <p className="crash-ref">
              Reference <code>{eventId}</code>. Quote this if you contact support.
            </p>
          ) : null}
        </div>
      </div>
    );
  }
}
