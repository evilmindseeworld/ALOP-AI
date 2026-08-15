const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { collectAttachedImages, combineImageDescriptions, MAX_IMAGES_PER_TURN } = require('./attached-images');

const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

test('the single-image field the shipped frontend sends still works', () => {
  assert.deepEqual(collectAttachedImages({ image: 'data:image/png;base64,AAA' }), ['data:image/png;base64,AAA']);
});

test('an images array is taken in order', () => {
  assert.deepEqual(collectAttachedImages({ images: ['a', 'b', 'c'] }), ['a', 'b', 'c']);
});

test('images wins over image when a client sends both, and neither is duplicated', () => {
  assert.deepEqual(collectAttachedImages({ image: 'a', images: ['b'] }), ['b']);
});

test('junk in the array is dropped, not passed to the parser', () => {
  assert.deepEqual(collectAttachedImages({ images: ['a', null, 42, '  ', {}, 'b'] }), ['a', 'b']);
});

test('no attachment is an empty list, never null', () => {
  assert.deepEqual(collectAttachedImages({}), []);
  assert.deepEqual(collectAttachedImages(), []);
  assert.deepEqual(collectAttachedImages({ images: 'not-an-array' }), []);
});

test('over the limit is NOT silently sliced — the route has to refuse it', () => {
  const many = ['a', 'b', 'c', 'd', 'e'];
  assert.equal(collectAttachedImages({ images: many }).length, 5);
  assert.ok(MAX_IMAGES_PER_TURN < many.length, 'this test is meaningless if the limit is above the fixture');
  assert.match(SOURCE, /attachedImages\.length > MAX_IMAGES_PER_TURN/, 'the route must refuse the overflow it is handed');
});

test('one image keeps the exact prompt block it had before labels existed', () => {
  assert.equal(combineImageDescriptions(['a keyboard']), 'a keyboard');
});

test('several images are labelled so the answer can refer to one of them', () => {
  assert.equal(
    combineImageDescriptions(['one', 'two']),
    '--- Image 1 of 2 ---\none\n\n--- Image 2 of 2 ---\ntwo',
  );
});

test('vision runs the images concurrently and fails the turn as a unit', () => {
  const block = SOURCE.slice(SOURCE.indexOf('let parsedImages = []'), SOURCE.indexOf("if (!attachedImages.length) {"));
  assert.match(block, /Promise\.all\(parsedImages\.map\(describeOne\)\)/, 'four images must cost one image of latency');
  assert.doesNotMatch(
    block,
    /\.map\([^)]*=>[^)]*\.catch\(/,
    'a per-image catch would answer about the pictures that worked and hide the one that did not',
  );
});
