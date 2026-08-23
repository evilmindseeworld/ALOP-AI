import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { API_BASE, clientTimezone, untilAborted } from "../lib/api";
import { uid, generateChatTitle, parseImagePrompt, buildImageUrl } from "../lib/format";
import { createReveal } from "../lib/streamReveal";
import { readChats, writeChats } from "../lib/chatCache";
import { rememberPendingTurn, readPendingTurn, clearPendingTurn } from "../lib/pendingTurn";
import { newOperationId, withOperationId, shortOperationId } from "../lib/operationId";
import { processFromProvenance } from "../lib/processSemantics";

const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/* Stage frames are a public progress contract, not hidden reasoning. Keep the
 * key exactly as the server sent it when it is a string, while allowing older
 * or text-only streams to remain renderable with a null key. */
const readStageFrame = (frame) => {
  if (typeof frame?.text !== "string" || !frame.text) return null;
  return {
    key: typeof frame.key === "string" && frame.key.length ? frame.key : null,
    text: frame.text,
  };
};

const readCouncilProgress = (text) => {
  const match = typeof text === "string" && text.match(/\b(\d+)\s+of\s+(\d+)\s+answered\b/i);
  return match ? { answered: Number(match[1]), total: Number(match[2]) } : null;
};

const stageName = (key) => ({
  context: "Context",
  council: "Council",
  synthesis: "Synthesis",
}[key] || (key ? key : "Progress"));

/** How much history the council is given. Older turns are summarised server-side. */
const HISTORY_TURNS = 8;
const HISTORY_CHARS = 4000;

/** How long a reload waits for a turn that is still being written, and how
 *  often it asks. The backend's resume route polls Postgres at 400ms; this is
 *  a page that has just loaded asking across the network, so it is slower on
 *  purpose. */
const RECOVERY_WINDOW_MS = 30000;
const RECOVERY_POLL_MS = 1500;
/* A reconnect is a read from the durable turn ledger, not a second POST.
 * Four bounded reads cover a short flap without turning an outage into a
 * polling loop. The delays apply only while the browser reports a network. */
const RECONNECT_BACKOFF_MS = [250, 750, 1500];
const MAX_RECONNECT_ATTEMPTS = RECONNECT_BACKOFF_MS.length + 1;

const asTransportError = (error) => {
  if (error?.name === "AbortError") return error;
  const wrapped = new Error(error?.message || "Connection lost");
  wrapped.transport = true;
  return wrapped;
};

const browserIsOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * Chat state: CRUD, ordering, and the council streaming loop.
 *
 * This is the one piece of the app with genuinely intricate behaviour, and it
 * is where three separate bugs lived. Each has a note at the point that fixes
 * it — read those before changing the abort path in particular.
 */
