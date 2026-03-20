import { describe, expect, test } from "bun:test";
import { findTarget } from "./cdp";
import type { CDPTarget } from "./types";

describe("findTarget", () => {
  const targets: CDPTarget[] = [
    { id: "1", title: "DevTools", type: "other", url: "devtools://", webSocketDebuggerUrl: "ws://1" },
    { id: "2", title: "App", type: "page", url: "http://app.local", webSocketDebuggerUrl: "ws://2" },
    {
      id: "3",
      title: "Background",
      type: "background_page",
      url: "chrome-extension://x",
      webSocketDebuggerUrl: "ws://3"
    },
    { id: "4", title: "Settings", type: "page", url: "views://settings", webSocketDebuggerUrl: "ws://4" }
  ];

  test("finds page matching predicate", () => {
    const t = findTarget(targets, (t) => t.url.startsWith("http://"));
    expect(t?.id).toBe("2");
    expect(t?.title).toBe("App");
  });

  test("skips non-page targets", () => {
    const t = findTarget(targets, (t) => t.url.startsWith("devtools://"));
    expect(t).toBeUndefined();
  });

  test("returns undefined when no match", () => {
    const t = findTarget(targets, (t) => t.url.includes("nonexistent"));
    expect(t).toBeUndefined();
  });

  test("predicate filters among pages", () => {
    const t = findTarget(targets, (t) => !t.url.startsWith("views://"));
    expect(t?.id).toBe("2");
  });

  test("empty targets array", () => {
    expect(findTarget([], () => true)).toBeUndefined();
  });
});
