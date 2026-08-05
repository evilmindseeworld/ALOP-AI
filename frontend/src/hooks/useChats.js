import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { API_BASE } from "../lib/api";
import { uid, generateChatTitle, parseImagePrompt, buildImageUrl } from "../lib/format";

const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** How much history the council is given. Older turns are summarised server-side. */
const HISTORY_TURNS = 8;
const HISTORY_CHARS = 4000;

/**
 * Chat state: CRUD, ordering, and the council streaming loop.
 *
 * This is the one piece of the app with genuinely intricate behaviour, and it
 * is where three separate bugs lived. Each has a note at the point that fixes
 * it — read those before changing the abort path in particular.
 */
export function useChats({ apiCall, getToken, isReady, setToast }) {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [status, setStatus] = useState("idle");
  const [feedback, setFeedback] = useState({});
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const abortRef = useRef(null);

  const activeChat = useMemo(() => chats.find((c) => c.id === activeChatId), [chats, activeChatId]);
  const activeMessages = useMemo(() => activeChat?.messages || [], [activeChat]);

  /** Pinned first, then favourites, then most recently posted in. */
  const sortedChats = useMemo(
    () =>
      [...chats].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
      }),
    [chats]
  );

  const createChat = useCallback(async () => {
    try {
      const r = await apiCall("/api/chats", { method: "POST", body: JSON.stringify({ title: "New Chat" }) });
      const d = await r.json();
      setChats((p) => [d, ...p]);
      setActiveChatId(d.id);
      return d.id;
    } catch {
      setToast("Failed to create chat");
      return null;
    }
  }, [apiCall, setToast]);

  /**
   * Load existing chats only.
   *
   * The row is created lazily on the first message, so opening the app no
   * longer leaves an empty "New Chat" behind on every page load.
   */
  const loadChats = useCallback(async () => {
    try {
      const res = await apiCall("/api/chats");
      const data = await res.json();
      if (Array.isArray(data)) setChats(data);
    } catch (e) {
      console.error(e.message);
      setToast("Couldn't load your chats.");
    } finally {
      setIsInitialLoading(false);
    }
  }, [apiCall, setToast]);

  useEffect(() => {
    if (isReady) loadChats();
  }, [isReady, loadChats]);

  const updateChatMessages = useCallback(
    async (chatId, messages, saveToDb = true) => {
      setChats((p) =>
        p.map((c) => (c.id === chatId ? { ...c, messages, updated_at: new Date().toISOString() } : c))
      );
      if (!saveToDb) return;
      try {
        await apiCall(`/api/chats/${chatId}`, { method: "PUT", body: JSON.stringify({ messages }) });
      } catch (e) {
        console.error(e.message);
      }
    },
    [apiCall]
  );

  const deleteChat = useCallback(
    async (id) => {
      try {
        await apiCall(`/api/chats/${id}`, { method: "DELETE" });
        setChats((p) => p.filter((c) => c.id !== id));
        setActiveChatId((current) => (current === id ? null : current));
      } catch (e) {
        console.error(e.message);
      }
    },
    [apiCall]
  );

  const renameChat = useCallback(
    async (id, title) => {
      if (!title?.trim()) return;
      setChats((p) => p.map((c) => (c.id === id ? { ...c, title } : c)));
      try {
        await apiCall(`/api/chats/${id}`, { method: "PUT", body: JSON.stringify({ title }) });
      } catch (e) {
        console.error(e.message);
      }
    },
    [apiCall]
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
        const idx = activeMessages.findIndex((m) => m.id === msgId);
        if (idx === -1) return;
        const msg = activeMessages[idx];
        // The question that produced this answer, for the learning store.
        const question = idx > 0 ? activeMessages[idx - 1]?.content : "";
        await apiCall("/api/feedback", {
          method: "POST",
          body: JSON.stringify({ messageId: msgId, feedback: type, question, answer: msg.content }),
        });
        setToast(type === "up" ? "AI will learn from this good answer." : "Noted. AI will avoid this pattern.");
      } catch (e) {
        console.error(e.message);
      }
    },
    [activeMessages, apiCall, setToast]
  );

  const generateImage = useCallback(
    async (promptText) => {
      const imagePrompt = parseImagePrompt(promptText) || promptText;
      if (!imagePrompt) {
        setToast("Describe image");
        return;
      }

      // The chat row is created here rather than earlier. An earlier revision
      // called createChat() BEFORE the image-request check, and generateImage
      // called it again from a closure holding a stale activeChatId — which
      // produced two rows for one image.
      let chatId = activeChatId;
      if (!chatId) chatId = await createChat();
      if (!chatId) return;

      const userMsg = { role: "user", content: `Generate image: ${imagePrompt}`, ts: now(), id: uid() };
      const withUser = [...activeMessages, userMsg];
      await updateChatMessages(chatId, withUser);

      if (activeMessages.length === 0) {
        const title = generateChatTitle(imagePrompt);
        if (title) renameChat(chatId, title);
      }

      await updateChatMessages(chatId, [
        ...withUser,
        { role: "assistant", content: "", imageUrl: buildImageUrl(imagePrompt), imagePrompt, ts: now(), id: uid() },
      ]);
    },
    [activeChatId, activeMessages, createChat, renameChat, updateChatMessages, setToast]
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

  const loadChatFiles = useCallback(
    async (chatId) => {
      if (!chatId) return setChatFiles([]);
      try {
        const res = await apiCall(`/api/chats/${chatId}/files`);
        setChatFiles(res.ok ? await res.json() : []);
      } catch {
        setChatFiles([]);
      }
    },
    [apiCall]
  );

  useEffect(() => {
    if (isReady) loadChatFiles(activeChatId);
  }, [isReady, activeChatId, loadChatFiles]);

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
   * `baseMessages` is what the new exchange is appended to. It defaults to the
   * live transcript, and only regenerate passes anything else: it has just
   * truncated the transcript, and this closure still holds the pre-truncation
   * copy — sending against that put the discarded answer back and duplicated
   * the question.
   */
  const send = useCallback(
    async (text, attachedImage, onAttachmentConsumed, baseMessages = activeMessages) => {
      const cleanText = text.trim();
      if (!cleanText || status !== "idle") return;

      let chatId = activeChatId;
      if (!chatId) chatId = await createChat();
      if (!chatId) return;

      const image = attachedImage;
      onAttachmentConsumed?.();
      setStatus("loading");

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
      await updateChatMessages(chatId, updated);

      if (baseMessages.length === 0) {
        const title = generateChatTitle(cleanText);
        if (title) renameChat(chatId, title);
      }

      const assistantId = uid();
      const assistantMsg = { role: "assistant", content: "", typing: true, ts: now(), id: assistantId };
      updateChatMessages(chatId, [...updated, assistantMsg], false);

      const history = baseMessages
        .filter((m) => m.content && m.content.trim() && !m.typing)
        .slice(-HISTORY_TURNS)
        .map((m) => ({ role: m.role, content: m.content.slice(0, HISTORY_CHARS) }));

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      // Hoisted so the catch can persist whatever streamed before an abort.
      // Discarding it would throw away text the user already watched arrive.
      let acc = "";
      // Mutated in place as frames arrive, and spread into the message on each
      // render so React sees a new array. It is deliberately NOT state: a
      // setState per frame would re-render the whole transcript on every tool
      // event, and the transcript already re-renders per chunk.
      const activity = [];

      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/api/council`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message: cleanText, history, chatId, ...(image ? { image } : {}) }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || `Server error: ${res.status}`);
        }
        if (!res.body) throw new Error("No stream");

        setStatus("streaming");
        updateChatMessages(chatId, [...updated, { ...assistantMsg, typing: false, content: "" }], false);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let done = false;

        while (!done) {
          const chunk = await reader.read();
          if (chunk.done) break;

          buf += decoder.decode(chunk.value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";

          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data: ")) continue;
            const payload = t.slice(6).trim();
            if (payload === "[DONE]") {
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
            if (frame.type === "chunk") acc += frame.text;
            else if (frame.type === "error") throw new Error(frame.text);
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
              if (row) Object.assign(row, { ok: frame.ok, summary: frame.summary, pending: false });
              else activity.push({ round: frame.round, name: frame.name, summary: frame.summary, ok: frame.ok });
            }
          }

          setChats((p) =>
            p.map((c) =>
              c.id === chatId
                ? { ...c, messages: [...updated, { ...assistantMsg, typing: false, content: acc, activity: activity.length ? [...activity] : undefined }] }
                : c
            )
          );
        }

        await updateChatMessages(chatId, [...updated, { ...assistantMsg, typing: false, content: acc, activity: activity.length ? [...activity] : undefined }]);
        setStatus("idle");
      } catch (err) {
        if (err.name === "AbortError") {
          // Two things this used to get wrong. It returned without resetting
          // status, which left the composer disabled forever once a user-facing
          // Stop existed; and it dropped `acc`, discarding text already on
          // screen.
          if (acc.trim()) {
            await updateChatMessages(chatId, [
              ...updated,
              { ...assistantMsg, typing: false, content: acc, stopped: true },
            ]);
          } else {
            await updateChatMessages(chatId, updated);
          }
          setStatus("idle");
          return;
        }

        setStatus("error");
        await updateChatMessages(chatId, [
          ...updated,
          { ...assistantMsg, typing: false, content: `⚠️ ${err.message || "Connection failed"}` },
        ]);
      }
    },
    [activeChatId, activeMessages, status, createChat, renameChat, updateChatMessages, getToken]
  );

  /**
   * Re-run the last exchange: drop the previous answer and everything after
   * it, then replay the user's message — so a bad answer can be retried
   * without retyping, and without leaving the stale reply in the transcript.
   */
  const regenerateLast = useCallback(async () => {
    if (status !== "idle") return;
    const lastUserIdx = activeMessages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx === -1) return;

    const prompt = activeMessages[lastUserIdx].content;
    if (!prompt?.trim()) return;

    const kept = activeMessages.slice(0, lastUserIdx);
    await updateChatMessages(activeChatId, kept);
    await send(prompt, null, undefined, kept);
  }, [status, activeMessages, activeChatId, updateChatMessages, send]);

  return {
    chats,
    sortedChats,
    activeChat,
    activeChatId,
    activeMessages,
    setActiveChatId,
    status,
    feedback,
    isInitialLoading,
    createChat,
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
    uploadFile,
    removeFile,
  };
}

export default useChats;
