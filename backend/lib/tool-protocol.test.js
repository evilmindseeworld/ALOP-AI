const test = require("node:test");
const assert = require("node:assert/strict");
const { parseToolRequests, sanitizeAnswerText, userRequestedProtocolJson, MAX_CALLS_PER_REPLY } = require("./tool-protocol");
const { callModel, parseOpenRouterSseLine } = require("./openrouter");

// ===== native =====

test("keeps reading legacy object-shaped tool_call arguments", () => {
  const r = parseToolRequests({
    message: { content: "", tool_calls: [{ function: { name: "web_search", arguments: { query: "OLED burn-in" } } }] },
  });
  assert.deepEqual(r.calls, [{ name: "web_search", args: { query: "OLED burn-in" } }]);
  assert.equal(r.isFinal, false);
});

test("reads arguments delivered as a JSON STRING", () => {
  // OpenAI-shaped gateways do this, and so do some models in native mode. A
  // caller assuming the object shape would silently see {} and call with no
  // query at all.
  const r = parseToolRequests({
    message: { tool_calls: [{ function: { name: "web_search", arguments: '{"query":"QD-OLED"}' } }] },
  });
  assert.deepEqual(r.calls, [{ name: "web_search", args: { query: "QD-OLED" } }]);
});

test("reads OpenRouter choices[0].message tool calls with JSON-string arguments", () => {
  const r = parseToolRequests({
    choices: [{
      message: {
        content: null,
        tool_calls: [{
          id: "call_123",
          type: "function",
          function: { name: "web_search", arguments: '{"query":"OpenRouter free models"}' },
        }],
      },
    }],
  });
  assert.deepEqual(r.calls, [{ name: "web_search", args: { query: "OpenRouter free models" } }]);
  assert.equal(r.isFinal, false);
});

// ===== OpenRouter adapter =====

test("OpenRouter SSE parser skips keepalives and recognizes provider completion", () => {
  assert.deepEqual(parseOpenRouterSseLine(": OPENROUTER PROCESSING"), { skip: true, done: false, text: "" });
  assert.deepEqual(parseOpenRouterSseLine("data: [DONE]"), { skip: false, done: true, text: "" });
  assert.deepEqual(
    parseOpenRouterSseLine('data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}'),
    { skip: false, done: false, text: "hello" },
  );
  assert.deepEqual(
    parseOpenRouterSseLine('data: {"choices":[{"delta":{"content":null,"reasoning":"thinking aloud"},"finish_reason":"stop"}]}'),
    { skip: false, done: true, text: "thinking aloud" },
  );
});

test("callModel falls back from empty content to reasoning details", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let body;
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: null, reasoning_details: [{ text: "usable answer" }] } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const answer = await callModel("https://openrouter.ai/api/v1", "test-key", "model:free", [], 0.2, 1000, 200);
  assert.equal(answer, "usable answer");
  assert.deepEqual(body.reasoning, { exclude: true });
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 200);
});

test("callModel retries a transient 429", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let attempts = 0;
  global.fetch = async () => {
    attempts++;
    if (attempts < 3) return new Response('{"error":{"metadata":{"provider_code":429}}}', { status: 429 });
    return new Response('{"choices":[{"message":{"content":"recovered"}}]}', { status: 200 });
  };
  const answer = await callModel("https://openrouter.ai/api/v1", "test-key", "model:free", [], 0.2, 3000, 200);
  assert.equal(answer, "recovered");
  assert.equal(attempts, 3);
});

test("callModel returns an empty string without fetching when already aborted", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => assert.fail("an aborted call must not reach fetch");
  const controller = new AbortController();
  controller.abort();
  const answer = await callModel("https://openrouter.ai/api/v1", "test-key", "model:free", [], 0.2, 3000, 200, controller.signal);
  assert.equal(answer, "");
});

test("reads a flat name/arguments shape with no .function nesting", () => {
  const r = parseToolRequests({ message: { tool_calls: [{ name: "read_url", arguments: { url: "https://x.test" } }] } });
  assert.deepEqual(r.calls, [{ name: "read_url", args: { url: "https://x.test" } }]);
});

