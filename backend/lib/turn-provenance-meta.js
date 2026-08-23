/*
 * Safe, bounded process memory for one completed turn.
 *
 * This is deliberately a serializer, not a persistence bag. It accepts the
 * route's live facts and emits only the small public record that a reloaded
 * answer may show: phases, counts, outcome, evidence availability and safe
 * public source references. Prompts, drafts, tool bodies and model debates
 * have no path through this file.
 */

const SCHEMA_VERSION = 1;
const MAX_STAGE_KEYS = 8;
const MAX_SOURCES = 24;
const MAX_ID_CHARS = 100;
const MAX_LABEL_CHARS = 60;
const MAX_TITLE_CHARS = 200;
const MAX_URL_CHARS = 2048;

const ROUTES = new Set([
  "arithmetic", "greeting", "memory", "answer_cache", "answer_cache_semantic",
  "search", "wiki", "council", "solo", "fallback", "degraded", "unknown",
]);
const STAGE_KEYS = new Set(["context", "council", "synthesis"]);

const clip = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
const label = (value) => clip(value, MAX_LABEL_CHARS).replace(/[\u0000-\u001f\u007f]/g, "");
const boundedCount = (value, max = 24) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.floor(n)) : 0;
};
const boundedMs = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(86_400_000, Math.round(n)) : null;
};

const safeMessageId = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) return null;
  return value;
};

const parseIpv4 = (value) => {
  const parts = String(value || "").split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
};

const ipv4IsSpecial = (octets) => {
  if (!octets) return false;
  const [a, b, c, d] = octets;
  return a === 0
    || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
    || (a === 255 && b === 255 && c === 255 && d === 255);
};

const parseIpv6 = (value) => {
  let input = String(value || "").toLowerCase();
  if (input.startsWith("[") && input.endsWith("]")) input = input.slice(1, -1);
  if (!input || input.includes("%")) return null;

  const halves = input.split("::");
  if (halves.length > 2) return null;
  const expand = (part) => {
    if (!part) return [];
    const pieces = part.split(":");
    if (pieces.some((piece) => !piece)) return null;
    const values = [];
    for (const piece of pieces) {
      if (piece.includes(".")) {
        const octets = parseIpv4(piece);
        if (!octets || piece !== pieces[pieces.length - 1]) return null;
        values.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
        values.push(parseInt(piece, 16));
      }
    }
    return values;
  };

  const left = expand(halves[0]);
  const right = expand(halves[1]);
  if (!left || !right) return null;
  const values = halves.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
    : [...left];
  return values.length === 8 ? values : null;
};

const ipv6IsSpecial = (value) => {
  const groups = parseIpv6(value);
  if (!groups) return false;
  const first = groups[0];
  if (groups.every((group) => group === 0) || (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1)) return true;
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return true;
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true;

  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const compatible = groups.slice(0, 6).every((group) => group === 0);
  if (mapped || compatible) {
    return ipv4IsSpecial([
      groups[6] >> 8, groups[6] & 0xff,
      groups[7] >> 8, groups[7] & 0xff,
    ]);
  }
  return false;
};

const isPublicHttpHostname = (hostname) => {
  const normalized = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!normalized || normalized === "localhost" || normalized.endsWith(".localhost")
    || normalized === "local" || normalized.endsWith(".local")
    || normalized.endsWith(".internal") || normalized.endsWith(".intranet")
    || normalized.endsWith(".lan") || normalized.endsWith(".home")
    || normalized.endsWith(".corp")) return false;
  const ipv4 = parseIpv4(normalized);
  if (ipv4) return !ipv4IsSpecial(ipv4);
  if (normalized.includes(":")) return !ipv6IsSpecial(normalized);
  return true;
};

const safeUrl = (value) => {
  if (typeof value !== "string" || value.length > MAX_URL_CHARS) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    if (!isPublicHttpHostname(parsed.hostname)) return null;
    parsed.hash = "";
    return parsed.toString().slice(0, MAX_URL_CHARS);
  } catch {
    return null;
  }
};

/** Drop private/tool-only records and retain only displayable public URLs. */
function safeSourceRecords(rows) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.displayable === false || row.private === true) continue;
    const url = safeUrl(row.url);
    if (!url || seen.has(url)) continue;
    let domain = "";
    try { domain = new URL(url).hostname.slice(0, 200); } catch { continue; }
    seen.add(url);
    out.push({
      title: clip(row.title || domain, MAX_TITLE_CHARS).replace(/[\u0000-\u001f\u007f]/g, "") || domain,
      url,
      domain,
      ...(row.date ? { date: clip(String(row.date), 40) } : {}),
      via: label(row.via || "search") || "search",
    });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

