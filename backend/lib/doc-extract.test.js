const test = require("node:test");
const assert = require("node:assert/strict");
const { deflateRawSync } = require("node:zlib");

const {
  extractDocument,
  extractDocx,
  extractXlsx,
  DocumentRejected,
} = require("./doc-extract");

function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const plain = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || "", "utf8");
    const method = entry.method === "deflate" ? 8 : 0;
    const compressed = method === 8 ? deflateRawSync(plain) : plain;
    const compressedSize = entry.compressedSize ?? compressed.length;
    const inflatedSize = entry.inflatedSize ?? plain.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(inflatedSize, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(inflatedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, eocd]);
}

const docxXml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<w:document xmlns:w="urn:w"><w:body>',
  '<w:p><w:r><w:t>Hello &amp; goodbye</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>Next</w:t><w:tab/><w:t>cell</w:t></w:r></w:p>',
  '</w:body></w:document>',
].join("");

test("PDF extraction delegates attacker bytes to the injected Gemini boundary", async () => {
  const bytes = Buffer.from("%PDF-1.7\nnot parsed locally", "utf8");
  const fetchImpl = async () => { throw new Error("network should stay injected"); };
  let received;
  const content = await extractDocument({
    kind: "pdf",
    mime: "application/pdf",
    bytes,
    apiKey: "test-key",
    models: ["gemini-test"],
    fetchImpl,
    describeImageImpl: async (options) => {
      received = options;
      return "Page one text";
    },
  });

  assert.equal(content, "Page one text");
  assert.equal(received.mime, "application/pdf");
  assert.equal(received.base64, bytes.toString("base64"));
  assert.equal(received.apiKey, "test-key");
  assert.deepEqual(received.models, ["gemini-test"]);
  assert.equal(received.fetchImpl, fetchImpl);
  assert.match(received.prompt, /extract|transcribe/i);
});

test("a PDF MIME cannot send arbitrary binary to Gemini", async () => {
  let called = false;
  await assert.rejects(
    extractDocument({
      kind: "pdf",
      mime: "application/pdf",
      bytes: Buffer.from([0, 1, 2, 3]),
      describeImageImpl: async () => { called = true; },
    }),
    (error) => error instanceof DocumentRejected && /valid PDF/i.test(error.message),
  );
  assert.equal(called, false);
});

test("the document dispatcher sends DOCX to the local stdlib extractor", async () => {
  const archive = makeZip([{ name: "word/document.xml", data: docxXml }]);
  assert.equal(await extractDocument({ kind: "docx", bytes: archive }), "Hello & goodbye\nNext\tcell");
});

test("DOCX supports the deflate method Office normally writes", () => {
  const archive = makeZip([{ name: "word/document.xml", data: docxXml, method: "deflate" }]);
  assert.equal(extractDocx(archive), "Hello & goodbye\nNext\tcell");
});

test("the document dispatcher sends XLSX through shared strings and worksheet rows", async () => {
  const shared = '<sst><si><t>Name</t></si><si><r><t>Al</t></r><r><t>ice</t></r></si></sst>';
  const sheet1 = [
    '<worksheet><sheetData>',
    '<row><c r="A1" t="s"><v>0</v></c><c r="B1"><v>Score</v></c></row>',
    '<row><c r="A2" t="s"><v>1</v></c><c r="B2"><v>42</v></c></row>',
    '</sheetData></worksheet>',
  ].join("");
  const sheet2 = '<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Done &amp; filed</t></is></c></row></sheetData></worksheet>';
  const archive = makeZip([
    { name: "xl/sharedStrings.xml", data: shared, method: "deflate" },
    { name: "xl/worksheets/sheet2.xml", data: sheet2 },
    { name: "xl/worksheets/sheet1.xml", data: sheet1, method: "deflate" },
  ]);

  assert.equal(
    await extractDocument({ kind: "xlsx", bytes: archive }),
    "[sheet1]\nName\tScore\nAlice\t42\n\n[sheet2]\nDone & filed",
  );
});

