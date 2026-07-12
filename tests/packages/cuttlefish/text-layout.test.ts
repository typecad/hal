import { describe, expect, it } from "vitest";
import { layoutText } from "@typecad/ui/ui-engine/text-layout";

const measure = (text: string) => text.length * 10;

describe("text layout", () => {
  it("wraps at word boundaries within a max width", () => {
    const layout = layoutText("alpha beta gamma", {
      maxWidth: 60,
      whiteSpace: "normal",
      lineHeight: 12,
      measureText: measure,
    });

    expect(layout.lines.map((line) => line.text)).toEqual(["alpha", "beta", "gamma"]);
    expect(layout.width).toBe(50);
    expect(layout.height).toBe(36);
  });

  it("splits long words so they cannot overflow indefinitely", () => {
    const layout = layoutText("abcdefgh", {
      maxWidth: 30,
      whiteSpace: "normal",
      lineHeight: 10,
      measureText: measure,
    });

    expect(layout.lines.map((line) => line.text)).toEqual(["abc", "def", "gh"]);
  });

  it("preserves hard lines for pre-line but still wraps each hard line", () => {
    const layout = layoutText("one two\nthree four", {
      maxWidth: 50,
      whiteSpace: "pre-line",
      lineHeight: 9,
      measureText: measure,
    });

    expect(layout.lines.map((line) => line.text)).toEqual(["one", "two", "three", "four"]);
    expect(layout.height).toBe(36);
  });

  it("does not wrap nowrap text", () => {
    const layout = layoutText("alpha beta gamma", {
      maxWidth: 40,
      whiteSpace: "nowrap",
      lineHeight: 12,
      measureText: measure,
    });

    expect(layout.lines).toHaveLength(1);
    expect(layout.width).toBe(160);
  });
});

