import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UpgradePanel from "../components/panels/UpgradePanel";
import AdminPanel from "../components/panels/AdminPanel";

const noop = () => {};

describe("UpgradePanel", () => {
  const prices = { monthly: { amount: 900, currency: "usd" }, yearly: { amount: 9000, currency: "usd" } };

  it("renders nothing when closed", () => {
    const { container } = render(
      <UpgradePanel open={false} onClose={noop} prices={prices} billingBusy={false} onCheckout={noop} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows both formatted prices", () => {
    render(<UpgradePanel open onClose={noop} prices={prices} billingBusy={false} onCheckout={noop} />);
    expect(screen.getByText(/Monthly \$9$/)).toBeInTheDocument();
    expect(screen.getByText(/Yearly \$90$/)).toBeInTheDocument();
  });

  it("passes the chosen plan to checkout", async () => {
    const onCheckout = vi.fn();
    render(<UpgradePanel open onClose={noop} prices={prices} billingBusy={false} onCheckout={onCheckout} />);

    await userEvent.click(screen.getByText(/Monthly/));
    expect(onCheckout).toHaveBeenCalledWith("monthly");

    await userEvent.click(screen.getByText(/Yearly/));
    expect(onCheckout).toHaveBeenCalledWith("yearly");
  });

  it("disables both buttons while a checkout is opening", () => {
    // Otherwise a second click opens a second Stripe session for one purchase.
    render(<UpgradePanel open onClose={noop} prices={prices} billingBusy onCheckout={noop} />);
    for (const button of screen.getAllByText(/Opening checkout/)) expect(button).toBeDisabled();
  });

  it("does not print NaN when a price is missing", () => {
    const { container } = render(
      <UpgradePanel open onClose={noop} prices={{}} billingBusy={false} onCheckout={noop} />
    );
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).not.toContain("undefined");
  });
});

describe("AdminPanel", () => {
  const users = [
    { id: "1", name: "Ada", email: "ada@example.com", plan: "pro", is_admin: true },
    { id: "2", name: "Bob", email: "bob@example.com", suspended: true },
  ];

  // This used to assert "2 Users" from a `{users.length} Users` heading. Once
  // the list was paged that number became the size of one page while still
  // reading as a total, so the heading had to stop claiming it. What the panel
  // may state is the range actually on screen.
  it("states the range on screen, and never a total it cannot know", () => {
    render(<AdminPanel open onClose={noop} users={users} offset={50} onSuspend={noop} onUnsuspend={noop} onDelete={noop} />);
    expect(screen.getByText("51-52")).toBeInTheDocument();
    expect(screen.queryByText(/\d+ Users/)).not.toBeInTheDocument();
  });

  it("says so plainly when a page is empty", () => {
    render(<AdminPanel open onClose={noop} users={[]} onSuspend={noop} onUnsuspend={noop} onDelete={noop} />);
    expect(screen.getByText("No users")).toBeInTheDocument();
  });

  it("cannot page past either end", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(
      <AdminPanel open onClose={noop} users={users} offset={0} hasMore={false}
        onPrevious={onPrevious} onNext={onNext} onSuspend={noop} onUnsuspend={noop} onDelete={noop} />
    );
    expect(screen.getByText("Previous")).toBeDisabled();
    expect(screen.getByText("Next")).toBeDisabled();
  });

  it("offers Unsuspend for a suspended user and Suspend for an active one", () => {
    render(<AdminPanel open onClose={noop} users={users} onSuspend={noop} onUnsuspend={noop} onDelete={noop} />);
    expect(screen.getByText("Suspend")).toBeInTheDocument();
    expect(screen.getByText("Unsuspend")).toBeInTheDocument();
  });

  it("passes the right id to each action", async () => {
    const onSuspend = vi.fn();
    const onUnsuspend = vi.fn();
    render(
      <AdminPanel open onClose={noop} users={users} onSuspend={onSuspend} onUnsuspend={onUnsuspend} onDelete={noop} />
    );

    await userEvent.click(screen.getByText("Suspend"));
    expect(onSuspend).toHaveBeenCalledWith("1");

    await userEvent.click(screen.getByText("Unsuspend"));
    expect(onUnsuspend).toHaveBeenCalledWith("2");
  });

  it("falls back for a user with no name or email", () => {
    render(
      <AdminPanel open onClose={noop} users={[{ id: "3" }]} onSuspend={noop} onUnsuspend={noop} onDelete={noop} />
    );
    expect(screen.getByText("Anonymous")).toBeInTheDocument();
    expect(screen.getByText("No email")).toBeInTheDocument();
    expect(screen.getByText("free")).toBeInTheDocument();
  });
});

describe("UpgradePanel without prices", () => {
  // The regression: App.jsx gated `open` on Boolean(prices), so a failed
  // prices request turned Upgrade into a button that did nothing at all — on
  // the one screen where someone is trying to pay.
  it("opens and explains itself when the request failed", () => {
    render(
      <UpgradePanel open onClose={noop} prices={null} pricesError="HTTP 500" onRetryPrices={noop} onCheckout={noop} />
    );
    expect(screen.getByText("Couldn’t load the plans.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("offers no retry when checkout is simply not configured", () => {
    render(<UpgradePanel open onClose={noop} prices={null} pricesUnavailable onCheckout={noop} />);
    expect(screen.getByText("Checkout isn’t available right now.")).toBeInTheDocument();
    // A 503 is permanent until an environment variable changes. A retry
    // button here loops forever against the same answer.
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("never shows a checkout button it cannot complete", () => {
    render(<UpgradePanel open onClose={noop} prices={null} pricesError="HTTP 500" onCheckout={noop} />);
    expect(screen.queryByText(/Monthly \$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Yearly \$/)).not.toBeInTheDocument();
  });

  it("retries on demand", async () => {
    const onRetryPrices = vi.fn();
    render(
      <UpgradePanel open onClose={noop} prices={null} pricesError="HTTP 500" onRetryPrices={onRetryPrices} onCheckout={noop} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetryPrices).toHaveBeenCalledOnce();
  });
});
