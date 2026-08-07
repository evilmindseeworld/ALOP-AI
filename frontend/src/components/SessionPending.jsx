/**
 * A signed-in user whose session the app cannot actually use.
 *
 * Clerk marks a session `pending` when it requires a task to be completed
 * before it counts as active — organization selection is the one that bit us.
 * A pending session has a USER but no usable auth: `useAuth()` reports
 * `isSignedIn: false` and `userId: null`, while `useUser()` reports
 * `isSignedIn: true` because a user object exists.
 *
 * This app asked one hook at the gate and the other inside, so it rendered
 * the application shell for a session that could never load anything. The
 * skeleton stayed up forever with no error and nothing to click.
 *
 * The instance setting is the real cure. This screen exists so that the whole
 * CLASS of failure — any future reason a session is pending, including tasks
 * Clerk has not shipped yet — produces something a user can read and act on
 * rather than a spinner that never stops.
 */
export default function SessionPending({ task, onSignOut }) {
  return (
    <div className="signin-root">
      <div className="signin-down" role="alert">
        <h1 className="signin-down-title">Your session needs one more step.</h1>
        <p className="signin-down-body">
          You&rsquo;re signed in, but your account provider is holding the session until a
          required step is finished &mdash; and this app has no screen for it. Nothing is wrong
          with your account and no data has been lost.
        </p>
        {/* The key VERBATIM, not translated into prose. An unrecognised task
            has to leave something searchable behind; a friendly sentence that
            hides which task is blocking is how this took days to find. */}
        {task?.key ? (
          <p className="signin-down-body">
            Required step: <code>{task.key}</code>
          </p>
        ) : null}
        <p className="signin-down-body">
          If you administer this deployment: this is Clerk&rsquo;s{" "}
          <code>force_organization_selection</code>, and this application has no organization
          concept. Turn it off in the Clerk dashboard.
        </p>
        <button className="signin-down-retry" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
