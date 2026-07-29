import { describe, it, expect } from "vitest";
import { formatPrice } from "../App";

// Prices come from the Stripe API in minor units so the paywall can never
// advertise a figure that differs from what the customer is charged.
describe("formatPrice", () => {
  it("renders a whole amount without decimals", () => {
    expect(formatPrice({ amount: 900, currency: "usd" })).toBe("$9");
  });

  it("keeps decimals when the amount has them", () => {
    expect(formatPrice({ amount: 999, currency: "usd" })).toBe("$9.99");
  });

  it("handles a yearly-sized amount", () => {
    expect(formatPrice({ amount: 9000, currency: "usd" })).toBe("$90");
  });

  it("respects the currency Stripe reports", () => {
    // Symbol placement varies by locale, so assert on content rather than shape.
    const eur = formatPrice({ amount: 1500, currency: "eur" });
    expect(eur).toMatch(/15/);
    expect(eur).toMatch(/€|EUR/);
  });

  it("defaults to USD when currency is absent", () => {
    expect(formatPrice({ amount: 500 })).toBe("$5");
  });

  it("returns an empty string rather than 'NaN' for missing data", () => {
    expect(formatPrice(null)).toBe("");
    expect(formatPrice(undefined)).toBe("");
    expect(formatPrice({})).toBe("");
    expect(formatPrice({ amount: null, currency: "usd" })).toBe("");
  });

  it("renders a zero amount rather than treating it as missing", () => {
    expect(formatPrice({ amount: 0, currency: "usd" })).toBe("$0");
  });

  it("falls back to a plain figure for an unrecognised currency code", () => {
    // Intl throws on invalid codes; the paywall must still render something.
    expect(formatPrice({ amount: 1234, currency: "notacurrency" })).toBe("12.34 NOTACURRENCY");
  });
});
