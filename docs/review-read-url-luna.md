# Adversarial review: `09fa8ef`

Reviewed the complete commit with `git show 09fa8ef`, the current
`backend/lib/read-url.js`, `backend/lib/pinned-fetch.js`,
`backend/lib/url-guard.js`, the two `server.js` registry call sites, and the
registry/test changes. `COUNCIL_TOOLS=1` reaches the live registry at
`backend/server.js:3092-3152`; the shadow registry at `2778-2787` uses the same
reader.

The backend test command completed with 1009 passing tests. I also ran direct
runtime probes for Unicode limits, EOF/truncation, post-response abort, and
Node's HTTP agent reuse.

## Findings

### 1. High — the transport can reuse a socket that is not pinned to the current hop

**File:** `backend/lib/pinned-fetch.js:55-73`

**Reachability:** production-reachable whenever Node's global HTTP agent has
keep-alive enabled (the current runtime reports
`http.globalAgent.options.keepAlive === true`). This can occur across two
`read_url` calls for the same hostname/port, and is also possible between
same-origin hops if the prior response leaves a reusable socket.

**Concrete failing input:** two sequential requests for
`http://same.example:443/`, where the first guard result is
`{ address: "203.0.113.10", family: 4 }` and the second guard result is
`{ address: "203.0.113.11", family: 4 }`. `pinnedFetch` receives the second
address, but `http.request()` uses the implicit global agent and can reuse the
socket connected to .10 without calling the supplied `lookup` callback.
The runtime probe sent both requests to server A even though the second call
was pinned to server B.

This violates the stated property that every connection is made to the exact
address validated for that request. The current guard still rejects a private
address returned by the second lookup, so this probe is not by itself a new
private-address bypass; it is a real pinning failure for rotating public
addresses and can also inherit an unsafe socket if another HTTP caller has
poisoned the shared agent pool.

**Why tests miss it:** `pinned-fetch.test.js:19-37` makes one request only,
and the rebinding test in `read-url.test.js:61-95` replaces the transport with
a test wrapper. No test makes two same-origin requests with different vetted
addresses or checks that lookup runs for each connection.

**Smallest fix:** disable pooling for this transport (`agent: false`) or use a
dedicated agent whose pool key includes the vetted address. The former is the
smallest safe change for this small, bounded reader.

### 2. Medium — private/reserved resolved addresses are disclosed to the model

**Files:** `backend/lib/url-guard.js:172-175`,
`backend/lib/read-url.js:67-68`, `backend/lib/tool-registry.js:193-198` and
`372`

**Reachability:** production-reachable with `COUNCIL_TOOLS=1`.

**Concrete failing input:** a search result for
`https://public.example/page` whose DNS resolves to `169.254.169.254`, or a
public page returning `302 Location: http://127.0.0.1/`. The guard throws a
message containing the exact resolved address, such as
`"public.example" resolves to 169.254.169.254, which is a private or reserved
address.` The registry returns that exception text in the tool result that is
fed back to the council.

**Why tests miss it:** `read-url.test.js:43-59` checks only that rejection
occurs. The registry blocked-URL test at `tool-registry.test.js:247-257` uses
an ID that is not a search result, so it never reaches the model-facing
guard-error branch and does not assert that sensitive address text is absent.

**Smallest fix:** make model-facing `UrlBlocked` messages generic (for
example, `That URL resolves to a private or reserved address.`), while
retaining the detailed address only in server-side diagnostics; apply the same
redaction to resolver-error details if they can contain address data.

### 3. Medium — `maxRedirects: 5` bounds redirect edges, not five fetch hops

**File:** `backend/lib/read-url.js:41, 62-70`

**Reachability:** production-reachable from any search result with a redirect
chain when `COUNCIL_TOOLS=1`.

