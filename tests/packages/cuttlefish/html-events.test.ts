import { describe, it, expect } from "vitest";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";

describe("on:* declarative event attributes", () => {
  it("captures on:click as a named function reference", () => {
    const root = parseHtml(`<screen><button id="btn" on:click="saveSettings">Save</button></screen>`);
    const btn = root.children![0];
    expect(btn.events).toEqual({ click: "saveSettings" });
  });

  it("captures on:hold and on:release", () => {
    const root = parseHtml(`<screen><button id="btn" on:hold="onLongPress" on:release="onUp">Hold</button></screen>`);
    const btn = root.children![0];
    expect(btn.events).toEqual({ hold: "onLongPress", release: "onUp" });
  });

  it("captures on:change for range/input", () => {
    const root = parseHtml(`<screen><range id="vol" on:change="updateVolume"></range></screen>`);
    const range = root.children![0];
    expect(range.events).toEqual({ change: "updateVolume" });
  });

  it("leaves events undefined when no on:* attributes are present (byte-identity)", () => {
    const root = parseHtml(`<screen><button id="btn">Plain</button></screen>`);
    const btn = root.children![0];
    expect(btn.events).toBeUndefined();
  });

  it("ignores malformed on: attributes (empty value)", () => {
    // on:click="" is not a valid handler reference; drop it.
    const root = parseHtml(`<screen><button id="btn" on:click="">Save</button></screen>`);
    const btn = root.children![0];
    expect(btn.events).toBeUndefined();
  });

  it("accepts Svelte brace form: on:click={fn}", () => {
    const root = parseHtml(`<screen><button id="btn" on:click={saveSettings}>Save</button></screen>`);
    const btn = root.children![0];
    expect(btn.events).toEqual({ click: "saveSettings" });
  });

  it("brace and quoted forms produce the same value", () => {
    const braceRoot = parseHtml(`<screen><button id="a" on:click={handler}>A</button></screen>`);
    const quotedRoot = parseHtml(`<screen><button id="b" on:click="handler">B</button></screen>`);
    expect(braceRoot.children![0].events).toEqual(quotedRoot.children![0].events);
  });
});
