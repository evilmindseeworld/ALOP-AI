/**
 * BUFFER, THE SECOND PUBLISHING BACKEND.
 *
 * Buffer Free gives three channels and a standing queue of ten posts PER
 * channel, and a slot comes back as soon as its post publishes. That is a
 * different shape from a monthly allowance, which is why it adds real capacity
 * rather than moving the ceiling around.
 *
 * WHAT THIS FILE WILL NOT DO:
 *
 *   - It will not read a key from anywhere but the environment. No argument
 *     default, no file, no prompt. `BUFFER_API_KEY` or nothing.
 *   - It will not put the key in a log line, an error message, or a thrown
 *     stack. Every response body and error string goes through `scrub` before
 *     it can reach a console — an API that echoes your Authorization header
 *     back inside a 400 is not a hypothetical.
 *   - It will not create a post against channels it has not first checked are
 *     the ALOP-AI accounts. Buffer keys are account-wide: the same key reaches
 *     every organization and channel the owner belongs to, so "the right key"
 *     and "the right account" are separate questions and only the second one
 *     matters to a publish.
 *
 * Media is passed by URL and Buffer fetches it AT PUBLISH TIME, not at create
 * time. Our reels live in the public `reels` bucket in Supabase Storage, which
 * is a permanent public object URL rather than a signed one, so it is still
 * there days later when the queue reaches it. That is the property that matters
 * — a pre-signed URL would create the post fine and fail silently at publish.
 */

/** Buffer's GraphQL endpoint. The only value production ever uses. */
export const BUFFER_ENDPOINT = 'https://api.buffer.com';

/**
 * Remove the credential from anything about to be shown to a human.
 *
 * Belt and braces: the key is never deliberately put into a message, so every
 * appearance of it is by definition one nobody intended.
 */
export function scrub(text, secret) {
  const s = String(text ?? '');
  if (!secret) return s;
  return s.split(secret).join('[redacted]');
}

export class BufferApiError extends Error {
  constructor(message, { status = null, errors = null } = {}) {
    super(message);
    this.name = 'BufferApiError';
    this.status = status;
    this.errors = errors;
  }
}

/**
 * @param {{fetchImpl?: Function, apiKey?: string, endpoint?: string}} [options]
 *   `apiKey` is for TESTS ONLY and is never given a real value by production
 *   code paths; the default comes from the environment and nowhere else.
 *
 *   `endpoint` is TESTS ONLY as well, and exists so the commit loop can be run
 *   end to end against a stub Buffer in a child process — the failure it proves
 *   (a ledger PATCH failing after a post is real) cannot be reached by calling
 *   functions one at a time. Unset, it is exactly BUFFER_ENDPOINT.
 */
