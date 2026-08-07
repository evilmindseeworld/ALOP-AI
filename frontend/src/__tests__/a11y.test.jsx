import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { APP_MARKUP } from "../test/fixtures/appMarkup";
import AdminPanel from "../components/panels/AdminPanel";
import SidePanel from "../components/SidePanel";

/**
 * Accessibility is a legal surface, not a polish item.
 *
 * Under the ADA in the US and the EAA across the EU from June 2025, a consumer
 * web service is expected to meet WCAG 2.1 AA, and the usual first contact is
 * a complaint rather than an audit. This suite is the cheapest possible guard:
 * it will not catch everything a human tester would, but it fails the build on
 * the violations that make up the bulk of filed complaints — an input with no
 * label, a button whose only content is an icon, a broken ARIA reference, a
 * heading level skipped.
 *
 * WHAT IT CANNOT SEE, so nobody reads a green run as a clean bill of health:
 * jsdom does no layout and no real colour compositing, so contrast, focus
 * order, reflow at 320px and anything requiring a live screen reader are out
 * of scope here. Those need a browser pass.
 *
 * The static fixture is checked as well as live components because it is the
 * one place every component's markup exists at once, in both themes.
 */

// Contrast is excluded EXPLICITLY rather than left to fail silently: jsdom
// resolves every colour to transparent, so the rule reports nothing useful in
// either direction. Naming it here keeps the gap visible.
const OPTIONS = { rules: { "color-contrast": { enabled: false } } };

const noViolations = async (container) => {
  const results = await axe(container, OPTIONS);
  const found = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.help}`);
  expect(found).toEqual([]);
};

describe("accessibility", () => {
  /**
   * A RATCHET, NOT A PASS. The fixture currently fails axe, and pretending
   * otherwise by deleting the test would be worse than recording it.
   *
   * Every count below is a real violation in the transcribed markup, waiting
   * on a browser pass to confirm against the live components — the fixture has
   * 53 buttons where the JSX has 71, so it is a lower bound and its labels may
   * lag the source. The test fails if any number goes UP. Drive them down and
   * update the baseline; do not add a new key to make a failure go away.
   *
   * `landmark-*` is excluded because the fixture renders the dark and light
   * trees side by side, so every landmark legitimately appears twice. That is
   * an artefact of the fixture, not of the app.
   */
  const KNOWN = {
    "button-name": 38,
    label: 6,
    "aria-dialog-name": 2,
    "aria-input-field-name": 2,
  };

  it("the full app markup does not get LESS accessible", async () => {
    const host = document.createElement("div");
    host.innerHTML = APP_MARKUP;
    document.body.appendChild(host);
    try {
      const { violations } = await axe(host, OPTIONS);
      const counts = Object.fromEntries(
        violations
          .filter((v) => !v.id.startsWith("landmark-"))
          .map((v) => [v.id, v.nodes.length])
      );
      for (const [id, n] of Object.entries(counts)) {
        expect(n, `${id}: ${n} nodes, baseline ${KNOWN[id] ?? 0}`).toBeLessThanOrEqual(KNOWN[id] ?? 0);
      }
    } finally {
      host.remove();
    }
  });

  it("the admin panel has no axe violations", async () => {
    const users = [
      { id: "1", email: "a@example.com", name: "A", plan: "free", is_admin: false, suspended: false },
    ];
    const { container } = render(
      <AdminPanel open users={users} offset={0} hasMore onClose={() => {}}
        onPrevious={() => {}} onNext={() => {}}
        onSuspend={() => {}} onUnsuspend={() => {}} onDelete={() => {}} />
    );
    await noViolations(container);
  });

  it("a side panel has no axe violations", async () => {
    const { container } = render(
      <SidePanel open title="Settings" onClose={() => {}}>
        <p>Body</p>
      </SidePanel>
    );
    await noViolations(container);
  });
});