// ===== text fallback =====

test("reads a fenced tool_call block", () => {
  const content = 'Let me check.\n```tool_call\n{"name":"web_search","args":{"query":"rtings"}}\n```';
  const r = parseToolRequests(content);
  assert.deepEqual(r.calls, [{ name: "web_search", args: { query: "rtings" } }]);
});

test("accepts the shapes models actually emit for the same block", () => {
  for (const body of [
    '{"name":"web_search","args":{"query":"a"}}',
    '{"tool":"web_search","arguments":{"query":"a"}}',
    '{"name":"web_search","parameters":{"query":"a"}}',
  ]) {
    const r = parseToolRequests("```tool_call\n" + body + "\n```");
    assert.deepEqual(r.calls, [{ name: "web_search", args: { query: "a" } }], body);
  }
});

test("accepts an array inside one block", () => {
  const r = parseToolRequests(
    '```tool_call\n[{"name":"web_search","args":{"query":"a"}},{"name":"read_url","args":{"url":"https://b.test"}}]\n```',
  );
  assert.equal(r.calls.length, 2);
});

test("reads several separate blocks", () => {
  const r = parseToolRequests(
    '```tool_call\n{"name":"web_search","args":{"query":"a"}}\n```\nand also\n```tool_call\n{"name":"web_search","args":{"query":"b"}}\n```',
  );
  assert.deepEqual(r.calls.map((c) => c.args.query), ["a", "b"]);
});

test("tolerates fence spelling and casing variation", () => {
  for (const fence of ["```tool_call", "```tool-call", "```TOOL_CALL", "```toolcall", "``` tool_call"]) {
    const r = parseToolRequests(fence + '\n{"name":"web_search","args":{"query":"a"}}\n```');
    assert.equal(r.calls.length, 1, fence);
  }
});

// ===== prose alongside calls =====

test("a reply carrying a call is never final, even with prose", () => {
  // Models narrate the call they are about to make. Treating that narration as
  // the answer ends the member's turn one round early, with a sentence that
  // answers nothing.
  const r = parseToolRequests('I should look this up first.\n```tool_call\n{"name":"web_search","args":{"query":"a"}}\n```');
  assert.equal(r.isFinal, false);
  assert.equal(r.text, "I should look this up first.");
});

test("prose with no call is a final answer, kept verbatim", () => {
  const r = parseToolRequests("The XG27AQWMG, because it holds black level in a lit room.");
  assert.equal(r.isFinal, true);
  assert.equal(r.text, "The XG27AQWMG, because it holds black level in a lit room.");
  assert.deepEqual(r.calls, []);
});

test("the fence is stripped from the surrounding text", () => {
  const r = parseToolRequests('before\n```tool_call\n{"name":"web_search","args":{"query":"a"}}\n```\nafter');
  assert.equal(r.text.includes("tool_call"), false);
  assert.equal(r.text.includes("before"), true);
  assert.equal(r.text.includes("after"), true);
});

test("a JSON tool-call fence is stripped without becoming a live call", () => {
  const content = 'before\n```json\n{"name":"web_search","arguments":{"query":"OECD Digital Education Outlook"}}\n```\nafter';
  const r = parseToolRequests(content);
  assert.deepEqual(r.calls, []);
  assert.equal(r.text, "before\n\nafter");
  assert.doesNotMatch(r.text, /web_search|OECD Digital Education/);
});

test("a truncated JSON tool-call fence is stripped without executing it", () => {
  const r = parseToolRequests('answer\n```json\n{"name":"web_search","arguments":{"query":"OECD Digital Education Ou');
  assert.deepEqual(r.calls, []);
  assert.equal(r.text, "answer");
});

test("a JSON tool-call fence truncated inside the name is stripped", () => {
  const r = parseToolRequests('answer\n```json\n{"name":"web_sear');
  assert.deepEqual(r.calls, []);
  assert.equal(r.text, "answer");
});

// ===== malformed input, none of which may throw =====

