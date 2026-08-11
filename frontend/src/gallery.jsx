import React, { useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import "./tailwind.css";
import "./App.css";
import { APP_MARKUP, appTree, outsideAppRoot } from "./test/fixtures/appMarkup";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetTrigger, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import MagneticButton from "@/components/ui/MagneticButton";
import Earring from "./components/Earring";
import CouncilRosette from "./components/CouncilRosette";
import { SakuraBaseCorners } from "./components/SakuraFrame";
import Icon, { ICON_NAMES } from "./components/Icon";
import MessageList from "./components/MessageList";
import InputBar from "./components/InputBar";
import ChatSidebar from "./components/ChatSidebar";

/**
 * A visual index of everything the stylesheet and the component layer render.
 *
 * Its own Vite entry, so none of this reaches the app bundle. Two jobs:
 *
 *   1. Before/after screenshots. The cascade snapshot proves which declaration
 *      wins; it cannot show you that a panel is 4px too narrow. This can.
 *   2. A place to see every state at once — hover, active, disabled, empty,
 *      both themes — without clicking through the running app to reach them.
 *
 * The chrome markup comes from the SAME fixture the cascade snapshot walks, so
 * the gallery and the guard cannot drift apart. If a component is missing
 * here, it is missing from the snapshot too.
 */

const Section = ({ title, note, children }) => (
  <section style={{ margin: "0 0 40px" }}>
    <h2
      style={{
        font: "600 12px/1.4 system-ui, sans-serif",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        opacity: 0.55,
        margin: "0 0 4px",
      }}
    >
      {title}
    </h2>
    {note && <p style={{ font: "13px/1.5 system-ui, sans-serif", opacity: 0.5, margin: "0 0 14px" }}>{note}</p>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>{children}</div>
  </section>
);

const Primitives = () => (
  <div data-ui-scope="" style={{ padding: 24 }}>
    <Section title="Button" note="Every variant and size, plus the disabled state.">
      {["default", "secondary", "destructive", "outline", "ghost", "link"].map((variant) => (
        <Button key={variant} variant={variant}>
          {variant}
        </Button>
      ))}
      <Button size="sm">small</Button>
      <Button size="lg">large</Button>
      <Button disabled>disabled</Button>
    </Section>

    <Section title="Badge">
      {["default", "secondary", "destructive", "outline"].map((variant) => (
        <Badge key={variant} variant={variant}>
          {variant}
        </Badge>
      ))}
    </Section>

    <Section title="Switch" note="Both states. Keyboard-operable, unlike the div it replaced.">
      <Switch aria-label="off" />
      <Switch defaultChecked aria-label="on" />
      <Switch disabled aria-label="disabled" />
    </Section>

    <Section title="Skeleton">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-9 w-9 rounded-full" />
    </Section>

    <Section title="Separator">
      <div style={{ width: 240 }}>
        <Separator />
      </div>
    </Section>

    <Section title="Tabs">
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">First</TabsTrigger>
          <TabsTrigger value="two">Second</TabsTrigger>
        </TabsList>
        <TabsContent value="one">First panel</TabsContent>
        <TabsContent value="two">Second panel</TabsContent>
      </Tabs>
    </Section>

    {/* The real components, not the fixture's placeholders.
     *
     * The fixture draws the ornament as <svg><path d="M0 0"/></svg> and every
     * icon the same way, which is all the cascade snapshot needs — it resolves
     * declarations, not pixels. It is useless for looking at: the first pass of
     * this gallery showed an empty chain hanging from nothing, and the earring
     * bug that shipped (a stud 30px below the end of its chain) is exactly the
     * kind of thing only a rendered drawing shows. */}
    <Section title="Icons" note="Every glyph in the set, at the size the UI uses it.">
      {ICON_NAMES.map((name) => (
        <span
          key={name}
          title={name}
          style={{ display: "grid", placeItems: "center", width: 34, height: 34, color: "var(--text-muted)" }}
        >
          <Icon name={name} size={18} />
        </span>
      ))}
    </Section>

    <Section title="Ornament" note="The real Crescent and chain — the pair, mirrored, as they hang in the app.">
      <div style={{ position: "relative", height: 190, width: 280 }}>
        <Earring side="left" active />
        <Earring side="right" active />
      </div>
    </Section>

    {/* These two only exist correctly in App's `.chat-content`, which the empty
     * state below cannot show: the lower sprigs are a SIBLING of the scroller,
     * not a child of it, precisely so they can reach the real bottom corners.
     * Without this section the only way to see them is to sign in. */}
    <Section
      title="Base corners"
      note="The lower sprigs, as they sit either side of the composer. They overlap the prompt bar on purpose and are pointer-events: none, so clicks pass through."
    >
      <div
        className="app-root dark"
        style={{ position: "relative", height: 200, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", overflow: "hidden" }}
      >
        <div className="chat-content" style={{ position: "relative", height: "100%" }}>
          <SakuraBaseCorners />
          <div className="input-bar" style={{ position: "absolute", insetInline: 0, bottom: 0 }}>
            <div className="input-wrapper">
              <span style={{ color: "var(--text-dim)", padding: "4px 2px" }}>Ask the AI Council anything…</span>
            </div>
          </div>
        </div>
      </div>
    </Section>

    <Section title="Council rosette" note="Seven traces, one per model in the pro council, superimposed until they resolve into one figure. Shown at full strength; it renders at 0.16 in the app.">
      <div className="app-root dark" style={{ position: "relative", height: 300, display: "grid", placeItems: "center", borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)" }}>
        <div style={{ position: "relative", width: 300, height: 300, color: "var(--primary)", opacity: 0.5 }}>
          <CouncilRosette />
        </div>
      </div>
    </Section>

    {/* The header buttons are MagneticButton, not <button> — they lean toward the
     * cursor. It is the one motion primitive in components/ui/ the app actually
     * mounts, and it was missing here, so its rest state was the only one any
     * screenshot had ever shown. Hover these. */}
    <Section title="Magnetic button" note="What the header controls really are. Springs toward the pointer; snaps back on leave.">
      <div className="app-root dark" style={{ display: "flex", gap: 12, padding: 16, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)" }}>
        <MagneticButton className="upgrade-btn" ariaLabel="Upgrade to Pro">
          <Icon name="crown" size={14} /> <span className="upgrade-label">Upgrade</span>
        </MagneticButton>
        <MagneticButton className="icon-btn" ariaLabel="Theme">
          <Icon name="moon" size={17} />
        </MagneticButton>
        <MagneticButton className="icon-btn" ariaLabel="Settings" disabled>
          <Icon name="settings" size={17} />
        </MagneticButton>
      </div>
    </Section>

    {/* The skip link is invisible until focused — `transform: translateY(-200%)`,
     * not `display: none`, because a hidden link cannot be focused and a link
     * that cannot be focused cannot be skipped to. A gallery that rendered it
     * honestly would render nothing, so this frame pins it to its focused
     * position. The mechanism is asserted in tests; this is here so the
     * focused appearance is reviewable at all. */}
    <Section title="Skip link" note="Shown in its focused position. In the app it sits off-screen until Tab reaches it.">
      <div className="app-root dark" style={{ position: "relative", height: 78, width: 320, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)" }}>
        <a className="skip-link" href="#transcript" style={{ transform: "translateY(0)" }}>
          Skip to the conversation
        </a>
      </div>
    </Section>

    <Section title="Overlays" note="Sheet and Dialog both portal out and trap focus.">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline">Open sheet</Button>
        </SheetTrigger>
        <SheetContent title="Settings">
          <p style={{ fontSize: 14 }}>Panel body.</p>
        </SheetContent>
      </Sheet>

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline">Open dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog</DialogTitle>
            <DialogDescription>With a description.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost">Hover me</Button>
          </TooltipTrigger>
          <TooltipContent>A tooltip</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </Section>
  </div>
);

/**
 * One framed copy of the fixture.
 *
 * `transform` creates a containing block, so the fixture's position:fixed
 * elements — camera overlay, command palette, side panel, toast — are boxed
 * inside this frame instead of covering the whole page.
 *
 * `hide` is what makes the gallery usable at all. The fixture deliberately
 * renders EVERY state at once, including four overlays, so a single frame
 * showed a blurred scrim with a command palette on top and none of the chrome
 * underneath — which is exactly the thing the gallery exists to let you look
 * at. Each frame now removes the layers it is not about.
 *
 * dangerouslySetInnerHTML is safe here and cannot become unsafe: APP_MARKUP is
 * a string literal checked into this repo, never user input, and this entry is
 * not part of the app bundle. The fixture is plain HTML by design so the
 * snapshot harness can walk it under bare jsdom without React.
 */
const Frame = ({ markup, hide = [], height = "100vh", label }) => {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.innerHTML = markup;
    for (const selector of hide) root.querySelectorAll(selector).forEach((el) => el.remove());
  }, [markup, hide]);

  return (
    <figure style={{ margin: "0 24px 28px" }}>
      {label && (
        <figcaption
          style={{
            font: "600 11px/1.4 system-ui, sans-serif",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            opacity: 0.45,
            margin: "0 0 8px",
          }}
        >
          {label}
        </figcaption>
      )}
      <div
        ref={ref}
        style={{
          transform: "translateZ(0)",
          position: "relative",
          height,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 12,
        }}
      />
    </figure>
  );
};

/**
 * The real components, with data — not the fixture.
 *
 * The fixture is transcribed markup: right for the cascade snapshot, which
 * resolves declarations, and wrong for judging the design, because its icons
 * are empty paths and its prose is one sentence. This renders the actual
 * MessageList, InputBar and ChatSidebar with a conversation in them, which is
 * the only way to see what a long answer, a wrapped question and a full
 * sidebar actually look like next to each other.
 */
const SAMPLE_MESSAGES = [
  {
    id: "u1",
    role: "user",
    ts: "16:04",
    content: "Which OLED monitor should I buy for gaming under $900, and why that one?",
  },
  {
    id: "a1",
    role: "assistant",
    ts: "16:05",
    // All three row states at once — done, still running, refused by the SSRF
    // guard. The failed row is the one worth looking at: it is what a model
    // pointing the server at 169.254.169.254 actually renders as.
    activity: [
      { round: 1, name: "web_search", summary: '6 results for "OLED burn-in 2026"', ok: true },
      { round: 1, name: "web_search", summary: '5 results for "QD-OLED vs WOLED"', ok: true },
      { round: 2, name: "read_url", summary: "Read rtings.com", pending: true },
      { round: 2, name: "read_url", summary: "Refused to fetch that URL: resolves to 169.254.169.254, which is a private or reserved address.", ok: false },
    ],
    content: `The **ASUS ROG Strix XG27AQWMG** is the one to buy at this budget.

### Why this one

It is the only panel in the range that pairs a 280Hz refresh rate with a true
1440p resolution, and its QD-OLED coating holds black level in a lit room —
which is where the cheaper WOLED panels fall apart.

1. **Motion.** 0.03ms response, no overdrive artefacts at any refresh rate.
2. **Colour.** 99% DCI-P3, factory calibrated to ΔE < 2.
3. **Burn-in cover.** Three years, including burn-in, which is not standard.

| Panel | Refresh | Price |
|---|---|---|
| XG27AQWMG | 280Hz | $849 |
| AW2725DF | 360Hz | $899 |

> The 360Hz alternative is faster on paper, and you will not see it below 240.

\`\`\`js
const pick = monitors.find((m) => m.hz >= 240 && m.price < 900);
\`\`\`

### Sources

- [Amazon.ae — ASUS ROG Strix OLED XG27AQWMG](https://example.com/a)
- [Microless UAE — ASUS ROG Strix OLED](https://example.com/b)`,
  },
];

const SAMPLE_CHATS = [
  { id: "1", title: "Monitor buying advice", pinned: true },
  { id: "2", title: "Refactor the cascade snapshot harness", favorite: true },
  { id: "3", title: "Why does useEffect run twice?" },
  { id: "4", title: "Postgres or Mongo for a social app" },
];

/** A 1×1 PNG, enough to prove the attachment thumbnail's box without a fixture file. */
const SAMPLE_ATTACHMENT =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#3b2f4a"/><circle cx="60" cy="40" r="22" fill="#e6b8c8"/></svg>',
  );

/**
 * @param streaming  the council is answering: ornament lit, transcript typing,
 *                   composer showing Stop instead of Send. This is the state
 *                   §5 of the overhaul added and the one screenshot nobody had.
 * @param loaded     composer carrying an attachment and dictating — the two
 *                   §4 states that only appear mid-interaction.
 * @param collapsed  the 56px sidebar rail from §2.
 */
const LiveChrome = ({ theme, empty = false, streaming = false, loaded = false, collapsed = false, label }) => (
  <figure style={{ margin: "0 24px 28px" }}>
    <figcaption
      style={{
        font: "600 11px/1.4 system-ui, sans-serif",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        opacity: 0.45,
        margin: "0 0 8px",
      }}
    >
      Live components — {theme}
      {label ? ` — ${label}` : empty ? " — empty state" : ""}
    </figcaption>
    <div
      className={`app-root ${theme}`}
      style={{
        transform: "translateZ(0)",
        position: "relative",
        height: "92vh",
        overflow: "hidden",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.12)",
      }}
    >
      <a className="skip-link" href="#transcript">
        Skip to the conversation
      </a>
      <div className="app-shell">
       <div className="app-frame">
        <header className="app-header">
          <button className="icon-btn" aria-label="Chats">
            <Icon name="menu" size={18} />
          </button>
          <div className="brand">
            <h1 className="main-title">{empty ? "ALOP-AI" : "Monitor buying advice"}</h1>
            {/* These classes are copied from App.jsx and must stay copied.
                Without `hidden sm:inline-flex` this frame showed the badge at
                every width while the real header hides it below 640px — so the
                gallery was reporting a crowded mobile header the app does not
                actually have. A fixture that differs from the app stops
                guarding the thing it differs on. */}
            <Badge variant="secondary" data-ui-scope="" className="hidden shrink-0 sm:inline-flex">
              7 models
            </Badge>
          </div>
          <div className="header-actions">
            <button className="cmdk-trigger">
              <Icon name="search" size={14} /> <span>Search</span> <kbd>Ctrl K</kbd>
            </button>
            <button className="upgrade-btn">
              <Icon name="crown" size={14} /> <span className="upgrade-label">Upgrade</span>
            </button>
            <button className="icon-btn" aria-label="Theme">
              <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
            </button>
            <button className="icon-btn" aria-label="Settings">
              <Icon name="settings" size={17} />
            </button>
          </div>
        </header>

        <div className="app-body">
          <ChatSidebar
            chats={empty ? [] : SAMPLE_CHATS}
            activeChatId="1"
            onSelect={() => {}}
            onCreate={() => {}}
            onDelete={() => {}}
            onRename={() => {}}
            onPin={() => {}}
            onFavorite={() => {}}
            collapsed={collapsed}
            mobileOpen={false}
            setMobileOpen={() => {}}
            onExpand={() => {}}
            userName="Ada Lovelace"
            userPlan={empty ? "free" : "pro"}
            onUpgrade={() => {}}
          />

          <div className="chat-main">
            <Earring side="left" active={streaming} />
            <Earring side="right" active={streaming} />

            <div className="chat-content">
              <div className="scroll-wrapper">
                <MessageList
                  messages={empty ? [] : streaming ? SAMPLE_MESSAGES.slice(0, -1) : SAMPLE_MESSAGES}
                  streamDraft={streaming ? SAMPLE_MESSAGES.at(-1) : undefined}
                  status={streaming ? "streaming" : "idle"}
                  feedback={{ a1: "up" }}
                  onCopy={() => {}}
                  onFeedback={() => {}}
                  onPickStarter={() => {}}
                />
              </div>

              {!empty && (
                <div className="chat-toolbar">
                  <button className="chat-toolbar-btn">
                    <Icon name="refresh" size={13} /> Regenerate
                  </button>
                  <button className="chat-toolbar-btn">
                    <Icon name="download" size={13} /> Export
                  </button>
                </div>
              )}

              <InputBar
                onSend={() => {}}
                disabled={false}
                onFileSelect={() => {}}
                onStartCamera={() => {}}
                isListening={loaded}
                toggleListening={() => {}}
                attachedFiles={
                  loaded
                    ? [
                        { id: "f1", name: "budget.csv" },
                        { id: "f2", name: "a-very-long-attachment-filename-that-must-truncate.md" },
                      ]
                    : []
                }
                attachedImage={loaded ? SAMPLE_ATTACHMENT : null}
                onClearAttachment={() => {}}
                isGenerating={streaming}
                onStop={() => {}}
              />
            </div>
          </div>
        </div>
       </div>
      </div>
    </div>
  </figure>
);

/** Everything that paints over the app rather than being part of it. */
const OVERLAYS = [".cmdk-backdrop", ".camera-overlay", ".panel-overlay", ".side-panel", ".toast"];

/** The variants of a component the fixture renders side by side for coverage. */
const DUPLICATE_SIDEBARS = [".sidebar.collapsed", ".sidebar.mobileOpen"];

const Gallery = () => (
  <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#f0ebe6" }}>
    <header style={{ padding: "24px 24px 8px", font: "600 20px/1.2 system-ui, sans-serif" }}>
      ALOP-AI style gallery
      <p style={{ font: "13px/1.5 system-ui, sans-serif", opacity: 0.5, margin: "6px 0 0", maxWidth: 620 }}>
        Not part of the app bundle. The chrome below is the same fixture the cascade snapshot walks, so what you see
        here is exactly what that guard governs.
      </p>
    </header>

    <Primitives />

    <h2
      style={{
        font: "600 12px/1.4 system-ui, sans-serif",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        opacity: 0.55,
        margin: "8px 24px 12px",
      }}
    >
      App chrome — both themes
    </h2>

    <LiveChrome theme="dark" />
    <LiveChrome theme="dark" empty />
    <LiveChrome theme="light" />

    {/* The three states the overhaul added that only exist mid-interaction, and
        which no screenshot covered until §7. Idle chrome is what everyone sees;
        these are what the work actually changed. */}
    <LiveChrome theme="dark" streaming label="council answering (§5 ornament, typing, Stop)" />
    <LiveChrome theme="dark" loaded label="composer loaded (§4 attachment + dictation)" />
    <LiveChrome theme="light" collapsed label="sidebar rail, 56px (§2)" />

    <Frame
      label="Dark — Sakura Obsidian (fixture)"
      markup={appTree("dark")}
      hide={[...OVERLAYS, ...DUPLICATE_SIDEBARS, ".empty-state"]}
    />

    <Frame
      label="Dark — empty state"
      markup={appTree("dark")}
      hide={[...OVERLAYS, ...DUPLICATE_SIDEBARS, ".msg-stream"]}
      height="78vh"
    />

    <Frame
      label="Light — Bamboo Day"
      markup={appTree("light")}
      hide={[...OVERLAYS, ...DUPLICATE_SIDEBARS, ".empty-state"]}
    />

    <Frame label="Overlays — palette, panel, camera, toast" markup={appTree("dark")} hide={DUPLICATE_SIDEBARS} />

    <Frame label="Overlay assistant — always dark, outside .app-root" markup={outsideAppRoot} height="40vh" />

    {/* The whole fixture, unedited: what the cascade snapshot actually walks.
        Kept last so the gallery and the guard cannot drift — if something is
        missing here it is missing from the guard too. */}
    <Frame label="The complete fixture, as the snapshot sees it" markup={APP_MARKUP} height="60vh" />
  </div>
);

ReactDOM.createRoot(document.getElementById("gallery")).render(
  <React.StrictMode>
    <Gallery />
  </React.StrictMode>
);
