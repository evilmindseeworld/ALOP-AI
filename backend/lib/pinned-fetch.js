'use strict';

const http = require('node:http');
const https = require('node:https');
const { Readable } = require('node:stream');

/**
 * A GET THAT CONNECTS TO THE ADDRESS WE VETTED, NOT THE ONE DNS FEELS LIKE
 * RETURNING A MOMENT LATER.
 *
 * `assertSafeUrl` resolves a hostname, refuses it if any of its addresses is
 * private or reserved, and returns the address it approved. The caller then
 * called `fetch(url)`, which RESOLVES THE NAME AGAIN. Between those two
 * resolutions the answer can change, and an attacker who controls the zone can
 * make it change on purpose: publish a public address with a one-second TTL,
 * pass the check, then answer 127.0.0.1 or 169.254.169.254 for the fetch. That
 * is DNS rebinding, and it defeats a check that is otherwise correct — sol's
 * review, 2026-08-13.
 *
 * Node's global `fetch` has no hook for this. It takes no `lookup` and no
 * dispatcher without the undici package, which is not installed here. The
 * `node:https` request does take `lookup`, so this pins it: the vetted address
 * is handed straight back to the connector and the name is never resolved a
 * second time.
 *
 * WHAT MUST SURVIVE THE PIN, and each of these breaks a real site if it does
 * not:
 *   - `Host` stays the hostname. Every virtual host on a shared address serves
 *     the wrong site, or a 404, without it. `node:https` derives it from the
 *     URL, so passing the URL rather than the address is what keeps it right.
 *   - TLS SNI stays the hostname (`servername`), or the handshake gets a
 *     certificate for the wrong name and fails — which would look exactly like
 *     "this site is broken" rather than "we pinned it wrong".
 *   - Certificate verification stays ON. Pinning the address is not a reason to
 *     stop checking who answered.
 *
 * The response is shaped like the `fetch` Response the callers already read —
 * `status`, `headers.get()`, a web `body` — so the reading code above it did
 * not have to change to gain this.
 */

/** Redirects are followed by the CALLER, which re-validates each hop. */
const NO_REDIRECT = { redirect: 'manual' };

const pinnedFetch = (url, { address, family, signal, headers = {} } = {}) => {
  const target = typeof url === 'string' ? new URL(url) : url;
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return Promise.reject(new Error(`pinnedFetch: unsupported scheme ${target.protocol}`));
  }
  if (!address) return Promise.reject(new Error('pinnedFetch: no vetted address given'));

  const transport = target.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      target,
      {
        method: 'GET',
        headers,
        // A pooled same-origin socket may have been opened for a different
        // vetted address; reuse would bypass `lookup` and defeat the pin.
        // This reader is small and bounded, so make every request connect
        // afresh through the lookup below.
        agent: false,
        // SNI, explicitly. It defaults to the hostname, but the default is the
        // thing that would silently change if someone passed the address here.
        servername: target.hostname,
        signal,
        /* THE PIN. Every connection attempt for this request resolves to the
         * address that passed the guard. `all` is honoured because net.connect
         * asks both ways depending on the options it was given, and answering
         * the wrong shape throws inside the connector where it reads as a
         * network error rather than a bug here. */
        lookup: (hostname, options, callback) => {
          const fam = family === 6 || family === 4 ? family : 4;
          if (options && options.all) return callback(null, [{ address, family: fam }]);
          return callback(null, address, fam);
        },
      },
      (res) => {
        resolve({
          status: res.statusCode,
          headers: { get: (name) => res.headers[String(name).toLowerCase()] ?? null },
          body: Readable.toWeb(res),
          // Empty for the same reason a manual-redirect fetch Response is
          // empty: the caller's last validated URL is the final URL.
          url: '',
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
};

module.exports = { pinnedFetch, NO_REDIRECT };