**Concrete failing input:** `/0` responds with `302 Location: /1`, `/1`
with `/2`, and so on. With `maxRedirects: 5`, the implementation connects
to `/0`, `/1`, `/2`, `/3`, `/4`, and `/5` (six HTTP requests), then
rejects only when the `/5` response itself contains another `Location`.
Thus exactly five redirects permits six URL hops; a sixth redirect response
has already caused a sixth connection before rejection.

**Why tests miss it:** `read-url.test.js:147-162` encodes the current
behavior and explicitly expects `hits === 6`. That verifies “five redirects
after the initial request,” not the stated “cap hops at five.”

**Smallest fix:** count the initial request as hop one and reject before
issuing request six, or rename/document the contract as “five redirects plus
the initial request” if that larger bound is intentional.

### 4. Medium — the character ceiling is UTF-16 code units and can split text

**File:** `backend/lib/read-url.js:82-92`

**Reachability:** production-reachable for pages containing non-BMP Unicode.

**Concrete failing input:** a response body of `😀😀` with `maxChars: 1`
returns the single high surrogate `"\\uD83D"`, not one complete character.
With the production limit, a body of 16,000 emoji is cut to 8,000 emoji plus a
possible broken surrogate. `TextDecoder.decode(value, { stream: true })`
correctly preserves UTF-8 sequences split across chunks; the defect is the
subsequent use of JavaScript string `.length` and `.slice()`.

**Why tests miss it:** `read-url.test.js:97-124` uses only ASCII `x` chunks,
so bytes, Unicode scalar values, UTF-16 units, and visible characters all
have the same count.

**Smallest fix:** count Unicode code points and slice at code-point
boundaries, e.g. use `Array.from(body)` (or an equivalent incremental
code-point-safe accumulator) for the ceiling. Keep the streaming
`TextDecoder`; it is the correct byte-boundary mechanism.

### 5. Low — `truncated` is true when the stream ends exactly at the limit

**File:** `backend/lib/read-url.js:88-97`

**Reachability:** production-reachable for a response whose decoded body is
exactly 16,000 counted units; the current registry does not expose the flag,
but `readUrl`'s declared return contract does.

**Concrete failing input:** a response containing exactly `"x".repeat(64)`
with `maxChars: 64`, delivered in one non-final `ReadableStream` chunk. The
reader sees `done === false`, immediately sets `truncated = true`, cancels,
and never performs the read that would establish EOF. The full body was
already received.

**Why tests miss it:** `read-url.test.js:97-124` tests only a body larger than
the limit and expects cancellation. There is no exact-boundary body that ends
without additional content.

**Smallest fix:** when the limit is reached, retain enough state to determine
whether another decoded character exists (or perform one bounded read before
setting `truncated`); only cancel and report `true` when content remains.

## Explicitly checked and not findings

- The production registry calls `assertSafeUrl` before `readUrl`, passes the
  returned `{ url, address, family }`, and supplies the guard again for every
  redirect. `pinnedFetch` passes that address to `lookup`, preserves the URL
  hostname for Host/SNI, and has no retry loop of its own. The keep-alive issue
  above is the exception: the implicit agent can bypass the lookup callback by
  reusing an existing socket.
- Relative and protocol-relative `Location` values are resolved by
  `new URL(location, vetted.url)`. Non-HTTP(S) targets reach the guard and are
  rejected; malformed targets throw; a `Location` on a non-3xx is ignored; a
  3xx without `Location` is treated as the terminal response. I ran probes for
  each of these shapes.
- The stream is actually cancelled at the character ceiling. A post-response
  abort also propagated through `signal` to the Node request: the server saw
  the response body close and the reader rejected with `ECONNRESET`.
- `isVettedTarget` is structural, so a direct caller could forge
  `{ url: new URL('https://x/'), address: '127.0.0.1', family: 4 }` and skip
  validation. That is an API hardening gap, but it is not reachable from the
  current production call graph: the only two callers inject the real
  `readUrl`, and `tool-registry.js:193-209` obtains `safe` from the real
  `assertSafeUrl` before calling it. A private brand/non-exported entry point
  would harden this boundary without revalidating the initial URL and reopening
  the DNS race.