test("a malformed block is dropped, not fatal", () => {
  const r = parseToolRequests('```tool_call\n{"name":"web_search",,,broken\n```');
  assert.deepEqual(r.calls, []);
  assert.equal(r.isFinal, true);
});

test("an unclosed fence is ignored", () => {
  const r = parseToolRequests('```tool_call\n{"name":"web_search","args":{}}');
  assert.deepEqual(r.calls, []);
});

test("one broken block does not lose a good one beside it", () => {
  const r = parseToolRequests(
    '```tool_call\nnot json\n```\n```tool_call\n{"name":"web_search","args":{"query":"good"}}\n```',
  );
  assert.deepEqual(r.calls, [{ name: "web_search", args: { query: "good" } }]);
});

test("a call with no usable name is dropped", () => {
  for (const body of ['{"args":{"query":"a"}}', '{"name":"","args":{}}', '{"name":123,"args":{}}', '{"name":null}']) {
    assert.deepEqual(parseToolRequests("```tool_call\n" + body + "\n```").calls, [], body);
  }
});

test("a call with a non-object argument bag is dropped rather than guessed at", () => {
  for (const body of ['{"name":"web_search","args":"just a string"}', '{"name":"web_search","args":[1,2]}']) {
    assert.deepEqual(parseToolRequests("```tool_call\n" + body + "\n```").calls, [], body);
  }
});

test("missing args means no args, not a dropped call", () => {
  const r = parseToolRequests('```tool_call\n{"name":"web_search"}\n```');
  assert.deepEqual(r.calls, [{ name: "web_search", args: {} }]);
});

test("survives every empty and wrong-typed response shape", () => {
  for (const input of [undefined, null, "", {}, { message: null }, { message: { content: null } }, { message: { tool_calls: "nope" } }, 42]) {
    const r = parseToolRequests(input);
    assert.deepEqual(r.calls, [], JSON.stringify(input));
    assert.equal(typeof r.text, "string");
  }
});

test("a runaway reply is capped", () => {
  const one = '{"name":"web_search","args":{"query":"x"}}';
  const r = parseToolRequests("```tool_call\n[" + Array(50).fill(one).join(",") + "]\n```");
  assert.equal(r.calls.length, MAX_CALLS_PER_REPLY);
});

test("an enormous argument payload is refused", () => {
  const huge = JSON.stringify({ name: "web_search", args: { query: "x".repeat(9000) } });
  assert.deepEqual(parseToolRequests("```tool_call\n" + huge + "\n```").calls, []);
});

test("a fenced block that is not a tool_call is left alone", () => {
  const content = "Here is code:\n```js\nconst x = 1;\n```";
  const r = parseToolRequests(content);
  assert.deepEqual(r.calls, []);
  assert.equal(r.text, content);
});

test("ordinary JSON remains answer text", () => {
  const content = "Example payload:\n```json\n{\"title\":\"OECD report\"}\n```";
  assert.equal(parseToolRequests(content).text, content);
});

test("a whole query-plan object is a failed answer, not an empty rendered answer", () => {
  const raw = '{\n  "queries": [\n    "OECD Digital Education Outlook 2026"\n  ]\n}';
  assert.deepEqual(sanitizeAnswerText(raw), { text: "", rejected: true });
});

test("a whole tool request is a failed answer", () => {
  const raw = '{"name":"web_search","arguments":{"query":"OECD outlook"}}';
  assert.deepEqual(sanitizeAnswerText(raw), { text: "", rejected: true });
});

test("protocol-shaped JSON inside a legitimate answer is not damaged", () => {
  const raw = 'Here is the requested object:\n```json\n{"queries":["OECD outlook"]}\n```';
  assert.deepEqual(sanitizeAnswerText(raw), { text: raw, rejected: false });
});

test("an explicitly requested queries-array JSON reply remains an answer", () => {
  const raw = '{"queries":["OECD outlook"]}';
  assert.equal(userRequestedProtocolJson("Show me a JSON object with a queries array"), true);
  assert.deepEqual(sanitizeAnswerText(raw, { allowProtocolJson: true }), { text: raw, rejected: false });
});