export function useChats({ apiCall, getToken, isReady, setToast, userId }) {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [status, setStatus] = useState("idle");
  /* The answer currently arriving is UI state, not persisted chat state.
   *
   * This used to live as the last element of `chat.messages`. Every 16ms reveal
   * paint therefore replaced the chat object and the complete messages array.
   * Memoized bubbles skipped their own render, but MessageList still reconciled
   * every row in a long transcript. Keeping the one changing row beside the
   * persisted tree lets that history retain its identity for the whole stream. */
  const [streamDraft, setStreamDraft] = useState(null);
  /* The durable receipt is hydrated from the turn ledger on reload. This tab
   * map remains as a narrow compatibility bridge for a just-finished turn when
   * the PUT has painted before the next transcript read returns. */
  const [sessionProcesses, setSessionProcesses] = useState({});
  const [feedback, setFeedback] = useState({});
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  /* The list failing is NOT the same as having no chats, and the sidebar used
   * to render both as "No chats yet" — telling a user their conversations are
   * gone when the request merely failed. That is the worst possible lie for
   * this app to tell. Tracked separately so the sidebar can say what actually
   * happened and offer the retry. Mirrors messageLoadError/retryMessages. */
  const [chatsError, setChatsError] = useState(null);
  const [messageLoadState, setMessageLoadState] = useState({});
  const abortRef = useRef(null);
  const retryTurnRef = useRef(null);
  const sendInFlightRef = useRef(false);
  const regenerateInFlightRef = useRef(false);
  const chatsRef = useRef(chats);
  const chatVersionsRef = useRef(new Map());
  const loadingMessagesRef = useRef(new Map());

  /* The reader is the source of truth for recovery, but the browser event is
   * what lets the UI say offline during the gap before that reader rejects. */
  useEffect(() => {
    const onOffline = () => {
      if (!sendInFlightRef.current) return;
      setStatus("offline");
      setStreamDraft((previous) => previous
        ? { ...previous, message: { ...previous.message, turnState: "offline" } }
        : previous);
    };
    window.addEventListener("offline", onOffline);
    return () => window.removeEventListener("offline", onOffline);
  }, []);

  // Event handlers can outlive the render that created them. Keeping the list
  // here lets a send that waited for a transcript use the response that is
  // actually current, not the `activeMessages` array captured before the wait.
  chatsRef.current = chats;

  const activeChat = useMemo(() => chats.find((c) => c.id === activeChatId), [chats, activeChatId]);
  const activeMessages = useMemo(() => activeChat?.messages || [], [activeChat]);
  const activeStream = streamDraft?.chatId === activeChatId ? streamDraft : null;

  /* Once the completed draft has been persisted, keep its existing DOM row in
   * the draft slot until the next send. The full transcript remains available
   * through activeMessages for export and feedback; only the render projection
   * omits the duplicate persisted copy. This preserves the bubble across the
   * stream-to-Markdown swap instead of remounting it at completion.
   *
   * THE TAIL TEST DRIVES BOTH HALVES, and that is the whole correctness of it.
   *
   * The slice used to be conditional while the draft rendered unconditionally,
   * so the two could disagree: if the transcript no longer ended with the
   * draft, nothing was sliced AND the draft still painted, and the answer
   * appeared TWICE. That is reachable. On a 409 the PUT's own recovery calls
   * `loadMessages(..., { force: true })`, which replaces the transcript with
   * the server's copy — a different tail — and the `setToast` that follows in
   * the same catch triggers a paint before `send` gets to clear the draft.
   *
   * A persisted draft is only standing in for the tail while it IS the tail.
   * When it is not, it is stale: do not slice, and do not render it either. */
  const persistedDraftIsTail =
    Boolean(activeStream?.persisted) && activeMessages.at(-1)?.id === activeStream.message.id;
  const draftIsStale = Boolean(activeStream?.persisted) && !persistedDraftIsTail;
  const activeStreamDraft = activeStream && !draftIsStale
    ? { ...activeStream.message, ...(activeStream.process ? { process: activeStream.process } : {}) }
    : null;

  const rememberSessionProcess = useCallback((chatId, messageId, process) => {
    if (!chatId || !messageId || !process) return;
    setSessionProcesses((previous) => ({
      ...previous,
      [chatId]: {
        ...(previous[chatId] || {}),
        [messageId]: process,
      },
    }));
  }, []);

  const renderedMessages = useMemo(
    () => {
      const messages = persistedDraftIsTail ? activeMessages.slice(0, -1) : activeMessages;
      const processes = sessionProcesses[activeChatId] || {};
      return messages.map((message) => {
        const process = processes[message.id];
        return process ? { ...message, process } : message;
      });
    },
    [activeMessages, activeChatId, persistedDraftIsTail, sessionProcesses],
  );

  /**
   * The open conversation's transcript has not arrived yet.
   *
   * `undefined` means "not fetched"; `[]` means "genuinely empty". Without that
   * distinction the two are the same to the UI, and opening a conversation would
   * show the empty state — "ask me anything" over a chat with fifty messages in
   * it — until the fetch landed. On a cold backend that is twenty seconds of
   * telling the user their history is gone.
   */
  const activeMessageLoadState = activeChatId ? messageLoadState[activeChatId] : undefined;
  const isLoadingMessages =
    Boolean(activeChat) &&
    activeChat.messages === undefined &&
    activeMessageLoadState !== "error";
  const messageLoadError = Boolean(activeChat) && (
    (activeChat.messages === undefined && activeMessageLoadState === "error")
    || activeMessageLoadState === "turn-error"
  );

  const sortedChatsRef = useRef([]);

  /**
   * Pinned first, then favourites, then most recently posted in.
   *
   * Transcript content changes on every reveal paint, but neither the sidebar
   * nor the command palette renders it. Projecting the rows to their displayed
   * fields lets both memoized consumers keep the same array identity while a
   * response grows. A changed timestamp can still change the order; if it does
   * not, it is not observable by either consumer and the old array is reused.
   */
  const sortedChats = useMemo(() => {
    const previous = sortedChatsRef.current;
    const previousById = new Map(previous.map((chat) => [chat.id, chat]));
    const ordered = [...chats].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
    });
    const projected = ordered.map((chat) => {
      const old = previousById.get(chat.id);
      if (
        old &&
        old.title === chat.title &&
        old.pinned === Boolean(chat.pinned) &&
        old.favorite === Boolean(chat.favorite)
      ) {
        return old;
      }
      return {
        id: chat.id,
        title: chat.title,
        pinned: Boolean(chat.pinned),
        favorite: Boolean(chat.favorite),
      };
    });

    if (projected.length === previous.length && projected.every((chat, index) => chat === previous[index])) {
      return previous;
    }
    sortedChatsRef.current = projected;
    return projected;
  }, [chats]);

  const createChat = useCallback(async () => {
    try {
      const r = await apiCall("/api/chats", { method: "POST", body: JSON.stringify({ title: "New Chat" }) });
      if (!r.ok) {
        const responseBody = await r.text().catch(() => "");
        const error = new Error(`HTTP ${r.status}`);
        error.status = r.status;
        error.responseBody = responseBody;
        throw error;
      }
      const d = await r.json();
      if (!d?.id) throw new Error("Chat creation returned no id");
      // The POST response normally carries messages: [], but making that
      // invariant explicit keeps a new chat from taking the lazy-load path.
      const chat = { ...d, messages: Array.isArray(d.messages) ? d.messages : [] };
      if (chat.updated_at) chatVersionsRef.current.set(chat.id, chat.updated_at);
      setChats((p) => [chat, ...p]);
      setActiveChatId(d.id);
      return d.id;
    } catch (e) {
      console.error("Failed to create chat", {
        message: e?.message || String(e),
        status: e?.status ?? null,
        responseBody: e?.responseBody ?? null,
      });
      setToast("Failed to create chat");
      return null;
    }
  }, [apiCall, setToast]);

  /**
   * What the New chat button should do, which is not what it was doing.
   *
   * It called createChat(), so pressing it opened a request to the server and
   * waited for a row to come back before the empty state appeared. Both halves
   * of that are wrong. The wait is unnecessary — every send path already calls
   * createChat() itself when there is no active chat, so the row gets made at
   * the moment there is finally something to put in it. And the row itself was
   * often wrong: a user who opens a new chat and changes their mind left an
   * empty "New Chat" behind in the sidebar, which is the litter the lazy-create
   * path was introduced to stop.
   *
   * Clearing the selection is the whole operation. Nothing to await, nothing to
   * roll back, nothing on the server to regret.
   */
  const newChat = useCallback(() => setActiveChatId(null), []);

  /**
   * Load existing chats only.
   *
   * The row is created lazily on the first message, so opening the app no
   * longer leaves an empty "New Chat" behind on every page load.
   */
  const loadChats = useCallback(async () => {
    setChatsError(null);
    try {
      const res = await apiCall("/api/chats");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // `{chats, hasMore}` now; a bare array was the old shape. Both are read so
      // a client running against an older deploy — or a cached bundle mid-roll —
      // still lists conversations instead of showing none.
      const list = Array.isArray(data) ? data : data?.chats;
      if (!Array.isArray(list)) throw new Error("Invalid chats response");

      for (const chat of list) {
        // A list response can be older than a transcript PUT that completed
        // while this request was in flight. Never let that metadata roll the
        // CAS token backwards; a stale token causes a safe 409, but it makes
        // an otherwise valid next message look unsaveable to the user.
        if (chat?.id && chat.updated_at && !chatVersionsRef.current.has(chat.id)) {
          chatVersionsRef.current.set(chat.id, chat.updated_at);
        }
      }

      setChats((current) => {
        const byId = new Map(current.map((chat) => [chat.id, chat]));
        const listedIds = new Set(list.map((chat) => chat.id));
        const loaded = list.map((chat) => {
          const previous = byId.get(chat.id);
          // Do not throw away a transcript that arrived while this list request
          // was in flight. This also preserves a newly-created chat if the first
          // list response was older than the POST that created it.
          return previous?.messages !== undefined
            ? { ...chat, messages: previous.messages, updated_at: previous.updated_at || chat.updated_at }
            : chat;
        });
        /* A row the server did not list is either a chat this tab just made, or
         * one restored from localStorage that has since been deleted — possibly
         * on another device. Only the first deserves to survive, which is what
         * `fromCache` distinguishes. Without that test, deleting a conversation
         * anywhere else brings it back on the next reload here, forever. */
        const localOnly = current.filter((chat) => !listedIds.has(chat.id) && !chat.fromCache);
        return [...loaded, ...localOnly];
      });
    } catch (e) {
      console.error(e.message);
      setChatsError(e.message || "Request failed");
      setToast("Couldn't load your chats.");
    } finally {
      setIsInitialLoading(false);
    }
  }, [apiCall, setToast, userId]);

  /**
   * Paint the last known sidebar before the request that replaces it.
   *
   * Runs before loadChats rather than instead of it: this is
   * stale-while-revalidate, not a cache the app trusts. The list request still
   * goes out on every mount and its answer wins.
   *
   * `isInitialLoading` goes false here on a hit, which is the whole point —
   * that flag is what puts the full app skeleton on screen, and there is no
   * reason to show a placeholder for a list already on screen.
   *
   * Guarded on chats being empty so a revalidation that has already landed is
   * never overwritten by an older cached copy.
   */
  useEffect(() => {
    if (!isReady || !userId) return;
    if (chatsRef.current.length > 0) return;
    const cached = readChats(userId);
    if (!cached) return;
    setChats(cached);
    setIsInitialLoading(false);
  }, [isReady, userId]);

  useEffect(() => {
    if (isReady) loadChats();
  }, [isReady, loadChats]);

  /**
   * Keep the cache current, from ONE place rather than from every mutation.
   *
   * Rename, pin, favourite, delete and create all change the sidebar, and
   * writing from each of them is five call sites and five chances for the sixth
   * to be forgotten. Watching the state they all end up in cannot be forgotten.
   *
   * KEYED ON A SIGNATURE, NOT ON `chats`, and that is not a micro-optimisation.
   * `chats` gets a new identity on every painted frame of a streaming answer,
   * roughly sixty times a second, and an effect on it would serialise and write
   * to localStorage at that rate for a payload that has not changed. The
   * signature covers only the fields the cache actually stores, so it stays
   * still while a message streams.
   */
  const chatsSignature = useMemo(
    () => chats.map((c) => `${c.id} ${c.title} ${c.pinned} ${c.favorite}`).join(""),
    [chats]
  );

  useEffect(() => {
    if (!isReady || !userId) return;
    // Not while the first list request is still out. Writing here would persist
    // the hydrated copy back over itself, and on a failed load it would persist
    // an empty list over a good one.
    if (isInitialLoading || chatsError) return;
    writeChats(userId, chatsRef.current);
    // chatsRef is read rather than `chats` so this depends on the signature
    // alone; adding `chats` would restore the per-frame writes the signature
    // exists to prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatsSignature, isReady, userId, isInitialLoading, chatsError]);

  /**
   * Messages arrive per conversation, not with the list.
   *
   * /api/chats used to return every message of every chat so the sidebar could
   * render titles — megabytes of JSON to draw a list of rows, of which the
   * client kept one conversation's worth and discarded the rest. The list is
   * now metadata only and this fills in the one transcript being read.
   *
   * `messages === undefined` is the "not fetched yet" marker and an empty array
   * is a genuinely empty conversation, so the two are distinguishable and a new
   * chat never triggers a pointless request. Once loaded it stays in `chats`,
   * so switching back to a conversation costs nothing.
   */
  const loadMessages = useCallback(
    async (chatId, { force = false } = {}) => {
      if (!chatId) return null;

      // One promise per chat prevents StrictMode, rapid switching, and a retry
      // click from creating competing reads. A response is applied by chat id,
      // never by whichever conversation happens to be active when it lands.
      const pending = loadingMessagesRef.current.get(chatId);
      if (pending) return pending;

      let request;
      request = (async () => {
        setMessageLoadState((p) => ({ ...p, [chatId]: "loading" }));
        try {
          const res = await apiCall(`/api/chats/${chatId}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const full = await res.json();
          if (!full || !Array.isArray(full.messages)) throw new Error("Invalid conversation response");
          const provenanceByMessage = new Map(
            (Array.isArray(full.turns) ? full.turns : [])
              .map((turn) => [turn?.provenance?.messageId, turn?.provenance])
              .filter(([messageId, provenance]) => messageId && provenance),
          );
          const hydratedMessages = full.messages.map((message) => {
            const provenance = provenanceByMessage.get(message?.id);
            const process = processFromProvenance(provenance);
            return provenance
              ? { ...message, provenance, ...(process ? { process } : {}) }
              : message;
          });

          const knownVersion = chatVersionsRef.current.get(chatId);
          const fullTime = typeof full.updated_at === "string" ? Date.parse(full.updated_at) : NaN;
          const knownTime = typeof knownVersion === "string" ? Date.parse(knownVersion) : NaN;
          // A late ordinary GET must not move the CAS token behind a PUT that
          // already completed. Forced reloads are authoritative; otherwise
          // only an actually newer ISO timestamp may replace known metadata.
          if (
            full.updated_at &&
            (force || !knownVersion || (Number.isFinite(fullTime) && (!Number.isFinite(knownTime) || fullTime >= knownTime)))
          ) {
            chatVersionsRef.current.set(chatId, full.updated_at);
          }
          setChats((p) =>
            p.map((c) => {
              if (c.id !== chatId) return c;
              // A forced reload is used after a server conflict. The ordinary
              // path refuses to overwrite local messages that appeared while
              // the GET was in flight; a late read must never erase a write.
              if (!force && c.messages !== undefined) return c;
              return { ...c, ...full, messages: hydratedMessages };
            })
          );
          setMessageLoadState((p) => ({ ...p, [chatId]: "loaded" }));
          return { ...full, messages: hydratedMessages };
        } catch (e) {
          console.error(e.message);
          setMessageLoadState((p) => ({ ...p, [chatId]: "error" }));
          setToast("Couldn't load that conversation.");
          return null;
        } finally {
          if (loadingMessagesRef.current.get(chatId) === request) loadingMessagesRef.current.delete(chatId);
        }
      })();
      loadingMessagesRef.current.set(chatId, request);
      return request;
    },
    [apiCall, setToast]
  );

  useEffect(() => {
    if (!isReady || !activeChatId) return;
    const c = chats.find((x) => x.id === activeChatId);
    if (c && c.messages === undefined) loadMessages(activeChatId);
  }, [isReady, activeChatId, chats, loadMessages]);

  const ensureMessagesLoaded = useCallback(
    async (chatId) => {
      if (!chatId) return [];
      const current = chatsRef.current.find((chat) => chat.id === chatId);
      if (!current) return null;
      if (current.messages !== undefined) return current.messages;

      const full = await loadMessages(chatId);
      if (!full) return null;
      // Another update may have landed while the GET was open. Read the ref
      // after the await so callers never continue with the closure's old `[]`.
      const latest = chatsRef.current.find((chat) => chat.id === chatId);
      return Array.isArray(latest?.messages) ? latest.messages : full.messages;
    },
    [loadMessages]
  );

  const retryMessages = useCallback(
    (chatId = activeChatId) => {
      if (!chatId) return Promise.resolve(null);
      const turnRetry = retryTurnRef.current;
      if (turnRetry?.chatId === chatId) return turnRetry.retry();
      return loadMessages(chatId, { force: true });
    },
    [activeChatId, loadMessages]
  );

  const updateChatMessages = useCallback(
    async (chatId, messages, saveToDb = true) => {
      const previousChat = chatsRef.current.find((chat) => chat.id === chatId);
      const previousMessages = previousChat?.messages;
      setChats((p) =>
        p.map((c) => (c.id === chatId ? { ...c, messages, updated_at: new Date().toISOString() } : c))
      );
      if (!saveToDb) return true;

      const expectedUpdatedAt = chatVersionsRef.current.get(chatId);
      const body = { messages };
      if (expectedUpdatedAt) body.expectedUpdatedAt = expectedUpdatedAt;

      let reloadedAfterFailure = false;
      try {
        const res = await apiCall(`/api/chats/${chatId}`, { method: "PUT", body: JSON.stringify(body) });
        const responseBody = typeof res.json === "function" ? await res.json().catch(() => ({})) : {};
        if (!res.ok) {
          if (res.status === 409) {
            // The server refused a stale replacement. Reload its copy before
            // returning so the local optimistic transcript cannot masquerade as
            // saved data and cannot be followed by another stale PUT.
            reloadedAfterFailure = Boolean(await loadMessages(chatId, { force: true }));
            throw new Error("Chat changed elsewhere. Latest transcript restored.");
          }
          throw new Error(responseBody.error || `HTTP ${res.status}`);
        }
        if (responseBody.updated_at) chatVersionsRef.current.set(chatId, responseBody.updated_at);
        return true;
      } catch (e) {
        // A failed HTTP response is not proof the database rejected the write:
        // a timeout can happen after Supabase committed it. Reload first so a
        // committed answer survives a lost response; if that reload also
        // fails, restore the last known local copy instead of showing an
        // optimistic transcript that will disappear on the next page load.
        if (!reloadedAfterFailure) {
          const latest = await loadMessages(chatId, { force: true });
          if (!latest && previousChat) {
            setChats((p) =>
              p.map((chat) => (chat.id === chatId ? { ...chat, messages: previousMessages } : chat))
            );
          }
        }
        console.error(e.message);
        setToast(e.message || "Couldn't save that conversation.");
        return false;
      }
    },
    [apiCall, loadMessages, setToast]
  );

  /**
   * THE TURN THAT OUTLIVED THE TAB.
   *
   * Every other recovery path in this hook lives inside `send`'s closure and
   * dies with it. Reload mid-council — or let a phone discard a backgrounded
   * tab, which it will — and the operation id is gone while the server carries
   * on writing the answer to the turn ledger. The user message was persisted
   * before the POST, so what comes back is a question with silence under it.
   *
   * `lib/pendingTurn.js` leaves the id where a reload can find it. This asks
   * the ledger for the answer and appends it, once.
   *
   * IT POLLS, and only the once-per-mount kind: the turn may still be running,
   * in which case the answer arrives seconds later and the reload should show
   * it rather than a gap. Bounded at 30s because that is roughly a council's
   * own ceiling, and giving up leaves the record in place — the next reload
   * tries again until the fifteen-minute expiry.
   * ponytail: the /stream endpoint would paint it as it arrives instead of in
   * one block; that needs `send`'s SSE reader lifted out of its closure first.
   *
   * THE DUPLICATE GUARD IS THE PART THAT MATTERS. Two tabs both reload, or a
   * turn is recovered that had in fact been saved: appending unconditionally
   * would write the same answer twice into a transcript. A transcript whose
   * last message is already an assistant one has nothing to recover.
   */
  const recoveredTurnRef = useRef(false);
  /* UNMOUNT, not "this effect re-ran". The recovery below can be waiting on a
   * turn that is still being written, and its effect depends on callbacks that
   * are re-created when the chat list changes — which the recovery itself
   * causes. A cleanup that cancelled the wait would therefore abandon it, and
   * the `recoveredTurnRef` guard means nothing restarts it. This ref is set by
   * an effect that has no dependencies, so it only ever fires on unmount. */
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  useEffect(() => {
    /* After the chat list, not before it. `ensureMessagesLoaded` answers null
     * for a conversation it cannot find in the list, and this effect gets one
     * attempt per mount — running it against an empty list would spend that
     * attempt on a lookup that could not have succeeded. */
    if (!isReady || !userId || isInitialLoading || recoveredTurnRef.current) return;
    const pending = readPendingTurn(userId);
    if (!pending) return;
    recoveredTurnRef.current = true;

    (async () => {
      const deadline = Date.now() + RECOVERY_WINDOW_MS;
      try {
        while (mountedRef.current) {
          const res = await apiCall(`/api/turns/${pending.operationId}`);
          /* 404 is the ledger saying there is nothing to resume — the turn was
           * never written, or it has aged out. Anything else (401 mid-refresh,
           * 429 from the resume limiter, a 500) is this attempt failing rather
           * than an answer not existing, so the record stays for next time. */
          if (res.status === 404) { clearPendingTurn(userId); return; }
          if (!res.ok) return;
          const turn = await res.json().catch(() => null);
          if (!turn) return;
          if (turn.complete && turn.answer) {
            if (!mountedRef.current) return;
            const messages = await ensureMessagesLoaded(pending.chatId);
            // A failed transcript read is not an empty transcript. Leaving the
            // record is what lets the next reload try again.
            if (!messages || !mountedRef.current) return;
            if (messages[messages.length - 1]?.role === "assistant") {
              clearPendingTurn(userId);
              return;
            }
            await updateChatMessages(pending.chatId, [
              ...messages,
              {
                role: "assistant",
                content: turn.answer,
                ts: now(),
                id: turn.provenance?.messageId || uid(),
                ...(turn.provenance ? { provenance: turn.provenance, process: processFromProvenance(turn.provenance) } : {}),
                recovered: true,
              },
            ]);
            clearPendingTurn(userId);
            return;
          }
          if (Date.now() >= deadline) return;
          await new Promise((resolve) => setTimeout(resolve, RECOVERY_POLL_MS));
        }
      } catch {
        /* Offline, or the backend is cold. The record survives; so does the
         * answer, in the ledger. */
      }
    })();
  }, [isReady, userId, isInitialLoading, apiCall, ensureMessagesLoaded, updateChatMessages]);

  /**
   * Optimistic, like rename and pin above it, and for a stronger reason than
   * either: deleting was the one destructive action in the sidebar that made
   * the user watch a round trip to find out whether it had worked. The row sat
   * there for the length of a request to Mumbai and back, which invites a
   * second click on a row that is already being deleted.
   *
   * The failure path is the part worth getting right. The chat is put back and
   * the user is told, rather than the row quietly staying gone while the
   * conversation still exists on the server — an optimistic delete that hides
   * its own failure is worse than a slow one, because the next reload
   * resurrects a conversation the user believes they deleted.
   *
   * Version and load-state bookkeeping is only cleared once the server has
   * confirmed: throwing away the CAS token for a chat that turns out to still
   * exist would make its next message unsaveable.
   */
  const deleteChat = useCallback(
    async (id) => {
      const removed = chatsRef.current.find((c) => c.id === id);
      if (!removed) return;
      const wasActive = activeChatId === id;

      setChats((p) => p.filter((c) => c.id !== id));
      setActiveChatId((current) => (current === id ? null : current));

      try {
        const res = await apiCall(`/api/chats/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        chatVersionsRef.current.delete(id);
        loadingMessagesRef.current.delete(id);
        setMessageLoadState((p) => {
          const next = { ...p };
          delete next[id];
          return next;
        });
      } catch (e) {
        console.error(e.message);
        // Sorting is derived, so re-appending restores the row to its own
        // place without having to remember an index.
        setChats((p) => (p.some((c) => c.id === id) ? p : [...p, removed]));
        if (wasActive) setActiveChatId(id);
        setToast("Couldn't delete that chat.");
      }
    },
    [activeChatId, apiCall, setToast]
  );

  const renameChat = useCallback(
    async (id, title) => {
      if (!title?.trim()) return;
      const before = chatsRef.current.find((chat) => chat.id === id)?.title;
      setChats((p) => p.map((c) => (c.id === id ? { ...c, title } : c)));
      try {
        const res = await apiCall(`/api/chats/${id}`, { method: "PUT", body: JSON.stringify({ title }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        console.error(e.message);
        setChats((p) => p.map((c) => (c.id === id ? { ...c, title: before } : c)));
        setToast("Couldn't save chat title.");
      }
    },
    [apiCall, setToast]
  );

  /**
   * Optimistic: flip locally so the sidebar responds instantly, then persist
   * and roll back if the write fails. These used to be local-only, which is
   * why pins silently vanished on reload.
   */
  const toggleChatFlag = useCallback(
    async (id, field) => {
      const current = chats.find((c) => c.id === id);
      if (!current) return;

      const next = !current[field];
      setChats((p) => p.map((c) => (c.id === id ? { ...c, [field]: next } : c)));

      try {
        const res = await apiCall(`/api/chats/${id}`, { method: "PUT", body: JSON.stringify({ [field]: next }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        setChats((p) => p.map((c) => (c.id === id ? { ...c, [field]: !next } : c)));
        setToast(`Couldn't save ${field === "pinned" ? "pin" : "favorite"}.`);
      }
    },
    [chats, apiCall, setToast]
  );

  const togglePinChat = useCallback((id) => toggleChatFlag(id, "pinned"), [toggleChatFlag]);
  const toggleFavoriteChat = useCallback((id) => toggleChatFlag(id, "favorite"), [toggleChatFlag]);

  const submitFeedback = useCallback(
    async (msgId, type) => {
      setFeedback((p) => ({ ...p, [msgId]: type }));
      try {
        if (!activeChatId) return;
        const messages = await ensureMessagesLoaded(activeChatId);
        if (!messages) return;
        const idx = messages.findIndex((m) => m.id === msgId);
        if (idx === -1) return;
        const msg = messages[idx];
        // The question that produced this answer, for the learning store.
        const question = idx > 0 ? messages[idx - 1]?.content : "";
        await apiCall("/api/feedback", {
          method: "POST",
          body: JSON.stringify({ messageId: msgId, feedback: type, question, answer: msg.content }),
        });
        setToast(type === "up" ? "AI will learn from this good answer." : "Noted. AI will avoid this pattern.");
      } catch (e) {
        console.error(e.message);
      }
    },
    [activeChatId, apiCall, ensureMessagesLoaded, setToast]
  );

  const generateImage = useCallback(
    async (promptText) => {
      const imagePrompt = parseImagePrompt(promptText) || promptText;
      if (!imagePrompt) {
        setToast("Describe image");
        return;
      }
      if (status !== "idle" || sendInFlightRef.current || regenerateInFlightRef.current) return;
      sendInFlightRef.current = true;
      setStreamDraft(null);
      setStatus("loading");

      // The chat row is created here rather than earlier. An earlier revision
      // called createChat() BEFORE the image-request check, and generateImage
      // called it again from a closure holding a stale activeChatId — which
      // produced two rows for one image.
      let chatId = activeChatId;
      let created = false;
      if (!chatId) {
        chatId = await createChat();
        created = true;
      }
      if (!chatId) {
        sendInFlightRef.current = false;
        setStatus("idle");
        return;
      }

      const baseMessages = created ? [] : await ensureMessagesLoaded(chatId);
      if (!baseMessages) {
        sendInFlightRef.current = false;
        setStatus("idle");
        return;
      }

      const userMsg = { role: "user", content: `Generate image: ${imagePrompt}`, ts: now(), id: uid() };
      const withUser = [...baseMessages, userMsg];
      if (!(await updateChatMessages(chatId, withUser))) {
        sendInFlightRef.current = false;
        setStatus("idle");
        return;
      }

      if (baseMessages.length === 0) {
        const title = generateChatTitle(imagePrompt);
        if (title) renameChat(chatId, title);
      }

      const saved = await updateChatMessages(chatId, [
        ...withUser,
        { role: "assistant", content: "", imageUrl: buildImageUrl(imagePrompt), imagePrompt, ts: now(), id: uid() },
      ]);
      sendInFlightRef.current = false;
      setStatus("idle");
      if (!saved) return;
    },
    [activeChatId, createChat, ensureMessagesLoaded, renameChat, status, updateChatMessages, setToast]
  );

  /**
   * There was no way to stop a running generation. abortRef existed, but only
   * to cancel the previous request when a new one started — a long or wrong
   * answer had to be waited out in full.
   */
  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /**
   * Documents attached to the active conversation.
   *
   * Kept separate from `messages` on purpose. An image belongs to one message;
   * a document belongs to the CONVERSATION, and the council can read it on any
   * turn via read_file. Storing it in the transcript would mean re-sending its
   * contents with every request, which is the thing the opaque-id design exists
   * to avoid.
   */
  const [chatFiles, setChatFiles] = useState([]);

  /* A FAILED LOAD IS NOT AN EMPTY ATTACHMENT LIST.
   *
   * Both branches here used to set []. So a user who had attached three
   * documents to a conversation opened it after a failed request and saw
   * none — identical on screen to the server having lost them. Nothing had
   * happened to the files; the read failed. Same class as the chat list, and
   * the same fix: track it, say it, offer the retry. */
  const [chatFilesError, setChatFilesError] = useState(null);

  const loadChatFiles = useCallback(
    async (chatId) => {
      setChatFilesError(null);
      if (!chatId) return setChatFiles([]);
      try {
        const res = await apiCall(`/api/chats/${chatId}/files`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setChatFiles(await res.json());
      } catch (e) {
        // The list is left ALONE rather than cleared. If a previous load
        // succeeded, those attachments are still the truth we last saw, and
        // replacing them with nothing is the lie this exists to prevent.
        setChatFilesError(e.message || "Request failed");
      }
    },
    [apiCall]
  );

  useEffect(() => {
    if (isReady) loadChatFiles(activeChatId);
  }, [isReady, activeChatId, loadChatFiles]);

  const retryChatFiles = useCallback(
    () => loadChatFiles(activeChatId),
    [activeChatId, loadChatFiles]
  );

  /**
   * Read a picked file and hand the bytes to the server.
   *
   * base64 rather than multipart: every other endpoint here speaks JSON, the
   * ceiling is 512KB, and adding a multipart parser to the request path for
   * one route is a dependency and an attack surface for no gain at this size.
   *
   * The server decides what is acceptable — this does no validation beyond
   * refusing an empty pick, because a client-side check is a convenience and
   * never a boundary.
   */
  const uploadFile = useCallback(
    async (file) => {
      if (!file) return;
      let chatId = activeChatId;
      if (!chatId) chatId = await createChat();
      if (!chatId) return;

      try {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          // result is a data URL; the payload is everything after the comma.
          reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
          reader.onerror = () => reject(new Error("Could not read that file."));
          reader.readAsDataURL(file);
        });

        const res = await apiCall(`/api/chats/${chatId}/files`, {
          method: "POST",
          body: JSON.stringify({ name: file.name, mime: file.type, base64 }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          // The server's rejection messages are written to be shown verbatim.
          setToast(body.error || "That file could not be attached.");
          return;
        }
        setChatFiles((p) => [...p, body]);
        setToast(`${body.name} attached — the council can read it.`);
      } catch (e) {
        setToast(e.message || "That file could not be attached.");
      }
    },
    [activeChatId, createChat, apiCall, setToast]
  );

  const removeFile = useCallback(
    async (fileId) => {
      if (!activeChatId) return;
      const before = chatFiles;
      setChatFiles((p) => p.filter((f) => f.id !== fileId));
      try {
        const res = await apiCall(`/api/chats/${activeChatId}/files/${fileId}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        setChatFiles(before);
        setToast("Couldn't remove that file.");
      }
    },
    [activeChatId, chatFiles, apiCall, setToast]
  );

  /**
   * Keep a file across every conversation, or put it back in this one.
   *
   * OPTIMISTIC, AND REVERTED ON FAILURE, like removeFile above: the button is
   * a toggle, and a toggle that waits for a round trip before moving reads as
   * broken. The server's own message is shown on failure because the one that
   * matters — the workspace is full — names a number the client does not know.
   */
  const setFileWorkspace = useCallback(
    async (fileId, workspace) => {
      if (!activeChatId) return;
      const before = chatFiles;
      setChatFiles((p) => p.map((f) => (f.id === fileId ? { ...f, workspace } : f)));
      try {
        const res = await apiCall(`/api/chats/${activeChatId}/files/${fileId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        setChatFiles(before);
        setToast(err?.message || "Couldn't change where that file is kept.");
      }
    },
    [activeChatId, chatFiles, apiCall, setToast]
  );

  /**
   * Hand the user back the file they uploaded.
   *
   * TWO STEPS, AND THE SECOND ONE IS THE BROWSER'S. The server answers with a
   * signed URL that is valid for sixty seconds and for one object, rather than
   * streaming the bytes back through the API — so this opens that URL and does
   * not hold the file in memory at any point.
   *
   * `window.open` rather than a hidden anchor click: the URL carries
   * `?download=<name>`, so the response arrives with a Content-Disposition and
   * the browser saves it under the original filename instead of a signature.
   */
  const downloadFile = useCallback(
    async (fileId) => {
      if (!activeChatId) return;
      try {
        const res = await apiCall(`/api/chats/${activeChatId}/files/${fileId}/download`);
        if (!res.ok) {
          /* 404 here is a real answer, not a fault: the original of a file
             uploaded before originals were kept was never stored. The server
             writes that sentence for the user; show it rather than a generic
             failure they would retry forever. */
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const { url } = await res.json();
        if (!url) throw new Error("no download url");
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (err) {
        setToast(err?.message || "Couldn't download that file.");
      }
    },
    [activeChatId, apiCall, setToast]
  );

  /**
   * `baseMessages` is what the new exchange is appended to. It defaults to the
   * live transcript, and only regenerate passes anything else: it has just
   * truncated the transcript, and this closure still holds the pre-truncation
   * copy — sending against that put the discarded answer back and duplicated
   * the question.
   */
  const send = useCallback(
    async (text, attachedImage, onAttachmentConsumed, suppliedBaseMessages) => {
      const cleanText = text.trim();
      if (!cleanText || status !== "idle" || sendInFlightRef.current || regenerateInFlightRef.current) return;
      sendInFlightRef.current = true;
      // A completed draft stays mounted to preserve its DOM at stream close.
      // It joins ordinary history when the next exchange begins.
      setStreamDraft(null);
      // Lock before any await. Otherwise two clicks during a transcript fetch
      // both observe the old `idle` closure and append competing turns.
      setStatus("loading");

      let chatId = activeChatId;
      let created = false;
      if (!chatId) {
        chatId = await createChat();
        created = true;
      }
      if (!chatId) {
        sendInFlightRef.current = false;
        setStatus("idle");
        return;
      }

      const loadedMessages = created ? [] : await ensureMessagesLoaded(chatId);
      if (!loadedMessages) {
        sendInFlightRef.current = false;
        setStatus("idle");
        return;
      }
      // `suppliedBaseMessages` is used only by regenerateLast. It is the
      // deliberate replacement base for one compare-and-set write; keeping the
      // old answer in the database until that write succeeds makes a failed
      // regeneration leave the original exchange intact.
      const baseMessages = suppliedBaseMessages ?? loadedMessages;

      const image = attachedImage;
      try {
        onAttachmentConsumed?.();
      } catch (error) {
        // This callback belongs to the composer, not this hook. It normally
        // only clears a preview, but a caller exception must not strand the
        // message-operation lock and permanently disable future sends.
        sendInFlightRef.current = false;
        setStatus("idle");
        throw error;
      }

      // imagePreview is local-only: the server whitelist keeps hasImage and
      // drops it, so a reloaded chat shows the marker without storing
      // megabytes per row.
      const userMsg = {
        role: "user",
        content: cleanText,
        ts: now(),
        id: uid(),
        ...(image ? { hasImage: true, imagePreview: image } : {}),
      };
      const updated = [...baseMessages, userMsg];
      if (!(await updateChatMessages(chatId, updated))) {
        sendInFlightRef.current = false;
        setStatus("idle");
        return;
      }

      if (baseMessages.length === 0) {
        // TWO TITLES, IN ORDER. The local one is the first six words and lands
        // instantly, so the sidebar never shows "New Chat" while a request is
        // in flight. The model-written one replaces it when it arrives.
        //
        // Deliberately not awaited. A title is not on the path to an answer,
        // and blocking the send on it would trade the thing the user asked for
        // against the label on the row they are already looking at.
        const title = generateChatTitle(cleanText);
        if (title) renameChat(chatId, title);

        getToken()
          .then((token) =>
            fetch(`${API_BASE}/api/chat-title`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ message: cleanText }),
            }),
          )
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            // Null is the documented "keep what you had" answer, not an error —
            // the endpoint returns 200 with title: null for every failure,
            // precisely so this branch stays one condition.
            if (d?.title) renameChat(chatId, d.title);
          })
          // Swallowed on purpose. The chat already has a title; a failed
          // rename is not something to tell the user about.
          .catch(() => {});
      }

      const assistantId = uid();
      const assistantMsg = { role: "assistant", content: "", typing: true, ts: now(), id: assistantId };
      const initialProcess = {
        phase: "working",
        reserve: true,
        activeKey: null,
        terminalKey: null,
        stages: [],
        frames: [],
        synthesisSeen: false,
        partialCouncil: false,
        pendingTools: false,
        announcement: "Assembling your answer.",
      };
      setStreamDraft({ chatId, message: assistantMsg, process: initialProcess });

      const history = baseMessages
        .filter((m) => m.content && m.content.trim() && !m.typing)
        .slice(-HISTORY_TURNS)
        .map((m) => ({ role: m.role, content: m.content.slice(0, HISTORY_CHARS) }));

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      // Hoisted so the catch can persist whatever streamed before an abort.
      // Discarding it would throw away text the user already watched arrive.
      let acc = "";
      // Hoisted for the same reason, and a stronger one: this is a live 16ms
      // interval. The catch has to be able to clear it, or an aborted request
      // leaves a timer repainting a message that is no longer being written.
      let painterRef = null;
      // Mutated in place as frames arrive, and spread into the message on each
      // render so React sees a new array. It is deliberately NOT state: a
      // setState per frame would re-render the whole transcript on every tool
      // event, and the transcript already re-renders per chunk.
      const activity = [];

      /* One operation id covers the POST and every ledger read. A new POST
       * would create a new server turn and reserve a second budget, so a
       * reconnect is deliberately GET-only. */
      const operationId = newOperationId();
      /* Written BEFORE the POST, not after it opens. The window this exists to
       * cover starts at the request, and a tab discarded in it would otherwise
       * leave a turn the server is paying for and no client will ever claim. */
      rememberPendingTurn(userId, { chatId, operationId });
      let started = false;
      let stage = null;
      /* `stage` is the current frame; these two collections are the bounded
       * UI receipt that keeps the ordered process visible after the current
       * line changes. They never enter `finalMessage`, so this phase does not
       * change chat persistence or the backend message schema. */
      const stageFrames = [];
      const stageRows = [];
      let liveProvenance = null;
      let turnOperationId = operationId;
      let reconnectAttempts = 0;
      let persistCompletedTurn;
      let failTurn;
      let announcement = initialProcess.announcement;
      const announcedStageKeys = new Set();
      let councilFirstAnnounced = false;
      let councilCompleteAnnounced = false;

      const announceStage = (event) => {
        const progress = event.key === "council" ? readCouncilProgress(event.text) : null;
        if (event.key === "council") {
          if (!councilFirstAnnounced || !progress) {
            announcement = `${stageName(event.key)}: ${event.text}`;
            councilFirstAnnounced = true;
          }
          if (progress && progress.answered >= progress.total && !councilCompleteAnnounced) {
            announcement = `${stageName(event.key)}: ${event.text}`;
            councilCompleteAnnounced = true;
          }
          return;
        }
        const key = event.key || "__unkeyed__";
        if (!announcedStageKeys.has(key)) {
          announcement = `${stageName(event.key)}: ${event.text}`;
          announcedStageKeys.add(key);
        }
      };

      const setTerminalAnnouncement = (phase) => {
        if (phase === "stopped") announcement = "Answer stopped before completion.";
        else if (phase === "failed") announcement = "Answer failed before completion.";
        else if (!stageRows.some(({ key }) => key === "synthesis")) {
          announcement = "Answer complete without a synthesis stage.";
        } else if (stageRows.some(({ key, progress }) => key === "council" && progress && progress.answered < progress.total)) {
          announcement = "Answer complete; council participation was partial.";
        } else {
          announcement = "Answer complete.";
        }
      };

      const recordStage = (frame) => {
        const event = readStageFrame(frame);
        if (!event) return null;
        stage = event;
        stageFrames.push(event);
        announceStage(event);
        const row = stageRows.find((item) => item.key === event.key);
        const progress = event.key === "council" ? readCouncilProgress(event.text) : null;
        if (row) {
          row.text = event.text;
          if (progress) row.progress = progress;
        } else {
          const previous = stageRows.at(-1);
          if (previous && !previous.state) {
            const previousProgress = previous.key === "council"
              ? previous.progress || readCouncilProgress(previous.text)
              : null;
            previous.state = previousProgress && previousProgress.answered < previousProgress.total
              ? "partial"
              : "completed";
          }
          stageRows.push({ ...event, ...(progress ? { progress } : {}) });
        }
        return event;
      };

      const processSnapshot = (phase = "working") => {
        const partialCouncil = stageRows.some(({ key, progress, text }) => {
          const council = key === "council" ? progress || readCouncilProgress(text) : null;
          return council && council.answered < council.total;
        });
        const hasProcess = Boolean(stageRows.length || initialProcess.reserve);
        if (!hasProcess) return undefined;
        const council = [...stageRows].reverse().find((row) => row.key === "council");
        const councilProgress = council?.progress || readCouncilProgress(council?.text);
        const sourceRows = activity.flatMap((item) => Array.isArray(item.sources) ? item.sources : []);
        const fallbackProvenance = {
          schemaVersion: 1,
          requestState: phase === "complete" ? "complete" : phase === "stopped" ? "aborted" : phase === "failed" ? "failed" : "running",
          answerProduced: Boolean(acc.trim()),
          stageKeys: stageRows.map(({ key }) => key).filter(Boolean),
          council: {
            used: stageRows.some(({ key }) => key === "council"),
            seatCount: councilProgress?.total || 0,
            answered: councilProgress?.answered || 0,
            completed: Boolean(councilProgress && councilProgress.answered >= councilProgress.total),
            partial: partialCouncil,
          },
          synthesis: {
            started: stageRows.some(({ key }) => key === "synthesis"),
            completed: phase === "complete" && stageRows.some(({ key }) => key === "synthesis") && Boolean(acc.trim()),
            skipped: !stageRows.some(({ key }) => key === "synthesis"),
            failed: phase === "failed",
          },
          evidence: {
            searchUsed: sourceRows.length > 0,
            toolUsed: activity.length > 0,
            toolCount: activity.length,
            failedTools: activity.filter((item) => item.ok === false).length,
            sourceCount: sourceRows.length,
          },
          failure: { occurred: phase === "failed", userAborted: phase === "stopped" },
          sources: sourceRows,
        };
        const provenance = liveProvenance
          ? {
              ...liveProvenance,
              answerProduced: liveProvenance.answerProduced ?? Boolean(acc.trim()),
              ...(liveProvenance.sources?.length || !sourceRows.length ? {} : { sources: sourceRows }),
            }
          : fallbackProvenance;
        return {
          phase,
          reserve: true,
          activeKey: phase === "working" || phase === "answering" ? stage?.key || null : null,
          terminalKey: phase === "stopped" || phase === "failed" ? stage?.key || stageRows.at(-1)?.key || null : null,
          stages: stageRows.map(({ key, text, progress, state }) => ({
            key,
            text,
            ...(progress ? { progress } : {}),
            ...(state ? { state } : {}),
          })),
          frames: stageFrames.map(({ key, text }) => ({ key, text })),
          synthesisSeen: stageRows.some(({ key }) => key === "synthesis"),
          partialCouncil,
          pendingTools: activity.some((item) => item.pending),
          announcement,
          provenance,
        };
      };

      const paintDraft = (message, phase = "working", extra = {}) =>
        setStreamDraft({ chatId, message, process: processSnapshot(phase), ...extra });

      const setTurnState = (next) => {
        setStatus(next);
        setStreamDraft((previous) => ({
          chatId,
          message: { ...(previous?.message || assistantMsg), turnState: next },
          process: previous?.process,
        }));
      };

      const waitForOnline = async () => {
        if (!browserIsOffline()) return;
        setTurnState("offline");
        await new Promise((resolve, reject) => {
          const onOnline = () => { cleanup(); resolve(); };
          const onAbort = () => { cleanup(); reject(abortRef.current.signal.reason || new DOMException("Aborted", "AbortError")); };
          const cleanup = () => {
            window.removeEventListener("online", onOnline);
            abortRef.current?.signal.removeEventListener("abort", onAbort);
          };
          window.addEventListener("online", onOnline, { once: true });
          abortRef.current?.signal.addEventListener("abort", onAbort, { once: true });
        });
      };

      const waitBeforeRetry = (ms) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
        const onAbort = () => { clearTimeout(timer); cleanup(); reject(abortRef.current.signal.reason || new DOMException("Aborted", "AbortError")); };
        const cleanup = () => abortRef.current?.signal.removeEventListener("abort", onAbort);
        abortRef.current?.signal.addEventListener("abort", onAbort, { once: true });
      });

      const resumeResponse = async () => {
        while (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          await waitForOnline();
          setTurnState("reconnecting");
          reconnectAttempts += 1;
          try {
            const token = await Promise.race([getToken(), untilAborted(abortRef.current.signal)]);
            const resumeUrl = `${API_BASE}/api/turns/${operationId}/stream?chars=${encodeURIComponent(acc.length)}`;
            const response = await fetch(resumeUrl, {
              headers: { Authorization: `Bearer ${token}` },
              signal: abortRef.current.signal,
            });
            if (!response.ok) {
              const body = await response.json().catch(() => ({}));
              throw withOperationId(new Error(body.error || `Resume failed: ${response.status}`), body.operationId || operationId, body.code);
            }
            if (!response.body) throw asTransportError(new Error("Resume returned no stream"));
            return response;
          } catch (error) {
            if (error.name === "AbortError") throw error;
            if (!error.transport) throw error;
            if (browserIsOffline()) continue;
            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) throw error;
            await waitBeforeRetry(RECONNECT_BACKOFF_MS[reconnectAttempts - 1]);
          }
        }
        throw asTransportError(new Error("Connection could not be restored"));
      };

      const consumeResume = async (response) => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let complete = false;
        while (!complete) {
          let chunk;
          try { chunk = await reader.read(); } catch (error) { throw asTransportError(error); }
          if (chunk.done) throw asTransportError(new Error("Resume ended before completion"));
          buffer += decoder.decode(chunk.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const text = line.trim();
            if (!text.startsWith("data: ")) continue;
            const payload = text.slice(6).trim();
            if (payload === "[DONE]") { complete = true; break; }
            let frame;
            try { frame = JSON.parse(payload); } catch { continue; }
            if (frame.type === "chunk") {
              started = true;
              announcement = "The answer is forming.";
              acc += frame.text;
              setStatus("streaming");
              paintDraft({
                ...assistantMsg,
                typing: false,
                content: acc,
                activity: activity.length ? [...activity] : undefined,
              }, "answering");
            } else if (frame.type === "meta" && frame.operationId) {
              turnOperationId = frame.operationId;
            } else if (frame.type === "provenance" && frame.provenance) {
              liveProvenance = frame.provenance;
            } else if (frame.type === "stage") {
              recordStage(frame);
              if (!started) {
                paintDraft({
                  ...assistantMsg,
                  typing: true,
                  content: "",
                  stage: stage?.text,
                  stageKey: stage?.key,
                  activity: activity.length ? [...activity] : undefined,
                });
              }
            } else if (frame.type === "error") {
              throw withOperationId(new Error(frame.text), frame.operationId || turnOperationId, frame.code);
            }
          }
        }
      };

      const resumeTurn = async () => {
        while (true) {
          try {
            await consumeResume(await resumeResponse());
            return;
          } catch (error) {
            if (!error.transport || error.name === "AbortError") throw error;
            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) throw error;
          }
        }
      };

      const retryTurn = async () => {
        reconnectAttempts = 0;
        setMessageLoadState((previous) => ({ ...previous, [chatId]: "loading" }));
        try {
          await resumeTurn();
          await persistCompletedTurn();
        } catch (error) {
          if (error.name === "AbortError") throw error;
          failTurn(error);
        }
      };

      const markFailedTurn = (error) => {
        if (painterRef) { clearInterval(painterRef); painterRef = null; }
        setTerminalAnnouncement("failed");
        const failedMessage = {
          ...assistantMsg,
          typing: false,
          content: acc || "The connection ended before an answer arrived.",
          retryable: true,
          turnState: "error",
        };
        retryTurnRef.current = { chatId, retry: retryTurn };
        paintDraft(failedMessage, "failed", { persisted: false });
        setMessageLoadState((previous) => ({ ...previous, [chatId]: "turn-error" }));
        setStatus("error");
        sendInFlightRef.current = false;
        console.error(error?.message || "Connection lost");
      };
      failTurn = markFailedTurn;

      persistCompletedTurn = async () => {
        /* Cleared even when the PUT below fails. The answer is in hand and on
         * screen at this point; recovery exists to find an answer nobody has,
         * and running it against one already painted would append a second
         * copy of it. A failed save is the transcript's problem, not the
         * ledger's. */
        clearPendingTurn(userId);
        setTerminalAnnouncement("complete");
        const completedProcess = processSnapshot("complete");
        const finalMessage = {
          ...assistantMsg,
          typing: false,
          content: acc,
          activity: activity.length ? [...activity] : undefined,
          ...(completedProcess?.provenance ? { provenance: completedProcess.provenance } : {}),
        };
        rememberSessionProcess(chatId, assistantId, completedProcess);
        paintDraft(finalMessage, "complete", { persisted: true });
        const saved = await updateChatMessages(chatId, [...updated, finalMessage]);
        if (!saved) {
          setStreamDraft(null);
          sendInFlightRef.current = false;
          setStatus("idle");
          return;
        }
        retryTurnRef.current = null;
        setMessageLoadState((previous) => ({ ...previous, [chatId]: "loaded" }));
        sendInFlightRef.current = false;
        setStatus("idle");
      };

      try {
        // Raced against the abort signal, NOT awaited bare. `getToken()` is
        // not a fetch, so `abortRef` cannot cancel it — and this happens
        // before the signal is handed to `fetch`, which is the window where
        // Stop looks like it does nothing. If Clerk hangs here, status stays
        // "streaming", the composer stays disabled, the catch below never
        // runs, and pressing Stop changes nothing at all.
        const token = await Promise.race([getToken(), untilAborted(abortRef.current.signal)]);
        /* ONE ID FOR THIS TURN, minted here rather than server-side.
         *
         * The server accepts it, validates it as a UUID, and echoes it into
         * every log line, error body and audit row for this request. Minting it
         * on the client is what makes a RETRY correlatable with the attempt it
         * replaced — a server-minted id changes on every request, so the one
         * question worth asking of a failed turn ("what else did this user try
         * in the same breath?") cannot be answered from it. */
        let res;
        try {
          res = await fetch(`${API_BASE}/api/council`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Operation-Id": operationId,
          },
          body: JSON.stringify({ message: cleanText, history, chatId, messageId: assistantId, timezone: clientTimezone(), ...(image ? { image } : {}) }),
          signal: abortRef.current.signal,
          });
        } catch (error) {
          if (error.name === "AbortError") throw error;
          throw asTransportError(error);
        }

        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          // The id the user can quote. Server-supplied wins: a proxy that
          // rewrote the request would make ours a lie.
          // `res.headers?.get?.()` rather than a bare call: this is the FAILURE
          // path, and a response object without a Headers instance — a mock, a
          // polyfill, an opaque cross-origin response — would turn a readable
          // server error into "Cannot read properties of undefined".
          throw withOperationId(
            new Error(d.error || `Server error: ${res.status}`),
            d.operationId || res.headers?.get?.("X-Operation-Id") || operationId,
            d.code,
          );
        }
        if (!res.body) throw asTransportError(new Error("No stream"));

        /* NOT "streaming" yet, and this is the half of the progress feature
         * that has to move with the other half.
         *
         * The backend now opens the response before the council runs, so that
         * it can report what it is doing. Headers therefore arrive almost
         * immediately, seconds before the first word. Clearing `typing` here —
         * which is what this line used to do — would swap the skeleton for an
         * empty bubble at the exact moment the long wait BEGINS, and the
         * feature meant to fill that wait would have emptied it instead.
         *
         * The state changes on the first CHUNK now. Until then the placeholder
         * stays and carries whatever the server last said it was doing. */
        /* The server echoes the id it settled on as the first SSE frame. It is
         * normally the one sent above; it differs if a proxy rewrote the header
         * or the value failed the server's UUID check and was replaced. Prefer
         * the server's — it is the one written into the logs. */
        const paintPending = () =>
          paintDraft({
            ...assistantMsg,
            typing: true,
            content: "",
            stage: stage?.text,
            stageKey: stage?.key,
            activity: activity.length ? [...activity] : undefined,
          });
        paintPending();

        /* THE VIEW IS PACED SEPARATELY FROM THE NETWORK.
         *
         * Measured against the real gateway: a 300-word answer arrives as 57
         * frames of ~29 characters, all within 1.7s at the end of a 11.5s
         * wait. Painting each frame the moment it lands reproduces that
         * rhythm exactly, and the rhythm is lumpy — reported as the messages
         * "just popping in".
         *
         * `acc` stays the source of truth and is what gets SAVED. The reveal
         * only decides how much of it is on screen right now, and it is
         * backlog-proportional so it can never fall permanently behind — see
         * lib/streamReveal.js for why a fixed typing speed is a trap. */
        /* NOT gated on prefers-reduced-motion, and that is a correction.
         *
         * The first version passed `instant: true` under reduced motion, which
         * is the reflex this codebase applies everywhere else and it was wrong
         * here. It also silently disabled the feature on the machine that
         * asked for it: this user's desktop has animation effects off at the OS
         * level, so the reveal they wanted resolved to "show everything at
         * once" — the exact behaviour being complained about.
         *
         * The distinction that matters: reduced motion is about MOVEMENT —
         * things sliding, scaling, spinning, parallax — because that is what
         * provokes vestibular symptoms. Text arriving progressively is content
         * delivery, not decoration. Nothing translates, nothing scales; the
         * answer simply becomes readable in the order it was written, which is
         * how a streamed answer has to behave to be a streamed answer at all.
         *
         * The ambient float, the entrance rise and the press feedback remain
         * gated, because those ARE movement. */
        const reveal = createReveal();

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let done = false;
        let sawDone = false;

        /** Put a given amount of the answer on screen. */
        let painted = null;
        const paint = (text) => {
          // A 60fps timer that re-renders the transcript when nothing has
          // changed is pure waste, and the transcript is the most expensive
          // thing in the app to render — it runs markdown over every message.
          if (text === painted) return;
          // Nothing revealed yet means the answer has not started. Painting an
          // empty string here would clear `typing` and put an empty bubble
          // where the skeleton was — the painter runs on its own 16ms clock
          // from before the first frame arrives, so without this it wins the
          // race against the first chunk on every single turn.
          if (!text) return;
          painted = text;
          paintDraft({
            ...assistantMsg,
            typing: false,
            content: text,
            activity: activity.length ? [...activity] : undefined,
          }, "answering");
        };

        /* THE REVEAL NEEDS ITS OWN CLOCK, not the network's.
         *
         * The first version of this ticked once per `reader.read()`, which is
         * the mistake it was written to fix: 57 frames can arrive in a handful
         * of reads, so the view still advanced in a handful of jumps. Pacing
         * against the thing you are trying not to be paced by does nothing.
         *
         * A 16ms timer paints at roughly display rate regardless of how the
         * bytes arrive. The read loop below only feeds the target. */
        painterRef = setInterval(() => paint(reveal.tick()), 16);

        while (!done) {
          let chunk;
          try { chunk = await reader.read(); } catch (error) { throw asTransportError(error); }
          if (chunk.done) {
            if (!sawDone) throw asTransportError(new Error("Stream ended before completion"));
            break;
          }

          buf += decoder.decode(chunk.value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";

          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data: ")) continue;
            const payload = t.slice(6).trim();
            if (payload === "[DONE]") {
              sawDone = true;
              done = true;
              break;
            }
            // A frame that is not valid JSON is a transport artifact, not a
            // failure worth aborting the whole response for.
            let frame;
            try {
              frame = JSON.parse(payload);
            } catch {
              continue;
            }
            if (frame.type === "chunk") {
              // The real start of the answer, and the only honest place to
              // call it: headers now arrive long before words do.
              if (!started) {
                started = true;
                announcement = "The answer is forming.";
                setStatus("streaming");
              }
              acc += frame.text;
            }
            else if (frame.type === "meta") {
              if (frame.operationId) turnOperationId = frame.operationId;
            }
            else if (frame.type === "provenance" && frame.provenance) {
              liveProvenance = frame.provenance;
            }
            else if (frame.type === "error") {
              throw withOperationId(new Error(frame.text), frame.operationId || turnOperationId, frame.code);
            }
            // What the council is doing while it is doing it. The latest text
            // still replaces the active line, but the keyed stage row and raw
            // frame receipt keep the ordered context/council/synthesis act
            // visible when the next phase arrives and when the first token
            // replaces the skeleton.
            else if (frame.type === "stage") {
              recordStage(frame);
              if (!started) {
                paintPending();
              }
            }
            // The council's tool loop reports what it is doing while it does
            // it. These arrive BEFORE any chunk — the loop runs to completion
            // before synthesis starts — so without them the user watches a
            // spinner for up to 25 seconds.
            //
            // A tool_result is matched to its tool_start by (round, name) and
            // REPLACES it, so a call renders as one row that resolves rather
            // than two rows. Matching on that pair rather than on an id is
            // safe because the loop executes each unique call once per round,
            // which is the whole point of the dedupe.
            else if (frame.type === "tool_start") {
              activity.push({ round: frame.round, name: frame.name, summary: frame.summary, pending: true });
            } else if (frame.type === "tool_result") {
              const row = activity.find((a) => a.round === frame.round && a.name === frame.name && a.pending);
              if (row) Object.assign(row, { ok: frame.ok, summary: frame.summary, pending: false, ...(Array.isArray(frame.sources) ? { sources: frame.sources } : {}) });
              else activity.push({ round: frame.round, name: frame.name, summary: frame.summary, ok: frame.ok, ...(Array.isArray(frame.sources) ? { sources: frame.sources } : {}) });
            }
            // The trail used to reach the screen because the painter repainted
            // the message on every tick regardless of content. It does not any
            // more — an empty paint is what put an empty bubble where the
            // skeleton belongs — so tool progress has to ask for its own
            // repaint while the answer has not started.
            if (!started && (frame.type === "tool_start" || frame.type === "tool_result")) paintPending();
          }

          // Feed the target only. The painter above decides what is on screen.
          reveal.push(acc);
        }
        clearInterval(painterRef);
        painterRef = null;

        /* The stream is over; the view may still be a few frames behind.
         * Drain it rather than snapping, so the last words arrive the same way
         * every earlier word did — a jump at the very end is the one place a
         * smoothed reveal would look worse than no smoothing at all.
         *
         * Bounded, and the bound is the point: this can add at most ~400ms,
         * and it exits the moment the text has caught up. `settled` is checked
         * rather than a fixed count so a short answer costs nothing. */
        for (let guard = 0; !reveal.settled && guard < 40; guard++) {
          paint(reveal.tick());
          await new Promise((r) => setTimeout(r, 16));
        }
        paint(reveal.finish());

        const completedProcess = processSnapshot("complete");
        const finalMessage = {
          ...assistantMsg,
          typing: false,
          content: acc,
          activity: activity.length ? [...activity] : undefined,
          ...(completedProcess?.provenance ? { provenance: completedProcess.provenance } : {}),
        };
        setTerminalAnnouncement("complete");
        rememberSessionProcess(chatId, assistantId, completedProcess);
        // Keep this exact keyed row mounted while its complete copy is written
        // into chats. renderedMessages omits that copy, so there is no duplicate
        // and the plain-text-to-Markdown swap does not remount the bubble.
        paintDraft(finalMessage, "complete", { persisted: true });
        const saved = await updateChatMessages(chatId, [
          ...updated,
          finalMessage,
        ]);
        if (!saved) {
          setStreamDraft(null);
          sendInFlightRef.current = false;
          setStatus("idle");
          return;
        }
        sendInFlightRef.current = false;
        setStatus("idle");
      } catch (err) {
        /* A 16ms timer that outlives its request repaints a message forever
         * and holds the closure that owns it. An abort throws straight out of
         * the read loop, so the clear after the loop is not reached — this is
         * the only path that runs on every ending. */
        if (painterRef) { clearInterval(painterRef); painterRef = null; }
        if (err.name === "AbortError") {
          /* Stop is a decision, not a failure. Recovering the turn on the next
           * reload would hand back the answer the user just refused. */
          clearPendingTurn(userId);
          // Two things this used to get wrong. It returned without resetting
          // status, which left the composer disabled forever once a user-facing
          // Stop existed; and it dropped `acc`, discarding text already on
          // screen.
          if (acc.trim()) {
            setTerminalAnnouncement("stopped");
            const stoppedProcess = processSnapshot("stopped");
            const stoppedMessage = {
              ...assistantMsg,
              typing: false,
              content: acc,
              stopped: true,
              ...(stoppedProcess?.provenance ? { provenance: stoppedProcess.provenance } : {}),
            };
            rememberSessionProcess(chatId, assistantId, stoppedProcess);
            paintDraft(stoppedMessage, "stopped", { persisted: true });
            const saved = await updateChatMessages(chatId, [
              ...updated,
              stoppedMessage,
            ]);
            if (!saved) setStreamDraft(null);
          } else {
            setStreamDraft(null);
            await updateChatMessages(chatId, updated);
          }
          sendInFlightRef.current = false;
          retryTurnRef.current = null;
          setStatus("idle");
          return;
        }

        if (err.transport) {
          try {
            reconnectAttempts = 0;
            await resumeTurn();
            await persistCompletedTurn();
            return;
          } catch (reconnectError) {
            if (reconnectError.name === "AbortError") {
              sendInFlightRef.current = false;
              setStatus("idle");
              return;
            }
            if (reconnectError.transport) {
              failTurn(reconnectError);
              return;
            }
            err = reconnectError;
          }
        }

        sendInFlightRef.current = false;
        setStatus("error");
        /* THE ID IS SHOWN, and it is shown HERE because this is the only place
         * the user can see it at all — the message is persisted, so it is still
         * there when they come back to report the failure. Eight characters is
         * enough to find the request in the logs and short enough to read out;
         * the full id is in `X-Operation-Id` and in the audit row. Appended
         * rather than replacing the message: what went wrong still matters more
         * than which request it was. */
        const ref = shortOperationId(err.operationId);
        const failedProcess = processSnapshot("failed");
        const errorMessage = {
          ...assistantMsg,
          typing: false,
          content: `${err.message || "Connection failed"}${ref ? `\n\n\`ref ${ref}\`` : ""}`,
          ...(failedProcess?.provenance ? { provenance: failedProcess.provenance } : {}),
        };
        setTerminalAnnouncement("failed");
        rememberSessionProcess(chatId, assistantId, failedProcess);
        paintDraft(errorMessage, "failed", { persisted: true });
        const saved = await updateChatMessages(chatId, [
          ...updated,
          errorMessage,
        ]);
        if (!saved) setStreamDraft(null);
      }
    },
    [activeChatId, status, createChat, ensureMessagesLoaded, renameChat, updateChatMessages, getToken]
  );

  /**
   * Re-run the last exchange: drop the previous answer and everything after
   * it, then replay the user's message — so a bad answer can be retried
   * without retyping, and without leaving the stale reply in the transcript.
   */
  const regenerateLast = useCallback(async () => {
    // Regeneration has an await before it calls send. Without its own lock,
    // two clicks (or a click followed by typing) can both read the same
    // transcript, both remove the same answer, and then race two council
    // requests. The PUT CAS prevents silent server loss, but it cannot make
    // that user interaction coherent, so block every message operation while
    // this read/replacement/replay sequence is in flight.
    if (status !== "idle" || sendInFlightRef.current || regenerateInFlightRef.current) return;
    if (!activeChatId) return;
    regenerateInFlightRef.current = true;
    setStatus("loading");
    const currentMessages = await ensureMessagesLoaded(activeChatId);
    if (!currentMessages) {
      regenerateInFlightRef.current = false;
      setStatus("idle");
      return;
    }

    const lastUserIdx = currentMessages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx === -1) {
      regenerateInFlightRef.current = false;
      setStatus("idle");
      return;
    }

    const prompt = currentMessages[lastUserIdx].content;
    if (!prompt?.trim()) {
      regenerateInFlightRef.current = false;
      setStatus("idle");
      return;
    }

    const kept = currentMessages.slice(0, lastUserIdx);

    // Release immediately before send. No event can interleave between these
    // synchronous statements, and send takes its own lock before its first
    // await. This hands ownership of the operation to the normal streaming
    // path without leaving a window where another click can start.
    regenerateInFlightRef.current = false;
    setStatus("idle");
    await send(prompt, null, undefined, kept);
  }, [status, activeChatId, ensureMessagesLoaded, send]);

  return {
    chats,
    sortedChats,
    activeChat,
    activeChatId,
    activeMessages,
    renderedMessages,
    streamDraft: activeStreamDraft,
    setActiveChatId,
    status,
    feedback,
    isInitialLoading,
    chatsError,
    retryChats: loadChats,
    isLoadingMessages,
    messageLoadError,
    retryMessages,
    createChat,
    newChat,
    deleteChat,
    renameChat,
    togglePinChat,
    toggleFavoriteChat,
    submitFeedback,
    generateImage,
    send,
    stopGeneration,
    regenerateLast,
    chatFiles,
    chatFilesError,
    retryChatFiles,
    uploadFile,
    removeFile,
    downloadFile,
    setFileWorkspace,
  };
}

export default useChats;
