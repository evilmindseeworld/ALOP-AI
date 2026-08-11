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

  /**
   * THE DEFERRED PARSE.
   *
   * react-markdown re-parses the whole accumulated message on every paint, and
   * the reveal cadence paints continuously — so a long answer was parsed from
   * scratch hundreds of times on the way in and only the last result was ever
   * kept. It is plain text until the stream closes.
   *
   * Asserted on the OUTPUT rather than on the branch: what matters is that no
   * parse happened, and the absence of a <strong> for `**bold**` is the
   * cheapest proof of that which cannot pass by accident.
   */
  const withMarkdown = [
    messages[0],
    { id: "a1", role: "assistant", content: "A **bold** claim.", ts: "10:05" },
  ];

  it("renders the streaming answer as plain text, not parsed markdown", () => {
    const { container } = renderList({ messages: withMarkdown, status: "streaming" });
    const plain = container.querySelector(".bubble.is-streaming .stream-plain");
    expect(plain).toBeInTheDocument();
    expect(plain.textContent).toBe("A **bold** claim.");
    expect(container.querySelector(".bubble.is-streaming strong")).toBeNull();
  });

  it("parses it once the stream closes", () => {
    const { container } = renderList({ messages: withMarkdown, status: "idle" });
    expect(container.querySelector(".stream-plain")).toBeNull();
    expect(container.querySelector(".bubble strong")).toHaveTextContent("bold");
  });

  /**
   * THE NO-SHIFT GUARANTEE, and it is a measurement rather than a preference.
   *
   * The first version put the whole raw message in one pre-wrap block, so every
   * blank line became a full line of leading — 27px where markdown's block
   * rhythm is 16px. Measured in a real browser at an 820px column: 82px plain
   * against 54px parsed, a 28px jump under the reader at the moment the answer
   * finished. One <p> per paragraph puts both states on the same
   * `.markdown-body > * + *` rule, and the shift measured 0.
   *
   * jsdom has no layout, so this asserts the STRUCTURE that produces it: the
   * plain branch emits the same number of block children the parsed branch
   * will.
   */
  it("emits one block per paragraph, so the parse does not change the height", () => {
    const twoParas = [
      messages[0],
      { id: "a1", role: "assistant", content: "First para.\n\nSecond para.", ts: "10:05" },
    ];
    const { container } = renderList({ messages: twoParas, status: "streaming" });
    expect(container.querySelectorAll(".stream-plain")).toHaveLength(2);
  });

  it("does not emit an empty paragraph for the trailing newline every stream has", () => {
    const trailing = [
      messages[0],
      { id: "a1", role: "assistant", content: "Done.\n\n", ts: "10:05" },
    ];
    const { container } = renderList({ messages: trailing, status: "streaming" });
    expect(container.querySelectorAll(".stream-plain")).toHaveLength(1);
  });

  it("keeps the same bubble across the swap, so nothing remounts", () => {
    // The one thing that would show as a flash: if the bubble itself were
    // replaced rather than its children, the element would unmount and any
    // entrance animation on it would replay at the exact moment the answer
    // finished arriving.
    const { container, rerender } = render(
      <MessageList messages={withMarkdown} status="streaming" feedback={{}} onCopy={noop} onFeedback={noop} onPickStarter={noop} />
    );
    const before = container.querySelector(".bubble");
    rerender(
      <MessageList messages={withMarkdown} status="idle" feedback={{}} onCopy={noop} onFeedback={noop} onPickStarter={noop} />
    );
    expect(container.querySelector(".bubble")).toBe(before);
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

/* The gap between pressing send and the placeholder arriving. `send` sets
 * status to "loading" first and inserts the `typing: true` message only after
 * up to three round trips, so the transcript sat on the question with nothing
 * underneath it — the whole cold start, on a new chat. */
describe("the wait before the placeholder exists", () => {
  const skeletons = () => document.querySelectorAll(".answer-skeleton");

  it("shows an answer skeleton while loading, before any typing message exists", () => {
    render(
      <MessageList
        messages={[{ id: "u1", role: "user", content: "What is this?", ts: "10:04" }]}
        status="loading"
        feedback={{}}
        onCopy={noop}
        onFeedback={noop}
        onPickStarter={noop}
      />
    );
    expect(skeletons()).toHaveLength(1);
    // In a real assistant row, not floating loose: it carries the same avatar
    // and the same screen-reader cue a real answer gets.
    expect(document.querySelectorAll(".msg-row.assistant")).toHaveLength(1);
    expect(screen.getByText("The council answered:")).toBeInTheDocument();
  });

  it("does NOT double up once the real typing placeholder lands", () => {
    render(
      <MessageList
        messages={[
          { id: "u1", role: "user", content: "What is this?", ts: "10:04" },
          { id: "a1", role: "assistant", content: "", typing: true },
        ]}
        status="loading"
        feedback={{}}
        onCopy={noop}
        onFeedback={noop}
        onPickStarter={noop}
      />
    );
    expect(skeletons()).toHaveLength(1);
  });

  it("stops once the answer starts arriving", () => {
    render(
      <MessageList
        messages={[
          { id: "u1", role: "user", content: "What is this?", ts: "10:04" },
          { id: "a1", role: "assistant", content: "The first tokens." },
        ]}
        status="streaming"
        feedback={{}}
        onCopy={noop}
        onFeedback={noop}
        onPickStarter={noop}
      />
    );
    expect(skeletons()).toHaveLength(0);
  });

  it("announces the wait, which used to be silent", () => {
    render(
      <MessageList
        messages={[{ id: "u1", role: "user", content: "Hi", ts: "10:04" }]}
        status="loading"
        feedback={{}}
        onCopy={noop}
        onFeedback={noop}
        onPickStarter={noop}
      />
    );
    expect(screen.getByText("The council is working")).toBeInTheDocument();
  });
});

describe("the stage line under the skeleton", () => {
  const renderTyping = (stage) =>
    render(
      <MessageList
        messages={[
          { id: "u1", role: "user", content: "Best air fryer?", ts: "10:04" },
          { id: "a1", role: "assistant", content: "", typing: true, stage },
        ]}
        status="loading"
        feedback={{}}
        onCopy={noop}
        onFeedback={noop}
        onPickStarter={noop}
      />
    );

  it("says what the council is doing when the server has said so", () => {
    renderTyping("4 of 7 answered");
    expect(screen.getByText("4 of 7 answered")).toBeInTheDocument();
    // And to a screen reader, which otherwise hears only "The council is
    // thinking" for the whole turn.
    expect(screen.getByRole("status", { name: "4 of 7 answered" })).toBeInTheDocument();
  });

  it("reserves no space for a line it has nothing to put in", () => {
    renderTyping(undefined);
    expect(document.querySelector(".answer-stage")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "The council is thinking" })).toBeInTheDocument();
  });
});
