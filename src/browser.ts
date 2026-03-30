import type { CDPClient } from "./cdp";
import { sleep } from "./internal";
import { captureScreenshot, clickAt, dblClickAt, hoverAt, insertText, pressKey } from "./input";
import {
  boxCenter,
  buildElementExistsJS,
  buildInteractiveSnapshot,
  callOnNode,
  collectSubtreeIds,
  getBoxModel,
  getFullAXTree,
  prepareRef
} from "./refs";
import type { Clip, LogEntry, SnapshotOptions } from "./types";

/**
 * High-level browser automation. Zero external dependencies.
 * Receives an already-connected CDPClient — caller owns the connection lifecycle.
 */
export class Browser {
  private _logs: LogEntry[] = [];
  private _onConsole: ((p: any) => void) | null = null;
  private _onException: ((p: any) => void) | null = null;

  constructor(
    private readonly client: CDPClient,
    private readonly targetKey: string,
    private readonly refsPath: string
  ) {}

  // ─── Snapshot ───

  async snapshot(options?: SnapshotOptions): Promise<string> {
    const nodes = await getFullAXTree(this.client);
    const scopeIds = options?.selector ? await collectSubtreeIds(this.client, options.selector) : undefined;
    return buildInteractiveSnapshot(nodes, this.refsPath, this.targetKey, {
      compact: options?.compact,
      roles: options?.roles ? new Set(options.roles) : undefined,
      scopeIds
    });
  }

  // ─── Navigation ───

  async navigate(url: string): Promise<void> {
    const r = await this.client.call("Page.navigate", { url });
    if (r.errorText) throw new Error(`Navigation failed: ${r.errorText}`);
  }

  async back(): Promise<void> {
    const { currentIndex, entries } = await this.client.call("Page.getNavigationHistory");
    if (currentIndex > 0)
      await this.client.call("Page.navigateToHistoryEntry", { entryId: entries[currentIndex - 1].id });
  }

  async forward(): Promise<void> {
    const { currentIndex, entries } = await this.client.call("Page.getNavigationHistory");
    if (currentIndex < entries.length - 1)
      await this.client.call("Page.navigateToHistoryEntry", { entryId: entries[currentIndex + 1].id });
  }

  async reload(): Promise<void> {
    await this.client.call("Page.reload");
  }

  // ─── Interaction ───

  async click(ref: string): Promise<void> {
    const { nodeId } = await prepareRef(this.client, this.refsPath, ref, this.targetKey);
    const center = boxCenter(await getBoxModel(this.client, nodeId));
    await clickAt(this.client, center.x, center.y);
  }

  async dblclick(ref: string): Promise<void> {
    const { nodeId } = await prepareRef(this.client, this.refsPath, ref, this.targetKey);
    const center = boxCenter(await getBoxModel(this.client, nodeId));
    await dblClickAt(this.client, center.x, center.y);
  }

  async hover(ref: string): Promise<void> {
    const { nodeId } = await prepareRef(this.client, this.refsPath, ref, this.targetKey);
    const center = boxCenter(await getBoxModel(this.client, nodeId));
    await hoverAt(this.client, center.x, center.y);
  }

  async focus(ref: string): Promise<void> {
    const { nodeId } = await prepareRef(this.client, this.refsPath, ref, this.targetKey);
    await this.client.call("DOM.focus", { nodeId });
  }

  async fill(ref: string, text: string): Promise<void> {
    const { nodeId } = await prepareRef(this.client, this.refsPath, ref, this.targetKey);
    await this.client.call("DOM.focus", { nodeId });
    await callOnNode(
      this.client,
      nodeId,
      `function() {
        const proto = this instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const nativeSet = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSet) nativeSet.call(this, ${JSON.stringify(text)});
        else this.value = ${JSON.stringify(text)};
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
      }`
    );
  }

  async type(text: string): Promise<void> {
    await insertText(this.client, text);
  }

  async press(combo: string): Promise<void> {
    await pressKey(this.client, combo);
  }

  async select(ref: string, ...values: string[]): Promise<void> {
    const { nodeId } = await prepareRef(this.client, this.refsPath, ref, this.targetKey);
    await callOnNode(
      this.client,
      nodeId,
      `function() {
        const vals = new Set(${JSON.stringify(values)});
        for (const opt of this.options) opt.selected = vals.has(opt.value);
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
      }`
    );
  }

  async check(ref: string, checked = true): Promise<void> {
    const { nodeId } = await prepareRef(this.client, this.refsPath, ref, this.targetKey);
    const current = await callOnNode(this.client, nodeId, "function() { return !!this.checked; }");
    if (current !== checked) {
      const center = boxCenter(await getBoxModel(this.client, nodeId));
      await clickAt(this.client, center.x, center.y);
    }
  }

