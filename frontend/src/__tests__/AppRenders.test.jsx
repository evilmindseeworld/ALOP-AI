import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { animateSpy, inputBarProps } = vi.hoisted(() => ({
  animateSpy: vi.fn(),
  inputBarProps: [],
}));

/**
 * THE SIGNED-IN APP RENDERS AT ALL.
 *
 * There was no test in this suite that ever rendered AuthenticatedApp. 524
 * of them passed while the deployed app threw on its first render for every
 * signed-in user:
 *
 *   const [skeletonStuck, setSkeletonStuck] = useState(false);
 *   useEffect(() => { ... }, [chat.isInitialLoading]);   // <- reads `chat`
 *   const chat = useChats(...);                          // <- declared here
 *
 * A dependency array is evaluated during render, so that read hit `chat` in
 * the temporal dead zone. In the production bundle the name is one letter,
 * which is why the crash screen said `Cannot access 'N' before
 * initialization` and named nothing a reader could search for.
 *
 * The specific ordering is fixed. This test exists for the CLASS: a
 * render-time throw anywhere in App.jsx's body fails here instead of
 * reaching a user. It asserts almost nothing about what is on screen on
 * purpose — the panels and the sidebar have their own tests, and a smoke
 * test that also asserts layout becomes a test nobody dares to change.
 *
 * The hooks are mocked because none of their behaviour is the subject; what
 * matters is that App.jsx can be evaluated top to bottom with real React
 * semantics, which is exactly what the bug violated.
 */

vi.mock("@clerk/react", () => ({
  ClerkProvider: ({ children }) => children,
  useUser: () => ({ user: { id: "u1", firstName: "A" }, isSignedIn: true, isLoaded: true }),
  useAuth: () => ({ getToken: async () => "t", isSignedIn: true, isLoaded: true, signOut: () => {} }),
  useSession: () => ({ session: { status: "active", currentTask: null } }),
  UserButton: () => <div />,
  SignOutButton: ({ children }) => <div>{children}</div>,
}));

// animejs drives the entrance animations against real layout, which jsdom does
// not have. Nothing here is about motion.
// `add` returns the scope because App chains `createScope(...).add(...)` and
// keeps the result to call `.revert()` on unmount. A mock whose `add` returns
// undefined only fails during teardown, which reads as an unrelated flake.
vi.mock("animejs", () => {
  const scope = { add: () => scope, revert: () => {} };
  return {
    animate: animateSpy,
    createScope: () => scope,
    spring: () => ({}),
    createDraggable: () => ({}),
  };
});

vi.mock("../components/InputBar", () => ({
  default: (props) => {
    inputBarProps.push(props);
    return <textarea aria-label="Message the AI Council" />;
  },
}));

const chat = {
  chats: [],
  sortedChats: [],
  activeChatId: null,
  activeChat: null,
  activeMessages: [],
  status: "idle",
  chatFiles: [],
  chatFilesError: null,
  chatsError: null,
  messageLoadError: null,
  feedback: {},
  isInitialLoading: false,
  isLoadingMessages: false,
  setActiveChatId: () => {},
  createChat: () => {},
  deleteChat: () => {},
  renameChat: () => {},
  togglePinChat: () => {},
  toggleFavoriteChat: () => {},
  send: () => {},
  stopGeneration: () => {},
  regenerateLast: () => {},
  generateImage: () => {},
  submitFeedback: () => {},
  uploadFile: () => {},
  removeFile: () => {},
  retryChats: () => {},
  retryMessages: () => {},
  retryChatFiles: () => {},
};

// The real hook returns a new object literal on every render. Returning a copy
// here catches callbacks that accidentally depend on that wrapper instead of
// on the stable methods inside it.
vi.mock("../hooks/useChats", () => ({ useChats: () => ({ ...chat }) }));
vi.mock("../hooks/useBilling", () => ({
  useBilling: () => ({
    userPlan: "free",
    prices: null,
    pricesError: null,
    pricesUnavailable: false,
    billingBusy: false,
    startCheckout: () => {},
    openBillingPortal: () => {},
    retryPrices: () => {},
  }),
}));
vi.mock("../hooks/useCamera", () => ({
  useCamera: () => ({ isOpen: false, start: () => {}, stop: () => {}, capture: () => {}, videoRef: { current: null }, canvasRef: { current: null } }),
}));
vi.mock("../hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => ({ isListening: false, toggle: () => {} }),
}));

describe("the signed-in app", () => {
  it("renders without throwing", async () => {
    const { default: App } = await import("../App");
    expect(() => render(<App />)).not.toThrow();
    // The composer is the one control present in every signed-in state, so it
    // proves the tree mounted rather than an error boundary swallowing it.
    expect(await screen.findByRole("textbox")).toBeInTheDocument();
  });

  it("shows the skeleton while chats are still loading", async () => {
    chat.isInitialLoading = true;
    try {
      const { default: App } = await import("../App");
      const { container } = render(<App />);
      expect(container.querySelector(".skeleton-block")).toBeTruthy();
    } finally {
      chat.isInitialLoading = false;
    }
  });

  it("keeps composer callbacks stable when only streamed content changes", async () => {
    inputBarProps.length = 0;
    const { default: App } = await import("../App");
    const { rerender } = render(<App />);
    const before = inputBarProps.at(-1);

    chat.activeMessages = [{ id: "a1", role: "assistant", content: "first" }];
    rerender(<App />);
    const after = inputBarProps.at(-1);

    expect(after.onSend).toBe(before.onSend);
    expect(after.onRetryFiles).toBe(before.onRetryFiles);
    chat.activeMessages = [];
  });

  it("runs the entrance animation once per message id, not once per token", async () => {
    animateSpy.mockClear();
    // Let the lazy MessageList boundary resolve before adding the row whose
    // entrance is under test. Otherwise the parent effect correctly has no DOM
    // row to animate on its first pass.
    chat.activeMessages = [{ id: "seed", role: "assistant", content: "ready" }];
    const { default: App } = await import("../App");
    const { rerender } = render(<App />);
    await screen.findByText("ready");

    chat.activeMessages = [{ id: "a1", role: "assistant", content: "first" }];
    rerender(<App />);
    await screen.findByText("first");
    await waitFor(() => expect(animateSpy).toHaveBeenCalled());
    const afterFirstToken = animateSpy.mock.calls.length;

    chat.activeMessages = [{ id: "a1", role: "assistant", content: "first second" }];
    rerender(<App />);
    await screen.findByText("first second");
    await Promise.resolve();

    expect(animateSpy).toHaveBeenCalledTimes(afterFirstToken);
    chat.activeMessages = [];
  });
});
