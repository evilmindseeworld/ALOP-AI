import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * The browser security headers, and the one that can silently break the app.
 *
 * A security scan found alop-ai.com serving none of Content-Security-Policy,
 * Permissions-Policy, Referrer-Policy or X-Content-Type-Options. Only HSTS was
 * present. These are set in vercel.json because the site is static on Vercel —
 * the Express `helmet` config in the backend covers alop-ai.onrender.com and
 * has never applied to the pages a browser actually loads.
 *
 * THE CSP IS THE DANGEROUS ONE. It is the only header here that can take the
 * product down: miss an origin and sign-in stops working, with the failure
 * visible only in the console. So the interesting assertion in this file is not
 * "a CSP exists" — it is that every external origin the frontend source
 * actually references is present in it. That check fails the day someone adds a
 * new third-party host and does not think about the header.
 *
 * Verified in a browser before shipping, against a build made with PRODUCTION
 * config: Clerk JS loaded from clerk.alop-ai.com, the API call reached CORS
 * rather than being blocked by CSP, fonts and styles applied. Testing the
 * ordinary local build proves nothing, because it points at the development
 * Clerk instance and localhost:3000 — neither of which production ever uses.
 */

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(here, "..", "..", "vercel.json"), "utf8"));

const rule = CONFIG.headers?.[0];
const headers = Object.fromEntries((rule?.headers || []).map((h) => [h.key, h.value]));
const csp = headers["Content-Security-Policy"] || "";

/** A CSP directive's source list. */
const directive = (name) => {
  const part = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${name} `) || s === name);
  return part ? part.slice(name.length).trim() : null;
};

describe("the config parses at all", () => {
  it("has one header rule covering every path", () => {
    // A guard on the guard: every assertion below is vacuous if this is absent.
    expect(rule, "no headers block in vercel.json").toBeTruthy();
    expect(rule.source, "the header rule does not cover all routes").toBe("/(.*)");
    expect(Object.keys(headers).length).toBeGreaterThanOrEqual(5);
  });
});

describe("the four headers the scan asked for", () => {
  it("X-Content-Type-Options is nosniff", () => {
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("Referrer-Policy is strict-origin-when-cross-origin", () => {
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("Permissions-Policy exists", () => {
    expect(headers["Permissions-Policy"]).toBeTruthy();
  });

  it("Content-Security-Policy exists and is not report-only", () => {
    expect(csp).toBeTruthy();
    expect(headers["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });
});

describe("Permissions-Policy matches what this app actually uses", () => {
  // The scan's advice was to disable camera, microphone and geolocation. Two of
  // those three would have broken shipped features: useCamera, the overlay's
  // getDisplayMedia, and useSpeechRecognition. A policy copied from a checklist
  // is a policy that disables your own product.
  const pp = headers["Permissions-Policy"] || "";

  it("allows the features the app has code for", () => {
    const SRC = join(here, "..");
    const used = readdirSync(join(SRC, "hooks")).join(" ");
    expect(used, "useCamera disappeared — re-check this policy").toMatch(/useCamera/);
    expect(used, "useSpeechRecognition disappeared — re-check this policy").toMatch(/useSpeechRecognition/);

    expect(pp, "camera is denied but the app ships a camera").toMatch(/camera=\(self\)/);
    expect(pp, "microphone is denied but the app ships voice input").toMatch(/microphone=\(self\)/);
    expect(pp, "display-capture is denied but the overlay captures the screen").toMatch(/display-capture=\(self\)/);
  });

  it("denies what the app genuinely does not use", () => {
    for (const feature of ["geolocation", "payment", "usb"]) {
      expect(pp, `${feature} should be denied`).toMatch(new RegExp(`${feature}=\\(\\)`));
    }
  });
});

describe("the CSP covers every origin the frontend can reach", () => {
  // THE ASSERTION THIS FILE EXISTS FOR. Add a new third-party host to the
  // source and forget the header, and the feature dies in production with
  // nothing but a console message.
  const SRC = join(here, "..");
  const sourceText = (function walk(dir) {
    let out = "";
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "__tests__" || entry.name === "test") continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) out += walk(p);
      else if (/\.(js|jsx)$/.test(entry.name)) out += readFileSync(p, "utf8");
    }
    return out;
  })(SRC);

  /** Hosts the app talks to, excluding ones that are only ever documentation. */
  const IGNORED = new Set(["example.com", "schema.org", "via.placeholder.com", "rtings.com", "alop-ai.com"]);
  const referenced = [
    ...new Set(
      [...sourceText.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].replace(/\/$/, "")),
    ),
  ].filter((h) => !IGNORED.has(h));

  it("found hosts to check, so this test is not vacuous", () => {
    expect(referenced.length).toBeGreaterThan(0);
  });

  for (const host of referenced) {
    it(`allows ${host}`, () => {
      expect(csp, `${host} is referenced in the frontend but absent from the CSP`).toContain(host);
    });
  }

  it("allows Clerk's own host, which serves clerk.browser.js", () => {
    // Not found by the scan above because the frontend never hardcodes it —
    // Clerk derives it from the publishable key at runtime. Miss it and the
    // entire sign-in screen fails to initialise.
    expect(directive("script-src")).toContain("https://clerk.alop-ai.com");
    expect(directive("connect-src")).toContain("https://clerk.alop-ai.com");
  });

  it("allows the Turnstile CAPTCHA Clerk's bot protection loads", () => {
    // bot_protection.captcha_enabled is true on the production instance with the
    // "smart" widget, which is Cloudflare Turnstile. It only appears during
    // sign-up, so a CSP that omits it looks fine until a real user registers.
    expect(directive("script-src")).toContain("https://challenges.cloudflare.com");
    expect(directive("frame-src")).toContain("https://challenges.cloudflare.com");
  });
});

describe("the CSP is actually restrictive", () => {
  it("locks down the directives that matter", () => {
    expect(directive("default-src")).toBe("'self'");
    expect(directive("object-src")).toBe("'none'");
    expect(directive("base-uri")).toBe("'self'");
    expect(directive("frame-ancestors")).toBe("'none'");
  });

  it("does not allow unsafe-eval, and allows unsafe-inline only for styles", () => {
    // 'unsafe-inline' on style-src is unavoidable: Clerk injects emotion styles
    // and this codebase uses React `style={{…}}` attributes throughout.
    // Allowing it for SCRIPTS would defeat most of the point of having a CSP.
    expect(directive("script-src")).not.toContain("unsafe-eval");
    expect(directive("script-src")).not.toContain("unsafe-inline");
    expect(directive("style-src")).toContain("'unsafe-inline'");
  });
});