  async scroll(target: string | null, dx: number, dy: number): Promise<void> {
    if (target) {
      const { nodeId } = await prepareRef(this.client, this.refsPath, target, this.targetKey);
      const center = boxCenter(await getBoxModel(this.client, nodeId));
      await this.client.call("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: center.x,
        y: center.y,
        deltaX: dx,
        deltaY: dy
      });
    } else {
      await this.client.evalJS(`window.scrollBy(${dx}, ${dy})`);
    }
  }

  // ─── Query ───

  async getText(ref: string): Promise<string> {
    const { nodeId } = await prepareRef(this.client, this.refsPath, ref, this.targetKey);
    return callOnNode(this.client, nodeId, "function() { return this.textContent ?? ''; }");
  }

  async getHtml(ref: string): Promise<string> {
    const { nodeId } = await prepareRef(this.client, this.refsPath, ref, this.targetKey);
    return callOnNode(this.client, nodeId, "function() { return this.innerHTML ?? ''; }");
  }

  async getValue(ref: string): Promise<string> {
    const { nodeId } = await prepareRef(this.client, this.refsPath, ref, this.targetKey);
    return callOnNode(this.client, nodeId, "function() { return this.value ?? ''; }");
  }

  async getAttr(ref: string, attr: string): Promise<string | null> {
    const { nodeId } = await prepareRef(this.client, this.refsPath, ref, this.targetKey);
    return callOnNode(this.client, nodeId, `function() { return this.getAttribute(${JSON.stringify(attr)}); }`);
  }

  async getBox(ref: string): Promise<Clip> {
    const { nodeId } = await prepareRef(this.client, this.refsPath, ref, this.targetKey);
    return getBoxModel(this.client, nodeId);
  }

  async getUrl(): Promise<string> {
    return this.client.evalJS("location.href");
  }

  async getTitle(): Promise<string> {
    return this.client.evalJS("document.title");
  }

  // ─── State Checks ───

  async isVisible(ref: string): Promise<boolean> {
    const { nodeId } = await prepareRef(this.client, this.refsPath, ref, this.targetKey);
    return callOnNode(
      this.client,
      nodeId,
      `function() {
        const r = this.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(this).visibility !== 'hidden';
      }`
    );
  }

  async isEnabled(ref: string): Promise<boolean> {
    const { nodeId } = await prepareRef(this.client, this.refsPath, ref, this.targetKey);
    return callOnNode(this.client, nodeId, "function() { return !this.disabled; }");
  }

  async isChecked(ref: string): Promise<boolean> {
    const { nodeId } = await prepareRef(this.client, this.refsPath, ref, this.targetKey);
    return callOnNode(this.client, nodeId, "function() { return !!this.checked; }");
  }

  // ─── Page ───

  async screenshot(clip?: Clip): Promise<string> {
    return captureScreenshot(this.client, clip);
  }

  async pdf(): Promise<string> {
    const r = await this.client.call("Page.printToPDF", {}, 30_000);
    return r.data as string;
  }

  async eval(expression: string): Promise<unknown> {
    return this.client.evalJS(expression);
  }

  // ─── Dialog ───

  async dialog(action: "accept" | "dismiss", promptText?: string): Promise<void> {
    await this.client.call("Page.handleJavaScriptDialog", { accept: action === "accept", promptText });
  }

  // ─── Console/Error Capture ───

  captureConsole(enabled = true): void {
    if (enabled && !this._onConsole) {
      this._onConsole = (p) => {
        this._logs.push({
          level: p.type === "warning" ? "warn" : p.type,
          text: p.args.map((a: any) => a.description ?? String(a.value ?? "")).join(" "),
          timestamp: p.timestamp
        });
      };
      this._onException = (p) => {
        this._logs.push({
          level: "exception",
          text: p.exceptionDetails.exception?.description ?? p.exceptionDetails.text,
          timestamp: p.timestamp
        });
      };
      this.client.on("Runtime.consoleAPICalled", this._onConsole);
      this.client.on("Runtime.exceptionThrown", this._onException);
    } else if (!enabled && this._onConsole) {
      this.client.off("Runtime.consoleAPICalled", this._onConsole);
      this.client.off("Runtime.exceptionThrown", this._onException!);
      this._onConsole = null;
      this._onException = null;
    }
  }

  logs(clear = true): LogEntry[] {
    const entries = [...this._logs];
    if (clear) this._logs = [];
    return entries;
  }

  // ─── Wait ───

  async wait(msOrSelector: number | string, timeoutMs = 10_000): Promise<void> {
    if (typeof msOrSelector === "number") {
      await sleep(msOrSelector);
      return;
    }
    const js = buildElementExistsJS(msOrSelector);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.client.evalJS(js)) return;
      await sleep(200);
    }
    throw new Error(`Timed out waiting for: ${msOrSelector}`);
  }

  async waitForLoad(timeoutMs = 30_000): Promise<void> {
    const state = await this.client.evalJS("document.readyState");
    if (state === "complete") return;
    await this.client.once("Page.loadEventFired", timeoutMs);
  }

  async waitForNetworkIdle(idleMs = 500, timeoutMs = 30_000): Promise<void> {
    try {
      await this.client.call("Network.enable", {}, 3000);
    } catch {
      /* may already be enabled */
    }

    // Snapshot current inflight count via CDP before listening
    const metrics = await this.client.evalJS(
      "performance.getEntriesByType('resource').filter(e => e.responseEnd === 0).length"
    );
    let inflight = typeof metrics === "number" ? metrics : 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("waitForNetworkIdle timed out"));
      }, timeoutMs);

      const checkIdle = () => {
        if (inflight <= 0) {
          idleTimer = setTimeout(() => {
            cleanup();
            resolve();
          }, idleMs);
        }
      };

      const onRequest = () => {
        inflight++;
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      };

      const onDone = () => {
        inflight = Math.max(0, inflight - 1);
        checkIdle();
      };

      const cleanup = () => {
        clearTimeout(timeout);
        if (idleTimer) clearTimeout(idleTimer);
        this.client.off("Network.requestWillBeSent", onRequest);
        this.client.off("Network.loadingFinished", onDone);
        this.client.off("Network.loadingFailed", onDone);
      };

      this.client.on("Network.requestWillBeSent", onRequest);
      this.client.on("Network.loadingFinished", onDone);
      this.client.on("Network.loadingFailed", onDone);

      checkIdle();
    });
  }

  // ─── Lifecycle ───

  async close(): Promise<void> {
    this.captureConsole(false);
    await this.client.close();
  }
}
