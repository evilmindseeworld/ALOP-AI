'use strict';

const { inflateRawSync } = require('node:zlib');
const { describeImage } = require('./vision');

/* Office files are ZIPs, but they are not handed to a general-purpose archive
 * library inside the credential-bearing web process. We read only their
 * central directory and the XML members the product needs. These ceilings are
 * checked before an inflate, then maxOutputLength enforces the important one
 * again while zlib is producing bytes — a forged directory size cannot turn a
 * reject into silent truncation or an allocation spike. */
const ZIP_LIMITS = Object.freeze({
  maxMembers: 512,
  maxCompressedMemberBytes: 8 * 1024 * 1024,
  maxInflatedMemberBytes: 16 * 1024 * 1024,
  maxTotalInflatedBytes: 64 * 1024 * 1024,
});

const PDF_PROMPT = [
  'Extract all readable text and document structure from this PDF.',
  'Transcribe scanned pages as well as embedded text.',
  'Preserve headings, lists, tables and page order in concise plain text.',
].join(' ');

class DocumentRejected extends Error {
  constructor(message) {
    super(message);
    this.name = 'DocumentRejected';
  }
}

const reject = (message) => { throw new DocumentRejected(message); };

function limitsWith(overrides = {}) {
  const limits = { ...ZIP_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${name} must be a positive integer`);
    }
  }
  return limits;
}

function findEndOfCentralDirectory(bytes) {
  // The EOCD is 22 bytes plus a bounded uint16 comment. Searching only that
  // tail avoids treating a signature buried in member data as archive control.
  const first = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= first; offset--) {
    if (bytes.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = bytes.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  reject('The DOCX/XLSX file is not a valid ZIP container.');
}

function readZipDirectory(bytes, limitOverrides) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22) {
    reject('The DOCX/XLSX file is not a valid ZIP container.');
  }
  const limits = limitsWith(limitOverrides);
  const eocd = findEndOfCentralDirectory(bytes);
  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocd + 8);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);

  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    reject('Multi-part DOCX/XLSX ZIP files are not accepted.');
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    reject('ZIP64 DOCX/XLSX files are not accepted.');
  }
  if (entryCount > limits.maxMembers) {
    reject(`The document ZIP has too many members; the limit is ${limits.maxMembers}.`);
  }
  if (centralOffset + centralSize > eocd || centralOffset > bytes.length) {
    reject('The document ZIP central directory is malformed.');
  }

  const entries = new Map();
  let cursor = centralOffset;
  let totalInflated = 0;
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > centralOffset + centralSize || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      reject('The document ZIP central directory is malformed.');
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const inflatedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const startDisk = bytes.readUInt16LE(cursor + 34);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;

    if (next > centralOffset + centralSize) reject('The document ZIP central directory is malformed.');
    if (flags & 1) reject('Encrypted DOCX/XLSX files are not accepted.');
    if (startDisk !== 0) reject('Multi-part DOCX/XLSX ZIP files are not accepted.');
    if (compressedSize === 0xffffffff || inflatedSize === 0xffffffff || localOffset === 0xffffffff) {
      reject('ZIP64 DOCX/XLSX files are not accepted.');
    }
    if (compressedSize > limits.maxCompressedMemberBytes) {
      reject(`A compressed member exceeds the ${limits.maxCompressedMemberBytes}-byte limit.`);
    }
    if (inflatedSize > limits.maxInflatedMemberBytes) {
      reject(`A document member exceeds the ${limits.maxInflatedMemberBytes}-byte inflated limit.`);
    }
    totalInflated += inflatedSize;
    if (totalInflated > limits.maxTotalInflatedBytes) {
      reject(`The document exceeds the ${limits.maxTotalInflatedBytes}-byte total inflated limit.`);
    }

    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (entries.has(name)) reject(`The document ZIP contains a duplicate member: ${name}.`);
    entries.set(name, { name, flags, method, compressedSize, inflatedSize, localOffset });
    cursor = next;
  }
  if (cursor !== centralOffset + centralSize) reject('The document ZIP central directory is malformed.');

  return { bytes, entries, limits };
}

function inflateMember(archive, name) {
  const entry = archive.entries.get(name);
  if (!entry) return null;
  const { bytes, limits } = archive;
  const offset = entry.localOffset;
  if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) {
    reject(`The ZIP header for ${name} is malformed.`);
  }
  const localFlags = bytes.readUInt16LE(offset + 6);
  const localMethod = bytes.readUInt16LE(offset + 8);
  const nameLength = bytes.readUInt16LE(offset + 26);
  const extraLength = bytes.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if ((localFlags & 1) || localMethod !== entry.method || dataEnd > bytes.length) {
    reject(`The ZIP header for ${name} is malformed.`);
  }
  const localName = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
  if (localName !== name) reject(`The ZIP header for ${name} does not match its directory entry.`);

  const compressed = bytes.subarray(dataStart, dataEnd);
  let inflated;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.inflatedSize) reject(`The stored ZIP member ${name} has inconsistent sizes.`);
    inflated = Buffer.from(compressed);
  } else if (entry.method === 8) {
    try {
      inflated = inflateRawSync(compressed, { maxOutputLength: limits.maxInflatedMemberBytes });
    } catch {
      reject(`The ZIP member ${name} could not be inflated within the safety limit.`);
    }
  } else {
    reject(`The ZIP member ${name} uses unsupported compression method ${entry.method}.`);
  }
  if (inflated.length !== entry.inflatedSize) {
    reject(`The ZIP member ${name} expanded to a different size than declared.`);
  }
  return inflated;
}

function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (whole, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    const lower = entity.toLowerCase();
    if (named[lower]) return named[lower];
    const point = lower.startsWith('#x')
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10);
    if (!Number.isInteger(point) || point < 1 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
      return '';
    }
    return String.fromCodePoint(point);
  });
}

function tidyText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \f\v]+\n/g, '\n')
    .replace(/\n[ \f\v]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function wordXmlToText(xml) {
  return tidyText(decodeXml(xml
    .replace(/<w:tab\b[^>]*\/?\s*>/gi, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<\/w:p\s*>/gi, '\n')
    .replace(/<\/w:tc\s*>/gi, '\t')
    .replace(/<\/w:tr\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')));
}

function textRuns(xml) {
  const values = [];
  const pattern = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t\s*>/gi;
  let match;
  while ((match = pattern.exec(xml))) values.push(decodeXml(match[1].replace(/<[^>]*>/g, '')));
  return values.join('');
}

function tagValue(xml, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i').exec(xml);
  return match ? decodeXml(match[1].replace(/<[^>]*>/g, '')) : '';
}

function extractDocx(bytes, limitOverrides) {
  const archive = readZipDirectory(bytes, limitOverrides);
  const member = inflateMember(archive, 'word/document.xml');
  if (!member) reject('The DOCX has no word/document.xml member.');
  const text = wordXmlToText(member.toString('utf8'));
  if (!text.trim()) reject('The DOCX has no readable text in it.');
  return text;
}

function sharedStringsFrom(archive) {
  const member = inflateMember(archive, 'xl/sharedStrings.xml');
  if (!member) return [];
  const xml = member.toString('utf8');
  const strings = [];
  const pattern = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si\s*>/gi;
  let match;
  while ((match = pattern.exec(xml))) strings.push(textRuns(match[1]));
  return strings;
}

function worksheetRows(xml, sharedStrings) {
  const rows = [];
  const rowPattern = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row\s*>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(xml))) {
    const values = [];
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c\s*>/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[1]))) {
      const attributes = cellMatch[1];
      const body = cellMatch[2];
      const typeMatch = /\bt\s*=\s*(["'])(.*?)\1/i.exec(attributes);
      const type = typeMatch ? typeMatch[2] : '';
      let value;
      if (type === 'inlineStr') {
        value = textRuns(body);
      } else if (type === 's') {
        const rawIndex = tagValue(body, 'v').trim();
        const index = /^\d+$/.test(rawIndex) ? Number(rawIndex) : -1;
        if (index < 0 || index >= sharedStrings.length) reject('The XLSX contains an invalid shared-string reference.');
        value = sharedStrings[index];
      } else {
        value = tagValue(body, 'v');
      }
      values.push(tidyText(value).replace(/\n/g, ' '));
    }
    if (values.some((value) => value.trim())) rows.push(values.join('\t'));
  }
  return rows;
}

function extractXlsx(bytes, limitOverrides) {
  const archive = readZipDirectory(bytes, limitOverrides);
  const sheetNames = [...archive.entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet[^/]*\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (!sheetNames.length) reject('The XLSX has no worksheet members.');

  const sharedStrings = sharedStringsFrom(archive);
  const sheets = [];
  for (const name of sheetNames) {
    const rows = worksheetRows(inflateMember(archive, name).toString('utf8'), sharedStrings);
    if (!rows.length) continue;
    const label = name.slice(name.lastIndexOf('/') + 1, -4);
    sheets.push(`[${label}]\n${rows.join('\n')}`);
  }
  const text = sheets.join('\n\n');
  if (!text.trim()) reject('The XLSX has no readable text in it.');
  return text;
}

async function extractPdf({ bytes, mime = 'application/pdf', apiKey, models, signal, fetchImpl, describeImageImpl = describeImage }) {
  if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-', 'ascii'))) {
    reject('The attachment is not a valid PDF file.');
  }
  const text = await describeImageImpl({
    apiKey,
    models,
    prompt: PDF_PROMPT,
    base64: bytes.toString('base64'),
    mime,
    maxTokens: 8192,
    signal,
    fetchImpl,
  });
  if (typeof text !== 'string' || !text.trim()) reject('The PDF has no readable text in it.');
  return text;
}

async function extractDocument({ kind, mime, bytes, apiKey, models, signal, fetchImpl, describeImageImpl, limits } = {}) {
  if (kind === 'pdf') return extractPdf({ bytes, mime, apiKey, models, signal, fetchImpl, describeImageImpl });
  if (kind === 'docx') return extractDocx(bytes, limits);
  if (kind === 'xlsx') return extractXlsx(bytes, limits);
  reject('That document type is not supported.');
}

module.exports = {
  extractDocument,
  extractPdf,
  extractDocx,
  extractXlsx,
  DocumentRejected,
  ZIP_LIMITS,
};

