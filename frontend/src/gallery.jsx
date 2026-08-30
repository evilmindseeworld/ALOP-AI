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
import CouncilExemplar from "./components/CouncilExemplar";
import CouncilRosette from "./components/CouncilRosette";
import { SakuraBaseCorners, Seal } from "./components/SakuraFrame";
import { COUNCIL, FREE_COUNT } from "./constants/council";
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

    {/* The keystone is positioned against App's `.chat-content`, as a sibling
     * of the scroller rather than a child of it. This section preserves that
     * positioning contract without requiring a signed-in session. */}
    <Section
      title="Composer keystone"
      note="The convergence mark above the composer. Its positioning layer overlaps the prompt bar and is pointer-events: none, so clicks pass through."
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

    <Section title="Council rosette" note={`${COUNCIL.length} traces, one per model in the pro council, superimposed until they resolve into one figure. Shown at full strength; it renders at 0.16 in the app.`}>
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
    provenance: {
      schemaVersion: 1,
      requestState: "complete",
      route: "search",
      answerProduced: true,
      evidence: { searchUsed: true, sourceCount: 2 },
      verification: { completed: true },
      sources: [
        { title: "Manufacturer product page", domain: "alop-ai.onrender.com", url: "https://alop-ai.onrender.com/example/manufacturer", date: "2026-08-20" },
        { title: "Independent panel review", domain: "alop-ai.onrender.com", url: "https://alop-ai.onrender.com/example/review", date: "2026-08-18" },
      ],
    },
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

- [Manufacturer product page](https://alop-ai.onrender.com/example/manufacturer)
- [Independent panel review](https://alop-ai.onrender.com/example/review)`,
  },
];

const SAMPLE_STREAM_DRAFT = {
  ...SAMPLE_MESSAGES.at(-1),
  content: "The answer is arriving from the council.",
  process: {
    phase: "answering",
    reserve: true,
    activeKey: null,
    synthesisSeen: true,
    pendingTools: true,
    announcement: "The answer is forming.",
    stages: [
      { key: "context", text: "Reading your conversation" },
      { key: "council", text: "3 of 3 answered" },
      { key: "synthesis", text: "Reconciling the answers" },
    ],
  },
};

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
            <img src="/favicon.png" alt="" className="header-logo" />
            <h1 className="main-title">{empty ? "ALOP-AI" : "Monitor buying advice"}</h1>
            {/* These classes are copied from App.jsx and must stay copied.
                Without `hidden sm:inline-flex` this frame showed the badge at
                every width while the real header hides it below 640px — so the
                gallery was reporting a crowded mobile header the app does not
                actually have. A fixture that differs from the app stops
                guarding the thing it differs on. */}
            <Badge variant="secondary" data-ui-scope="" className="hidden shrink-0 sm:inline-flex">
              {COUNCIL.length} models
            </Badge>
          </div>
          <div className="header-actions">
            {/* `desktop-only` was missing here and the note four lines above —
                "these classes are copied from App.jsx and must stay copied" —
                was written about the Badge on the element immediately before
                it. The very next element drifted anyway.
                The consequence was not cosmetic: this frame showed a 142px
                search box with a "Ctrl K" hint in a 390px header, so the
                gallery reported a crowded phone header that the real app does
                not have, and a phone fix aimed at it would have been aimed at
                nothing. The real trigger is hidden below 768px. */}
            <button className="cmdk-trigger desktop-only">
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
                  streamDraft={streaming ? SAMPLE_STREAM_DRAFT : undefined}
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

/**
 * Clerk cannot mount in this entry: there is no ClerkProvider, identity, or
 * network session. Keep the surrounding shell identical to SignInPage and
 * make the substitution impossible to mistake for a real auth check.
 */
