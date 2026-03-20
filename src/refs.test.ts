import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boxCenter, buildElementExistsJS, buildInteractiveSnapshot, loadRefs, resolveRef, saveRefs } from "./refs";
import type { AXNode, BackendNodeId } from "./types";
import { asRef } from "./types";

// ─── asRef ───

describe("asRef", () => {
  test("adds @ prefix when missing", () => {
    expect(asRef("e1") as string).toBe("@e1");
  });

  test("idempotent when @ already present", () => {
    expect(asRef("@e2") as string).toBe("@e2");
  });
});

// ─── boxCenter ───

describe("boxCenter", () => {
  test("computes center of rectangle", () => {
    expect(boxCenter({ x: 10, y: 20, width: 100, height: 50 })).toEqual({ x: 60, y: 45 });
  });

  test("zero-size box returns top-left", () => {
    expect(boxCenter({ x: 5, y: 5, width: 0, height: 0 })).toEqual({ x: 5, y: 5 });
  });
});

// ─── buildElementExistsJS ───

describe("buildElementExistsJS", () => {
  test("CSS selector — generates querySelector check", () => {
    const js = buildElementExistsJS("#main");
    expect(js).toContain("document.querySelector");
    expect(js).toContain('"#main"');
  });

  test("xpath= prefix — generates document.evaluate", () => {
    const js = buildElementExistsJS("xpath=//button[@id='ok']");
    expect(js).toContain("document.evaluate");
    expect(js).toContain("XPathResult.FIRST_ORDERED_NODE_TYPE");
    expect(js).toContain("//button[@id='ok']");
    expect(js).not.toContain("querySelector");
  });

  test("escapes quotes in CSS selector", () => {
    const js = buildElementExistsJS('[data-x="a"]');
    expect(js).toContain("querySelector");
  });

  test("escapes quotes in xpath", () => {
    const js = buildElementExistsJS('xpath=//div[contains(text(),"hello")]');
    expect(js).toContain("document.evaluate");
  });
});

// ─── loadRefs / saveRefs / resolveRef ───

describe("refs persistence", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeTmpRefs() {
    tmpDir = mkdtempSync(join(tmpdir(), "refs-test-"));
    return join(tmpDir, "refs.json");
  }

  test("loadRefs returns empty store for missing file", () => {
    const store = loadRefs("/nonexistent/refs.json");
    expect(store).toEqual({ version: 1, targets: {} });
  });

  test("saveRefs + loadRefs round-trip", () => {
    const path = makeTmpRefs();
    const data = {
      version: 1 as const,
      targets: {
        "http://test": {
          next: 1,
          refs: { "@e1": { backendDOMNodeId: 42 as BackendNodeId, role: "button", name: "OK" } }
        }
      }
    };
    saveRefs(path, data);
    expect(loadRefs(path)).toEqual(data);
  });

  test("resolveRef finds existing ref", () => {
    const path = makeTmpRefs();
    saveRefs(path, {
      version: 1,
      targets: {
        t1: { next: 1, refs: { "@e1": { backendDOMNodeId: 10 as BackendNodeId, role: "link", name: "Home" } } }
      }
    });
    const rec = resolveRef(path, asRef("@e1"), "t1");
    expect(rec.role).toBe("link");
    expect(rec.name).toBe("Home");
  });

  test("resolveRef throws for missing ref", () => {
    const path = makeTmpRefs();
    saveRefs(path, { version: 1, targets: { t1: { next: 0, refs: {} } } });
    expect(() => resolveRef(path, asRef("@e99"), "t1")).toThrow("Ref @e99 not found");
  });

  test("resolveRef throws for missing target", () => {
    const path = makeTmpRefs();
    saveRefs(path, { version: 1, targets: {} });
    expect(() => resolveRef(path, asRef("@e1"), "missing")).toThrow("not found");
  });
});

// ─── buildInteractiveSnapshot ───

function makeNode(opts: {
  role: string;
  name?: string;
  backendDOMNodeId: number;
  ignored?: boolean;
  properties?: AXNode["properties"];
}): AXNode {
  return {
    nodeId: `n${opts.backendDOMNodeId}`,
    ignored: opts.ignored ?? false,
    role: { type: "role", value: opts.role },
    name: opts.name != null ? { type: "computedString", value: opts.name } : undefined,
    backendDOMNodeId: opts.backendDOMNodeId,
    properties: opts.properties
  };
}

