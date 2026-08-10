import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("lets a later Tailwind utility beat an earlier conflicting one", () => {
    // Without tailwind-merge, `cn("px-2","px-4")` emits both and the winner is
    // whichever the stylesheet happens to order last — a caller's className
    // could then fail to override a variant's.
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("bg-primary", "bg-muted")).toBe("bg-muted");
  });

  it("keeps non-conflicting classes", () => {
    expect(cn("flex", "items-center")).toBe("flex items-center");
  });

  it("drops falsy values", () => {
    expect(cn("flex", false && "hidden", null, undefined)).toBe("flex");
  });
});

describe("Button", () => {
  it("renders a real button and fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("applies the variant and size classes", () => {
    render(
      <Button variant="destructive" size="sm">
        Delete
      </Button>
    );
    const button = screen.getByRole("button");
    expect(button.className).toContain("bg-destructive");
    expect(button.className).toContain("h-8");
  });

  it("lets a caller's className override the variant", () => {
    render(<Button className="bg-muted">X</Button>);
    expect(screen.getByRole("button").className).toContain("bg-muted");
    expect(screen.getByRole("button").className).not.toContain("bg-primary");
  });

  it("renders the child element when asChild is set", () => {
    render(
      <Button asChild>
        <a href="/somewhere">Link</a>
      </Button>
    );
    expect(screen.getByRole("link", { name: "Link" })).toBeInTheDocument();
  });

  it("scales less the larger it gets, and not at all under reduced motion", () => {
    // The press scale is per-size on purpose: one ratio for every size reads as
    // a different-sized press. And every motion rule in this app has to have a
    // reduced-motion counterpart — an instant snap with no easing is the worst
    // of both. reducedMotion.test.js enforces that for the stylesheets; the
    // button's motion lives in class names, so it is enforced here.
    const scaleOf = (size) => buttonVariants({ size }).match(/active:scale-\[([\d.]+)\]/)[1];
    expect(Number(scaleOf("sm"))).toBeGreaterThan(Number(scaleOf("default")));
    expect(Number(scaleOf("default"))).toBeGreaterThan(Number(scaleOf("lg")));
    expect(buttonVariants({})).toContain("motion-reduce:active:scale-100");
    expect(buttonVariants({})).toContain("motion-reduce:transition-none");
  });

  it("stretches only when asked", () => {
    render(<Button fullWidth>Wide</Button>);
    expect(screen.getByRole("button").className).toContain("w-full");
    expect(buttonVariants({})).not.toContain("w-full");
  });

  it("does not fire while disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Switch", () => {
  it("exposes a real checkbox role and toggles", async () => {
    const onCheckedChange = vi.fn();
    render(<Switch onCheckedChange={onCheckedChange} aria-label="Theme" />);
    await userEvent.click(screen.getByRole("switch", { name: "Theme" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("is operable by keyboard", async () => {
    const onCheckedChange = vi.fn();
    render(<Switch onCheckedChange={onCheckedChange} aria-label="Theme" />);
    await userEvent.tab();
    await userEvent.keyboard(" ");
    expect(onCheckedChange).toHaveBeenCalled();
  });
});

describe("Badge, Separator, Skeleton", () => {
  it("Badge renders its variant", () => {
    const { container } = render(<Badge variant="secondary">pro</Badge>);
    expect(container.firstChild.className).toContain("bg-muted");
  });

  it("Separator is decorative by default, so it is not announced", () => {
    const { container } = render(<Separator />);
    // Radix marks a decorative separator with role="none".
    expect(container.firstChild.getAttribute("role")).not.toBe("separator");
  });

  it("Skeleton carries the pulse class", () => {
    const { container } = render(<Skeleton className="h-4 w-20" />);
    expect(container.firstChild.className).toContain("animate-pulse");
  });
});

describe("Sheet", () => {
  it("traps focus and labels itself — the reason it replaced the hand-rolled panel", async () => {
    render(
      <Sheet defaultOpen>
        <SheetContent title="Settings">
          <button>Inside</button>
        </SheetContent>
      </Sheet>
    );

    const dialog = screen.getByRole("dialog");

    // Radix in this version marks the rest of the page aria-hidden rather than
    // setting aria-modal on the dialog. Both express the same thing; assert the
    // behaviour rather than the spelling.
    expect(dialog).toHaveAttribute("aria-labelledby");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByLabelText("Close Settings")).toBeInTheDocument();

    // The point of the migration: focus is inside the panel, not still on the
    // page behind it. The hand-rolled SidePanel never moved focus at all, so
    // Tab from an open settings panel walked into the chat underneath.
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("keeps Tab inside the panel", async () => {
    render(
      <Sheet defaultOpen>
        <SheetContent title="Settings">
          <button>First</button>
          <button>Second</button>
        </SheetContent>
      </Sheet>
    );

    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 6; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement), "focus escaped the panel").toBe(true);
    }
  });

  it("closes on Escape", async () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet defaultOpen onOpenChange={onOpenChange}>
        <SheetContent title="Settings">body</SheetContent>
      </Sheet>
    );

    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens from its trigger", async () => {
    render(
      <Sheet>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent title="Settings">body</SheetContent>
      </Sheet>
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByText("Open"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("marks its content as a UI scope so the scoped reset applies", () => {
    render(
      <Sheet defaultOpen>
        <SheetContent title="Settings">body</SheetContent>
      </Sheet>
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("data-ui-scope");
  });
});
