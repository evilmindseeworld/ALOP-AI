const test = require("node:test");
const assert = require("node:assert/strict");
const { parseToolRequests, MAX_CALLS_PER_REPLY } = require("./tool-protocol");

// ===== native =====

test("reads Ollama-shaped tool_calls", () => {
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