const GalleryClerkPlaceholder = ({ signUp }) => (
  <div
    aria-label="Clerk form stand-in"
    style={{
      display: "grid",
      gap: 12,
      color: "var(--text-muted)",
      font: "13px/1.4 system-ui, sans-serif",
    }}
  >
    <div
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: 42,
        border: "1px solid var(--border)",
        borderRadius: 8,
        color: "var(--text)",
        background: "color-mix(in srgb, var(--surface) 72%, transparent)",
      }}
    >
      Continue with Google
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-subtle)", fontSize: 11 }}>
      <span aria-hidden="true" style={{ height: 1, flex: 1, background: "var(--border)" }} />
      or
      <span aria-hidden="true" style={{ height: 1, flex: 1, background: "var(--border)" }} />
    </div>
    <label style={{ display: "grid", gap: 6, color: "var(--text-muted)", fontSize: 12 }}>
      Email address
      <input
        readOnly
        aria-label="Email address (stand-in)"
        placeholder="you@example.com"
        style={{
          width: "100%",
          boxSizing: "border-box",
          minHeight: 42,
          padding: "0 12px",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          color: "var(--text)",
          font: "inherit",
        }}
      />
    </label>
    <div
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: 42,
        borderRadius: 8,
        background: "var(--primary)",
        color: "var(--text-on-fill)",
        fontWeight: 600,
      }}
    >
      {signUp ? "Create account" : "Continue"}
    </div>
    <p style={{ margin: 0, textAlign: "center", color: "var(--text-subtle)", fontSize: 11 }}>
      Static Clerk form stand-in for the gallery
    </p>
  </div>
);

const SIGNIN_SHELL = ({ signUp, loading, theme }) => (
  <div className={`app-root ${theme}`} style={{ position: "relative", height: "100vh", overflow: "hidden", transform: "translateZ(0)" }}>
    <div className="signin-root">
      <div className="signin-noise" />
      <div className="signin-lattice" aria-hidden="true" />
      <Earring side="left" />
      <Earring side="right" />

      <div className="signin-wrap">
        <div className="signin-brand">
          <img src="/favicon.png" alt="" className="signin-logo-mark" />
          <span className="signin-logo-text">ALOP-AI</span>
        </div>

        {/* INTRO, CARD, PROOF — the same DOM order as SignInPage.jsx, and the
            order matters more here than anywhere else in this file.
            `.signin-thesis` was one block with the tagline after the ladder;
            splitting it is what stopped the form from preceding the product's
            first sentence on a phone. A gallery frame that keeps the old
            structure would document a layout the app no longer has, and would
            be consulted as if it were current — the same failure as the test
            that agreed with a comment about Clerk instead of checking the
            page. If SignInPage's structure changes again, change this too. */}
        <div className="signin-grid">
          <section className="signin-intro">
            <h1 className="signin-title">Ask once. Several models answer.</h1>
            <p className="signin-tagline">
              They disagree on purpose. You get what they agreed on, and where they didn&rsquo;t.
            </p>
          </section>

          <section className="signin-card">
            <h2 className="signin-card-title">{signUp ? "Create your account" : "Sign in"}</h2>
            <div className="signin-card-inner">
              {loading ? (
                <div className="signin-card-loading" {...(loading === "captioned" ? { role: "status" } : { "aria-hidden": "true" })}>
                  {loading === "captioned" ? "Preparing secure sign-in\u2026" : null}
                </div>
              ) : (
                <GalleryClerkPlaceholder signUp={signUp} />
              )}
            </div>
            <p className="signin-plan">
              {FREE_COUNT} models free. All {COUNCIL.length} on Pro.
            </p>
            <p className="signin-legal">
              {signUp ? "By creating an account" : "By continuing"} you confirm you are at least 13 years old
              (16 in the EEA and UK) and agree to our{" "}
              <a href="/terms.html">Terms</a> and <a href="/privacy.html">Privacy Policy</a>.
            </p>
          </section>

          <section className="signin-proof" aria-labelledby={`gallery-proof-title-${theme}-${signUp ? "up" : "in"}`}>
            <h2 id={`gallery-proof-title-${theme}-${signUp ? "up" : "in"}`} className="sr-only">
              How the council is composed
            </h2>
            <p id={`gallery-council-scale-${theme}-${signUp ? "up" : "in"}`} className="sr-only">
              Five seats, ordered from the most literal to the most lateral.
              Each row begins with that seat&rsquo;s sampling temperature, from
              0.2 to 0.7.
            </p>
            <ol
              className="council-ladder"
              aria-describedby={`gallery-council-scale-${theme}-${signUp ? "up" : "in"}`}
            >
              {COUNCIL.map((m) => (
                <li key={m.model} className={`council-row ${m.free ? "" : "is-pro"}`}>
                  <span className="council-temp">{m.temperature.toFixed(1)}</span>
                  <span className="council-seat">
                    <span className="council-name">{m.title}</span>
                    <span className="council-blurb">{m.company}</span>
                  </span>
                  {!m.free && <span className="council-tag">Pro</span>}
                </li>
              ))}
            </ol>
            <p className="council-resolve">
              One reply, reconciled.
              <Seal className="sakura-seal signin-seal" id={`gallery-signin-seal-${theme}-${signUp ? "up" : "in"}`} />
            </p>
          </section>
        </div>
        <CouncilExemplar />
      </div>
    </div>
  </div>
);

