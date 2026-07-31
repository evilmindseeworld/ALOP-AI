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
