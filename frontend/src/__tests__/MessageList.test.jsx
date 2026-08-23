import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageList, { MessageActions } from "../components/MessageList";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** expect().toMatch on a large source blob prints the whole file on failure. */
const assertMatch = (src, re) => expect(re.test(src), "MessageList.jsx does not match " + re).toBe(true);

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

/**
 * Render and wait for the markdown chunk.
 *
 * react-markdown is lazy — it is 49 kB gzip and no message needs it until one
 * has finished arriving. Until the chunk resolves, a completed message renders
 * through the same plain-paragraph path a streaming one does, which is what
 * makes the swap invisible. Anything asserting on PARSED output therefore has
 * to let the import settle first; asserting synchronously reads the fallback
 * and fails on markup that is merely not there yet.
 */
const renderParsed = async (props = {}) => {
  const result = renderList(props);
  // POLLED, NOT TICKED. Flushing microtasks is not enough: `import()` is a real
  // module load that vitest resolves and transforms asynchronously, so twenty
  // `await Promise.resolve()` still left every bubble on its fallback. waitFor
  // polls on a timer, which is the only thing that outlasts a genuine import.
  await waitFor(() => {
    expect(result.container.querySelector(".stream-plain")).toBeNull();
  });
  return result;
};

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

  it("keeps a partial answer visible and routes a failed turn through Retry", async () => {
    const onRetryMessages = vi.fn();
    renderList({
      messages: [{ id: "u1", role: "user", content: "Continue", ts: "10:04" }],
      streamDraft: { id: "a2", role: "assistant", content: "Partial answer", retryable: true },
      messageLoadError: true,
      status: "error",
      onRetryMessages,
    });

    expect(screen.getByText("Partial answer")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("paused before it finished");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetryMessages).toHaveBeenCalled();
  });

  it.each([
    ["reconnecting", "Connection lost. Reconnecting..."],
    ["offline", "You're offline. Waiting for the connection..."],
  ])("shows the %s turn state", (status, text) => {
    renderList({
      messages: [{ id: "u1", role: "user", content: "Continue", ts: "10:04" }],
      streamDraft: { id: "a2", role: "assistant", content: "Partial answer" },
      status,
    });
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("gives only the assistant an avatar", () => {
    // A right-aligned filled pill is already unmistakably yours. An avatar, a
    // role label AND the alignment are three ways of saying the same thing.
    const { container } = renderList();
    expect(container.querySelectorAll(".msg-row.user .avatar")).toHaveLength(0);
    expect(container.querySelectorAll(".msg-row.assistant .avatar")).toHaveLength(1);
  });

  it("marks only the streaming draft, not persisted assistants", () => {
    const { container } = renderList({
      status: "streaming",
      streamDraft: { id: "a2", role: "assistant", content: "Arriving." },
    });
    const streaming = container.querySelectorAll(".bubble.is-streaming");
    expect(streaming).toHaveLength(1);
    expect(container.querySelectorAll(".msg-row")[2]).toContainElement(streaming[0]);
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
    const { container } = renderList({ messages: [messages[0]], streamDraft: withMarkdown[1], status: "streaming" });
    const plain = container.querySelector(".bubble.is-streaming .stream-plain");
    expect(plain).toBeInTheDocument();
    expect(plain.textContent).toBe("A **bold** claim.");
    expect(container.querySelector(".bubble.is-streaming strong")).toBeNull();
  });

  it("parses it once the stream closes", async () => {
    const { container } = await renderParsed({ messages: withMarkdown, status: "idle" });
    expect(container.querySelector(".stream-plain")).toBeNull();
    expect(container.querySelector(".bubble strong")).toHaveTextContent("bold");
  });

  it("falls back to the unparsed answer, never to a blank, while the chunk loads", () => {
    // THE ONLY USER-VISIBLE COST OF MAKING THE PARSER LAZY. If the chunk has not
    // arrived when an answer completes, the reader must keep seeing the frame
    // they were already looking at — a null fallback would blank a finished
    // answer, which is far worse than unstyled text for one frame.
    //
    // ASSERTED ON THE SOURCE, and the reason is a limit of the test environment
    // rather than a preference: the module cache makes this state unobservable.
    // Once any earlier test in this file has pulled the chunk in, React.lazy
    // resolves it immediately and the fallback never renders — so a test that
    // waited for the fallback would pass alone, fail in suite order, and prove
    // nothing either way. What is checkable is the contract that produces the
    // behaviour: the boundary's fallback is the plain renderer.
    const src = readFileSync(join(__dirname, "..", "components", "MessageList.jsx"), "utf8");
    assertMatch(src, /<Suspense fallback=\{<PlainParagraphs text=\{displayContent\} \/>\}>/);
    // And the same renderer serves the streaming branch — one component used
    // twice is what makes the swap between them invisible. Two copies would
    // drift, and the drift would show as a jump at the moment an answer lands.
    assertMatch(src, /const PlainParagraphs = /);
    expect(src).toMatch(/<PlainParagraphs text=\{msg\.content\} \/>/);
    expect(src).toMatch(/<PlainParagraphs text=\{displayContent\} \/>/);
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
    // SCOPED TO THE STREAMING BUBBLE. `.stream-plain` used to appear only while
    // an answer arrived, so an unscoped count meant "the draft's paragraphs".
    // It is now also the Suspense fallback for any message whose markdown chunk
    // has not landed — including the user's own — so the unscoped count picks
    // up neighbours and the number it returns is not the one this test is about.
    const { container } = renderList({ messages: [messages[0]], streamDraft: twoParas[1], status: "streaming" });
    expect(container.querySelectorAll(".bubble.is-streaming .stream-plain")).toHaveLength(2);
  });

  it("does not emit an empty paragraph for the trailing newline every stream has", () => {
    const trailing = [
      messages[0],
      { id: "a1", role: "assistant", content: "Done.\n\n", ts: "10:05" },
    ];
    const { container } = renderList({ messages: [messages[0]], streamDraft: trailing[1], status: "streaming" });
    expect(container.querySelectorAll(".bubble.is-streaming .stream-plain")).toHaveLength(1);
  });

  it("keeps the same bubble across the swap, so nothing remounts", () => {
    // The one thing that would show as a flash: if the bubble itself were
    // replaced rather than its children, the element would unmount and any
    // entrance animation on it would replay at the exact moment the answer
    // finished arriving.
    const { container, rerender } = render(
      <MessageList messages={[messages[0]]} streamDraft={withMarkdown[1]} status="streaming" feedback={{}} onCopy={noop} onFeedback={noop} onPickStarter={noop} />
    );
    const before = container.querySelector(".bubble.is-streaming");
    rerender(
      <MessageList messages={[messages[0]]} streamDraft={withMarkdown[1]} status="idle" feedback={{}} onCopy={noop} onFeedback={noop} onPickStarter={noop} />
    );
    expect(container.querySelectorAll(".bubble")[1]).toBe(before);
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
    const draft = { id: "a2", role: "assistant", content: "Arriving." };
    const { container, rerender } = renderList({ status: "streaming", streamDraft: draft });
    expect(screen.getByRole("status")).toHaveTextContent("Answer in progress");
    // The answer text itself is deliberately not live. Putting aria-live on
    // the token stream makes assistive tech enqueue the growing answer again
    // on every 16ms paint.
    expect(container.querySelector(".bubble.is-streaming")).not.toHaveAttribute("aria-live");

    rerender(
      <MessageList
        messages={messages}
        streamDraft={draft}
        status="idle"
        feedback={{}}
        onCopy={noop}
        onFeedback={noop}
        onPickStarter={noop}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("Answer complete");
  });

  it("does not announce a completed answer on an initial idle transcript", () => {
    renderList({ status: "idle" });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("does not duplicate the loading announcement", () => {
    const { container } = renderList({
      messages: [{ id: "u1", role: "user", content: "Hi" }],
      status: "loading",
    });
    expect(container.querySelector(".council-process")).toBeInTheDocument();
    expect(container.querySelector(".answer-skeleton")).not.toHaveAttribute("role", "status");
    expect(screen.getByRole("status", { name: "Assembling your answer." })).toBeInTheDocument();
    expect(container.querySelector(".msg-stream > .sr-only[role='status']")).toBeEmptyDOMElement();
  });

  it("does not remap persisted history when only the draft changes", () => {
    const history = Array.from({ length: 200 }, (_, index) => ({
      id: `m-${index}`,
      role: index % 2 ? "assistant" : "user",
      content: `Persisted ${index}`,
    }));
    history.map = vi.fn(Array.prototype.map.bind(history));
    const feedback = {};
    const renderProps = (content) => (
      <MessageList
        messages={history}
        streamDraft={{ id: "draft", role: "assistant", content }}
        status="streaming"
        feedback={feedback}
        onCopy={noop}
        onFeedback={noop}
        onPickStarter={noop}
      />
    );
    const { rerender } = render(renderProps("a"));
    for (let tick = 2; tick <= 20; tick++) rerender(renderProps("a".repeat(tick)));

    expect(history.map).toHaveBeenCalledTimes(1);
  });

  it("escapes raw HTML and strips executable URL schemes from model output", async () => {
    const hostile = [
      messages[0],
      {
        id: "a1",
        role: "assistant",
        content:
          '<script>window.pwned = true</script><img src=x onerror="window.pwned=true">\n\n' +
          '[bad link](javascript:alert(1)) ![bad image](javascript:alert(2)) [safe link](https://example.com)',
      },
    ];
    const { container } = await renderParsed({ messages: hostile });

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img[onerror]")).toBeNull();
    const links = [...container.querySelectorAll(".markdown-body a")];
    expect(links[0].getAttribute("href") || "").not.toMatch(/^javascript:/i);
    expect(links[1]).toHaveAttribute("href", "https://example.com");
    const markdownImage = container.querySelector(".markdown-body img");
    expect(markdownImage.getAttribute("src") || "").not.toMatch(/^javascript:/i);
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
        messages={[{ id: "u1", role: "user", content: "What is this?", ts: "10:04" }]}
        streamDraft={{ id: "a1", role: "assistant", content: "", typing: true }}
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
        messages={[{ id: "u1", role: "user", content: "What is this?", ts: "10:04" }]}
        streamDraft={{ id: "a1", role: "assistant", content: "The first tokens." }}
        status="streaming"
        feedback={{}}
        onCopy={noop}
        onFeedback={noop}
        onPickStarter={noop}
      />
    );
    expect(skeletons()).toHaveLength(0);
  });

  it("announces the wait once through the answer skeleton", () => {
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
    expect(screen.getByRole("status", { name: "Assembling your answer." })).toBeInTheDocument();
  });
});

describe("the stage line under the skeleton", () => {
  const renderTyping = (stage) =>
    render(
      <MessageList
        messages={[{ id: "u1", role: "user", content: "Best air fryer?", ts: "10:04" }]}
        streamDraft={{ id: "a1", role: "assistant", content: "", typing: true, stage }}
        status="loading"
        feedback={{}}
        onCopy={noop}
        onFeedback={noop}
        onPickStarter={noop}
      />
    );

  it("says what the council is doing when the server has said so", () => {
    renderTyping("4 of 7 answered");
    expect(document.querySelector(".answer-stage")).toHaveTextContent("4 of 7 answered");
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

describe("the live council process receipt", () => {
  it("keeps the current stage available to assistive technology during the handoff", () => {
    render(
      <MessageList
        messages={[{ id: "u1", role: "user", content: "Best air fryer?", ts: "10:04" }]}
        streamDraft={{
          id: "a1",
          role: "assistant",
          content: "",
          typing: true,
          stage: "3 of 3 answered",
          process: {
            phase: "working",
            activeKey: "council",
            stages: [{ key: "council", text: "3 of 3 answered" }],
          },
        }}
        status="loading"
        feedback={{}}
        onCopy={noop}
        onFeedback={noop}
        onPickStarter={noop}
      />
    );

    expect(document.querySelector(".answer-stage")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "3 of 3 answered" })).toBeInTheDocument();
  });

  it("keeps the ordered stages beside the first answer token", () => {
    render(
      <MessageList
        messages={[{ id: "u1", role: "user", content: "Best air fryer?", ts: "10:04" }]}
        streamDraft={{
          id: "a1",
          role: "assistant",
          content: "The answer is ready.",
          process: {
            phase: "answering",
            activeKey: null,
            stages: [
              { key: "context", text: "Reading your conversation" },
              { key: "council", text: "3 of 3 answered" },
              { key: "synthesis", text: "Reconciling the answers" },
            ],
          },
        }}
        status="streaming"
        feedback={{}}
        onCopy={noop}
        onFeedback={noop}
        onPickStarter={noop}
      />
    );

    expect(screen.getByRole("region", { name: "Coming together" })).toBeInTheDocument();
    expect(screen.getByText("Reading your conversation")).toBeInTheDocument();
    expect(screen.getByText("3 of 3 answered")).toBeInTheDocument();
    expect(document.querySelector(".council-stage-text")).toBeInTheDocument();
    expect(document.querySelectorAll(".council-stage-text")[2]).toHaveTextContent("Reconciling the answers");
    expect(screen.getByText("The answer is ready.")).toBeInTheDocument();
    expect(screen.queryByText("Answer in progress")).not.toBeInTheDocument();
  });

  it("marks a completed process without inventing a correctness seal", () => {
    render(
      <MessageList
        messages={[{ id: "u1", role: "user", content: "Hi", ts: "10:04" }]}
        streamDraft={{
          id: "a1",
          role: "assistant",
          content: "Done.",
          process: {
            phase: "complete",
            activeKey: null,
            stages: [{ key: "council", text: "3 of 3 answered" }],
          },
        }}
        status="idle"
        feedback={{}}
        onCopy={noop}
        onFeedback={noop}
        onPickStarter={noop}
      />
    );

    expect(screen.getByRole("region", { name: "Answer assembled" })).toBeInTheDocument();
    expect(screen.getByText("Answer complete without a synthesis stage")).toBeInTheDocument();
    expect(screen.queryByText(/seal/i)).not.toBeInTheDocument();
  });

  it.each([
    ["stopped", "Process incomplete", "Answer stopped before completion", "is-interrupted"],
    ["failed", "Process incomplete", "Answer failed before completion", "is-failed"],
  ])("does not mark the terminal %s stage as successful", (phase, heading, transition, terminalClass) => {
    render(
      <MessageList
        messages={[{ id: "u1", role: "user", content: "Hi", ts: "10:04" }]}
        streamDraft={{
          id: "a1",
          role: "assistant",
          content: "Partial.",
          stopped: phase === "stopped",
          process: {
            phase,
            terminalKey: "synthesis",
            stages: [
              { key: "context", text: "Reading your conversation", state: "completed" },
              { key: "council", text: "2 of 3 answered", state: "partial" },
              { key: "synthesis", text: "Reconciling the answers" },
            ],
            partialCouncil: true,
            announcement: transition,
          },
        }}
        status="error"
        feedback={{}}
        onCopy={noop}
        onFeedback={noop}
        onPickStarter={noop}
      />
    );

    expect(screen.getByRole("region", { name: heading })).toBeInTheDocument();
    expect(document.querySelector(".council-process-transition")).toHaveTextContent(transition);
    const terminal = document.querySelector(`.council-stage-row.${terminalClass}`);
    expect(terminal).toBeInTheDocument();
    expect(terminal).not.toHaveClass("is-complete");
    expect(document.querySelectorAll(".council-stage-row.is-complete")).toHaveLength(1);
  });

  it("consolidates tool activity into the process receipt", () => {
    render(
      <MessageList
        messages={[{ id: "u1", role: "user", content: "Search this", ts: "10:04" }]}
        streamDraft={{
          id: "a1",
          role: "assistant",
          content: "Answer.",
          process: {
            phase: "answering",
            synthesisSeen: true,
            stages: [{ key: "synthesis", text: "Writing the reply" }],
          },
          activity: [{ round: 1, name: "web_search", summary: "Checked the web", pending: false }],
        }}
        status="streaming"
        feedback={{}}
        onCopy={noop}
        onFeedback={noop}
        onPickStarter={noop}
      />
    );

    expect(document.querySelector(".tool-trail")).not.toBeInTheDocument();
    expect(document.querySelector(".council-process-tools")).toBeInTheDocument();
    expect(document.querySelector(".council-process-tools")).not.toHaveAttribute("open");
    expect(screen.getByText("Evidence work · 1 check")).toBeInTheDocument();
  });

  it("reveals the actual evidence row when the optional disclosure opens", async () => {
    const user = userEvent.setup();
    render(
      <MessageList
        messages={[{ id: "u1", role: "user", content: "Search this", ts: "10:04" }]}
        streamDraft={{
          id: "a1",
          role: "assistant",
          content: "Answer.",
          process: { phase: "answering", stages: [{ key: "council", text: "3 of 3 answered" }] },
          activity: [{ round: 1, name: "web_search", summary: "Checked the web", pending: false }],
        }}
        status="streaming"
        feedback={{}}
        onCopy={noop}
        onFeedback={noop}
        onPickStarter={noop}
      />
    );

    await user.click(screen.getByText("Evidence work · 1 check"));
    expect(screen.getByText("Checked the web")).toBeVisible();
  });

  it("shows a progressive source receipt only for safe structured URLs", async () => {
    renderList({
      messages: [{
        id: "a1",
        role: "assistant",
        content: "A sourced answer.",
        provenance: {
          sources: [
            { title: "Public page", domain: "example.com", url: "https://example.com/page#fragment", date: "2026-08-23" },
            { title: "Second page", domain: "example.org", url: "https://example.org/guide" },
            { title: "Unsafe", url: "javascript:alert(1)" },
          ],
          verification: { completed: true },
        },
      }],
    });

    expect(screen.getByText("Sources · 2")).toBeInTheDocument();
    expect(screen.getByText("Evidence recorded")).toBeInTheDocument();
    expect(screen.queryByText("Unsafe")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Sources · 2"));
    const link = screen.getByRole("link", { name: "Public page" });
    expect(link).toHaveAttribute("href", "https://example.com/page");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
    expect(screen.getByText("2026-08-23")).toBeVisible();
  });

  it("rejects private and special-use hosts before rendering source links", () => {
    renderList({
      messages: [{
        id: "a1",
        role: "assistant",
        content: "A sourced answer.",
        provenance: {
          sources: [
            { title: "Loopback", url: "http://127.0.0.1/secret" },
            { title: "Local host", url: "http://localhost/private" },
            { title: "IPv6 loopback", url: "http://[::1]/private" },
            { title: "Public page", url: "https://example.com/page" },
          ],
        },
      }],
    });

    expect(screen.getByText("Sources · 1")).toBeInTheDocument();
    expect(screen.queryByText("Loopback")).not.toBeInTheDocument();
    expect(screen.queryByText("Local host")).not.toBeInTheDocument();
    expect(screen.queryByText("IPv6 loopback")).not.toBeInTheDocument();
  });

  it("does not leave an empty source surface when provenance has no public URLs", () => {
    renderList({
      messages: [{
        id: "a1",
        role: "assistant",
        content: "An answer without displayable sources.",
        provenance: { evidence: { sourceCount: 2 }, sources: [] },
      }],
    });

    expect(document.querySelector(".source-receipt")).not.toBeInTheDocument();
  });

  it("uses the structured receipt instead of repeating an exact Markdown Sources block", async () => {
    const { container } = await renderParsed({
      messages: [{
        id: "a1",
        role: "assistant",
        content: "A sourced answer.\n\n### Sources\n- [Public page](https://example.com/page)\n- [Second page](https://example.org/guide)",
        provenance: {
          sources: [
            { title: "Public page", url: "https://example.com/page" },
            { title: "Second page", url: "https://example.org/guide" },
          ],
        },
      }],
    });

    expect(container.querySelector(".markdown-body")).toHaveTextContent("A sourced answer.");
    expect(container.querySelector(".markdown-body")).not.toHaveTextContent("Public page");
    expect(screen.getByText("Sources · 2")).toBeInTheDocument();
  });

  it("keeps a Markdown source section when its URLs do not match the receipt", async () => {
    const { container } = await renderParsed({
      messages: [{
        id: "a1",
        role: "assistant",
        content: "A sourced answer.\n\n### Sources\n- [Unmatched page](https://example.net/other)",
        provenance: { sources: [{ title: "Recorded page", url: "https://example.com/page" }] },
      }],
    });

    expect(container.querySelector(".markdown-body")).toHaveTextContent("Unmatched page");
  });
});