export function createBufferClient({ fetchImpl = globalThis.fetch, apiKey = process.env.BUFFER_API_KEY, endpoint = process.env.BUFFER_ENDPOINT_FOR_TESTS || BUFFER_ENDPOINT } = {}) {
  if (!apiKey) {
    throw new Error('BUFFER_API_KEY is not set. Create a key at Buffer → Settings → API and put it in backend/.env (gitignored). Do not pass it on the command line.');
  }

  const calls = { graphql: 0, createPost: 0 };

  const graphql = async (query, variables = {}, { label = 'request' } = {}) => {
    calls.graphql += 1;
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, variables }),
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new BufferApiError(`Buffer refused the ${label} (HTTP ${res.status}): ${scrub(raw, apiKey).slice(0, 400)}`, { status: res.status });
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new BufferApiError(`Buffer answered the ${label} with a non-JSON body: ${scrub(raw, apiKey).slice(0, 200)}`, { status: res.status });
    }
    if (body.errors?.length) {
      const messages = body.errors.map((e) => scrub(e.message, apiKey)).join('; ');
      /* Scrubbed here as well as in the message: `errors` is an own-enumerable
       * property, so an unscrubbed copy reaches any console.dir, JSON.stringify
       * or crash dump that walks the error. */
      const errors = body.errors.map((e) => ({ ...e, message: scrub(e.message, apiKey) }));
      throw new BufferApiError(`Buffer rejected the ${label}: ${messages}`, { status: res.status, errors });
    }
    return body.data;
  };

  return {
    /** For the dry-run's zero-network assertion. */
    calls,

    async organizationId() {
      const data = await graphql('query GetOrganizations { account { organizations { id } } }', {}, { label: 'organization lookup' });
      const id = data?.account?.organizations?.[0]?.id;
      if (!id) throw new BufferApiError('Buffer returned no organization for this key.');
      return id;
    },

    /**
     * `organizationId` is a CUSTOM SCALAR, `OrganizationId!`, not `ID!`.
     *
     * Declaring it as `ID!` fails validation with "Unknown argument" plus
     * "argument input of type ChannelsInput! is required" — two errors that
     * read like a wrong argument NAME and sent the first version of this
     * function chasing a second spelling the schema does not have. Taken from
     * introspection rather than from the guides, which show `channels(input:)`
     * on one page and `channels(organizationId:)` on another.
     *
     * `isDisconnected` and `isLocked` are fetched because a channel can be
     * present and unpublishable, and a scheduler that cannot tell those apart
     * queues posts into a channel that will never send them.
     */
    async channels(organizationId) {
      const data = await graphql(
        `query GetChannels($organizationId: OrganizationId!) {
           channels(input: { organizationId: $organizationId }) {
             id name displayName service serviceId isDisconnected isLocked isQueuePaused
           }
         }`,
        { organizationId },
        { label: 'channel list' },
      );
      return data?.channels || [];
    },

    /**
     * CREATE ONE POST. Called only after the ledger has granted the claim.
     *
     * `customScheduled` + `dueAt` rather than `addToQueue`: the slot comes from
     * Metricool's measured best-time data, so the time is ours to state, not
     * Buffer's to choose.
     */
    async createPost({ channelId, text, dueAt, videoUrl, thumbnailOffset = null, metadata = {} }) {
      const asset = { video: { url: videoUrl } };
      /* thumbnailOffset picks a FRAME, in milliseconds. It is the only
       * thumbnail control the API has, and it does nothing on YouTube — the
       * covers in the reels bucket cannot be used through Buffer at all. */
      if (Number.isFinite(thumbnailOffset)) asset.video.metadata = { thumbnailOffset };

      calls.createPost += 1;
      const data = await graphql(
        /* `CreatePostInput!`, from introspection, not from the guides.
         *
         * Declared as `PostInput!` the whole batch comes back with
         * `Variable "$input" of type "PostInput!" used in position expecting
         * type "CreatePostInput!"` - a schema validation error, so it fails
         * before any post exists, which is the one good thing about it.
         *
         * `needsApproval` is NON_NULL on that input and has no default. */
        `mutation CreatePost($input: CreatePostInput!) {
           createPost(input: $input) {
             ... on PostActionSuccess { post { id text dueAt } }
             ... on MutationError { message }
           }
         }`,
        {
          input: {
            channelId,
            text,
            schedulingType: 'automatic',
            mode: 'customScheduled',
            needsApproval: false,
            dueAt,
            assets: [asset],
            metadata,
          },
        },
        { label: 'post creation' },
      );
      const result = data?.createPost;
      if (result?.message) throw new BufferApiError(`Buffer would not create the post: ${scrub(result.message, apiKey)}`);
      const id = result?.post?.id;
      if (!id) throw new BufferApiError('Buffer accepted the mutation but returned no post id.');
      return result.post;
    },
  };
}

/**
 * Per-platform metadata. Required fields are required ON CREATE — Buffer
 * rejects the mutation without them, and the rejection names the field, which
 * is a worse way to learn this than the table in the report.
 */
