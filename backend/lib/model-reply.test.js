'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { normaliseCompletion, emptyReply, isModelReply, replyText, normaliseUsage } = require('./model-reply');
const { parseToolRequests } = require('./tool-protocol');

const payload = (message, extra = {}) => ({
  id: 'gen-1',
  model: 'test/model',
  choices: [{ message, finish_reason: extra.finishReason ?? 'stop' }],
  ...(extra.usage ? { usage: extra.usage } : {}),
});

test('plain content is the answer and is labelled as such', () => {
  const reply = normaliseCompletion(payload({ role: 'assistant', content: 'Paris.' }));
  assert.equal(reply.content, 'Paris.');
  assert.equal(reply.textSource, 'content');
  assert.equal(reply.reasoning, '');
  assert.deepEqual(reply.toolCalls, []);
});

test('THE REGRESSION: native tool_calls survive instead of becoming empty text', () => {
  // This is the exact shape a tool-capable model returns: no content at all,
  // the whole request in tool_calls. The old completionText returned '' here.
  const message = {
    role: 'assistant',
    content: null,
    tool_calls: [
      { id: 'call_abc123', type: 'function', function: { name: 'web_search', arguments: '{"query":"aurora tonight"}' } },
    ],
  };
  const reply = normaliseCompletion(payload(message, { finishReason: 'tool_calls' }));

  assert.equal(reply.content, '', 'no prose was written, and none is invented');
  assert.equal(reply.finishReason, 'tool_calls');
  assert.equal(reply.toolCalls.length, 1);
  assert.equal(reply.toolCalls[0].id, 'call_abc123', 'the tool id is preserved verbatim');
  assert.equal(reply.toolCalls[0].name, 'web_search');
  assert.equal(reply.toolCalls[0].rawArguments, '{"query":"aurora tonight"}');

  // And the whole point: the parser the agent loop uses can now read it.
  const parsed = parseToolRequests(reply);
  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.calls[0].name, 'web_search');
  assert.deepEqual(parsed.calls[0].args, { query: 'aurora tonight' });
  assert.equal(parsed.isFinal, false, 'a seat that asked for a tool is not done');
});

test('a string reply still parses exactly as before', () => {
  const parsed = parseToolRequests('```tool_call\n{"name":"web_search","args":{"query":"x"}}\n```');
  assert.equal(parsed.calls.length, 1);
});

test('reasoning is kept separate but still rescues an otherwise blank answer', () => {
  const reply = normaliseCompletion(payload({ role: 'assistant', content: '', reasoning: 'The capital is Paris.' }));
  assert.equal(reply.content, 'The capital is Paris.');
  assert.equal(reply.textSource, 'reasoning', 'the caller can tell this is not a real answer field');
  assert.equal(reply.reasoning, 'The capital is Paris.');
});

test('reasoning never becomes the answer when a tool was requested', () => {
  const reply = normaliseCompletion(payload({
    role: 'assistant',
    content: null,
    reasoning: 'I should look this up.',
    tool_calls: [{ id: 'c1', function: { name: 'web_search', arguments: '{"query":"q"}' } }],
  }));
  assert.equal(reply.content, '', 'narration of a call is not an answer');
  assert.equal(reply.reasoning, 'I should look this up.');
});

test('reasoning_details parts are joined', () => {
  const reply = normaliseCompletion(payload({
    role: 'assistant',
    content: '',
    reasoning_details: [{ text: 'one ' }, { notText: 1 }, { text: 'two' }],
  }));
  assert.equal(reply.content, 'one two');
  assert.equal(reply.textSource, 'reasoning');
});

test('a refusal is distinguishable from silence', () => {
  const reply = normaliseCompletion(payload({ role: 'assistant', content: null, refusal: 'I cannot help with that.' }, { finishReason: 'content_filter' }));
  assert.equal(reply.refusal, 'I cannot help with that.');
  assert.equal(reply.content, '');
  assert.equal(reply.finishReason, 'content_filter');
  assert.notDeepEqual(reply, emptyReply('timeout'));
});

test('usage is normalised, including the cost field', () => {
  const reply = normaliseCompletion(payload({ role: 'assistant', content: 'hi' }, {
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost: 0.00042 },
  }));
  assert.deepEqual(reply.usage, { promptTokens: 120, completionTokens: 30, totalTokens: 150, costUsd: 0.00042 });
});

test('usage total is derived when the provider omits it', () => {
  assert.equal(normaliseUsage({ prompt_tokens: 10, completion_tokens: 5 }).totalTokens, 15);
  assert.equal(normaliseUsage({}), null);
  assert.equal(normaliseUsage(null), null);
});

test('a bare message is accepted as well as a whole payload', () => {
  const reply = normaliseCompletion({ role: 'assistant', content: 'bare' });
  assert.equal(reply.content, 'bare');
});

test('garbage in gives an empty reply, never a throw', () => {
  for (const bad of [null, undefined, 'string', 42, [], {}]) {
    const reply = normaliseCompletion(bad);
    assert.equal(reply.content, '');
    assert.equal(reply.textSource, 'none');
  }
});

test('a tool call with no name is dropped rather than half-built', () => {
  const reply = normaliseCompletion(payload({
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'c1', function: { name: '  ', arguments: '{}' } }, null, 'nonsense'],
  }));
  assert.deepEqual(reply.toolCalls, []);
});

test('a tool call without a provider id still gets a stable handle', () => {
  const reply = normaliseCompletion(payload({
    role: 'assistant',
    content: null,
    tool_calls: [{ function: { name: 'read_url', arguments: '{"id":"x"}' } }],
  }));
  assert.equal(reply.toolCalls[0].id, 'call_0');
});

test('isModelReply and replyText discriminate the two contracts', () => {
  const reply = normaliseCompletion(payload({ role: 'assistant', content: 'x' }));
  assert.equal(isModelReply(reply), true);
  assert.equal(isModelReply('x'), false);
  assert.equal(isModelReply(null), false);
  assert.equal(replyText(reply), 'x');
  assert.equal(replyText('x'), 'x');
  assert.equal(replyText(null), '');
});

test('emptyReply carries why it is empty', () => {
  assert.equal(emptyReply('aborted').finishReason, 'aborted');
  assert.equal(emptyReply().finishReason, 'none');
  assert.equal(isModelReply(emptyReply()), true);
});