test("the document dispatcher refuses an unknown binary kind", async () => {
  await assert.rejects(
    extractDocument({ kind: "pptx", bytes: Buffer.from("not used") }),
    (error) => error instanceof DocumentRejected && /not supported/i.test(error.message),
  );
});

test("a ZIP must contain the member required by its declared document kind", () => {
  const unrelated = makeZip([{ name: "other.xml", data: "<x>hello</x>" }]);
  assert.throws(() => extractDocx(unrelated), (error) => error instanceof DocumentRejected && /document\.xml/i.test(error.message));
  assert.throws(() => extractXlsx(unrelated), (error) => error instanceof DocumentRejected && /worksheet/i.test(error.message));
});

test("malformed, encrypted and duplicate-member ZIPs are refused clearly", () => {
  assert.throws(() => extractDocx(Buffer.from("PK not a zip")), (error) => error instanceof DocumentRejected && /ZIP|DOCX/i.test(error.message));

  const duplicate = makeZip([
    { name: "word/document.xml", data: docxXml },
    { name: "word/document.xml", data: docxXml },
  ]);
  assert.throws(() => extractDocx(duplicate), (error) => error instanceof DocumentRejected && /duplicate/i.test(error.message));

  const encrypted = makeZip([{ name: "word/document.xml", data: docxXml }]);
  const centralOffset = encrypted.readUInt32LE(encrypted.length - 6);
  encrypted.writeUInt16LE(encrypted.readUInt16LE(centralOffset + 8) | 1, centralOffset + 8);
  assert.throws(() => extractDocx(encrypted), (error) => error instanceof DocumentRejected && /encrypted/i.test(error.message));
});

test("ZIP member count and compressed-size caps reject rather than partially reading", () => {
  const archive = makeZip([
    { name: "word/document.xml", data: docxXml },
    { name: "extra.bin", data: "12345" },
  ]);
  assert.throws(
    () => extractDocx(archive, { maxMembers: 1 }),
    (error) => error instanceof DocumentRejected && /too many members/i.test(error.message),
  );
  assert.throws(
    () => extractDocx(archive, { maxCompressedMemberBytes: 4 }),
    (error) => error instanceof DocumentRejected && /compressed member/i.test(error.message),
  );
  assert.throws(
    () => extractDocx(archive, { maxInflatedMemberBytes: 5 }),
    (error) => error instanceof DocumentRejected && /inflated limit/i.test(error.message),
  );
  assert.throws(
    () => extractDocx(archive, { maxInflatedMemberBytes: 1000, maxTotalInflatedBytes: docxXml.length }),
    (error) => error instanceof DocumentRejected && /total inflated/i.test(error.message),
  );
});

test("inflateRawSync is bounded even when the central directory lies about output size", () => {
  const archive = makeZip([{
    name: "word/document.xml",
    data: `<w:document><w:p><w:t>${"a".repeat(2000)}</w:t></w:p></w:document>`,
    method: "deflate",
    inflatedSize: 20,
  }]);
  assert.throws(
    () => extractDocx(archive, { maxInflatedMemberBytes: 100 }),
    (error) => error instanceof DocumentRejected && /inflated|expand/i.test(error.message),
  );
});

test("an extraction that yields no readable text is refused, never stored empty", async () => {
  await assert.rejects(
    extractDocument({
      kind: "pdf",
      mime: "application/pdf",
      bytes: Buffer.from("%PDF-1.7\n", "utf8"),
      describeImageImpl: async () => "   ",
    }),
    (error) => error instanceof DocumentRejected && /no readable text/i.test(error.message),
  );
  const emptyDocx = makeZip([{ name: "word/document.xml", data: "<w:document><w:p/></w:document>" }]);
  assert.throws(() => extractDocx(emptyDocx), (error) => error instanceof DocumentRejected && /no readable text/i.test(error.message));
});
