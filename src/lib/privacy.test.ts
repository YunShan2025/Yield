import { describe, expect, it } from "vitest";
import { isPrivacyModeEnabled } from "./privacy";

describe("isPrivacyModeEnabled", () => {
  it("is opt-in: only explicit true enables privacy", () => {
    expect(isPrivacyModeEnabled("true")).toBe(true);
    expect(isPrivacyModeEnabled("false")).toBe(false);
    expect(isPrivacyModeEnabled(null)).toBe(false);
    expect(isPrivacyModeEnabled(undefined)).toBe(false);
    expect(isPrivacyModeEnabled("")).toBe(false);
  });
});

