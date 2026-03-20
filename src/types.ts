// ─── Branded Types ───
declare const RefBrand: unique symbol;
declare const BackendNodeIdBrand: unique symbol;
declare const DOMNodeIdBrand: unique symbol;

/** Stable element reference: @e1, @e2, … */
export type Ref = string & { readonly [RefBrand]: true };
/** CDP backend node ID (stable across sessions) */
export type BackendNodeId = number & { readonly [BackendNodeIdBrand]: true };
/** CDP DOM node ID (session-scoped, may change) */
export type DOMNodeId = number & { readonly [DOMNodeIdBrand]: true };

export const asRef = (s: string): Ref => (s.startsWith("@") ? s : `@${s}`) as Ref;

// ─── Geometry ───
export type Point = { x: number; y: number };
export type Clip = { x: number; y: number; width: number; height: number };

// ─── CDP Target ───
export type CDPTarget = {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
};

// ─── Accessibility Tree ───
export type AXNode = {
  nodeId: string;
  ignored: boolean;
  role?: { type: string; value: string };
  name?: { type: string; value: string };
  properties?: Array<{ name: string; value: { type: string; value: any } }>;
  backendDOMNodeId?: number;
  childIds?: string[];
};

// ─── Ref Store ───
export type RefRecord = {
  backendDOMNodeId: BackendNodeId;
  role: string;
  name: string;
};

export type TargetRefs = {
  next: number;
  refs: Record<string, RefRecord>;
};

export type RefsFile = {
  version: 1;
  targets: Record<string, TargetRefs>;
};

// ─── Keyboard ───
export type KeyDef = {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
};

// ─── CDP Events (typed event map) ───
export type CDPEventMap = {
  "Page.javascriptDialogOpening": {
    url: string;
    message: string;
    type: "alert" | "confirm" | "prompt" | "beforeunload";
    hasBrowserHandler: boolean;
    defaultPrompt?: string;
  };
  "Page.loadEventFired": { timestamp: number };
  "Page.domContentEventFired": { timestamp: number };
  "Page.frameNavigated": { frame: { id: string; url: string } };
  "Runtime.consoleAPICalled": {
    type: string;
    args: Array<{ type: string; value?: unknown; description?: string }>;
    timestamp: number;
  };
  "Runtime.exceptionThrown": {
    timestamp: number;
    exceptionDetails: { text: string; exception?: { description?: string } };
  };
  "Page.lifecycleEvent": {
    frameId: string;
    loaderId: string;
    name: string;
    timestamp: number;
  };
};

// ─── Snapshot Options ───
export type SnapshotOptions = {
  /** Skip elements with empty name and value */
  compact?: boolean;
  /** Scope to elements within this CSS selector's subtree */
  selector?: string;
  /** Only include these roles (filters within interactive roles) */
  roles?: string[];
};

// ─── Console/Error Capture ───
export type LogEntry = {
  level: "log" | "warn" | "error" | "info" | "debug" | "trace" | "dir" | "exception" | (string & {});
  text: string;
  timestamp: number;
};
