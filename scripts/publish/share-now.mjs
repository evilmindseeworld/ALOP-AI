/**
 * PUBLISH THE ALREADY-SCHEDULED BUFFER POSTS IMMEDIATELY.
 *
 * Owner instruction, 2026-08-19: "post them all right now".
 *
 * WHY THIS IS NOT A ONE-LINE dueAt EDIT. `editPost` is a REPLACE, not a patch:
 * anything the input omits is cleared. Sending `{ id, dueAt }` alone stripped
 * the media and the per-platform metadata off all thirty posts and Buffer
 * refused every one of them with "Post must have either text or media" - the
 * refusal is why nothing was damaged. So each edit is rebuilt in full, from the
 * same catalogue the create used, and only `mode` changes.
 *
 * The ledger row is NOT released. A published pair still owns its slot -
 * releasing it would let the other scheduler post the same reel tomorrow, which
 * is the duplicate the ledger exists to stop.
 *
 *   node scripts/publish/share-now.mjs            print what would be published
 *   node scripts/publish/share-now.mjs --commit   publish
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBufferClient, metadataFor, resolveChannels } from './buffer.mjs';
import { EXPECTED_ACCOUNTS, mediaUrlFor } from './queue.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const commit = process.argv.includes('--commit');

const { reels } = JSON.parse(await readFile(join(HERE, 'reels.json'), 'utf8'));

/* The ledger is the record of what Buffer holds, so it is what says which posts
 * exist - not a list pasted from a console. */
const res = await fetch(
  `${process.env.SUPABASE_URL}/rest/v1/publishing_ledger?scheduler=eq.buffer&status=eq.scheduled&select=reel_id,platform,scheduler_post_id&order=scheduled_at`,
  { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } },
);
const rows = await res.json();
if (!Array.isArray(rows)) throw new Error(`ledger read failed: ${JSON.stringify(rows).slice(0, 200)}`);

const buffer = createBufferClient();
const orgId = await buffer.organizationId();
const { channels, problems } = resolveChannels(await buffer.channels(orgId), EXPECTED_ACCOUNTS);
if (problems.length) {
  console.error(`REFUSING to publish:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

const EDIT = `mutation EditPost($input: EditPostInput!) {
  editPost(input: $input) { ... on PostActionSuccess { post { id status dueAt } } ... on MutationError { message } }
}`;

const call = (query, variables) => fetch(process.env.BUFFER_ENDPOINT_FOR_TESTS || 'https://api.buffer.com', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.BUFFER_API_KEY}` },
  body: JSON.stringify({ query, variables }),
}).then((r) => r.json());

console.log(`${rows.length} scheduled Buffer posts`);
if (!commit) {
  for (const row of rows) console.log(`would publish ${row.reel_id}/${row.platform} (${row.scheduler_post_id})`);
  console.log('\nDRY RUN — nothing was published. Re-run with --commit.');
  process.exit(0);
}

let done = 0;
const failures = [];
for (const row of rows) {
  const reel = reels.find((r) => r.id === row.reel_id);
  const input = {
    id: row.scheduler_post_id,
    text: reel.captions[row.platform],
    /* Full payload every time. See the header: an omitted field is a cleared field. */
    assets: [{ video: { url: mediaUrlFor(reel, { supabaseUrl: process.env.SUPABASE_URL }) } }],
    metadata: metadataFor(row.platform, reel),
    schedulingType: 'automatic',
    mode: 'shareNow',
  };
  const j = await call(EDIT, { input });
  const r = j.data?.editPost;
  if (j.errors || r?.message) {
    const why = r?.message || JSON.stringify(j.errors).slice(0, 200);
    failures.push({ ...row, why });
    console.error(`FAILED ${row.reel_id}/${row.platform}: ${why}`);
    continue;
  }
  done += 1;
  console.log(`published ${row.reel_id}/${row.platform} → ${r.post.id} status ${r.post.status}`);
  /* One at a time with a gap: three platforms have their own burst limits and a
   * rejected post costs a retry, not a slot. */
  await new Promise((s) => setTimeout(s, 1500));
}
console.log(`\n${done} published, ${failures.length} failed`);
if (failures.length) console.log(failures.map((f) => `${f.reel_id}/${f.platform}: ${f.why}`).join('\n'));
