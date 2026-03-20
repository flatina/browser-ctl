# @flatina/browser-ctl

- Zero-dependency browser automation **package** built on raw WebSocket CDP.
  - not a cli. Designed to be embedded in other tools (e.g. flmux).
- Inspired by https://github.com/vercel-labs/agent-browser
- Inspired by https://github.com/Ataraxy-Labs/agent-electrobun

## Design

- **Zero dependencies** — only Bun built-ins + WebSocket
- **CDPClient injection** — both WebView and CDP support
- **Single-target** — one `Browser` per page; multi-tab is the caller's concern

## Core Concept: @ref

`snapshot` scans the accessibility tree, assigns `@e1`, `@e2`, ... references to interactive elements,
then commands like `click("@e1")` resolve the ref to a real DOM node via `backendDOMNodeId`.

```
@e1 button "Sign In"
@e2 textbox "Email" value="user@example.com"
@e3 link "Forgot password?"
@e4 checkbox "Remember me" [checked]
```

## Usage

```ts
import { Browser, CDPClient, discoverTargets, findTarget } from "@flatina/browser-ctl";

const targets = await discoverTargets("http://127.0.0.1:9222");
const target = findTarget(targets, t => t.url.startsWith("http"));
const client = await CDPClient.connect(target.webSocketDebuggerUrl);
const browser = new Browser(client, target.url, "/tmp/refs.json");

// Snapshot (with optional filtering — CSS or xpath=)
console.log(await browser.snapshot({ compact: true, selector: "#main" }));
console.log(await browser.snapshot({ selector: "xpath=//form[@id='login']" }));

// Interact
await browser.fill("@e2", "user@example.com");
await browser.click("@e1");
await browser.waitForLoad();
await browser.wait("xpath=//div[@class='success']");

// Query
const url = await browser.getUrl();
const visible = await browser.isVisible("@e3");

// Console capture
browser.captureConsole();
await browser.eval("fetch('/api')");
console.log(browser.logs()); // [{ level: "log", text: "...", timestamp }]

await browser.close();
```

## API

| Category | Methods |
|----------|---------|
| Snapshot | `snapshot(options?)` with `compact`, `selector` (CSS or `xpath=`), `roles` filters |
| Navigation | `navigate` `back` `forward` `reload` |
| Interaction | `click` `dblclick` `hover` `focus` `fill` `type` `press` `select` `check` `scroll` |
| Query | `getText` `getHtml` `getValue` `getAttr` `getBox` `getUrl` `getTitle` |
| State | `isVisible` `isEnabled` `isChecked` |
| Page | `screenshot` `pdf` `eval` |
| Dialog | `dialog("accept" \| "dismiss")` |
| Console | `captureConsole` `logs` |
| Wait | `wait(ms \| selector \| xpath=...)` `waitForLoad` `waitForNetworkIdle` |

## CDP Events

`CDPClient` exposes a typed event system with `on`/`off`/`once`:

```ts
client.on("Page.javascriptDialogOpening", (e) => {
  // e.type: "alert" | "confirm" | "prompt" | "beforeunload"
  browser.dialog("accept");
});

await client.once("Page.loadEventFired"); // Promise-based
```

## License

MIT License
