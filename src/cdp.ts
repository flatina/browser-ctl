import type { CDPEventMap, CDPTarget } from "./types";

type EventHandler = (params: any) => void;

export class CDPClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private listeners = new Map<string, Set<EventHandler>>();
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private ready: Promise<void>;

  private constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("CDP WebSocket connection failed"));
    });
    this.ws.onmessage = (event) => {
      let msg: any;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.id != null) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
          else p.resolve(msg.result);
        }
      }
      if (msg.method) {
        const handlers = this.listeners.get(msg.method);
        if (handlers) for (const h of [...handlers]) h(msg.params);
      }
    };
    this.ws.onclose = () => {
      if (this.keepalive) {
        clearInterval(this.keepalive);
        this.keepalive = null;
      }
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("CDP WebSocket closed unexpectedly"));
      }
      this.pending.clear();
      // Notify event listeners so once() waiters reject immediately
      const closeHandlers = this.listeners.get("__close__");
      if (closeHandlers) for (const h of [...closeHandlers]) h({});
      this.listeners.clear();
    };
  }

  static async connect(wsUrl: string, domains = ["Runtime", "Page", "DOM", "Accessibility"]): Promise<CDPClient> {
    const client = new CDPClient(wsUrl);
    await client.ready;
    for (const domain of domains) {
      try {
        await client.call(`${domain}.enable`, {}, 3000);
      } catch {
        /* ignore */
      }
    }
    if (domains.includes("DOM")) {
      try {
        await client.call("DOM.getDocument", { depth: -1 }, 5000);
      } catch {
        /* ignore */
      }
    }
    client.keepalive = setInterval(() => {
      try {
        // id=0 is never used by normal calls (nextId starts at 1), response is silently dropped
        client.ws.send('{"id":0,"method":"Browser.getVersion"}');
      } catch {
        /* connection closing */
      }
    }, 30_000);
    return client;
  }

  async call<T = any>(method: string, params: Record<string, any> = {}, timeoutMs = 15_000): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out (${timeoutMs}ms)`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evalJS(expression: string): Promise<any> {
    const r = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
    return r.result?.value;
  }

  // ─── Event System (typed overloads for known events, fallback for arbitrary) ───

  on<E extends keyof CDPEventMap>(event: E, handler: (params: CDPEventMap[E]) => void): void;
  on(event: string, handler: EventHandler): void;
  on(event: string, handler: EventHandler): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
  }

  off<E extends keyof CDPEventMap>(event: E, handler: (params: CDPEventMap[E]) => void): void;
  off(event: string, handler: EventHandler): void;
  off(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  once<E extends keyof CDPEventMap>(event: E, timeoutMs?: number): Promise<CDPEventMap[E]>;
  once(event: string, timeoutMs?: number): Promise<unknown>;
  once(event: string, timeoutMs = 30_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.off(event, handler);
        this.off("__close__", onClose);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for event: ${event}`));
      }, timeoutMs);
      const handler = (params: unknown) => {
        cleanup();
        resolve(params);
      };
      const onClose = () => {
        cleanup();
        reject(new Error("CDP WebSocket closed while waiting for event"));
      };
      this.on(event, handler);
      this.on("__close__", onClose);
    });
  }

  async close(): Promise<void> {
    if (this.keepalive) {
      clearInterval(this.keepalive);
      this.keepalive = null;
    }
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("CDPClient closed"));
    }
    this.pending.clear();
    this.listeners.clear();
    this.ws.close();
  }
}

export async function discoverTargets(cdpBase: string): Promise<CDPTarget[]> {
  const res = await fetch(`${cdpBase}/json/list`);
  return (await res.json()) as CDPTarget[];
}

export function findTarget(targets: CDPTarget[], predicate: (t: CDPTarget) => boolean): CDPTarget | undefined {
  return targets.find((t) => t.type === "page" && predicate(t));
}

