import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CDPClient } from "./cdp";
import type { AXNode, BackendNodeId, DOMNodeId, Ref, RefRecord, RefsFile } from "./types";
import { asRef } from "./types";

const INTERACTIVE_ROLES = new Set([
  "button",
  "textbox",
  "link",
  "combobox",
  "checkbox",
  "radio",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "treeitem",
  "listbox"
]);

export function loadRefs(refsPath: string): RefsFile {
  try {
    return JSON.parse(readFileSync(refsPath, "utf-8"));
  } catch {
    return { version: 1, targets: {} };
  }
}

export function saveRefs(refsPath: string, data: RefsFile): void {
  const dir = dirname(refsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${refsPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, refsPath);
}

export function resolveRef(refsPath: string, ref: Ref, targetKey: string): RefRecord {
  const store = loadRefs(refsPath);
  const targetRefs = store.targets[targetKey];
  if (!targetRefs?.refs[ref]) throw new Error(`Ref ${ref} not found. Run \`snapshot\` first.`);
  return targetRefs.refs[ref];
}

export async function getFullAXTree(client: CDPClient): Promise<AXNode[]> {
  const r = await client.call("Accessibility.getFullAXTree", {}, 10_000);
  return (r.nodes ?? []) as AXNode[];
}

export type SnapshotFilter = {
  compact?: boolean;
  roles?: Set<string>;
  scopeIds?: Set<number>;
};

export function buildInteractiveSnapshot(
  nodes: AXNode[],
  refsPath: string,
  targetKey: string,
  filter?: SnapshotFilter
): string {
  const lines: string[] = [];
  const refs: Record<string, RefRecord> = {};
  let counter = 0;

  for (const node of nodes) {
    const role = node.role?.value;
    if (!role || !INTERACTIVE_ROLES.has(role)) continue;
    if (node.ignored || node.backendDOMNodeId == null) continue;
    if (filter?.roles && !filter.roles.has(role)) continue;
    if (filter?.scopeIds && !filter.scopeIds.has(node.backendDOMNodeId)) continue;

    const name = node.name?.value ?? "";
    const value = node.properties?.find((p) => p.name === "value")?.value?.value;
    const valueStr = typeof value === "string" ? value : "";

    if (filter?.compact && !name && !valueStr) continue;

    counter++;
    const refKey = `@e${counter}`;
    const disabled = node.properties?.find((p) => p.name === "disabled")?.value?.value;
    const checked = node.properties?.find((p) => p.name === "checked")?.value?.value;

    refs[refKey] = { backendDOMNodeId: node.backendDOMNodeId as BackendNodeId, role, name };

    let line = `${refKey} ${role}`;
    if (name) line += ` "${name}"`;
    if (valueStr.length > 0) line += ` value="${valueStr}"`;
    if (checked === "true" || checked === true) line += " [checked]";
    if (disabled) line += " [disabled]";
    lines.push(line);
  }

  const store = loadRefs(refsPath);
  store.targets[targetKey] = { next: counter, refs };
  saveRefs(refsPath, store);

  return lines.length ? lines.join("\n") : "(no interactive elements found)";
}

export function buildElementExistsJS(selector: string): string {
  if (selector.startsWith("xpath=")) {
    const xpath = selector.slice(6);
    return `!!document.evaluate(${JSON.stringify(xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`;
  }
  return `!!document.querySelector(${JSON.stringify(selector)})`;
}

async function resolveSelectorNode(client: CDPClient, selector: string): Promise<number> {
  if (selector.startsWith("xpath=")) {
    const xpath = selector.slice(6);
    const r = await client.call("Runtime.evaluate", {
      expression: `document.evaluate(${JSON.stringify(xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`,
      returnByValue: false
    });
    const objectId = r.result?.objectId;
    if (!objectId) throw new Error(`XPath "${xpath}" not found`);
    try {
      const { nodeId } = await client.call("DOM.requestNode", { objectId });
      if (!nodeId) throw new Error(`XPath "${xpath}" could not resolve to DOM node`);
      return nodeId;
    } finally {
      client.call("Runtime.releaseObject", { objectId }).catch(() => {});
    }
  }
  const doc = await client.call("DOM.getDocument", {});
  const { nodeId } = await client.call("DOM.querySelector", { nodeId: doc.root.nodeId, selector });
  if (!nodeId) throw new Error(`Selector "${selector}" not found`);
  return nodeId;
}

export async function collectSubtreeIds(client: CDPClient, selector: string): Promise<Set<number>> {
  const nodeId = await resolveSelectorNode(client, selector);
  const desc = await client.call("DOM.describeNode", { nodeId, depth: -1 });
  const ids = new Set<number>();
  const walk = (n: any) => {
    if (n.backendNodeId != null) ids.add(n.backendNodeId);
    for (const c of n.children ?? []) walk(c);
    if (n.contentDocument) walk(n.contentDocument);
    for (const sr of n.shadowRoots ?? []) walk(sr);
  };
  walk(desc.node);
  return ids;
}

export async function resolveBackendNode(client: CDPClient, backendNodeId: BackendNodeId): Promise<DOMNodeId> {
  const r = await client.call("DOM.describeNode", { backendNodeId });
  const nodeId = r.node?.nodeId;
  if (nodeId == null) throw new Error(`DOM.describeNode returned no nodeId for backendNodeId ${backendNodeId}`);
  return nodeId as DOMNodeId;
}

export async function scrollIntoView(client: CDPClient, nodeId: DOMNodeId): Promise<void> {
  try {
    await client.call("DOM.scrollIntoViewIfNeeded", { nodeId });
  } catch {
    /* best-effort */
  }
}

export async function getBoxModel(
  client: CDPClient,
  nodeId: DOMNodeId
): Promise<{ x: number; y: number; width: number; height: number }> {
  const r = await client.call("DOM.getBoxModel", { nodeId });
  const quad = r.model?.content ?? r.model?.border;
  if (!quad || quad.length < 8) throw new Error("No box model for node");
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export function boxCenter(box: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function prepareRef(
  client: CDPClient,
  refsPath: string,
  refArg: string,
  targetKey: string
): Promise<{ nodeId: DOMNodeId; ref: RefRecord }> {
  const ref = resolveRef(refsPath, asRef(refArg), targetKey);
  const nodeId = await resolveBackendNode(client, ref.backendDOMNodeId);
  await scrollIntoView(client, nodeId);
  return { nodeId, ref };
}

export async function callOnNode(client: CDPClient, nodeId: DOMNodeId, fn: string): Promise<any> {
  const resolved = await client.call("DOM.resolveNode", { nodeId });
  const objectId = resolved.object?.objectId;
  if (!objectId) throw new Error("Could not resolve node to JS object");
  try {
    const r = await client.call("Runtime.callFunctionOn", { objectId, functionDeclaration: fn, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "callFunctionOn failed");
    return r.result?.value;
  } finally {
    client.call("Runtime.releaseObject", { objectId }).catch(() => {});
  }
}
