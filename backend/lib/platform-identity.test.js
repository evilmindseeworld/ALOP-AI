const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ALOP_IDENTITY, CONVERSATIONAL_CONTEXT, withIdentity } = require('./platform-identity');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('the shared identity names the platform, capabilities, boundaries, and priorities', () => {
  assert.match(ALOP_IDENTITY, /You are ALOP-AI/);
  assert.match(ALOP_IDENTITY, /council/);
  assert.match(ALOP_IDENTITY, /one fast model/);
  assert.match(ALOP_IDENTITY, /search and read live web sources/);
  assert.match(ALOP_IDENTITY, /attached images/);
  assert.match(ALOP_IDENTITY, /conversation history and saved user preferences/);
  assert.match(ALOP_IDENTITY, /never claim a specific integration/);
  assert.match(ALOP_IDENTITY, /Speed and message efficiency/);
  assert.match(ALOP_IDENTITY, /Accuracy: never trade correctness for speed/);
  assert.match(CONVERSATIONAL_CONTEXT, /natural language|shorthand/i);
  assert.match(CONVERSATIONAL_CONTEXT, /Never invent personal/i);
  assert.match(CONVERSATIONAL_CONTEXT, /ask a follow-up only when/i);
  assert.equal(withIdentity('TASK'), `${ALOP_IDENTITY}\n\n${CONVERSATIONAL_CONTEXT}\n\nTASK`);
});

test('the shared context policy handles natural personal trade-off questions', () => {
  assert.match(CONVERSATIONAL_CONTEXT, /selling my PS5 to buy a monitor/i);
  assert.match(CONVERSATIONAL_CONTEXT, /interpret it naturally the same way/i);
  assert.match(CONVERSATIONAL_CONTEXT, /Do not mirror telegraphic language/i);
  assert.match(CONVERSATIONAL_CONTEXT, /assistant guesses are not/i);
});

test('every user-facing model path receives the shared ALOP-AI identity', () => {
  for (const path of [
    'shadow_probe', 'memory', 'greeting', 'search_council', 'search_synthesis',
    'wikipedia', 'plain_council', 'fallback', 'synthesis', 'overlay',
  ]) {
    assert.match(SERVER, new RegExp(`identityPrompt\\([^\\n]+, '${path}'\\)`), `${path} lost identity injection`);
  }
  assert.match(SERVER, /const content = withIdentity\(taskPrompt\)/, 'identityPrompt stopped applying the shared wrapper');
  assert.match(SERVER, /\[SYSTEM PROMPT\] identity injected path=\$\{path\} content=\$\{JSON\.stringify\(ALOP_IDENTITY\)\}/);
  assert.match(SERVER, /if \(!identityPromptLogged\)/);
});
