import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from "react";
import { ClerkProvider, useUser, useAuth } from "@clerk/react";
import { Toaster, toast } from "sonner";
import "./App.css";

import SignInPage from "./SignInPage";
import clerkAppearance from "./lib/clerkAppearance";
import MagneticButton from "./components/ui/MagneticButton";
import { Badge } from "./components/ui/badge";
import CommandPalette from "./components/CommandPalette";
import Icon from "./components/Icon";
import Earring from "./components/Earring";
import InputBar from "./components/InputBar";
import ChatSidebar from "./components/ChatSidebar";
import CameraOverlay from "./components/CameraOverlay";
import { InitialLoader, AppSkeleton } from "./components/Skeletons";
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

import { useApi } from "./lib/api";
import { Storage } from "./lib/storage";
import { fileToDataUrl } from "./lib/image";
import { appendToControlledInput } from "./lib/dom";
import { isImageRequest } from "./lib/format";
import { useChats } from "./hooks/useChats";
import { useBilling } from "./hooks/useBilling";
import { useCamera } from "./hooks/useCamera";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";

import { animate, createScope, spring, createDraggable } from "animejs";

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

  const chat = useChats({ apiCall, getToken, isReady, setToast });
  const billing = useBilling({ apiCall, isReady, setToast });

  const camera = useCamera({ onCapture: setAttachedImage, onError: setToast });
  const speech = useSpeechRecognition({
    onUnsupported: () => setToast("Needs Chrome/Edge/Safari"),
    // The composer owns its own text state, so dictation is appended through
    // the DOM. It has to go through the native setter — see lib/dom.js.
    onTranscript: (text) => appendToControlledInput(document.querySelector(".input-text"), text),
  });

  const { activeChat, activeMessages, status } = chat;

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
  }, [chat.chats, chat.activeChatId]);

  useEffect(() => {
    if (chatRef.current && status === "loading") chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [status]);

  // --- animation ---------------------------------------------------------
  useEffect(() => {
    if (!chatRef.current) return;

    if (activeMessages.length === 0) {
      const scope = createScope({ root: chatRef.current }).add(() => {
        animate(".empty-logo", {
          scale: [
            { to: 1.08, ease: "inOut(3)", duration: 400 },
            { to: 1, ease: spring({ bounce: 0.7 }) },
          ],
          loop: true,
          loopDelay: 1200,
        });
        createDraggable(".empty-logo", { container: [0, 0, 0, 0], releaseEase: spring({ bounce: 0.8 }) });
      });
      return () => scope.revert();
    }

    const rows = chatRef.current.querySelectorAll(".msg-row");
    if (rows.length) {
      animate(rows[rows.length - 1], {
        opacity: [0, 1],
        translateY: [16, 0],
        scale: [0.97, 1],
        ease: spring({ bounce: 0.3, stiffness: 120 }),
        duration: 700,
      });
    }
  }, [activeMessages]);

  // Delegated press feedback, so every primary button gets it without wiring.
  useEffect(() => {
    const onClick = (e) => {
      const button = e.target.closest(".input-btn.primary, .new-chat-btn, .overlay-submit");
      if (!button) return;
      animate(button, { scale: [{ to: 0.9, duration: 80 }, { to: 1, ease: spring({ bounce: 0.6 }) }] });
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
    [attachedImage, chat]
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
  const openOnly = useCallback((which) => {
    setShowSettings(which === "settings");
    setShowAdmin(which === "admin");
    setShowUpgrade(which === "upgrade");
  }, []);

  const paletteActions = useMemo(
    () => [
      { id: "new", label: "New chat", hint: "Ctrl N", icon: "✚", run: () => chat.createChat() },
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
    [chat, exportChat, darkMode, billing.userPlan, billing.prices, openOnly]
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
        chat.createChat();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [chat]);

  if (!isLoaded) return null;
  if (chat.isInitialLoading) return <AppSkeleton />;

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
          <button className="icon-btn mobile-only" onClick={() => setMobileSidebarOpen(true)} title="Chats">
            <Icon name="menu" size={18} />
          </button>
          <button className="icon-btn desktop-only" onClick={() => setSidebarCollapsed((c) => !c)} title="Chats">
            <Icon name="menu" size={18} />
          </button>

          <div className="brand">
            <img src="/logo.png" alt="" className="header-logo" />
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
              {billing.userPlan === "pro" ? "7 models" : "4 models"}
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
            onCreate={chat.createChat}
            onDelete={chat.deleteChat}
            onRename={chat.renameChat}
            onPin={chat.togglePinChat}
            onFavorite={chat.toggleFavoriteChat}
            collapsed={sidebarCollapsed}
            mobileOpen={mobileSidebarOpen}
            setMobileOpen={setMobileSidebarOpen}
            onExpand={() => setSidebarCollapsed(false)}
            userName={user?.fullName || user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress}
            userImageUrl={user?.imageUrl}
            userPlan={billing.userPlan}
            onUpgrade={showUpgradeButton ? () => openOnly("upgrade") : undefined}
          />

          <div className="chat-main">
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

            <UpgradePanel
              open={showUpgrade && Boolean(billing.prices)}
              onClose={() => setShowUpgrade(false)}
              prices={billing.prices}
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
            />

            <div className="chat-content">
              <div
                className="scroll-wrapper"
                id="transcript"
                // Focusable only as a skip-link target: without tabIndex the
                // jump moves the viewport but not focus, so the next Tab
                // continues from the sidebar as though nothing happened.
                tabIndex={-1}
                aria-label="Conversation"
                ref={chatRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  // Same threshold the auto-scroll uses, so the button appears
                  // exactly when following stops.
                  setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > FOLLOW_THRESHOLD_PX);
                }}
              >
                <Suspense fallback={null}>
                <MessageList
                  messages={activeMessages}
                  isLoadingMessages={chat.isLoadingMessages}
                  messageLoadError={chat.messageLoadError}
                  onRetryMessages={chat.retryMessages}
                  status={status}
                  feedback={chat.feedback}
                  onCopy={(content) => navigator.clipboard.writeText(content)}
                  onFeedback={chat.submitFeedback}
                  onPickStarter={handleSend}
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
                onClearAttachment={() => setAttachedImage(null)}
                isGenerating={status === "loading" || status === "streaming"}
                onStop={chat.stopGeneration}
                onImageFile={acceptImageFile}
                attachedFiles={chat.chatFiles}
                onDocSelect={(e) => {
                  const file = e.target.files?.[0];
                  // Cleared so picking the same file twice in a row still
                  // fires change — the input keeps its value otherwise.
                  e.target.value = "";
                  chat.uploadFile(file);
                }}
                onRemoveFile={chat.removeFile}
              />
            </div>
          </div>
        </div>
       </div>
      </div>
    </div>
  );
};

const AuthenticatedAppWrapper = () => {
  const { isSignedIn, isLoaded } = useUser();
  if (!isLoaded) return <InitialLoader />;
  if (!isSignedIn) return <SignInPage />;
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
