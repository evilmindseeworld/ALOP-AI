'use strict';

const crypto = require('node:crypto');

/**
 * The parts of "what produced this answer" that are NOT in the question, and
 * that a cache key has to carry anyway.
 *
 * WHY. `keyFor` already carries everything about the ASK — the words, the
 * language, the country, the plan, the detail level, the branch. What it did
 * not carry is anything about the MACHINE that answered:
 *
 *   - Edit the synthesis prompt and every cached answer was written by the old
 *     one. There is no signal anywhere that they are stale; they simply keep
 *     being served, for up to a week, and the change looks like it did nothing.
 *     This has a name in this repository already — the cascade baseline test
 *     exists because a snapshot that cannot see a change bakes the change in.
 *   - Change the source-truth rules or the length rules and the same.
 *   - Change which model writes the answer and a Gemma answer is served to a
 *     user whose plan now gets Luna.
 *   - Add a tool and the cached answer was produced by a council that did not
 *     have it.
 *   - A search-backed answer and a Wikipedia answer to the same words are not
 *     interchangeable; `branch` covers the seeded/unseeded split but not which
 *     retrieval actually ran.
 *
 * THE FINGERPRINT IS COMPUTED FROM THE ARTEFACT, NOT FROM A VERSION NUMBER
 * SOMEBODY REMEMBERS TO BUMP. A hand-maintained `PROMPT_VERSION = 3` is a
 * constant that goes stale silently, which is the same failure with an extra
 * step. Hashing the prompt strings themselves means editing a prompt IS the
 * invalidation.
 *
 * IT IS SHORT ON PURPOSE. Twelve hex characters of a sha256 over the material,
 * because this is a cache-partition label rather than a security boundary and
 * it goes into a key that already has a full hash around it. A collision costs
 * one wrongly-reused answer at a probability of about 2^-48 per pair; a longer
 * label costs nothing but is not free to read in a log line.
 */

const short = (material) => crypto.createHash('sha256').update(material).digest('hex').slice(0, 12);

/**
 * @param {object} parts
 * @param {string[]} [parts.prompts]   every system prompt that shaped the answer
 * @param {string[]} [parts.policies]  length rules, source-truth rules, identity
 * @param {string[]} [parts.models]    the models that could write the answer
 * @param {object[]|string[]} [parts.toolSchemas]  the registry's schemas
 * @returns {{promptVersion: string, policyVersion: string, modelFamily: string, toolSchema: string}}
 */
function fingerprint({ prompts = [], policies = [], models = [], toolSchemas = [] } = {}) {
  const flat = (list) => list.filter((x) => typeof x === 'string' && x).join('\u0000');
  return {
    promptVersion: short(flat(prompts)),
    policyVersion: short(flat(policies)),
    /* FAMILY, not the exact id. `openai/gpt-5.6-luna` and
     * `openai/gpt-5.6-luna:beta` write the same answer; keying on the full id
     * would drop the whole cache on a routing tweak that changed nothing a
     * reader could see. The vendor prefix is kept because vendors do differ. */
    modelFamily: short(models
      .filter(Boolean)
      .map((m) => String(m).split(':')[0].replace(/-\d{4}-\d{2}-\d{2}$/, ''))
      .sort()
      .join('\u0000')),
    /* Names and parameter names, not descriptions. A description reworded for
     * clarity does not change what the tool can do, and dropping the cache for
     * a typo fix is how a cache stops being worth having. */
    toolSchema: short(toolSchemas
      .map((t) => {
        if (typeof t === 'string') return t;
        const fn = t?.function || t || {};
        const params = Object.keys(fn.parameters?.properties || {}).sort().join(',');
        return `${fn.name || ''}(${params})`;
      })
      .filter(Boolean)
      .sort()
      .join('\u0000')),
  };
}

/**
 * How the evidence for this answer was gathered. Part of the key because two
 * answers to the same words with different provenance are different answers,
 * and part of the row because that is how anyone finds out which.
 *
 * @param {{searched?: boolean, wiki?: boolean, tools?: boolean, files?: boolean}} flags
 */
function retrievalMode({ searched = false, wiki = false, tools = false, files = false } = {}) {
  const parts = [];
  if (tools) parts.push('tools');
  if (searched) parts.push('web');
  if (wiki) parts.push('wiki');
  if (files) parts.push('files');
  return parts.length ? parts.join('+') : 'none';
}

/**
 * How time-sensitive the SOURCES were, which decides how fast the answer rots.
 *
 * Distinct from `retrievalMode`: an answer built from today's news and one built
 * from a decade-old encyclopaedia entry can both come from `web`.
 */
function sourceFreshness(fresh) {
  if (!fresh) return 'evergreen';
  const label = typeof fresh === 'string' ? fresh : fresh.label;
  return typeof label === 'string' && label ? label : 'recent';
}

module.exports = { fingerprint, retrievalMode, sourceFreshness, short };