const safeStageKeys = (keys) => [...new Set((Array.isArray(keys) ? keys : [])
  .filter((key) => typeof key === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(key))
  .filter((key) => STAGE_KEYS.has(key))
  .slice(0, MAX_STAGE_KEYS))];

/**
 * @returns {{provenance: object}}
 */
function buildTurnProvenanceMeta(input = {}) {
  const stageKeys = safeStageKeys(input.stageKeys);
  const sources = safeSourceRecords(input.sources);
  const councilInput = input.council && typeof input.council === "object" ? input.council : {};
  const synthesisInput = input.synthesis && typeof input.synthesis === "object" ? input.synthesis : {};
  const evidenceInput = input.evidence && typeof input.evidence === "object" ? input.evidence : {};
  const verificationInput = input.verification && typeof input.verification === "object" ? input.verification : null;
  const failureInput = input.failure && typeof input.failure === "object" ? input.failure : {};

  const requestState = ["running", "complete", "failed", "aborted"].includes(input.requestState)
    ? input.requestState
    : "unknown";
  const route = ROUTES.has(input.route) ? input.route : "unknown";
  const answerProduced = Boolean(input.answerProduced);
  const partialCouncil = Boolean(councilInput.partial);
  const synthesisCompleted = Boolean(synthesisInput.completed);
  const failedTools = boundedCount(evidenceInput.failedTools, 24);
  const assembled = requestState === "complete"
    && answerProduced
    && synthesisCompleted
    && !Boolean(failureInput.occurred)
    && !Boolean(failureInput.userAborted);

  return {
    provenance: {
      schemaVersion: SCHEMA_VERSION,
      ...(safeMessageId(input.messageId) ? { messageId: safeMessageId(input.messageId) } : {}),
      requestState,
      route,
      answerProduced,
      stageKeys,
      council: {
        used: Boolean(councilInput.used || stageKeys.includes("council")),
        seatCount: boundedCount(councilInput.seatCount),
        answered: boundedCount(councilInput.answered),
        completed: Boolean(councilInput.completed),
        partial: partialCouncil,
      },
      synthesis: {
        started: Boolean(synthesisInput.started || stageKeys.includes("synthesis")),
        completed: synthesisCompleted,
        skipped: Boolean(synthesisInput.skipped),
        failed: Boolean(synthesisInput.failed),
        fallback: Boolean(synthesisInput.fallback),
      },
      evidence: {
        searchUsed: Boolean(evidenceInput.searchUsed),
        toolUsed: Boolean(evidenceInput.toolUsed),
        toolCount: boundedCount(evidenceInput.toolCount),
        failedTools,
        sourceCount: Math.max(sources.length, boundedCount(evidenceInput.sourceCount, MAX_SOURCES)),
        truncated: Boolean(evidenceInput.truncated),
      },
      verification: verificationInput
        ? {
            completed: true,
            claims: boundedCount(verificationInput.claims, 200),
            grounded: boundedCount(verificationInput.grounded, 200),
            coverage: Number.isFinite(Number(verificationInput.coverage))
              ? Math.max(0, Math.min(1, Number(verificationInput.coverage)))
              : null,
            sources: boundedCount(verificationInput.sources, MAX_SOURCES),
            conflicts: boundedCount(verificationInput.conflicts, MAX_SOURCES),
            unresolved: boundedCount(verificationInput.unresolved, MAX_SOURCES),
          }
        : { completed: false },
      disagreement: {
        detected: Boolean(verificationInput?.conflicts || verificationInput?.unresolved),
        unresolved: boundedCount(verificationInput?.unresolved, MAX_SOURCES),
      },
      completion: {
        assembled,
        qualified: partialCouncil ? "partial_council" : failedTools ? "partial_evidence" : "none",
      },
      failure: {
        occurred: Boolean(failureInput.occurred),
        userAborted: Boolean(failureInput.userAborted),
        kind: label(failureInput.kind) || null,
      },
      timing: {
        turnMs: boundedMs(input.timing?.turnMs),
        msToFirstByte: boundedMs(input.timing?.msToFirstByte),
      },
      sources,
    },
  };
}

module.exports = {
  buildTurnProvenanceMeta,
  safeSourceRecords,
  safeMessageId,
  isPublicHttpHostname,
  SCHEMA_VERSION,
  MAX_SOURCES,
};
