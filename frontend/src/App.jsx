import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from "react";
import { ClerkProvider, useUser, useAuth, useSession } from "@clerk/react";
import { Toaster, toast } from "sonner";
import "./App.css";

import SignInPage from "./SignInPage";
import SessionPending from "./components/SessionPending";
import clerkAppearance from "./lib/clerkAppearance";
import MagneticButton from "./components/ui/MagneticButton";
import { Badge } from "./components/ui/badge";
import CommandPalette from "./components/CommandPalette";
import Icon from "./components/Icon";
import Earring from "./components/Earring";
import InputBar from "./components/InputBar";
import ChatSidebar from "./components/ChatSidebar";
import CameraOverlay from "./components/CameraOverlay";
import { InitialLoader, AppSkeleton, StuckLoading, TranscriptFallback } from "./components/Skeletons";
import SettingsPanel from "./components/panels/SettingsPanel";
import AdminPanel from "./components/panels/AdminPanel";
import UpgradePanel from "./components/panels/UpgradePanel";

/* THE MARKDOWN RENDERER, OFF THE SIGN-IN PATH.
 *
 * react-markdown and its remark/rehype pipeline are 49 KB gzipped, and these
 * two components are the only things importing them. Both render exclusively
 * behind a signed-in check, but a static import is downloaded whether or not
 * the component ever renders — so every visitor paid for a markdown renderer
 * in order to look at a login form.
 *
 * Lazy here costs a signed-in user one extra round trip for the chunk, which
 * overlaps the Clerk handshake and the first /api/chats call and is invisible
 * against them. It saves a signed-out user the whole 49 KB.
 *
 * Their own test files import these modules directly, so the split does not
 * reach the tests. */
const MessageList = lazy(() => import("./components/MessageList"));
const OverlayAssistant = lazy(() => import("./overlay/OverlayAssistant"));
/* Not lazy, and not inside MessageList: the keystone must render as a sibling
 * of the scroller so its bottom anchor is the chat surface, not scroll content. */
import { SakuraBaseCorners } from "./components/SakuraFrame";

import { COUNCIL, FREE_COUNT } from "./constants/council";
import { useApi } from "./lib/api";
import { Storage } from "./lib/storage";
import { fileToDataUrl } from "./lib/image";
import { appendToControlledInput } from "./lib/dom";
import { isImageRequest } from "./lib/format";
import { useChats } from "./hooks/useChats";
import { useBilling } from "./hooks/useBilling";
import { useUserFacts } from "./hooks/useUserFacts";
import { useCamera } from "./hooks/useCamera";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { speak } from "./lib/speak";
import { clearChats } from "./lib/chatCache";
import { clearPendingTurn } from "./lib/pendingTurn";

/** Follow the transcript only while the reader is already near the bottom. */
const FOLLOW_THRESHOLD_PX = 150;
const ADMIN_PAGE_SIZE = 50;

