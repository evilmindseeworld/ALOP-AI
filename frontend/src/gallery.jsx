import React from "react";
import ReactDOM from "react-dom/client";
import "./tailwind.css";
import "./App.css";
import { APP_MARKUP } from "./test/fixtures/appMarkup";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetTrigger, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

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

    {/* `transform` creates a containing block, so the fixture's position:fixed
        elements — camera overlay, command palette, side panel, toast — are
        boxed inside this frame instead of covering the whole page. Without it
        the gallery is four overlays stacked on top of each other.

        dangerouslySetInnerHTML is safe here and cannot become unsafe: APP_MARKUP
        is a string literal checked into this repo, never user input, and this
        entry is not part of the app bundle. The fixture is plain HTML by design
        so the snapshot harness can walk it under bare jsdom without React. */}
    <div
      style={{
        transform: "translateZ(0)",
        position: "relative",
        height: "100vh",
        overflow: "hidden",
        margin: "0 24px 24px",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 12,
      }}
      dangerouslySetInnerHTML={{ __html: APP_MARKUP }}
    />
  </div>
);

ReactDOM.createRoot(document.getElementById("gallery")).render(
  <React.StrictMode>
    <Gallery />
  </React.StrictMode>
);
