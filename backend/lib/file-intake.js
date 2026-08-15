/**
 * Accepting a non-image upload, and turning it into text a model can read.
 *
 * The design's rule, which everything here exists to enforce:
 *
 *   > A model passes an OPAQUE ID, never a filename and never a path. The
 *   > server resolves it against a store scoped to (user, chat) and refuses
 *   > anything the requesting user does not own.
 *   >
 *   > This is not a stylistic preference. The repo is public, the process holds
 *   > live Stripe and Supabase credentials, and a model-issued path is
 *   > attacker-controlled the moment anyone can get text into a prompt. There is
 *   > no allowlist of directories that makes read_file("../../.env") safe to
 *   > even attempt, so the filesystem is not addressable at all.
 *
 * So: nothing here ever touches `fs`. Uploaded content is stored in Postgres
 * and read back by UUID. There is no path to traverse because there is no path.
 *
 * WHAT IS ACCEPTED, and where it is allowed to cross a parser boundary:
 *
 *   text/plain, text/markdown, text/csv, text/tab-separated-values,
 *   application/json — accepted. These need no parser at all: the bytes ARE
 *   the text, so the attack surface is decoding UTF-8.
 *
 *   application/pdf — sent to Gemini's existing inline_data boundary. Gemini
 *   reads both native and scanned PDFs; this process never parses their object
 *   graph.
 *
 *   DOCX and XLSX — their ZIP central directory and required XML members are
 *   read with Buffer plus node:zlib. No general Office/ZIP/XML package enters
 *   this credential-bearing process. doc-extract.js owns the bomb ceilings.
 */

const { extractDocument, DocumentRejected } = require('./doc-extract');

/** MIME -> short kind label. This map IS the allowlist. */
const ACCEPTED = new Map([
  ["text/plain", "txt"],
  ["text/markdown", "md"],
  ["text/x-markdown", "md"],
  ["text/csv", "csv"],
  ["text/tab-separated-values", "tsv"],
  ["application/json", "json"],
  ["application/pdf", "pdf"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
]);

const TEXT_KINDS = new Set(["txt", "md", "csv", "tsv", "json"]);

/** Per file, after decoding. Comfortably larger than any real note or export. */
const MAX_BYTES = 512 * 1024;

/** PDFs and Office containers need room for compression and scanned pages. */
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

/** What a model is given. The rest is stored but not spent on context. */
const MAX_CHARS = 20000;

/** Per chat. A model can only read what it can name, and 20 is generous. */
const MAX_FILES_PER_CHAT = 20;

class UploadRejected extends Error {
  constructor(message) {
    super(message);
    this.name = "UploadRejected";
  }
}

/**
 * Is this decoded buffer plausibly text?
 *
 * The declared MIME comes from the client and is not evidence of anything. A
 * NUL byte is the most reliable signal that something is binary — no encoding
 * this app accepts produces one — and it is also what would let a crafted
 * "text/plain" upload smuggle a payload past a naive reader.
 *
 * Checked over the WHOLE buffer, not a prefix. A file that is clean for its
 * first kilobyte and binary afterwards is precisely what a prefix check
 * misses, and this content is about to be put in front of a model.
 */
const looksBinary = (buf) => {
  if (buf.includes(0)) return true;
  // C0 controls that are not tab (0x09), LF (0x0A) or CR (0x0D). A few can
  // appear in odd exports; a dense run means it is not text.
  let control = 0;
  for (const byte of buf) {
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f) control++;
  }
  return control > buf.length * 0.02;
};

/**
 * Normalise text for storage.
 *
 * Line endings are unified, and the characters that let text lie about its own
 * shape are stripped:
 *
 *   - U+202A..U+202E, U+2066..U+2069 are bidirectional overrides. They make a
 *     stored line RENDER in a different order than it is stored — the Trojan
 *     Source trick. Written as \u escapes on purpose: as literals they are
 *     invisible in this file, which is the entire point of the attack.
 *   - U+200B..U+200D and U+FEFF are zero-width. They hide content from a human
 *     reviewing what a model was actually fed.
 *
 * Neither has any business in a CSV.
 */
const normalise = (text) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[‪-‮⁦-⁩]/g, "")
    .replace(/[​-‍﻿]/g, "");

