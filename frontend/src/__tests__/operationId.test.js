import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { newOperationId, withOperationId, shortOperationId } from "../lib/operationId";

// The server validates the header with this exact shape before echoing it into
// a log line. An id that fails it is silently replaced, which would leave the
// client showing a reference that appears nowhere.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("operation ids", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mints a UUID the server will accept", () => {
    for (let i = 0; i < 50; i++) expect(newOperationId()).toMatch(UUID_V4);
  });

  it("is unique per call — a shared id would merge two turns in the log", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newOperationId()));
    expect(ids.size).toBe(200);
  });

  it("falls back to a valid id where crypto.randomUUID is unavailable", () => {
    // An http dev server on a LAN address is not a secure context. A missing id
    // must degrade, never throw inside the send path.
    vi.stubGlobal("crypto", {});
    for (let i = 0; i < 50; i++) expect(newOperationId()).toMatch(UUID_V4);
  });

  it("attaches the id and code to an error without changing its message", () => {
    const err = withOperationId(new Error("The council is briefly rate limited."), "abcd1234-0000-4000-8000-000000000000", "model_rate_limited");
    expect(err.message).toBe("The council is briefly rate limited.");
    expect(err.operationId).toBe("abcd1234-0000-4000-8000-000000000000");
    expect(err.code).toBe("model_rate_limited");
  });

  it("leaves an error alone when there is nothing to attach", () => {
    const err = withOperationId(new Error("boom"), undefined, undefined);
    expect(err.operationId).toBeUndefined();
    expect(err.code).toBeUndefined();
    expect(withOperationId(null, "x", "y")).toBeNull();
  });

  it("shows eight characters, and nothing at all for a missing id", () => {
    expect(shortOperationId("abcd1234-0000-4000-8000-000000000000")).toBe("abcd1234");
    expect(shortOperationId(undefined)).toBe("");
    expect(shortOperationId("short")).toBe("");
  });
});

describe("the turn actually sends and surfaces the id", () => {
  // useChats owns a live Clerk session and a streaming fetch, so it is asserted
  // as source here rather than mounted. A unit test of the helpers proves the
  // helpers; this is what proves they are WIRED, which is the part that has
  // silently regressed before.
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "..", "hooks", "useChats.js"), "utf8");

  it("sends the id as a request header on the council turn", () => {
    expect(source).toMatch(/"X-Operation-Id": operationId/);
  });

  it("prefers the server's id over its own", () => {
    expect(source).toMatch(/frame\.type === "meta"/);
    expect(source).toMatch(/turnOperationId = frame\.operationId/);
  });

  it("puts a reference on the failure the user can see", () => {
    expect(source).toMatch(/shortOperationId\(err\.operationId\)/);
    expect(source).toMatch(/ref \$\{ref\}/);
  });
});
