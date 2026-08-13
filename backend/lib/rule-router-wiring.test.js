'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { routeByRule } = require('./router');

/**
 * A ROUTER SAVING THAT IS NOT WIRED IS NOT A SAVING.
 *
 * `router.test.js` proves `routeByRule` decides correctly. It cannot prove
 * `server.js` asks it before paying for `planTurn`, and sol's report said so
 * outright: "until this is wired, the measured router saving is not active".
 * A rule router called after the model router, or called and then ignored,
 * passes every test in that file while costing exactly what it did before.
 */
const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

const at = (needle) => {
  const i = SOURCE.indexOf(needle);
  assert.notEqual(i, -1, `anchor vanished from server.js: ${needle}`);
  return i;
};

test('the rule router decides before planTurn can be called', () => {
  const rule = at('const ruleRoute = skipRouter');
  const model = at('planTurn(pv.value, convSummary, region, turnSignal)');
  assert.ok(rule < model, 'routeByRule must be consulted above the model router');
});

test('a rule decision actually suppresses the model call', () => {
  // The failure this catches: computing ruleRoute, logging it, and then calling
  // planTurn anyway — which is a saving in the log and nowhere else.
  const guard = at('const routeP = skipRouter || ruleRoute');
  assert.ok(guard > 0);
  assert.match(
    SOURCE.slice(guard, guard + 220),
    /Promise\.resolve\(ruleRoute \|\| NO_ROUTE\)/,
    'a non-null rule route must resolve without reaching planTurn',
  );
});

test('an explicit rule-routed search is logged as web search, not no search', () => {
  assert.match(SOURCE, /ruleRoute\.queries\?\.length \? 'web search' : 'no search'/);
});

test('the rule is told whether a conversation exists', () => {
  // "what did I just say" is a memory question with history and an ordinary
  // question without it. Passing this wrong turns the memory branch on for
  // first messages, which have no history to answer from.
  assert.match(
    SOURCE,
    /routeByRule\(pv\.value, \{ hasConversationContext: Boolean\(convSummary \|\| histArr\.length\) \}\)/,
  );
});

test('the rule declines anything the model router should still decide', () => {
  // Guards the property the wiring depends on: the rule may only REMOVE a
  // call, never take a decision it is not sure about. If a future edit makes
  // it answer volatile or entity-bearing questions, the model router stops
  // seeing turns it is needed for and this goes red.
  assert.equal(routeByRule('what is the latest version of node', {}), null, 'volatile phrasing must fall through');
  assert.equal(routeByRule('summarise https://example.com/page', {}), null, 'a URL must fall through');
  assert.equal(routeByRule('what is the capital of France', {}), null, 'a named entity must fall through');
  // The memory phrasings are deliberately narrow — "what did i say" matches,
  // "what did I JUST say" does not, because the regex has no gap there. That
  // is a fall-through to the model router, which is the safe direction, and it
  // is recorded here so the next reader does not mistake it for a bug.
  assert.equal(routeByRule('what did i just say', { hasConversationContext: true }), null, 'an unmatched phrasing falls through');
  assert.equal(routeByRule('what did i say', { hasConversationContext: false }), null, 'no history means no memory branch');

  const memory = routeByRule('what did i say', { hasConversationContext: true });
  assert.equal(memory?.memory, true, 'with history it is a memory question');
});