/** A display name: no separators, no control characters, bounded. */
function sanitiseName(name, kind = "txt") {
  const raw = typeof name === "string" ? name : "";
  const cleaned = raw
    .replace(/[\\/]/g, " ")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[‪-‮⁦-⁩​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || `upload.${kind}`;
}

/**
 * Validate and decode one upload.
 *
 * @param {object} input
 * @param {string} input.name    client-supplied filename — DISPLAY ONLY
 * @param {string} input.mime    client-supplied type, checked against ACCEPTED
 * @param {string} input.base64  the file's bytes
 * @returns {{name, mime, kind, bytes, content, truncated}}
 * @throws {UploadRejected}
 */
function prepareUpload({ name, mime, base64 } = {}) {
  const declared = typeof mime === "string" ? mime.split(";")[0].trim().toLowerCase() : "";
  const kind = ACCEPTED.get(declared);
  if (!kind) {
    throw new UploadRejected(
      `${declared || "That file type"} is not accepted. Text, Markdown, CSV, TSV, JSON, PDF, DOCX and XLSX only.`,
    );
  }
  if (!TEXT_KINDS.has(kind)) {
    // Keeping this function synchronous is a compatibility contract for every
    // existing text caller. Documents have an explicit async sibling because
    // PDF extraction crosses the Gemini network boundary.
    throw new UploadRejected("PDF, DOCX and XLSX files require asynchronous document extraction.");
  }

  if (typeof base64 !== "string" || !base64.trim()) throw new UploadRejected("The file was empty.");

  let buf;
  try {
    buf = Buffer.from(base64, "base64");
  } catch {
    throw new UploadRejected("The file could not be decoded.");
  }
  if (buf.length === 0) throw new UploadRejected("The file was empty.");
  if (buf.length > MAX_BYTES) {
    throw new UploadRejected(
      `The file is ${Math.round(buf.length / 1024)}KB; the limit is ${MAX_BYTES / 1024}KB.`,
    );
  }
  if (looksBinary(buf)) {
    throw new UploadRejected("That file is not text, whatever its extension says.");
  }

  const full = normalise(buf.toString("utf8"));
  if (!full.trim()) throw new UploadRejected("The file has no readable text in it.");

  return {
    // The filename NEVER locates anything — the id does that. It is stripped of
    // separators regardless, so a name like "../../etc/passwd" cannot even be
    // displayed as though it were a path.
    name: sanitiseName(name, kind),
    mime: declared,
    kind,
    bytes: buf.length,
    content: full.slice(0, MAX_CHARS),
    truncated: full.length > MAX_CHARS,
  };
}

/**
 * Validate and extract an upload that may be a binary document.
 *
 * Text takes the exact synchronous path above. Binary kinds bypass looksBinary
 * only after the MIME allowlist selects a document extractor; a ZIP renamed to
 * text/plain therefore still fails the whole-buffer binary check.
 *
 * @param {object} input the same {name, mime, base64} contract as prepareUpload
 * @param {object} options injectable provider/deadline options for PDF tests and callers
 * @returns {Promise<{name, mime, kind, bytes, content, truncated}>}
 */
async function prepareUploadAsync(input = {}, options = {}) {
  const { name, mime, base64 } = input;
  const declared = typeof mime === "string" ? mime.split(";")[0].trim().toLowerCase() : "";
  const kind = ACCEPTED.get(declared);
  if (!kind) {
    throw new UploadRejected(
      `${declared || "That file type"} is not accepted. Text, Markdown, CSV, TSV, JSON, PDF, DOCX and XLSX only.`,
    );
  }
  if (TEXT_KINDS.has(kind)) return prepareUpload(input);

  if (typeof base64 !== "string" || !base64.trim()) throw new UploadRejected("The file was empty.");
  let buf;
  try {
    buf = Buffer.from(base64, "base64");
  } catch {
    throw new UploadRejected("The file could not be decoded.");
  }
  if (buf.length === 0) throw new UploadRejected("The file was empty.");
  if (buf.length > MAX_DOCUMENT_BYTES) {
    throw new UploadRejected(
      `The file is ${Math.round(buf.length / 1024)}KB; the limit is ${MAX_DOCUMENT_BYTES / 1024}KB.`,
    );
  }

  let extracted;
  try {
    // Validated identity and bytes win over injectable provider options. This
    // keeps a caller-supplied options bag from selecting a different extractor
    // after the MIME/size checks above have already run.
    extracted = await extractDocument({ ...options, kind, mime: declared, bytes: buf });
  } catch (error) {
    // A malformed/bomb-like document is caller input. Provider outages and
    // timeouts are operational failures and deliberately retain their type so
    // the route does not misreport them as a 400.
    if (error instanceof DocumentRejected) throw new UploadRejected(error.message);
    throw error;
  }

  const full = normalise(extracted);
  if (!full.trim()) throw new UploadRejected("The file has no readable text in it.");
  return {
    name: sanitiseName(name, kind),
    mime: declared,
    kind,
    bytes: buf.length,
    content: full.slice(0, MAX_CHARS),
    truncated: full.length > MAX_CHARS,
  };
}

module.exports = {
  prepareUpload,
  prepareUploadAsync,
  sanitiseName,
  looksBinary,
  UploadRejected,
  ACCEPTED,
  MAX_BYTES,
  MAX_DOCUMENT_BYTES,
  MAX_CHARS,
  MAX_FILES_PER_CHAT,
};
