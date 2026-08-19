'use strict';

/**
 * THE AUDIT ROW HAD TWO MEANINGS FOR ONE FIELD, AND THE COUNT WON.
 *
 * `turn-telemetry.snapshot()` builds `seats` as the per-seat array that
 * `recordSeat` spent the turn filling, and then spreads `...extra` LAST. Every
 * council branch passed `seats: selection.members.length` — a number — through
 * that same `extra` bag, so the array was overwritten by a count on its way
 * into `audit_logs.metadata`.
 *
 * MEASURED in production over 30 days: of 58 current-schema turns exactly ONE
 * carried a seats array; 33 council turns and 24 fallback turns carried none.
 * The single survivor was an aborted turn whose `extra` happened to omit the
 * key. The seat sample available for analysis was n=14 — that was never
 * traffic volume, it was this.
 *
 * SETTLEMENT WAS NEVER AFFECTED, and that is why the array is the side that
 * keeps the name: `server.js` prices and counts from
 * `telemetry.snapshot({ category: 'settle' })`, which passes no `extra` at all,
 * so `priceTurn` and `countTurnRequests` always saw the real array. Money and
 * request quota were correct throughout. `admin-commands.js` reads `row.seats`
 * from the AUDIT row expecting an array, finds a number, and falls back to []
 * — a blank per-seat view, which is the whole user-visible impact.
 *
 * `server.js` cannot be `require`d in a test (it calls `process.exit(1)` at
 * import time on missing env), so this asserts on its SOURCE, like
 * census-wiring and cors-wiring already do. Asserted by shape rather than by
 * line number, and it names every offender it finds rather than the first.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

/* Only real code: a `seats:` inside a comment is prose about the bug, not a
 * writer of it. `seatCount:` cannot match — the colon follows the whole word. */
const auditWriters = () =>
  SOURCE.split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => !line.startsWith('*') && !line.startsWith('//') && !line.startsWith('/*'))
    .filter(({ line }) => /(^|[^A-Za-z])seats:/.test(line));

test('no audit writer in server.js carries a numeric `seats` field', () => {
  const offenders = auditWriters();
  assert.deepEqual(
    offenders.map((o) => `${o.number}: ${o.line.slice(0, 72)}`),
    [],
    'audit metadata must use `seatCount` for the number; `seats` belongs to the per-seat array '
      + 'that snapshot() builds and admin-commands.js reads',
  );
});

/* The rename is only worth anything if the count still reaches the row. */
test('the council branches still report how many seats were selected', () => {
  const counts = SOURCE.split('\n').filter((l) => /seatCount:/.test(l) && !l.trim().startsWith('*'));
  assert.ok(counts.length >= 8, `expected every former \`seats:\` writer to carry seatCount, found ${counts.length}`);
  assert.ok(
    counts.some((l) => /seatCount:\s*selection\.members\.length/.test(l)),
    'the council branches must report the selected roster size',
  );
  assert.ok(
    counts.some((l) => /seatCount:\s*0\b/.test(l)),
    'the branches that dispatch no council must still say so explicitly',
  );
});
