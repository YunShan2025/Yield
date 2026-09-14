import { afterEach, describe, expect, it, vi } from "vitest";
import { detectDesktopPlatform, isMobileShell } from "./platform";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isMobileShell", () => {
  it("detects Android WebView user agents", () => {
    vi.stubGlobal(
      "navigator",
      { userAgent: "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36" },
    );
    expect(isMobileShell()).toBe(true);
  });

  it("is false for desktop WebView2", () => {
    vi.stubGlobal(
      "navigator",
      {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      },
    );
    expect(isMobileShell()).toBe(false);
  });

  it("is false for iOS browsers (仅 Android 壳走移动布局)", () => {
    vi.stubGlobal(
      "navigator",
      {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      },
    );
    expect(isMobileShell()).toBe(false);
  });
});

describe("detectDesktopPlatform", () => {
  it("maps user agents to desktop platforms", () => {
    vi.stubGlobal(
      "navigator",
      { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36" },
    );
    expect(detectDesktopPlatform()).toBe("windows");
  });
});
