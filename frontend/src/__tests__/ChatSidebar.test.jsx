import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatSidebar from "../components/ChatSidebar";

const chats = [
  { id: "a", title: "First chat", pinned: true },
  { id: "b", title: "Second chat", favorite: true },
  { id: "c", title: "" },
];

const noop = () => {};
const renderSidebar = (props = {}) =>
  render(
    <ChatSidebar
      chats={chats}
      activeChatId="a"
      onSelect={noop}
      onCreate={noop}
      onDelete={noop}
      onRename={noop}
      onPin={noop}
      onFavorite={noop}
      collapsed={false}
      mobileOpen={false}
      setMobileOpen={noop}
      {...props}
    />
  );

describe("ChatSidebar", () => {
  it("shows an empty message rather than a bare list", () => {
    renderSidebar({ chats: [] });
    expect(screen.getByText("No chats yet")).toBeInTheDocument();
  });

  it("falls back to 'New Chat' for an untitled chat", () => {
    renderSidebar();
    expect(screen.getByText("New Chat", { selector: ".chat-title" })).toBeInTheDocument();
  });

  it("marks the active, pinned and favourite chats with classes the stylesheet uses", () => {
    const { container } = renderSidebar();
    const rows = container.querySelectorAll(".chat-item");
    expect(rows[0].className).toContain("active");
    expect(rows[0].className).toContain("pinned");
    expect(rows[1].className).toContain("favorite");
  });

  it("selects a chat when its row is clicked", async () => {
    const onSelect = vi.fn();
    renderSidebar({ onSelect });
    await userEvent.click(screen.getByText("Second chat"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("does NOT select the chat when an action button is clicked", async () => {
    // The row is the select target, so every action has to stop propagation.
    // Without it, deleting a chat also switches to it on the way out.
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    renderSidebar({ onSelect, onDelete });

    await userEvent.click(screen.getAllByLabelText("Delete chat")[1]);

    expect(onDelete).toHaveBeenCalledWith("b");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("commits a rename on Enter", async () => {
    const onRename = vi.fn();
    renderSidebar({ onRename });

    await userEvent.click(screen.getAllByLabelText("Rename chat")[0]);
    const input = screen.getByLabelText("Chat title");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed{Enter}");

    expect(onRename).toHaveBeenCalledWith("a", "Renamed");
  });

  it("abandons a rename on Escape without calling onRename", async () => {
    const onRename = vi.fn();
    renderSidebar({ onRename });

    await userEvent.click(screen.getAllByLabelText("Rename chat")[0]);
    const input = screen.getByLabelText("Chat title");
    await userEvent.clear(input);
    await userEvent.type(input, "Discarded{Escape}");

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText("First chat")).toBeInTheDocument();
  });

  it("only offers the mobile close button while the mobile drawer is open", () => {
    const { queryByLabelText } = renderSidebar({ mobileOpen: false });
    expect(queryByLabelText("Close chat list")).toBeNull();

    renderSidebar({ mobileOpen: true });
    expect(screen.getByLabelText("Close chat list")).toBeInTheDocument();
  });
});

/**
 * The row's select target is a <button>, not the row div.
 *
 * It used to be a div with onClick, which meant the only way to reach a chat
 * from the keyboard was not to reach it at all — and it forced every action
 * button inside it to stopPropagation, because deleting a chat would otherwise
 * switch to it on the way out. A button for the title and buttons for the
 * actions are siblings, so there is no propagation to stop.
 */
describe("ChatSidebar — the row is reachable", () => {
  it("makes the title a real button", () => {
    const { container } = renderSidebar();
    const title = container.querySelector(".chat-title");
    expect(title.tagName).toBe("BUTTON");
  });

  it("selects with Enter from the keyboard", async () => {
    const onSelect = vi.fn();
    const { container } = renderSidebar({ onSelect });

    container.querySelectorAll(".chat-title")[1].focus();
    await userEvent.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("walks the list with the arrow keys", async () => {
    const { container } = renderSidebar();
    const rows = [...container.querySelectorAll(".chat-title")];

    rows[0].focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rows[1]);

    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rows[2]);

    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(rows[1]);
  });

  it("wraps at both ends rather than dead-ending", async () => {
    const { container } = renderSidebar();
    const rows = [...container.querySelectorAll(".chat-title")];

    rows[0].focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(rows.at(-1));

    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rows[0]);
  });

  it("jumps to the ends with Home and End", async () => {
    const { container } = renderSidebar();
    const rows = [...container.querySelectorAll(".chat-title")];

    rows[1].focus();
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(rows.at(-1));

    await userEvent.keyboard("{Home}");
    expect(document.activeElement).toBe(rows[0]);
  });
});

/**
 * Filtering is the change that most makes a sidebar feel like Linear's, and it
 * is also the one most likely to be implemented as "hide the rows that do not
 * match" — which leaves the group headings of empty groups behind.
 */
describe("ChatSidebar — search", () => {
  const search = (container) => container.querySelector(".sidebar-search-input");

  it("filters the list as you type, case-insensitively", async () => {
    const { container } = renderSidebar();
    await userEvent.type(search(container), "SECOND");

    const titles = [...container.querySelectorAll(".chat-title")].map((b) => b.textContent);
    expect(titles).toEqual(["Second chat"]);
  });

  it("drops the heading of a group the filter emptied", async () => {
    const { container } = renderSidebar();
    // "Second chat" is the only favourite, so Pinned and Recent both empty.
    await userEvent.type(search(container), "second");

    const labels = [...container.querySelectorAll(".chat-group-label")].map((l) => l.textContent);
    expect(labels).not.toContain("Pinned");
    expect(labels).not.toContain("Recent");
  });

  it("distinguishes 'no matches' from 'no chats yet'", async () => {
    const { container } = renderSidebar();
    await userEvent.type(search(container), "zzzzz");

    expect(screen.getByText(/No chats match/i)).toBeInTheDocument();
    expect(screen.queryByText("No chats yet")).toBeNull();
  });

  it("clears on Escape", async () => {
    const { container } = renderSidebar();
    const input = search(container);

    await userEvent.type(input, "second");
    expect(container.querySelectorAll(".chat-title")).toHaveLength(1);

    await userEvent.type(input, "{Escape}");
    expect(input).toHaveValue("");
    expect(container.querySelectorAll(".chat-title")).toHaveLength(3);
  });

  it("searches the untitled chat by its fallback name", async () => {
    // A chat with no title renders as "New Chat"; searching for what is on
    // screen has to find it, or the filter lies about what it can see.
    const { container } = renderSidebar();
    await userEvent.type(search(container), "new ch");

    expect(container.querySelectorAll(".chat-title")).toHaveLength(1);
  });

  it("hides the search field when there is nothing to search", () => {
    const { container } = renderSidebar({ chats: [] });
    expect(search(container)).toBeNull();
  });
});

/**
 * Collapsed renders a RAIL, and renders it ALONGSIDE the full list rather than
 * instead of it.
 *
 * Which one is visible is a cascade decision, not a JavaScript one — the same
 * rule the sidebar's own mobile breakpoint already follows. It has to be:
 * `collapsed` defaults to true, so on a phone the FIRST render is collapsed,
 * and a component that swapped in rail markup there would put a 56px icon
 * column inside a 300px drawer. `display: none` also takes the hidden copy out
 * of the accessibility tree, so nothing is announced twice.
 */
describe("ChatSidebar — the collapsed rail", () => {
  it("always renders both the rail and the full list", () => {
    const { container } = renderSidebar({ collapsed: true });
    expect(container.querySelector(".sidebar-rail")).toBeInTheDocument();
    expect(container.querySelector(".sidebar-full")).toBeInTheDocument();
  });

  it("still renders both when expanded, so the cascade alone decides", () => {
    const { container } = renderSidebar({ collapsed: false });
    expect(container.querySelector(".sidebar-rail")).toBeInTheDocument();
    expect(container.querySelector(".sidebar-full")).toBeInTheDocument();
  });

  it("names every rail chat, since the rail shows only a glyph", () => {
    const { container } = renderSidebar();
    const railChats = container.querySelectorAll(".rail-chat");

    expect(railChats.length).toBeGreaterThan(0);
    for (const button of railChats) {
      expect(button.getAttribute("aria-label")).toBeTruthy();
    }
  });

  it("selects from the rail", async () => {
    const onSelect = vi.fn();
    const { container } = renderSidebar({ onSelect });

    await userEvent.click(container.querySelectorAll(".rail-chat")[1]);
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("marks the active chat in the rail too", () => {
    const { container } = renderSidebar();
    expect(container.querySelector(".rail-chat").className).toContain("active");
  });

  it("offers new chat and search from the rail", () => {
    const { container } = renderSidebar();
    expect(container.querySelector(".rail-new")).toBeInTheDocument();
    expect(container.querySelector(".rail-search")).toBeInTheDocument();
  });
});

describe("ChatSidebar — the user block", () => {
  it("shows the name and plan", () => {
    renderSidebar({ userName: "Ada", userPlan: "pro" });
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText(/pro/i)).toBeInTheDocument();
  });

  it("offers the upgrade action only off the pro plan", async () => {
    const onUpgrade = vi.fn();
    const { queryByLabelText, rerender } = render(
      <ChatSidebar
        chats={chats}
        activeChatId="a"
        onSelect={noop}
        onCreate={noop}
        onDelete={noop}
        onRename={noop}
        onPin={noop}
        onFavorite={noop}
        collapsed={false}
        mobileOpen={false}
        setMobileOpen={noop}
        userName="Ada"
        userPlan="pro"
        onUpgrade={onUpgrade}
      />
    );
    expect(queryByLabelText("Upgrade to Pro")).toBeNull();

    rerender(
      <ChatSidebar
        chats={chats}
        activeChatId="a"
        onSelect={noop}
        onCreate={noop}
        onDelete={noop}
        onRename={noop}
        onPin={noop}
        onFavorite={noop}
        collapsed={false}
        mobileOpen={false}
        setMobileOpen={noop}
        userName="Ada"
        userPlan="free"
        onUpgrade={onUpgrade}
      />
    );

    await userEvent.click(screen.getByLabelText("Upgrade to Pro"));
    expect(onUpgrade).toHaveBeenCalled();
  });

  it("falls back to a neutral name rather than rendering 'undefined'", () => {
    const { container } = renderSidebar();
    expect(container.querySelector(".sidebar-user").textContent).not.toMatch(/undefined/);
  });
});

describe("a failed chat list", () => {
  // The regression this exists for: a failed request left `chats` empty, so
  // the sidebar rendered "No chats yet" — telling a user their conversations
  // were gone when nothing had happened to them.
  it("never says 'No chats yet' when the request failed", () => {
    renderSidebar({ chats: [], error: "HTTP 500" });
    expect(screen.queryByText("No chats yet")).not.toBeInTheDocument();
    expect(screen.getByText("Couldn’t load your chats.")).toBeInTheDocument();
    expect(screen.getByText(/safe on the server/)).toBeInTheDocument();
  });

  it("offers a retry that calls back", async () => {
    const onRetry = vi.fn();
    renderSidebar({ chats: [], error: "HTTP 500", onRetry });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows the normal empty state when there is genuinely nothing", () => {
    renderSidebar({ chats: [] });
    expect(screen.getByText("No chats yet")).toBeInTheDocument();
  });
});
