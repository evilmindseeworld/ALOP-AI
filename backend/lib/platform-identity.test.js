const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ALOP_IDENTITY, withIdentity } = require('./platform-identity');

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
  assert.equal(withIdentity('TASK'), `${ALOP_IDENTITY}\n\nTASK`);
});

test('every user-facing model path receives the shared ALOP-AI identity', () => {
  assert.match(SERVER, /const probeSys = `\$\{ALOP_IDENTITY\}/);
  assert.match(SERVER, /const memSys = `\$\{ALOP_IDENTITY\}/);
  assert.match(SERVER, /const greetMsgs = \[\{ role: 'system', content: `\$\{ALOP_IDENTITY\}/);
  for (const name of ['extMsgs', 'searchSynthMsgs', 'wikiMsgs', 'fbMsgs', 'synthMsgs']) {
    assert.ok(
      SERVER.includes(`const ${name} = [{ role: 'system', content: withIdentity(`),
      `${name} lost the shared identity system message`,
    );
  }
  assert.match(SERVER, /const councilMsgs = \[\{ role: 'system', content: `\$\{ALOP_IDENTITY\}\\n\\n\$\{councilSys\}`/);
  assert.match(SERVER, /\$\{todayLine\(\)\}\\n\\n\$\{ALOP_IDENTITY\}[\s\S]*You are ALOP-AI Overlay/);
});
