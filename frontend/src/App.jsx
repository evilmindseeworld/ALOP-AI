import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { ClerkProvider, useUser, useAuth } from "@clerk/react";
import "./App.css";

import SignInPage from "./SignInPage";
import MagneticButton from "./components/ui/MagneticButton";
import CommandPalette from "./components/CommandPalette";
import Icon from "./components/Icon";
import Earring from "./components/Earring";
import InputBar from "./components/InputBar";
import ChatSidebar from "./components/ChatSidebar";
import MessageList from "./components/MessageList";
import CameraOverlay from "./components/CameraOverlay";
import { InitialLoader, AppSkeleton } from "./components/Skeletons";
import SettingsPanel from "./components/panels/SettingsPanel";
import AdminPanel from "./components/panels/AdminPanel";
import UpgradePanel from "./components/panels/UpgradePanel";
import OverlayAssistant from "./overlay/OverlayAssistant";

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

const AuthenticatedApp = () => {
  const { user, isLoaded } = useUser();
  const { getToken, isSignedIn } = useAuth();
  const apiCall = useApi(getToken);
  const isReady = isLoaded && isSignedIn;

  const [darkMode, setDarkMode] = useState(() => Storage.get("alop-dark-mode") !== "false");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => Storage.get("pa-sidebar-collapsed") !== "false");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const [adminUsers, setAdminUsers] = useState([]);
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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

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
  const fetchAdminUsers = useCallback(async () => {
    try {
      const r = await apiCall("/api/admin/users");
      setAdminUsers((await r.json()) || []);
    } catch (e) {
      console.error(e.message);
    }
  }, [apiCall]);

  useEffect(() => {
    if (!isReady) return;
    const email = user?.emailAddresses?.[0]?.emailAddress;
    if (!email) return;

    (async () => {
      try {
        const r = await apiCall("/api/admin/users");
        if (!r.ok) return;
        const users = await r.json();
        if (users.find((u) => u.email === email)?.is_admin) setIsAdmin(true);
      } catch (e) {
        console.error(e.message);
      }
    })();
  }, [isReady, user, apiCall]);

  useEffect(() => {
    if (isAdmin && showAdmin) fetchAdminUsers();
  }, [isAdmin, showAdmin, fetchAdminUsers]);

  const adminAction = useCallback(
    async (path, method, label) => {
      try {
        if ((await apiCall(path, { method })).ok) {
          setToast(label);
          fetchAdminUsers();
        }
      } catch (e) {
        console.error(e.message);
      }
    },
    [apiCall, fetchAdminUsers]
  );

  // --- composer ----------------------------------------------------------
  const handleFileSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
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
  }, []);

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
      <div className="bg-layer" />
      <div className="bg-overlay" />
      <Earring side="left" />
      <Earring side="right" />

      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        chats={chat.sortedChats}
        actions={paletteActions}
        onSelectChat={chat.setActiveChatId}
      />

      {toast && <div className="toast">{toast}</div>}

      {camera.isOpen && (
        <CameraOverlay
          videoRef={camera.videoRef}
          canvasRef={camera.canvasRef}
          onCapture={camera.capture}
          onCancel={camera.stop}
        />
      )}

      <div className="app-shell">
        <header className="app-header">
          <button className="icon-btn mobile-only" onClick={() => setMobileSidebarOpen(true)} title="Chats">
            <Icon name="menu" size={20} />
          </button>
          <button className="icon-btn desktop-only" onClick={() => setSidebarCollapsed((c) => !c)} title="Chats">
            <Icon name="menu" size={20} />
          </button>

          <div className="brand">
            <img src="/logo.png" alt="" className="header-logo" />
            <div className="brand-text">
              <h1 className="main-title">{activeChat?.title || "ALOP-AI"}</h1>
              <span className="sub-title">
                AI Council • {billing.userPlan === "pro" ? "7 models" : "4 models"} • Precision • Learning
              </span>
            </div>
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
                <Icon name="crown" size={14} /> Upgrade
              </MagneticButton>
            )}

            {isAdmin && (
              <MagneticButton
                className={`icon-btn admin-btn ${showAdmin ? "active" : ""}`}
                onClick={() => openOnly(showAdmin ? null : "admin")}
                ariaLabel="Admin"
              >
                <Icon name="crown" size={20} />
              </MagneticButton>
            )}

            <MagneticButton className="icon-btn" onClick={() => setDarkMode((d) => !d)} ariaLabel="Theme">
              <Icon name={darkMode ? "sun" : "moon"} size={20} />
            </MagneticButton>

            <MagneticButton
              className="icon-btn"
              onClick={() => openOnly(showSettings ? null : "settings")}
              ariaLabel="Settings"
            >
              <Icon name="settings" size={20} />
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
          />

          <div className="chat-main">
            <AdminPanel
              open={showAdmin && isAdmin}
              onClose={() => setShowAdmin(false)}
              users={adminUsers}
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
                ref={chatRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  // Same threshold the auto-scroll uses, so the button appears
                  // exactly when following stops.
                  setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > FOLLOW_THRESHOLD_PX);
                }}
              >
                <MessageList
                  messages={activeMessages}
                  status={status}
                  feedback={chat.feedback}
                  onCopy={(content) => navigator.clipboard.writeText(content)}
                  onFeedback={chat.submitFeedback}
                  onPickStarter={handleSend}
                />
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
                disabled={status !== "idle"}
                onFileSelect={handleFileSelect}
                onStartCamera={camera.start}
                isListening={speech.isListening}
                toggleListening={speech.toggle}
                attachedImage={attachedImage}
                onClearAttachment={() => setAttachedImage(null)}
                isGenerating={status === "loading" || status === "streaming"}
                onStop={chat.stopGeneration}
              />
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
    signUpUrl="/"
    afterSignInUrl="/"
    afterSignUpUrl="/"
    appearance={{
      baseTheme: "dark",
      variables: { colorPrimary: "#ec7d96", colorBackground: "#1b120c", colorText: "#faf0e6" },
    }}
  >
    <div style={{ width: "100vw", height: "100dvh" }}>
      {isOverlayWindow() ? <OverlayAssistant /> : <AuthenticatedAppWrapper />}
    </div>
  </ClerkProvider>
);

export default App;
