import { describe, expect, test } from "bun:test";
import { parseKeyCombo, pressKey } from "./input";

// ─── parseKeyCombo ───

describe("parseKeyCombo", () => {
  test("special keys from KEY_MAP", () => {
    expect(parseKeyCombo("enter")).toEqual({
      keyDef: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
      modifiers: 0
    });
    expect(parseKeyCombo("Escape").keyDef.key).toBe("Escape");
    expect(parseKeyCombo("Tab").keyDef.keyCode).toBe(9);
    expect(parseKeyCombo("space").keyDef.text).toBe(" ");
  });

  test("F-keys", () => {
    expect(parseKeyCombo("F1").keyDef).toEqual({ key: "F1", code: "F1", keyCode: 112 });
    expect(parseKeyCombo("f12").keyDef.keyCode).toBe(123);
  });

  test("navigation keys", () => {
    expect(parseKeyCombo("pageup").keyDef.keyCode).toBe(33);
    expect(parseKeyCombo("pagedown").keyDef.keyCode).toBe(34);
    expect(parseKeyCombo("insert").keyDef.keyCode).toBe(45);
  });

  test("single letter — code = Key{upper}, keyCode = ASCII", () => {
    const { keyDef, modifiers } = parseKeyCombo("a");
    expect(keyDef.key).toBe("a");
    expect(keyDef.code).toBe("KeyA");
    expect(keyDef.keyCode).toBe(65);
    expect(keyDef.text).toBe("a");
    expect(modifiers).toBe(0);
  });

  test("digit — code = Key{digit}, keyCode = ASCII of digit", () => {
    const { keyDef } = parseKeyCombo("1");
    expect(keyDef.key).toBe("1");
    expect(keyDef.keyCode).toBe(49); // "1".charCodeAt(0)
    expect(keyDef.text).toBe("1");
  });

  test("punctuation — single char fallback", () => {
    const { keyDef } = parseKeyCombo("/");
    expect(keyDef.key).toBe("/");
    expect(keyDef.text).toBe("/");
    // code for single char is Key + upper, which is "Key/" — quirky but consistent
    expect(keyDef.code).toBe("Key/");
  });

  test("single modifier — ctrl", () => {
    const { modifiers } = parseKeyCombo("ctrl+a");
    expect(modifiers).toBe(2);
  });

  test("multiple modifiers — ctrl+shift", () => {
    const { keyDef, modifiers } = parseKeyCombo("ctrl+shift+a");
    expect(modifiers).toBe(2 | 8); // 10
    expect(keyDef.key).toBe("a");
  });

  test("modifier aliases — cmd = meta", () => {
    expect(parseKeyCombo("cmd+c").modifiers).toBe(4);
    expect(parseKeyCombo("command+c").modifiers).toBe(4);
    expect(parseKeyCombo("meta+c").modifiers).toBe(4);
  });

  test("modifier + special key", () => {
    const { keyDef, modifiers } = parseKeyCombo("ctrl+enter");
    expect(keyDef.key).toBe("Enter");
    expect(modifiers).toBe(2);
  });

  test("case insensitive for modifiers and KEY_MAP", () => {
    expect(parseKeyCombo("CTRL+ENTER").modifiers).toBe(2);
    expect(parseKeyCombo("CTRL+ENTER").keyDef.key).toBe("Enter");
  });
});

// ─── pressKey with mock client ───

describe("pressKey", () => {
  function mockClient() {
    const calls: Array<{ method: string; params: any }> = [];
    return {
      calls,
      call: async (method: string, params: any = {}) => {
        calls.push({ method, params });
        return {};
      }
    } as any;
  }

  test("plain key sends rawKeyDown + char + keyUp", async () => {
    const client = mockClient();
    await pressKey(client, "a");
    const types = client.calls.map((c: any) => c.params.type);
    expect(types).toEqual(["rawKeyDown", "char", "keyUp"]);
  });

  test("ctrl+key suppresses char event", async () => {
    const client = mockClient();
    await pressKey(client, "ctrl+c");
    const types = client.calls.map((c: any) => c.params.type);
    expect(types).toEqual(["rawKeyDown", "keyUp"]);
    expect(client.calls[0].params.modifiers).toBe(2);
  });

  test("meta+key suppresses char event", async () => {
    const client = mockClient();
    await pressKey(client, "cmd+a");
    const types = client.calls.map((c: any) => c.params.type);
    expect(types).toEqual(["rawKeyDown", "keyUp"]);
  });

  test("shift+key still sends char event (not a control modifier)", async () => {
    const client = mockClient();
    await pressKey(client, "shift+a");
    const types = client.calls.map((c: any) => c.params.type);
    expect(types).toEqual(["rawKeyDown", "char", "keyUp"]);
  });

  test("special key without text skips char event", async () => {
    const client = mockClient();
    await pressKey(client, "escape");
    const types = client.calls.map((c: any) => c.params.type);
    expect(types).toEqual(["rawKeyDown", "keyUp"]);
  });
});