const AuthenticatedApp = () => {
  const { user, isLoaded } = useUser();
  const { getToken, isSignedIn } = useAuth();
  const apiCall = useApi(getToken);
  const isReady = isLoaded && isSignedIn;

  const [darkMode, setDarkMode] = useState(() => Storage.get("alop-dark-mode") !== "false");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => Storage.get("pa-sidebar-collapsed") !== "false");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  /**
   * Toasts are Sonner's now, behind the same one-argument call the hooks have
   * always made.
   *
   * The old implementation was a single piece of state rendered as one fixed
   * div: a second message replaced the first mid-read, the timer restarted on
   * every render that touched it, and nothing was ever announced to a screen
   * reader. Sonner brings the stack, the timers, swipe-to-dismiss and a live
   * region; `setToast` keeps its signature so no hook changed.
   */
  const setToast = useCallback((message) => {
    if (message) toast(message);
  }, []);

  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const [adminUsers, setAdminUsers] = useState([]);
  const [adminUsersOffset, setAdminUsersOffset] = useState(0);
  const [adminUsersHasMore, setAdminUsersHasMore] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [attachedImage, setAttachedImage] = useState(null);

  const chatRef = useRef(null);

  const chat = useChats({ apiCall, getToken, isReady, setToast, userId: user?.id });
  const billing = useBilling({ apiCall, isReady, setToast });
  const userFacts = useUserFacts({ apiCall, setToast });

  /* A SKELETON THAT NEVER RESOLVES IS THE WORST FAILURE THIS APP HAS SHIPPED.
   *
   * `isInitialLoading` is cleared in loadChats' `finally`, so it survives any
   * error — but only if loadChats RUNS. When a pending Clerk session held
   * `isReady` at false it never did, and the skeleton stayed up for days with
   * no error, no toast and nothing to click.
   *
   * The gate above fixes that specific cause. This is the backstop for the
   * class: whatever the reason, if the app is still skeleton after this long,
   * it says so instead of pretending to load. Deliberately longer than the
   * 45s API_TIMEOUT_MS, so a genuinely slow request finishes and reports its
   * own error rather than being pre-empted by this.
   *
   * IT MUST STAY BELOW `chat`. This block first shipped ABOVE that line, and
   * the dependency array `[chat.isInitialLoading]` is evaluated during render
   * — reading a `const` that had not been initialised yet. Every signed-in
   * render threw `Cannot access 'chat' before initialization`, which minified
   * to a one-letter name and reached users as a crash screen. A hook cannot
   * be hoisted above the value it depends on. */
  const [skeletonStuck, setSkeletonStuck] = useState(false);
  useEffect(() => {
    if (!chat.isInitialLoading) return setSkeletonStuck(false);
    const t = setTimeout(() => setSkeletonStuck(true), 60_000);
    return () => clearTimeout(t);
  }, [chat.isInitialLoading]);

  const camera = useCamera({ onCapture: setAttachedImage, onError: setToast });
  const speech = useSpeechRecognition({
    onUnsupported: () => setToast("Needs Chrome/Edge/Safari"),
    // The composer owns its own text state, so dictation is appended through
    // the DOM. It has to go through the native setter — see lib/dom.js.
    onTranscript: (text) => appendToControlledInput(document.querySelector(".input-text"), text),
  });

  /**
   * The other direction of voice: dictation above puts speech IN, this reads
   * an answer OUT.
   *
   * `apiCall` is threaded in from here rather than reached for inside the
   * message row, so the authenticated fetch keeps one owner. Without a Fish
   * Audio key on the server the request comes back 501 and lib/speak falls
   * through to the browser's own voice, so this is never a control that fails.
   */
  const speakAnswer = useCallback((text, opts) => speak(text, { apiCall, ...opts }), [apiCall]);

  /* THE MOST EXPENSIVE ARROW FUNCTION IN THE APPLICATION.
   *
   * This was written inline on <MessageList onCopy={...}>, which gave it a new
   * identity on every render of App. `Message` is memo'd and takes onCopy, so a
   * new identity invalidated EVERY message in the transcript — and a message
   * re-render is a full react-markdown parse of its content.
   *
   * While a reply streams, App re-renders at the reveal cadence. So every
   * paint, every message already on screen was re-parsed from Markdown, not
   * only the one receiving tokens. The memo was there and was doing nothing;
   * one unstable prop is enough to switch it off completely.
   *
   * No dependencies: navigator.clipboard is stable for the document's life. */
  const copyAnswer = useCallback((content) => navigator.clipboard.writeText(content), []);

  const { activeChat, activeMessages, renderedMessages, streamDraft, status } = chat;
  const lastMessageId = streamDraft?.id || activeMessages.at(-1)?.id;

  // --- preferences -------------------------------------------------------
  useEffect(() => Storage.set("alop-dark-mode", darkMode.toString()), [darkMode]);
  useEffect(() => Storage.set("pa-sidebar-collapsed", sidebarCollapsed.toString()), [sidebarCollapsed]);

  // The desktop shell focuses the composer when its hotkey is pressed.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("desktop") !== "true") return;
    const focus = () => document.querySelector(".input-text")?.focus();
    focus();
    window.addEventListener("alop-focus", focus);
    return () => window.removeEventListener("alop-focus", focus);
  }, []);

  // --- scrolling ---------------------------------------------------------
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [chat.chats, chat.activeChatId, streamDraft?.content]);

  useEffect(() => {
    if (chatRef.current && status === "loading") chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [status]);

  // --- animation ---------------------------------------------------------
  /* THE ONE PLACE `prefers-reduced-motion` CANNOT REACH.
   *
   * The stylesheet has a reduced-motion block and nine components honour it,
   * which is why this looked covered. It is not: anime.js writes inline styles
   * frame by frame from JavaScript, and a CSS media query has no opinion about
   * a value being assigned to element.style. Both calls below therefore ran at
   * full motion for a user who had asked the whole system for less — a
   * transcript row springing in on every single message, which is the exact
   * repetition motion sensitivity reacts to.
   *
   * Read at call time, not once at module load: this is a system setting a
   * user can change while the tab is open, and a value captured at import
   * would keep animating until a reload. */
  const reducedMotion = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!chatRef.current) return;

    /* The empty state's logo used to be animated and made draggable from here,
     * by selector, inside a createScope rooted at this element. It crashed the
     * app: this effect is keyed on the message list, which is not the same
     * thing as "the empty state is mounted", and on both the paths where it
     * differs the selector matched nothing. See EmptyState in MessageList.jsx,
     * which now owns that motion against a ref. Only the transcript's own rows
     * are animated here, and those are queried from a live DOM. */
    const rows = chatRef.current.querySelectorAll(".msg-row");
    // No animation at all rather than a faster one: the row is already in the
    // DOM and readable, so skipping the entrance costs nothing to see.
    if (rows.length && !reducedMotion()) {
      let cancelled = false;
      import("./lib/motion")
        .then(({ animateMessageEntrance }) => {
          if (cancelled) return;
          animateMessageEntrance(rows[rows.length - 1]);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
  // Content changes on every reveal paint; the row itself is new only when
  // its id changes. Keying this effect on the array restarted a 700ms entrance
  // animation at the 16ms token cadence.
  }, [lastMessageId]);

  /* A starter SEEDS the composer; it does not send.
   *
   * This was `onPickStarter={handleSend}`, which fired a finished question the
   * user had not asked — click "Generate an image" and you were committed to a
   * jellyfish. Now the card writes its opening fragment into the composer and
   * puts the cursor after it, so the user finishes their own sentence.
   *
   * It goes through appendToControlledInput for the reason that file explains:
   * the composer owns its text state, and assigning `.value` from outside React
   * updates the pixels but not the state, so Send would post an empty message.
   *
   * The composer is cleared first. Clicking a second starter should replace the
   * first fragment, not concatenate into "Why does Help me decide between ". */
  const handlePickStarter = useCallback((starter) => {
    const el = document.querySelector(".input-text");
    if (!el) return;
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    appendToControlledInput(el, starter.seed);
    el.focus();
    // Cursor after the seed rather than before it, so typing continues the
    // sentence instead of prefixing it.
    const end = el.value.length;
    el.setSelectionRange?.(end, end);
  }, []);

  // Delegated press feedback, so every primary button gets it without wiring.
  useEffect(() => {
    const onClick = async (e) => {
      const button = e.target.closest(".input-btn.primary, .new-chat-btn, .overlay-submit");
      if (!button) return;
      if (reducedMotion()) return;
      try {
        const { animateButtonPress } = await import("./lib/motion");
        animateButtonPress(button);
      } catch {
        // Motion is optional. A failed lazy chunk must not turn a click into
        // an unhandled rejection after the button's real action has run.
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // --- admin -------------------------------------------------------------
  const fetchAdminUsers = useCallback(async (offset = 0) => {
    try {
      const r = await apiCall(`/api/admin/users?limit=${ADMIN_PAGE_SIZE}&offset=${offset}`);
      const body = await r.json();
      // Accept the old bare-array response during a rolling deploy. The new
      // response carries page metadata so the admin panel never asks the
      // server for every user just to render the first screen.
      const page = Array.isArray(body) ? { users: body, hasMore: false, offset } : body;
      setAdminUsers(Array.isArray(page?.users) ? page.users : []);
      setAdminUsersOffset(Number.isInteger(page?.offset) ? page.offset : offset);
      setAdminUsersHasMore(Boolean(page?.hasMore));
    } catch (e) {
      console.error(e.message);
    }
  }, [apiCall]);

  useEffect(() => {
    if (!isReady) return;

    (async () => {
      try {
        // A 200 is the admin check. Do not search the first page by email: an
        // admin created earlier could legitimately be past that page once the
        // user table grows, which would hide the admin controls from them.
        const r = await apiCall(`/api/admin/users?limit=1&offset=0`);
        if (!r.ok) return;
        await r.json().catch(() => null);
        setIsAdmin(true);
      } catch (e) {
        console.error(e.message);
      }
    })();
  }, [isReady, user, apiCall]);

  useEffect(() => {
    if (isAdmin && showAdmin) fetchAdminUsers(0);
  }, [isAdmin, showAdmin, fetchAdminUsers]);

  const adminAction = useCallback(
    async (path, method, label) => {
      try {
        if ((await apiCall(path, { method })).ok) {
          setToast(label);
          fetchAdminUsers(adminUsersOffset);
        }
      } catch (e) {
        console.error(e.message);
      }
    },
    [apiCall, fetchAdminUsers, adminUsersOffset]
  );

  // --- composer ----------------------------------------------------------
  /**
   * The one place that decides whether an attachment is acceptable.
   *
   * There are now three ways in — the file picker, a paste, and a drop — and
   * the camera makes a fourth that arrives already decoded. Three copies of
   * the type check would be three chances for them to disagree about what an
   * image is.
   */
  /* THE COMPOSER'S TWO UNSTABLE PROPS, for the same reason as copyAnswer above.
   *
   * Both were arrow functions written inline on <InputBar>, which is memo'd —
   * so the composer re-rendered on every streaming paint along with its
   * textarea and its five tooltip subscriptions, for tokens it has nothing to
   * do with. The one control the user is looking at while waiting was the one
   * doing the most pointless work. */
  const clearAttachment = useCallback(() => setAttachedImage(null), []);

  const handleDocSelect = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      // Cleared so picking the same file twice in a row still fires change —
      // the input keeps its value otherwise.
      e.target.value = "";
      chat.uploadFile(file);
    },
    // The FUNCTION, not `chat`. useChats returns a fresh object literal every
    // render, so depending on the whole hook result would rebuild this callback
    // every time and undo the point of it. uploadFile is useCallback'd in
    // useChats.js:616 and is the only part of `chat` this reads.
    [chat.uploadFile]
  );

  const acceptImageFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setToast("Only images can be attached.");
      return;
    }
    try {
      setAttachedImage(await fileToDataUrl(file));
    } catch (err) {
      setToast(err.message);
    }
  }, [setToast]);

  const handleFileSelect = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      // Cleared before the await, so picking the same file twice in a row
      // still fires a change event the second time.
      e.target.value = "";
      acceptImageFile(file);
    },
    [acceptImageFile]
  );

  const handleSend = useCallback(
    (text) => {
      // An attached image means "look at this", never "draw me one".
      if (!attachedImage && isImageRequest(text.trim())) {
        chat.generateImage(text.trim());
        return;
      }
      chat.send(text, attachedImage, () => setAttachedImage(null));
    },
    [attachedImage, chat.generateImage, chat.send]
  );

  const exportChat = useCallback(() => {
    if (!activeMessages.length) {
      setToast("Nothing to export yet.");
      return;
    }

    const title = activeChat?.title || "ALOP-AI chat";
    const body = activeMessages
      .filter((m) => m.content?.trim())
      .map((m) => `### ${m.role === "user" ? "You" : "ALOP-AI"}${m.ts ? ` · ${m.ts}` : ""}\n\n${m.content}`)
      .join("\n\n---\n\n");

    const url = URL.createObjectURL(
      new Blob([`# ${title}\n\n_Exported ${new Date().toLocaleString()}_\n\n${body}\n`], { type: "text/markdown" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^\w\s-]/g, "").trim().slice(0, 60) || "chat"}.md`;
    a.click();
    // Revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setToast("Chat exported.");
  }, [activeMessages, activeChat]);

  // --- panels and palette ------------------------------------------------
  // Only one panel is ever open: they occupy the same space, and two at once
  // renders as one panel with the wrong contents behind it.
  const openOnly = useCallback(
    (which) => {
      setShowSettings(which === "settings");
      setShowAdmin(which === "admin");
      setShowUpgrade(which === "upgrade");
      // Stored memory is fetched when the panel that shows it opens, not at
      // startup — nothing renders it before then, and a request nobody is
      // waiting on is latency on the path they are.
      if (which === "settings") userFacts.loadFacts();
    },
    [userFacts.loadFacts],
  );

  const openUpgrade = useCallback(() => openOnly("upgrade"), [openOnly]);

  const paletteActions = useMemo(
    () => [
      { id: "new", label: "New chat", hint: "Ctrl N", icon: "✚", run: chat.newChat },
      { id: "regen", label: "Regenerate last answer", hint: "Chat", icon: "↻", run: chat.regenerateLast },
      { id: "export", label: "Export chat as Markdown", hint: "Chat", icon: "⭳", run: exportChat },
      {
        id: "theme",
        label: darkMode ? "Switch to Bamboo Day" : "Switch to Sakura Night",
        hint: "Appearance",
        icon: darkMode ? "☀" : "☾",
        run: () => setDarkMode((d) => !d),
      },
      { id: "settings", label: "Open settings", hint: "App", icon: "⚙", run: () => openOnly("settings") },
      ...(billing.userPlan !== "pro" && billing.prices
        ? [{ id: "upgrade", label: "Upgrade to Pro", hint: "Billing", icon: "♛", run: () => openOnly("upgrade") }]
        : []),
    ],
    [chat.newChat, chat.regenerateLast, exportChat, darkMode, billing.userPlan, billing.prices, openOnly]
  );

  // Capture phase, so it still fires while focus is in the composer where
  // keydown is otherwise handled locally.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        setShowPalette((p) => !p);
      }
      if (key === "n") {
        e.preventDefault();
        chat.newChat();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [chat.newChat]);

  if (!isLoaded) return null;
  if (chat.isInitialLoading) return skeletonStuck ? <StuckLoading /> : <AppSkeleton />;

  const showUpgradeButton = billing.userPlan !== "pro" && Boolean(billing.prices);

  return (
    <div className={`app-root ${darkMode ? "dark" : "light"}`}>
      {/* The first tab stop. Without it, reaching the transcript from the
          keyboard means tabbing past the sidebar toggle, the search field, New
          Chat, and then every chat with its four action buttons. */}
      <a className="skip-link" href="#transcript">
        Skip to the conversation
      </a>

      <div className="bg-layer" />
      <div className="bg-overlay" />

      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        chats={chat.sortedChats}
        actions={paletteActions}
        onSelectChat={chat.setActiveChatId}
      />

      {/* `unstyled` hands the whole appearance to .toast in chat-controls.css,
          so a toast is dressed by the same tokens as everything else and does
          not ship a second colour system with the library. */}
      <Toaster
        position="top-center"
        duration={3200}
        visibleToasts={3}
        toastOptions={{ unstyled: true, className: "toast" }}
      />

      {camera.isOpen && (
        <CameraOverlay
          videoRef={camera.videoRef}
          canvasRef={camera.canvasRef}
          onCapture={camera.capture}
          onCancel={camera.stop}
        />
      )}

      <div className="app-shell">
       <div className="app-frame">
        <header className="app-header">
          {/* Both of these said only `title="Chats"`, which axe accepts as an
              accessible name but which is the weakest source there is: a title
              is not announced by every screen reader and never appears on
              touch. It was also inaccurate — these are two DIFFERENT controls
              that happened to share a tooltip, one opening a drawer and one
              collapsing a rail, and a name has to say which. aria-expanded
              gives the state, which a name cannot. */}
          <button
            className="icon-btn mobile-only"
            onClick={() => setMobileSidebarOpen(true)}
            title="Chats"
            aria-label="Open chat list"
            aria-expanded={mobileSidebarOpen}
          >
            <Icon name="menu" size={18} />
          </button>
          <button
            className="icon-btn desktop-only"
            onClick={() => setSidebarCollapsed((c) => !c)}
            title="Chats"
            aria-label={sidebarCollapsed ? "Show chat list" : "Hide chat list"}
            aria-expanded={!sidebarCollapsed}
          >
            <Icon name="menu" size={18} />
          </button>

          <div className="brand">
            {/* 22px on screen. favicon.png (144px) covers that to 6x device pixels;
                logo-mark.png is 512px and 28 KB. The empty state keeps the big
                one because it renders at 76px and genuinely needs the detail. */}
            <img src="/favicon.png" alt="" className="header-logo" />
            <h1 className="main-title">{activeChat?.title || "ALOP-AI"}</h1>
            {/* The council's size is the one fact the old subtitle carried that
                a reader could act on — it changes with the plan. The other
                three claims it sat beside ("AI Council", "Precision",
                "Learning") were a value proposition in the corner where the
                eye lands first, and they are gone.

                shadcn's Badge, not a hand-rolled pill: `secondary` already
                resolves to --surface-2 on --text-muted through the token
                bridge, so it cannot drift from the stylesheet. It needs
                data-ui-scope because Tailwind's `border` utility assumes a
                solid zero-width default that only ui-reset.css supplies here —
                without it the badge renders with no border at all. */}
            <Badge variant="secondary" data-ui-scope="" className="hidden shrink-0 sm:inline-flex">
              {/* Counted from the roster, never typed. This was a hardcoded pair of
                  digits that claimed one more free seat than COUNCIL has, and it
                  stayed wrong silently because nothing reads a literal. */}
              {billing.userPlan === "pro" ? `${COUNCIL.length} models` : `${FREE_COUNT} models`}
            </Badge>
          </div>

          <div className="header-actions">
            <button
              className="cmdk-trigger desktop-only"
              onClick={() => setShowPalette(true)}
              title="Search chats and commands (Ctrl+K)"
              aria-label="Search chats and commands"
            >
              <Icon name="search" size={14} /> <span>Search</span> <kbd>Ctrl K</kbd>
            </button>

            {showUpgradeButton && (
              <MagneticButton className="upgrade-btn" onClick={() => openOnly("upgrade")} ariaLabel="Upgrade to Pro">
                <Icon name="crown" size={14} /> <span className="upgrade-label">Upgrade</span>
              </MagneticButton>
            )}

            {isAdmin && (
              <MagneticButton
                className={`icon-btn admin-btn ${showAdmin ? "active" : ""}`}
                onClick={() => openOnly(showAdmin ? null : "admin")}
                ariaLabel="Admin"
              >
                <Icon name="crown" size={17} />
              </MagneticButton>
            )}

            <MagneticButton className="icon-btn" onClick={() => setDarkMode((d) => !d)} ariaLabel="Theme">
              <Icon name={darkMode ? "sun" : "moon"} size={17} />
            </MagneticButton>

            <MagneticButton
              className="icon-btn"
              onClick={() => openOnly(showSettings ? null : "settings")}
              ariaLabel="Settings"
            >
              <Icon name="settings" size={17} />
            </MagneticButton>
          </div>
        </header>

        <div className="app-body">
          <ChatSidebar
            chats={chat.sortedChats}
            activeChatId={chat.activeChatId}
            onSelect={chat.setActiveChatId}
            onCreate={chat.newChat}
            onDelete={chat.deleteChat}
            onRename={chat.renameChat}
            onPin={chat.togglePinChat}
            onFavorite={chat.toggleFavoriteChat}
            error={chat.chatsError}
            onRetry={chat.retryChats}
            collapsed={sidebarCollapsed}
            mobileOpen={mobileSidebarOpen}
            setMobileOpen={setMobileSidebarOpen}
            onExpand={() => setSidebarCollapsed(false)}
            userName={user?.fullName || user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress}
            userImageUrl={user?.imageUrl}
            userPlan={billing.userPlan}
            onUpgrade={showUpgradeButton ? openUpgrade : undefined}
            busy={status !== "idle"}
          />

          {/* THE PAGE HAD NO MAIN LANDMARK AT ALL — header and nav, then a run
              of anonymous divs. A screen reader user's first move on an unknown
              page is the landmark list, and the transcript and composer were
              not in it. This is the same box it always was; only the tag
              changed, so every `.chat-main` rule still applies. */}
          <main className="chat-main">
            {/* Inside the transcript panel, not the window: fixed positioning
                hung these over the sidebar and the header, which is the app's
                own chrome. They live in the margin the centred column makes. */}
            <Earring side="left" active={status !== "idle"} />
            <Earring side="right" active={status !== "idle"} />

            <AdminPanel
              open={showAdmin && isAdmin}
              onClose={() => setShowAdmin(false)}
              users={adminUsers}
              offset={adminUsersOffset}
              hasMore={adminUsersHasMore}
              onPrevious={() => fetchAdminUsers(Math.max(0, adminUsersOffset - ADMIN_PAGE_SIZE))}
              onNext={() => fetchAdminUsers(adminUsersOffset + ADMIN_PAGE_SIZE)}
              onSuspend={(id) => adminAction(`/api/admin/users/${id}/suspend`, "POST", "Suspended")}
              onUnsuspend={(id) => adminAction(`/api/admin/users/${id}/unsuspend`, "POST", "Unsuspended")}
              onDelete={(id) => {
                if (confirm("DELETE this user?")) adminAction(`/api/admin/users/${id}`, "DELETE", "Deleted");
              }}
            />

            {/* `&& Boolean(billing.prices)` was here, which made Upgrade a
                dead button whenever the prices request failed: no panel, no
                message, nothing. The panel owns that state now and says which
                failure it was. */}
            <UpgradePanel
              open={showUpgrade}
              onClose={() => setShowUpgrade(false)}
              prices={billing.prices}
              pricesError={billing.pricesError}
              pricesUnavailable={billing.pricesUnavailable}
              onRetryPrices={billing.retryPrices}
              billingBusy={billing.billingBusy}
              onCheckout={billing.startCheckout}
            />

            <SettingsPanel
              open={showSettings}
              onClose={() => setShowSettings(false)}
              darkMode={darkMode}
              onToggleTheme={() => setDarkMode((d) => !d)}
              onExport={exportChat}
              onDeleteChat={() => chat.activeChatId && chat.deleteChat(chat.activeChatId)}
              canDeleteChat={Boolean(chat.activeChatId)}
              userPlan={billing.userPlan}
              hasPrices={Boolean(billing.prices)}
              billingBusy={billing.billingBusy}
              onManageBilling={billing.openBillingPortal}
              onUpgrade={() => openOnly("upgrade")}
              facts={userFacts.facts}
              factsError={userFacts.factsError}
              factsBusy={userFacts.factsBusy}
              onRetryFacts={userFacts.loadFacts}
              onDeleteFact={userFacts.deleteFact}
              onForgetAll={userFacts.forgetAll}
            />

            <div className="chat-content">
              {/* Only on the empty state, matching SakuraFrame: an illustrated
                  frame around a transcript competes with the thing it frames. */}
              {activeMessages.length === 0 && <SakuraBaseCorners />}
              <div
                className="scroll-wrapper"
                id="transcript"
                // Focusable only as a skip-link target: without tabIndex the
                // jump moves the viewport but not focus, so the next Tab
                // continues from the sidebar as though nothing happened.
                tabIndex={-1}
                // aria-label on a plain div is discarded. Without a role there
                // is nothing for the name to name, so the skip link landed on
                // an anonymous container and the transcript appeared in no
                // landmark list. `region` is what makes "Conversation" a name
                // a screen reader will ever say.
                role="region"
                aria-label="Conversation"
                ref={chatRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  // Same threshold the auto-scroll uses, so the button appears
                  // exactly when following stops.
                  setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > FOLLOW_THRESHOLD_PX);
                }}
              >
                <Suspense fallback={<TranscriptFallback answerPending={status !== "idle"} />}>
                <MessageList
                  messages={renderedMessages}
                  streamDraft={streamDraft}
                  isLoadingMessages={chat.isLoadingMessages}
                  messageLoadError={chat.messageLoadError}
                  onRetryMessages={chat.retryMessages}
                  status={status}
                  feedback={chat.feedback}
                  onCopy={copyAnswer}
                  onSpeak={speakAnswer}
                  onFeedback={chat.submitFeedback}
                  onPickStarter={handlePickStarter}
                />
                </Suspense>
              </div>

              {showScrollDown && (
                <button
                  className="scroll-down-btn"
                  onClick={() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" })}
                  title="Jump to latest"
                  aria-label="Jump to latest message"
                >
                  <Icon name="arrowDown" size={16} />
                </button>
              )}

              {activeMessages.length > 0 && status === "idle" && (
                <div className="chat-toolbar">
                  <button className="chat-toolbar-btn" onClick={chat.regenerateLast} title="Regenerate the last answer">
                    <Icon name="refresh" size={13} /> Regenerate
                  </button>
                  <button className="chat-toolbar-btn" onClick={exportChat} title="Download this chat as Markdown">
                    <Icon name="download" size={13} /> Export
                  </button>
                </div>
              )}

              <InputBar
                onSend={handleSend}
                disabled={status !== "idle" || chat.isLoadingMessages || chat.messageLoadError}
                onFileSelect={handleFileSelect}
                onStartCamera={camera.start}
                isListening={speech.isListening}
                toggleListening={speech.toggle}
                attachedImage={attachedImage}
                onClearAttachment={clearAttachment}
                isGenerating={status === "loading" || status === "streaming"}
                onStop={chat.stopGeneration}
                onImageFile={acceptImageFile}
                attachedFiles={chat.chatFiles}
                attachedFilesError={chat.chatFilesError}
                onRetryFiles={chat.retryChatFiles}
                onDocSelect={handleDocSelect}
                onRemoveFile={chat.removeFile}
              />
            </div>
          </main>
        </div>
       </div>
      </div>
    </div>
  );
};

/**
 * THE GATE ASKED ONE HOOK AND THE APP ASKED THE OTHER.
 *
 * This used to branch on `useUser().isSignedIn` alone, while AuthenticatedApp
 * computes `isReady` from `useAuth().isSignedIn`. Clerk answers those two
 * questions differently, and its own shipped source is explicit about it:
 *
 *   useAuth:  isSignedIn = session.status !== "pending" && !!session
 *   useUser:  isSignedIn = a user object exists — no session check at all
 *
 * So a PENDING session rendered the whole application for a user whose
 * requests could never be authorised: `isReady` stayed false, `loadChats`
 * never ran, `isInitialLoading` was never cleared, and the skeleton stayed up
 * forever with no error and nothing to click.
 *
 * Both hooks are consulted here now, and every combination has a screen. The
 * fix is the gate, not the loader — a component further in cannot know why
 * its data never arrives.
 */
const AuthenticatedAppWrapper = () => {
  const { isLoaded: userLoaded, isSignedIn: hasUser } = useUser();
  const { isLoaded: authLoaded, isSignedIn, signOut } = useAuth();
  const { session } = useSession();

  /**
   * Signing out has to actually remove the cached sidebar, not merely stop
   * reading it.
   *
   * Hung off "there is no user" rather than off a sign-out button, because most
   * sign-outs do not go through a button this app owns — Clerk's own UserButton
   * menu is the usual route and there is nothing to wrap. Whatever path was
   * taken, the app arrives here with no user, and that is the moment the
   * browser should stop holding anybody's conversation titles.
   *
   * Above the early returns because hooks cannot be conditional; the guard is
   * inside instead.
   */
  useEffect(() => {
    if (userLoaded && !hasUser) {
      clearChats();
      clearPendingTurn();
    }
  }, [userLoaded, hasUser]);

  if (!userLoaded || !authLoaded) return <InitialLoader />;
  if (!hasUser) return <SignInPage />;
  // A user, but no usable session. Never render the app for this: it is the
  // exact state that produced an infinite skeleton.
  if (!isSignedIn) return <SessionPending task={session?.currentTask} onSignOut={() => signOut()} />;
  return <AuthenticatedApp />;
};

/** The desktop shell opens the overlay by URL, not by route. */
const isOverlayWindow = () =>
  typeof window !== "undefined" &&
  (window.location.search.includes("overlay=true") || window.location.hash.includes("overlay"));

const App = () => (
  <ClerkProvider
    publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
    signInUrl="/"
    // Was "/", which renders the sign-in form — so Clerk's own "Sign up" link
    // led back to sign-in and email registration was unreachable. SignInPage
    // renders <SignUp> on this path; vercel.json rewrites it to index.html.
    signUpUrl="/sign-up"
    afterSignInUrl="/"
    afterSignUpUrl="/"
    // Element styling moved here from 21 CSS rules that named Clerk's internal
    // classes — the pattern Clerk warns about on every page load, because those
    // selectors break when it ships a component update. See lib/clerkAppearance.js.
    appearance={clerkAppearance}
  >
    <div style={{ width: "100vw", height: "100dvh" }}>
      {isOverlayWindow() ? (
        <Suspense fallback={null}>
          <OverlayAssistant />
        </Suspense>
      ) : (
        <AuthenticatedAppWrapper />
      )}
    </div>
  </ClerkProvider>
);

export default App;
