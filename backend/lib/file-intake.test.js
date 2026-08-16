const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareUpload, prepareUploadAsync, sanitiseName, looksBinary, UploadRejected, ACCEPTED, MAX_BYTES, MAX_DOCUMENT_BYTES, MAX_CHARS } = require("./file-intake");

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const upload = (over = {}) => prepareUpload({ name: "notes.txt", mime: "text/plain", base64: b64("hello"), ...over });
const rejects = (over, re) => assert.throws(() => upload(over), (e) => e instanceof UploadRejected && re.test(e.message));

// ===== the allowlist =====

test("accepts the text formats that need no parser", () => {
  for (const mime of ["text/plain", "text/markdown", "text/x-markdown", "text/csv", "text/tab-separated-values", "application/json"]) {
    assert.equal(upload({ mime }).mime, mime, mime);
  }
});

test("tolerates a charset parameter and odd casing", () => {
  assert.equal(upload({ mime: "TEXT/Plain; charset=utf-8" }).mime, "text/plain");
});

test("the allowlist includes PDF, DOCX and XLSX without treating arbitrary ZIPs as documents", () => {
  assert.equal(ACCEPTED.get("application/pdf"), "pdf");
  assert.equal(ACCEPTED.get("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "docx");
  assert.equal(ACCEPTED.get("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "xlsx");
  rejects({ mime: "application/zip" }, /not accepted/);
});

test("the sync API remains the text path and points binary documents at its async sibling", () => {
  rejects({ mime: "application/pdf", base64: Buffer.from("%PDF-1.7").toString("base64") }, /asynchronous|document extraction/i);
});

test("refuses executables and archives dressed as anything", () => {
  for (const mime of ["application/octet-stream", "application/zip", "text/html", "image/svg+xml", "", null, 42]) {
    rejects({ mime }, /not accepted/);
  }
});

// ===== document extraction =====

test("prepareUploadAsync preserves the six-field storage contract for PDF", async () => {
  const bytes = Buffer.from("%PDF-1.7\nscanned bytes\x00", "binary");
  const result = await prepareUploadAsync({
    name: "scan.pdf",
    mime: "application/pdf",
    base64: bytes.toString("base64"),
  }, {
    apiKey: "test-key",
    models: ["gemini-test"],
    describeImageImpl: async () => "Scanned page text",
  });

  assert.deepEqual(Object.keys(result), ["name", "mime", "kind", "bytes", "content", "truncated"]);
  assert.deepEqual(result, {
    name: "scan.pdf",
    mime: "application/pdf",
    kind: "pdf",
    bytes: bytes.length,
    content: "Scanned page text",
    truncated: false,
  });
});

test("prepareUploadAsync delegates text kinds to the unchanged sync path", async () => {
  const input = { name: "notes.txt", mime: "text/plain", base64: b64("same text") };
  assert.deepEqual(await prepareUploadAsync(input), prepareUpload(input));
  await assert.rejects(
    prepareUploadAsync({ ...input, base64: Buffer.from([0x41, 0, 0x42]).toString("base64") }),
    (error) => error instanceof UploadRejected && /not text/i.test(error.message),
  );
});

test("binary document bytes bypass looksBinary but still pass format validation", async () => {
  const pdf = Buffer.from("%PDF-1.7\n\x00\x01\x02", "binary");
  const result = await prepareUploadAsync({ name: "binary.pdf", mime: "application/pdf", base64: pdf.toString("base64") }, {
    describeImageImpl: async () => "readable",
  });
  assert.equal(looksBinary(pdf), true);
  assert.equal(result.content, "readable");

  const optionsCannotReplaceValidatedInput = await prepareUploadAsync({
    name: "real.pdf",
    mime: "application/pdf",
    base64: pdf.toString("base64"),
  }, {
    kind: "docx",
    mime: "text/plain",
    bytes: Buffer.from("attacker-selected replacement"),
    describeImageImpl: async () => "still the PDF path",
  });
  assert.equal(optionsCannotReplaceValidatedInput.kind, "pdf");
  assert.equal(optionsCannotReplaceValidatedInput.content, "still the PDF path");

  await assert.rejects(
    prepareUploadAsync({ name: "fake.pdf", mime: "application/pdf", base64: Buffer.from([0, 1, 2]).toString("base64") }, {
      describeImageImpl: async () => "must not run",
    }),
    (error) => error instanceof UploadRejected && /valid PDF/i.test(error.message),
  );
});

test("the async API applies its own allowlist and empty-file checks", async () => {
  await assert.rejects(
    prepareUploadAsync({ name: "archive.zip", mime: "application/zip", base64: b64("PK") }),
    (error) => error instanceof UploadRejected && /not accepted/i.test(error.message),
  );
  await assert.rejects(
    prepareUploadAsync({ name: "empty.pdf", mime: "application/pdf", base64: "" }),
    (error) => error instanceof UploadRejected && /empty/i.test(error.message),
  );
});

test("document output is normalised and truncated under the unchanged storage contract", async () => {
  const content = `safe\u202eevil\u202c\r\n${"x".repeat(MAX_CHARS)}`;
  const result = await prepareUploadAsync({ name: "long.pdf", mime: "application/pdf", base64: b64("%PDF-1.7") }, {
    describeImageImpl: async () => content,
  });
  assert.equal(result.content.includes("\u202e"), false);
  assert.equal(result.content.includes("\r"), false);
  assert.equal(result.content.length, MAX_CHARS);
  assert.equal(result.truncated, true);
});

test("document rejection becomes a caller-safe UploadRejected, provider failure does not", async () => {
  await assert.rejects(
    prepareUploadAsync({ name: "empty.pdf", mime: "application/pdf", base64: b64("%PDF-1.7") }, {
      describeImageImpl: async () => "",
    }),
    (error) => error instanceof UploadRejected && /no readable text/i.test(error.message),
  );

  const providerError = new Error("provider unavailable");
  await assert.rejects(
    prepareUploadAsync({ name: "scan.pdf", mime: "application/pdf", base64: b64("%PDF-1.7") }, {
      describeImageImpl: async () => { throw providerError; },
    }),
    (error) => error === providerError && !(error instanceof UploadRejected),
  );
});

test("documents have an 8MB transport ceiling without widening the text ceiling", async () => {
  assert.equal(MAX_DOCUMENT_BYTES, 8 * 1024 * 1024);
  assert.equal(MAX_BYTES, 512 * 1024);
  const tooLarge = Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 0x20);
  tooLarge.write("%PDF-1.7", 0, "ascii");
  await assert.rejects(
    prepareUploadAsync({ name: "large.pdf", mime: "application/pdf", base64: tooLarge.toString("base64") }, {
      describeImageImpl: async () => "text",
    }),
    (error) => error instanceof UploadRejected && /limit/i.test(error.message),
  );
});

// ===== the bytes, not the label =====

test("refuses binary content declared as text", () => {
  // The declared MIME comes from the client and is evidence of nothing.
  const binary = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x41, 0x42]).toString("base64");
  rejects({ mime: "text/plain", base64: binary }, /not text/);
});

test("a NUL anywhere is binary, not just in the first kilobyte", () => {
  // A prefix check is exactly what a crafted file defeats.
  const buf = Buffer.concat([Buffer.from("a".repeat(4000), "utf8"), Buffer.from([0x00])]);
  rejects({ base64: buf.toString("base64") }, /not text/);
  assert.equal(looksBinary(Buffer.from("a".repeat(4000), "utf8")), false);
});

test("tab, newline and carriage return are text, not control noise", () => {
  const r = upload({ mime: "text/csv", base64: b64("a\tb\r\nc\td\n") });
  assert.equal(r.content, "a\tb\nc\td\n");
});

test("accepts real UTF-8 rather than mangling it", () => {
  const r = upload({ base64: b64("日本語 — café — 😀") });
  assert.equal(r.content, "日本語 — café — 😀");
});

// ===== text that lies about its own shape =====

test("strips bidirectional overrides (Trojan Source)", () => {
  // These make a stored line RENDER in a different order than it is stored.
  const r = upload({ base64: b64("safe‮evil‬end") });
  assert.equal(r.content.includes("‮"), false);
  assert.equal(r.content, "safeevilend");
});

test("strips zero-width characters that hide content from a reviewer", () => {
  const r = upload({ base64: b64("a​b‍c﻿d") });
  assert.equal(r.content, "abcd");
});

// ===== size =====

test("refuses a file over the byte ceiling, and says the numbers", () => {
  const big = Buffer.alloc(MAX_BYTES + 1, 0x61).toString("base64");
  assert.throws(() => upload({ base64: big }), (e) => /KB/.test(e.message) && /limit/.test(e.message));
});

test("accepts a file exactly at the ceiling", () => {
  assert.equal(upload({ base64: Buffer.alloc(MAX_BYTES, 0x61).toString("base64") }).bytes, MAX_BYTES);
});

test("A TEXT FILE IS STORED WHOLE — retrieval cannot reach what was never kept", () => {
  // The storage ceiling used to be 20,000 characters, so page 90 of a long
  // document was not merely unread but absent. MAX_BYTES now bites first for
  // text: the largest accepted file is stored entire.
  const size = MAX_BYTES - 100;
  const r = upload({ base64: Buffer.alloc(size, 0x61).toString("base64") });
  assert.ok(size > 20_000, "fixture is smaller than the ceiling it is testing");
  assert.equal(r.content.length, size);
  assert.equal(r.truncated, false);
  assert.equal(upload().truncated, false);
});

test("refuses empty and whitespace-only files", () => {
  rejects({ base64: "" }, /empty/);
  rejects({ base64: b64("   \n\t  ") }, /no readable text/);
  assert.throws(() => prepareUpload(), (e) => e instanceof UploadRejected);
  assert.throws(() => prepareUpload({ mime: "text/plain" }), (e) => e instanceof UploadRejected);
});

// ===== the filename is display-only =====

test("a filename can never look like a path", () => {
  // It never LOCATES anything — the uuid does that — but it must not be
  // renderable as a path either.
  assert.equal(sanitiseName("../../etc/passwd").includes("/"), false);
  assert.equal(sanitiseName("..\\..\\windows\\system32").includes("\\"), false);
  assert.equal(sanitiseName("/etc/shadow").includes("/"), false);
});

test("a filename carries no control or invisible characters", () => {
  assert.equal(sanitiseName("a\u0000b\u001fcd"), "abcd");
  assert.equal(sanitiseName("a‮b"), "ab");
});

test("an absent or unusable filename gets one from the kind", () => {
  assert.equal(sanitiseName("", "csv"), "upload.csv");
  assert.equal(sanitiseName(null, "md"), "upload.md");
  assert.equal(sanitiseName("///", "json"), "upload.json");
  assert.equal(upload({ name: undefined }).name, "upload.txt");
});

test("a very long filename is bounded", () => {
  assert.ok(sanitiseName("a".repeat(500)).length <= 80);
});
