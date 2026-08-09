import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageList, { MessageActions } from "../components/MessageList";

const messages = [
  { id: "u1", role: "user", content: "What is this?", ts: "10:04" },
  { id: "a1", role: "assistant", content: "An answer.", ts: "10:05" },
];

const noop = () => {};
const renderList = (props = {}) =>
  render(
    <MessageList
      messages={messages}
      status="idle"
      feedback={{}}
      onCopy={noop}
      onFeedback={noop}
      onPickStarter={noop}
      {...props}
    />
  );

describe("MessageList", () => {
  it("shows the starters when there is nothing to show yet", () => {
    renderList({ messages: [] });
    expect(document.querySelector(".starter-grid")).toBeInTheDocument();
  });

  it("shows retry instead of treating a failed transcript fetch as empty", async () => {
    const onRetryMessages = vi.fn();
    renderList({ messages: [], messageLoadError: true, onRetryMessages });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load this conversation");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetryMessages).toHaveBeenCalled();
    expect(document.querySelector(".starter-grid")).not.toBeInTheDocument();
  });

  it("gives only the assistant an avatar", () => {
    // A right-aligned filled pill is already unmistakably yours. An avatar, a
    // role label AND the alignment are three ways of saying the same thing.
    const { container } = renderList();
    expect(container.querySelectorAll(".msg-row.user .avatar")).toHaveLength(0);
    expect(container.querySelectorAll(".msg-row.assistant .avatar")).toHaveLength(1);
  });

  it("marks only the last assistant message as streaming", () => {
    const { container } = renderList({ status: "streaming" });
    const streaming = container.querySelectorAll(".bubble.is-streaming");
    expect(streaming).toHaveLength(1);
    expect(container.querySelectorAll(".msg-row")[1]).toContainElement(streaming[0]);
  });

  it("does not mark a trailing USER message as streaming", () => {
    // The caret means "an answer is arriving". On a user message it would sit
    // blinking inside the question the reader just typed.
    const { container } = renderList({
      messages: [...messages, { id: "u2", role: "user", content: "And this?" }],
      status: "streaming",
    });
    expect(container.querySelectorAll(".bubble.is-streaming")).toHaveLength(0);
  });

  it("announces streaming state to a screen reader", () => {
    const { rerender } = renderList({ status: "streaming" });
    expect(screen.getByRole("status")).toHaveTextContent("Answer in progress");

    rerender(
      <MessageList
        messages={messages}
        status="idle"
        feedback={{}}
        onCopy={noop}
        onFeedback={noop}
        onPickStarter={noop}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("Answer complete");
  });
});

/**
 * Copy used to call navigator.clipboard.writeText and say nothing at all — no
 * toast, no icon change, nothing. The only way to find out whether it worked
 * was to paste somewhere else.
 */
describe("MessageActions — copy confirms", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  const renderActions = (props = {}) =>
    render(<MessageActions content="text" onCopy={noop} msgId="a1" onFeedback={noop} feedback={null} {...props} />);

  it("calls onCopy", async () => {
    const onCopy = vi.fn();
    renderActions({ onCopy });
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(onCopy).toHaveBeenCalled();
  });

  it("shows a confirmed state after copying", async () => {
    renderActions();
    const button = screen.getByRole("button", { name: /copy/i });
    expect(button.className).not.toContain("is-copied");

    await userEvent.click(button);

    expect(screen.getByRole("button", { name: /copied/i }).className).toContain("is-copied");
  });

  it("returns to 'Copy' rather than staying confirmed forever", async () => {
    renderActions();
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument();
  });

  it("does not leave a timer running after unmount", async () => {
    // An unmounted component whose timer still fires calls setState on nothing.
    // The transcript unmounts rows constantly — switching chats does it.
    const { unmount } = renderActions();
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));

    unmount();
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
  });

  it("still records feedback votes", async () => {
    const onFeedback = vi.fn();
    renderActions({ onFeedback });

    await userEvent.click(screen.getByLabelText("Good answer"));
    expect(onFeedback).toHaveBeenCalledWith("a1", "up");

    await userEvent.click(screen.getByLabelText("Bad answer"));
    expect(onFeedback).toHaveBeenCalledWith("a1", "down");
  });

  it("keeps the row's actions visible once a vote is cast", () => {
    const { container } = renderActions({ feedback: "up" });
    expect(container.querySelector(".msg-actions").className).toContain("is-voted");
  });
});
