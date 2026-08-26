const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { MODEL, DIMENSIONS, requestBody, parseEmbedding, vectorLiteral } = require('./answer-embeddings');

test('answer embeddings stay in one named 768-dimensional space', () => {
  assert.equal(MODEL, 'openai/text-embedding-3-small');
  assert.equal(DIMENSIONS, 768);
  assert.deepEqual(requestBody('  Example  '), { model: MODEL, input: '  Example  ', dimensions: 768 });
  const vector = Array(768).fill(0.01);
  assert.equal(parseEmbedding({ data: [{ embedding: vector }] }), vector);
  assert.match(vectorLiteral(vector), /^\[0\.01,/);
  assert.equal(parseEmbedding({ data: [{ embedding: [1] }] }), null);
});

test('the one-time backfill is paced, resumable, null-only, and dry by default', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'backfill-answer-cache-embeddings.mjs'), 'utf8');
  assert.match(src, /args\.includes\('--apply'\)/);
  assert.match(src, /\.is\('embedding', null\)/);
  assert.doesNotMatch(src, /\.gt\('expires_at'/);
  assert.match(src, /\.order\('key'/);
  assert.match(src, /--resume-after/);
  assert.match(src, /Math\.max\(250, numberArg\('--delay-ms'/);
  assert.match(src, /if \(!apply\) continue/);
  assert.doesNotMatch(src, /console\.log\([^\n]*question_text/);
});

test('every direct OpenRouter embedding POST is behind the centralized free-only guard', () => {
  const sources = [
    fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'scripts', 'backfill-answer-cache-embeddings.mjs'), 'utf8'),
  ];
  const marker = "fetch('https://openrouter.ai/api/v1/embeddings'";
  for (const source of sources) {
    const post = source.indexOf(marker);
    const guard = source.lastIndexOf('assertAllowedOpenRouterModel', post);
    assert.ok(post > 0, 'the direct embedding POST is missing');
    assert.ok(guard > 0 && post - guard < 400, 'a direct embedding POST is not free-only guarded');
  }
});
