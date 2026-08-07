import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CommandPalette from "../components/CommandPalette";

// Chat search did not exist before this. The sidebar lists every chat with no
// filter, so finding an old conversation meant scrolling and reading titles.
const CHATS = [
  { id: "c1", title: "Postgres vs Mongo" },
  { id: "c2", title: "Debugging useEffect" },
  { id: "c3", title: "Jellyfish artwork" },
  { id: "c4", title: null }, // untitled chats must still be reachable
];

const setup = (props = {}) => {
  const onClose = vi.fn();
  const onSelectChat = vi.fn();
  const run = vi.fn();
  const actions = [
    { id: "new", label: "New chat", hint: "Ctrl N", icon: "✚", run },
    { id: "export", label: "Export chat as Markdown", hint: "Chat", icon: "⭳", run },
  ];
  render(
    <CommandPalette open onClose={onClose} chats={CHATS} actions={actions} onSelectChat={onSelectChat} {...props} />
  );
  return { onClose, onSelectChat, run };
};

const options = () => screen.getAllByRole("option");

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    render(<CommandPalette open={false} onClose={vi.fn()} chats={CHATS} actions={[]} onSelectChat={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists actions and chats when open", () => {
    setup();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("New chat")).toBeInTheDocument();
    expect(screen.getByText("Postgres vs Mongo")).toBeInTheDocument();
  });

  it("shows untitled chats as 'New Chat' rather than dropping them", () => {
    setup();
    expect(screen.getByText("New Chat")).toBeInTheDocument();
  });

  it("puts actions first when the query is empty", () => {
    setup();
    expect(options()[0]).toHaveTextContent("New chat");
  });

  it("filters chats by title, case-insensitively", async () => {
    setup();
    await userEvent.type(screen.getByRole("textbox"), "mongo");

    const labels = options().map((o) => o.textContent);
    expect(labels.some((l) => l.includes("Postgres vs Mongo"))).toBe(true);
    expect(labels.some((l) => l.includes("Jellyfish"))).toBe(false);
  });

  it("leads with chats once the user types, since that is what they're hunting", async () => {
    setup();
    await userEvent.type(screen.getByRole("textbox"), "chat");

    // "New chat" and "Export chat" both match, but a chat result should lead.
    expect(options()[0]).toHaveTextContent("New Chat");
  });

  it("can still find actions by name", async () => {
    setup();
    await userEvent.type(screen.getByRole("textbox"), "markdown");
    expect(options()).toHaveLength(1);
    expect(options()[0]).toHaveTextContent("Export chat as Markdown");
  });

  it("reports when nothing matches", async () => {
    setup();
    await userEvent.type(screen.getByRole("textbox"), "zzzzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/No matches/)).toBeInTheDocument();
  });

  it("moves the selection with the arrow keys", async () => {
    setup();
    expect(options()[0]).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{ArrowDown}");
    expect(options()[1]).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{ArrowUp}");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("wraps around at both ends", async () => {
    setup();
    const count = options().length;

    // Up from the first entry lands on the last.
    await userEvent.keyboard("{ArrowUp}");
    expect(options()[count - 1]).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{ArrowDown}");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("runs the selected action on Enter and closes", async () => {
    const { run, onClose } = setup();

    await userEvent.keyboard("{Enter}");

    expect(run).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opens the chosen chat on Enter", async () => {
    const { onSelectChat } = setup();

    await userEvent.type(screen.getByRole("textbox"), "jellyfish");
    await userEvent.keyboard("{Enter}");

    expect(onSelectChat).toHaveBeenCalledWith("c3");
  });

  it("runs an item on click", async () => {
    const { onSelectChat, onClose } = setup();

    await userEvent.click(screen.getByText("Debugging useEffect"));

    expect(onSelectChat).toHaveBeenCalledWith("c2");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", async () => {
    const { onClose } = setup();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when the backdrop is clicked", async () => {
    const { onClose } = setup();
    // mouseDown, matching the handler — click alone would not reach it.
    await userEvent.pointer({ target: document.querySelector(".cmdk-backdrop"), keys: "[MouseLeft>]" });
    expect(onClose).toHaveBeenCalled();
  });

  it("does NOT close when the panel itself is clicked", async () => {
    const { onClose } = setup();
    await userEvent.pointer({ target: document.querySelector(".cmdk-search"), keys: "[MouseLeft>]" });
    expect(onClose).not.toHaveBeenCalled();
  });

  // Enter on an empty result set previously risked running items[undefined].
  it("does nothing on Enter when there are no results", async () => {
    const { run, onSelectChat, onClose } = setup();

    await userEvent.type(screen.getByRole("textbox"), "zzzzz");
    await userEvent.keyboard("{Enter}");

    expect(run).not.toHaveBeenCalled();
    expect(onSelectChat).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the selection in range when the list shrinks under it", async () => {
    setup();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
    await userEvent.type(screen.getByRole("textbox"), "markdown");

    // One result left; the cursor must have clamped onto it, not run off.
    expect(options()).toHaveLength(1);
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
  });
});

describe("focus management", () => {
  // aria-modal="true" promises a screen reader that everything outside the
  // dialog is inert. Nothing enforced it: Tab walked into the page behind,
  // and closing dropped focus on <body> so the next Tab restarted from the
  // top of the document.
  it("takes focus on open and gives it back on close", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open palette";
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { rerender } = render(
      <CommandPalette open onClose={() => {}} chats={[]} actions={[]} onSelectChat={() => {}} />
    );
    expect(document.activeElement).toBe(screen.getByPlaceholderText(/search/i));

    rerender(<CommandPalette open={false} onClose={() => {}} chats={[]} actions={[]} onSelectChat={() => {}} />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("does not throw when the opener is gone", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(
      <CommandPalette open onClose={() => {}} chats={[]} actions={[]} onSelectChat={() => {}} />
    );
    opener.remove();
    expect(() =>
      rerender(<CommandPalette open={false} onClose={() => {}} chats={[]} actions={[]} onSelectChat={() => {}} />)
    ).not.toThrow();
  });
});