describe("buildInteractiveSnapshot", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  function tmpRefs() {
    tmpDir = mkdtempSync(join(tmpdir(), "snap-test-"));
    return join(tmpDir, "refs.json");
  }

  const nodes: AXNode[] = [
    makeNode({ role: "button", name: "Submit", backendDOMNodeId: 1 }),
    makeNode({ role: "textbox", name: "Email", backendDOMNodeId: 2 }),
    makeNode({ role: "link", name: "Help", backendDOMNodeId: 3 }),
    makeNode({ role: "button", name: "", backendDOMNodeId: 4 }), // unnamed
    makeNode({ role: "heading", name: "Title", backendDOMNodeId: 5 }), // non-interactive
    makeNode({
      role: "checkbox",
      name: "Agree",
      backendDOMNodeId: 6,
      properties: [{ name: "checked", value: { type: "boolean", value: true } }]
    }),
    makeNode({
      role: "textbox",
      name: "",
      backendDOMNodeId: 7,
      properties: [{ name: "value", value: { type: "string", value: "hello" } }]
    })
  ];

  test("basic — includes all interactive, assigns sequential refs", () => {
    const snap = buildInteractiveSnapshot(nodes, tmpRefs(), "t1");
    expect(snap).toContain('@e1 button "Submit"');
    expect(snap).toContain('@e2 textbox "Email"');
    expect(snap).toContain('@e3 link "Help"');
    expect(snap).toContain("@e4 button"); // unnamed button
    expect(snap).not.toContain("heading"); // non-interactive excluded
    expect(snap).toContain("[checked]");
  });

  test("compact — skips elements with no name and no value", () => {
    const snap = buildInteractiveSnapshot(nodes, tmpRefs(), "t1", { compact: true });
    // @e4 (unnamed button, no value) should be excluded
    expect(snap).not.toContain("@e4 button\n");
    expect(snap).toContain('@e1 button "Submit"');
    // unnamed textbox with value should survive
    expect(snap).toContain('value="hello"');
  });

  test("roles filter — only specified roles", () => {
    const snap = buildInteractiveSnapshot(nodes, tmpRefs(), "t1", { roles: new Set(["button"]) });
    expect(snap).toContain("button");
    expect(snap).not.toContain("textbox");
    expect(snap).not.toContain("link");
  });

  test("scopeIds filter — only matching backendDOMNodeIds", () => {
    const snap = buildInteractiveSnapshot(nodes, tmpRefs(), "t1", { scopeIds: new Set([1, 3]) });
    expect(snap).toContain('@e1 button "Submit"');
    expect(snap).toContain('@e2 link "Help"');
    expect(snap).not.toContain("textbox");
  });

  test("combined filters — compact + roles", () => {
    const snap = buildInteractiveSnapshot(nodes, tmpRefs(), "t1", {
      compact: true,
      roles: new Set(["button", "textbox"])
    });
    expect(snap).toContain("Submit");
    expect(snap).toContain("Email");
    expect(snap).not.toContain("link");
    // unnamed button with no value is filtered by compact
    const lines = snap.split("\n");
    expect(lines.every((l: string) => !l.match(/^@e\d+ button$/))).toBe(true);
  });

  test("empty result", () => {
    const snap = buildInteractiveSnapshot([], tmpRefs(), "t1");
    expect(snap).toBe("(no interactive elements found)");
  });

  test("ignored nodes are excluded", () => {
    const ignored = [makeNode({ role: "button", name: "Ghost", backendDOMNodeId: 99, ignored: true })];
    const snap = buildInteractiveSnapshot(ignored, tmpRefs(), "t1");
    expect(snap).toBe("(no interactive elements found)");
  });

  test("persists refs to disk", () => {
    const path = tmpRefs();
    buildInteractiveSnapshot(nodes, path, "t1");
    const store = loadRefs(path);
    expect(store.targets.t1).toBeDefined();
    expect(store.targets.t1.refs["@e1"].role).toBe("button");
  });
});
