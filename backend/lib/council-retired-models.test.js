'use strict';

/**
 * A MODEL ID THAT NO PROVIDER SERVES MUST NOT SIT IN THE ROSTER.
 *
 * On 2026-08-19 seat one of a real council turn was
 * `inclusionai/ling-3.0-tiny:free` and it answered HTTP 404 in 38ms. Nothing at
 * runtime can fix that: the pacer's breaker opens after enough failures and
 * closes again after its cool-off, the retry ladder asks a dead id twice more,
 * and every process restart pays the whole cost again. A dead id is a
 * CONFIGURATION fault and the only repair is deleting it.
 *
 * WHY A LIST AND NOT A LIVE CHECK. A test that called OpenRouter would be a
 * network call in the unit suite, would fail offline, and would spend a request
 * against the daily cap on every run. What is cheap and still has teeth is a
 * headstone list: every id proven dead, with the evidence that killed it, and
 * an assertion that none of them has crept back into the roster or its
 * frontend mirror. That catches the realistic failure — someone restoring a
 * seat from an older comment, a revert, or a copy-paste from the paragraph in
 * server.js that still names ling as a live seat.
 *
 * TO ADD AN ID HERE: verify it first, do not assume. `GET /api/v1/models/<id>/
 * endpoints` returning an empty `endpoints` array is the proof — that is the
 * state a chat request reports as "No endpoints found for <id>". A model that
 * is merely rate-limited, slow, or absent from `/models` while still having an
 * endpoint is NOT dead and does not belong on this list.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const BACKEND = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
const FRONTEND = readFileSync(
  join(__dirname, '..', '..', 'frontend', 'src', 'constants', 'council.js'),
  'utf8',
);

/** Ids proven unroutable, with the date and the evidence. */
const RETIRED = [
  {
    id: 'inclusionai/ling-3.0-tiny:free',
    retired: '2026-08-19',
    evidence: 'zero endpoints; chat returns HTTP 404 "No endpoints found"; absent from /models',
  },
  {
    id: 'inclusionai/ling-3.0-flash:free',
    retired: '2026-08-19',
    evidence: 'zero endpoints — checked as a same-family replacement for ling-3.0-tiny and rejected',
  },
  {
    id: 'openai/gpt-oss-20b:free',
    retired: '2026-08-30',
    evidence: 'missing from current official public and authenticated /models metadata; exact free route is not selectable',
  },
  {
    id: 'nvidia/nemotron-3-nano-30b-a3b:free',
    retired: '2026-08-30',
    evidence: 'missing from current official public and authenticated /models metadata; exact free route is not selectable',
  },
];

const REQUIRED_P1_HEADSTONES = [
  'openai/gpt-oss-20b:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
];

/* The seat lines only, not the prose. A retired id may still be NAMED in a
 * comment — the paragraph explaining why ling is gone has to say "ling" — and a
 * test that forbade the word would forbid the explanation with it. What must
 * not exist is a `model:` field carrying one. */
const configuredIds = (src) => [...src.matchAll(/\bmodel:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

test('the two upstream-dead P1 routes have durable headstones', () => {
  const retired = new Set(RETIRED.map(({ id }) => id));
  for (const id of REQUIRED_P1_HEADSTONES) {
    assert.ok(retired.has(id), `${id} is missing from the retired-model guard`);
  }
});

test('no retired model id is configured as a seat in the backend roster', () => {
  const configured = configuredIds(BACKEND);
  for (const dead of RETIRED) {
    assert.ok(
      !configured.includes(dead.id),
      `${dead.id} was retired on ${dead.retired} (${dead.evidence}) and is configured again`,
    );
  }
});

test('no retired model id is configured in the frontend roster either', () => {
  const configured = configuredIds(FRONTEND);
  for (const dead of RETIRED) {
    assert.ok(!configured.includes(dead.id), `${dead.id} is retired and still on the sign-in page`);
  }
});

test('the guard can actually see a seat — it is parsing ids, not an empty list', () => {
  /* The failure this prevents is the one the roster test already learned once:
   * a regex that stops matching turns a guard into a pass. If this ever reads
   * zero seats, the two assertions above are vacuously true. */
  const backend = configuredIds(BACKEND);
  const frontend = configuredIds(FRONTEND);
  assert.ok(backend.length >= 5, `parsed only ${backend.length} backend model ids`);
  assert.ok(frontend.length >= 5, `parsed only ${frontend.length} frontend model ids`);
  assert.ok(backend.includes('cohere/north-mini-code:free'), 'the seat that replaced ling is not in the roster');
});

test('every seat id looks like an OpenRouter id, so a typo cannot be a silent 404', () => {
  /* A misspelled id fails exactly the way a retired one does — 404, no
   * endpoints — and is far more likely. This will not catch a plausible-looking
   * wrong id, and does not claim to; it catches the shapes that cannot be
   * right at all. */
  for (const id of configuredIds(BACKEND)) {
    assert.match(id, /^[a-z0-9][a-z0-9.\-]*\/[a-z0-9][a-z0-9.\-]*(:free|:batch)?$/, `${id} is not a well-formed model id`);
  }
});
