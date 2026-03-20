import type { CDPClient } from "./cdp";
import type { Clip, KeyDef } from "./types";

export const KEY_MAP: Record<string, KeyDef> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  insert: { key: "Insert", code: "Insert", keyCode: 45 },
  f1: { key: "F1", code: "F1", keyCode: 112 },
  f2: { key: "F2", code: "F2", keyCode: 113 },
  f3: { key: "F3", code: "F3", keyCode: 114 },
  f4: { key: "F4", code: "F4", keyCode: 115 },
  f5: { key: "F5", code: "F5", keyCode: 116 },
  f6: { key: "F6", code: "F6", keyCode: 117 },
  f7: { key: "F7", code: "F7", keyCode: 118 },
  f8: { key: "F8", code: "F8", keyCode: 119 },
  f9: { key: "F9", code: "F9", keyCode: 120 },
  f10: { key: "F10", code: "F10", keyCode: 121 },
  f11: { key: "F11", code: "F11", keyCode: 122 },
  f12: { key: "F12", code: "F12", keyCode: 123 }
};

const MOD_MAP: Record<string, number> = {
  alt: 1,
  control: 2,
  ctrl: 2,
  meta: 4,
  command: 4,
  cmd: 4,
  shift: 8
};

export function parseKeyCombo(combo: string): { keyDef: KeyDef; modifiers: number } {
  const parts = combo.split("+");
  let modifiers = 0;
  let keyPart = "";
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (MOD_MAP[lower] != null) modifiers |= MOD_MAP[lower];
    else keyPart = p;
  }
  const lower = keyPart.toLowerCase();
  if (KEY_MAP[lower]) return { keyDef: KEY_MAP[lower], modifiers };
  const upper = keyPart.toUpperCase();
  return {
    keyDef: {
      key: keyPart,
      code: keyPart.length === 1 ? `Key${upper}` : keyPart,
      keyCode: upper.charCodeAt(0),
      text: keyPart
    },
    modifiers
  };
}

export async function pressKey(client: CDPClient, combo: string): Promise<void> {
  const { keyDef, modifiers } = parseKeyCombo(combo);
  await client.call("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    modifiers,
    windowsVirtualKeyCode: keyDef.keyCode,
    nativeVirtualKeyCode: keyDef.keyCode,
    key: keyDef.key,
    code: keyDef.code,
    text: keyDef.text
  });
  const hasModifier = modifiers & (2 | 4); // control or meta suppress char events
  if (keyDef.text && !hasModifier) {
    await client.call("Input.dispatchKeyEvent", {
      type: "char",
      modifiers,
      text: keyDef.text,
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode
    });
  }
  await client.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    modifiers,
    windowsVirtualKeyCode: keyDef.keyCode,
    nativeVirtualKeyCode: keyDef.keyCode,
    key: keyDef.key,
    code: keyDef.code
  });
}

export async function clickAt(client: CDPClient, x: number, y: number): Promise<void> {
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

export async function dblClickAt(client: CDPClient, x: number, y: number): Promise<void> {
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 2 });
  await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 2 });
}

export async function hoverAt(client: CDPClient, x: number, y: number): Promise<void> {
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}

export async function insertText(client: CDPClient, text: string): Promise<void> {
  await client.call("Input.insertText", { text });
}

export async function captureScreenshot(client: CDPClient, clip?: Clip): Promise<string> {
  const params: Record<string, unknown> = { format: "png" };
  if (clip) params.clip = { ...clip, scale: 1 };
  const r = await client.call("Page.captureScreenshot", params, 15_000);
  return r.data as string;
}
