import { describe, it, expect } from "vitest";
import { splitUiFile } from "../../../packages/ui/src/ui-engine/ui-file-splitter";

describe("splitUiFile (.ui single-file component)", () => {
  it("extracts script, style, and template from a .ui file", () => {
    const src = [
      "<script>",
      "export const count = ui.signal(0);",
      "export function incrementTaps() { count.set(count() + 1); }",
      "</script>",
      "<style>",
      "#formBtn { background: #3399ff; }",
      "</style>",
      "<screen id=\"forms\">",
      "  <button id=\"formBtn\" on:click=\"incrementTaps\">Tap</button>",
      "  <span>taps: {count}</span>",
      "</screen>",
    ].join("\n");

    const result = splitUiFile(src);
    expect(result.script).toContain("export const count");
    expect(result.script).toContain("export function incrementTaps");
    expect(result.style).toContain("#formBtn { background: #3399ff; }");
    expect(result.html).toContain("<screen id=\"forms\">");
    expect(result.html).toContain("<button id=\"formBtn\"");
    expect(result.html).not.toContain("<script>");
    expect(result.html).not.toContain("<style>");
  });

  it("handles a file with only a template (no script/style)", () => {
    const src = "<screen id=\"home\"><text>Hello</text></screen>";
    const result = splitUiFile(src);
    expect(result.script).toBe("");
    expect(result.style).toBe("");
    expect(result.html).toContain("<screen");
  });

  it("handles multiple style blocks (concatenated)", () => {
    const src = [
      "<style>#a { color: red; }</style>",
      "<style>#b { color: blue; }</style>",
      "<screen><text>Hi</text></screen>",
    ].join("\n");
    const result = splitUiFile(src);
    expect(result.style).toContain("#a");
    expect(result.style).toContain("#b");
  });

  it("preserves the order of script and template relative to each other", () => {
    // Template before script (Svelte allows any order).
    const src = [
      "<screen><text>Hi</text></screen>",
      "<script>export const x = 1;</script>",
    ].join("\n");
    const result = splitUiFile(src);
    expect(result.script).toContain("export const x");
    expect(result.html).toContain("<screen>");
  });
});
