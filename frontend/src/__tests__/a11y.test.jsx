import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import ChatSidebar from "../components/ChatSidebar";
import CommandPalette from "../components/CommandPalette";
import InputBar from "../components/InputBar";
import { EmptyState } from "../components/MessageList";
import AdminPanel from "../components/panels/AdminPanel";
import SidePanel from "../components/SidePanel";

/**
 * Accessibility is a legal surface, not a polish item.
 *
 * Under the ADA in the US and the EAA across the EU since June 2025, a
 * consumer service is expected to meet WCAG 2.1 AA, and the usual first
 * contact is a complaint rather than an audit. This suite fails the build on
 * the violation classes that make up most of those complaints: an input with
 * no label, a button whose only content is an icon, a broken ARIA reference.
 *
 * THESE ARE THE REAL COMPONENTS, and that is the whole point.
 *
 * The first version of this file ran axe over test/fixtures/appMarkup.js and
 * reported 38 unlabelled buttons and 6 unlabelled fields. Nearly all of it was
 * FIXTURE DRIFT. That fixture is hand-transcribed markup kept for the CSS
 * cascade snapshot, where only classes and structure matter, so its
 * aria-labels were never maintained — ChatSidebar's four row actions carry
 * aria-label and aria-pressed in the source and carried neither in the copy.
 * An accessibility test that reads a transcription measures the transcription.
 * Anything asserted here is rendered from the component the user gets.
 *
 * WHAT IT STILL CANNOT SEE, so a green run is not a clean bill of health:
 * jsdom does no layout and no colour compositing, so contrast, focus order,
 * reflow at 320px and real screen-reader output are out of scope and need a
 * browser pass.
 */

// Contrast is disabled EXPLICITLY rather than left to report nothing: jsdom
// resolves every colour to transparent, so the rule is meaningless here in
// either direction. Naming it keeps the gap visible.
const OPTIONS = { rules: { "color-contrast": { enabled: false } } };

const expectClean = async (container) => {
  const { violations } = await axe(container, OPTIONS);
  expect(
    violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.html?.slice(0, 100)}`)
  ).toEqual([]);
};

const noop = () => {};

describe("accessibility", () => {
  it("the chat sidebar", async () => {
    const { container } = render(
      <ChatSidebar
        chats={[
          { id: "a", title: "First chat", pinned: true },
          { id: "b", title: "Second chat", favorite: true },
          { id: "c", title: "" },
        ]}
        activeChatId="a"
        onSelect={noop} onCreate={noop} onDelete={noop} onRename={noop}
        onPin={noop} onFavorite={noop}
        collapsed={false} mobileOpen setMobileOpen={noop}
      />
    );
    await expectClean(container);
  });

  it("the command palette", async () => {
    const { container } = render(
      <CommandPalette
        open
        onClose={noop}
        chats={[{ id: "c1", title: "Postgres vs Mongo" }, { id: "c2", title: null }]}
        actions={[{ id: "new", label: "New chat", hint: "Ctrl N", icon: "+", run: noop }]}
        onSelectChat={noop}
      />
    );
    await expectClean(container);
  });

  it("the composer, idle and generating", async () => {
    const idle = render(<InputBar onSend={noop} onFileSelect={noop} onStartCamera={noop} toggleListening={noop} />);
    await expectClean(idle.container);
    idle.unmount();

    // The stop button and the attachment chip only exist in this state, and a
    // control that appears mid-generation is exactly the kind that gets
    // shipped unlabelled.
    const busy = render(
      <InputBar
        onSend={noop} onFileSelect={noop} onStartCamera={noop} toggleListening={noop}
        isGenerating onStop={noop} isListening
        attachedImage="data:image/png;base64,iVBORw0KGgo=" onClearAttachment={noop}
        attachedFiles={[{ id: "f1", name: "notes.txt", bytes: 120 }]} onRemoveFile={noop}
      />
    );
    await expectClean(busy.container);
  });

  it("the empty state", async () => {
    const { container } = render(<EmptyState onPick={noop} />);
    await expectClean(container);
  });

  it("the admin panel", async () => {
    const { container } = render(
      <AdminPanel
        open
        users={[{ id: "1", email: "a@example.com", name: "A", plan: "free", is_admin: false, suspended: false }]}
        offset={0} hasMore onClose={noop} onPrevious={noop} onNext={noop}
        onSuspend={noop} onUnsuspend={noop} onDelete={noop}
      />
    );
    await expectClean(container);
  });

  it("a side panel", async () => {
    const { container } = render(
      <SidePanel open title="Settings" onClose={noop}>
        <p>Body</p>
      </SidePanel>
    );
    await expectClean(container);
  });
});