export function metadataFor(platform, reel) {
  switch (platform) {
    case 'instagram':
      /* Both fields are required by InstagramPostMetadataInput. `reel` is the
       * type; sharing to feed matches what the Metricool rows already do
       * (`showReelOnFeed: true`), so the two backends produce the same artefact. */
      return { instagram: { type: 'reel', shouldShareToFeed: true } };
    case 'tiktok':
      /* Everything on TikTokPostMetadataInput is optional. `title` is for photo
       * posts only, so a video post carries nothing but the disclosure flag. */
      return { tiktok: { isAiGenerated: Boolean(reel.isAiGenerated) } };
    case 'youtube':
      if (!reel.youtube?.title) throw new Error(`reel ${reel.id} has no youtube.title, which YoutubePostMetadataInput requires on create`);
      if (!reel.youtube?.categoryId) throw new Error(`reel ${reel.id} has no youtube.categoryId, which YoutubePostMetadataInput requires on create`);
      return {
        youtube: {
          title: reel.youtube.title,
          categoryId: String(reel.youtube.categoryId),
          privacy: reel.youtube.privacy || 'public',
          madeForKids: Boolean(reel.youtube.madeForKids),
        },
      };
    default:
      throw new Error(`unknown platform: ${platform}`);
  }
}

/**
 * REFUSE TO PUBLISH INTO SOMEONE ELSE'S ACCOUNT.
 *
 * A personal Buffer key reaches every channel its owner can see. Matching the
 * accounts we expect is the difference between "the key works" and "the key
 * points at ALOP-AI". Ambiguity is refused too: two connected Instagram
 * channels means the script cannot know which one was meant.
 *
 * MATCHED ON IDS ONLY - `id` and `serviceId`. Display names are not identity.
 * Buffer's `name` is a DISPLAY name and drifts: the ALOP-AI YouTube channel is
 * called "vash" in Buffer while Metricool knows it by its channel id
 * UCjSfNPTI9Obg3wWNnzvDV9g — same channel, and only the id says so. A matcher
 * that reads names alone rejects the right account and, worse, would accept a
 * wrong one that happened to be renamed to the string we expected.
 *
 * A disconnected, locked or paused channel is refused as well. It is present in
 * the list and cannot publish, and a scheduler that cannot tell those apart
 * queues posts into a channel that will never send them.
 *
 * @param {Array<{id: string, name: string, displayName?: string, service: string,
 *                serviceId?: string, isDisconnected?: boolean, isLocked?: boolean,
 *                isQueuePaused?: boolean}>} channels
 * @param {Record<string, string[]>} expected service -> accepted identifiers
 * @returns {{channels: Record<string, string>, problems: string[]}}
 */
export function resolveChannels(channels, expected) {
  const resolved = {};
  const problems = [];
  const clean = (v) => String(v ?? '').toLowerCase().replace(/^@/, '');

  for (const [platform, accepted] of Object.entries(expected)) {
    const onService = (channels || []).filter((c) => clean(c.service) === platform);
    if (!onService.length) {
      problems.push(`no ${platform} channel is connected to this Buffer account`);
      continue;
    }
    const wanted = accepted.map(clean);
    /* `id` first, deliberately: the Buffer channel id is the identifier a
     * rename cannot move, and every account here HAS been renamed once. */
    /* IDS ONLY. The handles in the accepted list are documentation and appear
     * in the refusal below, but a display name is a label the owner can change
     * — matching one would accept a stranger's channel renamed to our handle. */
    const matches = onService.filter((c) => [c.id, c.serviceId].some((id) => id && wanted.includes(clean(id))));

    if (matches.length > 1) {
      problems.push(`${matches.length} ${platform} channels match ${accepted.join(', ')} — refusing to guess which is ALOP-AI`);
      continue;
    }
    if (!matches.length) {
      const seen = onService.map((c) => `${c.name}${c.serviceId ? ` (${c.serviceId})` : ''}`).join(', ');
      problems.push(`the connected ${platform} channel is ${seen}, not one of ${accepted.join(', ')}`);
      continue;
    }

    const channel = matches[0];
    if (channel.isDisconnected) { problems.push(`the ${platform} channel ${channel.name} is disconnected in Buffer and cannot publish`); continue; }
    if (channel.isLocked) { problems.push(`the ${platform} channel ${channel.name} is locked in Buffer and cannot publish`); continue; }
    if (channel.isQueuePaused) { problems.push(`the ${platform} channel ${channel.name} has a paused queue, so a scheduled post would not send`); continue; }
    resolved[platform] = channel.id;
  }
  return { channels: resolved, problems };
}
