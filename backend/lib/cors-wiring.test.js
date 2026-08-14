'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/* server.js exits when required environment is absent, so assert the route
 * wiring at the source seam used by the other server integration contracts. */
const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

test('CORS preflight permits the operation correlation header', () => {
  const corsStart = SOURCE.indexOf('app.use(cors(');
  const corsEnd = SOURCE.indexOf('// The options moved to lib/security-headers.js', corsStart);
  assert.notEqual(corsStart, -1, 'CORS middleware mount is missing');
  assert.notEqual(corsEnd, -1, 'CORS middleware boundary is missing');

  const corsConfig = SOURCE.slice(corsStart, corsEnd);
  assert.match(
    corsConfig,
    /allowedHeaders:\s*\[[^\]]*['"]X-Operation-Id['"][^\]]*\]/,
    'the frontend correlation header must be allowed by the CORS preflight',
  );
});
