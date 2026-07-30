import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SidePanel from "../components/SidePanel";

/**
 * The behavioural half of the stacking guard in zIndexOrder.test.js.
 *
 * That suite reads source; this one renders. A panel that ends up nested
 * inside .chat-main is trapped in that element's stacking context, where its
 * --z-panel (70) is composited beneath the earring's --z-earring (4) no matter
 * what the numbers say. Nine commits were spent on that bug. Asserting the DOM
 * position is the only check that actually catches it.
 */
describe("SidePanel", () => {
  it("renders nothing while closed", () => {
    const { container } = render(
      <SidePanel open={false} title="Settings" onClose={() => {}}>
        <p>body</p>
      </SidePanel>
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("escapes the chat stacking context by rendering outside its parent", () => {
    const { container } = render(
      <div className="chat-main">
        <SidePanel open title="Settings" onClose={() => {}}>
          <p>body</p>
        </SidePanel>
      </div>
    );

    const dialog = screen.getByRole("dialog");
    expect(container.querySelector(".chat-main").contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it("labels itself with the title it was given", () => {
    render(
      <SidePanel open title="Admin Dashboard" onClose={() => {}}>
        <p>body</p>
      </SidePanel>
    );
    expect(screen.getByText("Admin Dashboard")).toBeInTheDocument();
    expect(screen.getByLabelText("Close Admin Dashboard")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <SidePanel open title="Settings" onClose={onClose}>
        <p>body</p>
      </SidePanel>
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes from the close button", async () => {
    const onClose = vi.fn();
    render(
      <SidePanel open title="Settings" onClose={onClose}>
        <p>body</p>
      </SidePanel>
    );
    await userEvent.click(screen.getByLabelText("Close Settings"));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not call onClose merely because it opened", () => {
    // onOpenChange fires in both directions; forwarding it blindly would close
    // the panel the instant it opened.
    const onClose = vi.fn();
    render(
      <SidePanel open title="Settings" onClose={onClose}>
        <p>body</p>
      </SidePanel>
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps focus inside the panel", async () => {
    // The hand-rolled version this replaced registered an Escape handler and
    // nothing else, so Tab walked straight into the chat behind it.
    render(
      <div>
        <button>Behind</button>
        <SidePanel open title="Settings" onClose={() => {}}>
          <button>Inside one</button>
          <button>Inside two</button>
        </SidePanel>
      </div>
    );

    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 6; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement), "focus escaped into the page behind").toBe(true);
    }
  });
});