const SignInGalleryFrame = ({ theme, signUp = false, loading, down = false, label }) => (
  <figure style={{ margin: "0 24px 28px" }}>
    <figcaption
      style={{
        font: "600 11px/1.4 system-ui, sans-serif",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        opacity: 0.55,
        margin: "0 0 8px",
      }}
    >
      {label}
    </figcaption>
    {down ? (
      <div className={`app-root ${theme}`} style={{ position: "relative", height: "72vh", minHeight: 560, overflow: "hidden", transform: "translateZ(0)" }}>
        <div className="signin-root">
          <div className="signin-down" role="alert">
            <h1 className="signin-down-title">Sign-in isn&rsquo;t responding.</h1>
            <p className="signin-down-body">
              We can&rsquo;t reach the service that signs you in. Your account and your chats are not affected &mdash; there is nothing to recover and nothing has been lost.
            </p>
            <p className="signin-down-body">
              This is usually brief. If reloading doesn&rsquo;t help, it is on our side, not yours.
            </p>
            <button className="signin-down-retry" type="button">Reload</button>
          </div>
        </div>
      </div>
    ) : (
      <SIGNIN_SHELL signUp={signUp} loading={loading} theme={theme} />
    )}
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

    <h2
      style={{
        font: "600 12px/1.4 system-ui, sans-serif",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        opacity: 0.55,
        margin: "8px 24px 12px",
      }}
    >
      Signed-out shell — Clerk states
    </h2>

    <SignInGalleryFrame
      theme="dark"
      label="Sign-in — Sakura Night; Clerk form is a static stand-in, not a mounted Clerk card"
    />
    <SignInGalleryFrame
      theme="light"
      label="Sign-in — Bamboo Day intent; Clerk form is a static stand-in, not a mounted Clerk card; live page cannot currently reach this theme"
    />
    <SignInGalleryFrame
      theme="dark"
      signUp
      label="Sign-up — Sakura Night; Clerk form is a static stand-in, not a mounted Clerk card"
    />
    <SignInGalleryFrame
      theme="light"
      signUp
      label="Sign-up — Bamboo Day intent; Clerk form is a static stand-in, not a mounted Clerk card; live page cannot currently reach this theme"
    />
    <SignInGalleryFrame
      theme="dark"
      loading="reserved"
      label="Clerk loading slot — dark; empty 342px reservation before the 700ms grace period; no form is mounted"
    />
    <SignInGalleryFrame
      theme="dark"
      loading="captioned"
      label="Clerk loading slot — dark; after 700ms: Preparing secure sign-in…; no form is mounted"
    />
    <SignInGalleryFrame
      theme="light"
      loading="reserved"
      label="Clerk loading slot — light intent; empty 342px reservation before the 700ms grace period; live page cannot currently reach this theme"
    />
    <SignInGalleryFrame
      theme="light"
      loading="captioned"
      label="Clerk loading slot — light intent; after 700ms: Preparing secure sign-in…; live page cannot currently reach this theme"
    />
    <SignInGalleryFrame
      theme="dark"
      down
      label="Ten-second Clerk down state — dark; no form is mounted, only the real outage message and Reload action"
    />
    <SignInGalleryFrame
      theme="light"
      down
      label="Ten-second Clerk down state — light intent; no form is mounted; live page cannot currently reach this theme"
    />

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
