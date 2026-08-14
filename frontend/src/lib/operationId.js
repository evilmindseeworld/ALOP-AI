/**
 * The id that ties one turn together across the client, the server and the log.
 *
 * WHY THE CLIENT MINTS IT. The server already minted a request id per request
 * and now echoes it, which is enough to find one request in a log. It is not
 * enough to answer the question anyone actually asks about a failure — "what
 * happened on this TURN" — because a turn can be more than one request: an
 * error, a retry, and whatever the user pressed next all get different
 * server-side ids and nothing joins them. An id minted here and sent as
 * `X-Operation-Id` is stable across those, and the server validates it as a
 * UUID before echoing it anywhere, so it cannot be used to inject into a log.
 */

/**
 * `crypto.randomUUID` needs a secure context. That covers production and
 * `localhost`, but not a LAN-address dev server or an http preview — and a
 * missing id must degrade to a worse id, never to a thrown TypeError inside the
 * send path. The fallback is not cryptographically strong and does not need to
 * be: this is a correlation handle, not a secret or a capability.
 */
export function newOperationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const hex = (n) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  // Version 4, variant 8-b, so it satisfies the server's UUID check.
  const variant = "89ab"[Math.floor(Math.random() * 4)];
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}

/**
 * Attach the id (and the server's machine code, when there is one) to an error
 * without changing its message.
 *
 * Deliberately mutating the error rather than wrapping it: every existing
 * `catch` reads `e.message`, and a wrapper would either lose that or duplicate
 * it into a message the user reads.
 */
export function withOperationId(error, operationId, code) {
  if (error && operationId) error.operationId = operationId;
  if (error && code) error.code = code;
  return error;
}

/** The short form to show a user, e.g. `4f3a91c2`. The full id is in the logs. */
export function shortOperationId(operationId) {
  return typeof operationId === "string" && operationId.length >= 8 ? operationId.slice(0, 8) : "";
}
