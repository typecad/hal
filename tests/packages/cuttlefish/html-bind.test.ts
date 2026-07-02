import { describe, it, expect } from "vitest";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";

describe("bind:* declarative two-way bindings", () => {
  it("captures bind:text on an input as a signal name", () => {
    const root = parseHtml(`<screen><input id="ssid" bind:text="ssidValue"></input></screen>`);
    const input = root.children![0];
    expect(input.bind).toEqual({ text: "ssidValue" });
  });

  it("captures bind:value on a range", () => {
    const root = parseHtml(`<screen><range id="vol" bind:value="volume"></range></screen>`);
    const range = root.children![0];
    expect(range.bind).toEqual({ value: "volume" });
  });

  it("leaves bind undefined when no bind:* attributes present (byte-identity)", () => {
    const root = parseHtml(`<screen><input id="ssid"></input></screen>`);
    const input = root.children![0];
    expect(input.bind).toBeUndefined();
  });

  it("ignores empty bind:* values", () => {
    const root = parseHtml(`<screen><input id="ssid" bind:text=""></input></screen>`);
    const input = root.children![0];
    expect(input.bind).toBeUndefined();
  });
});
