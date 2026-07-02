import { describe, it, expect } from "vitest";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import { lowerInterpolationText } from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";

describe("{expr} text interpolation", () => {
  describe("HTML parsing", () => {
    it("marks a node with {expr} as hasInterpolation and keeps raw text", () => {
      const root = parseHtml(`<screen><text>taps: {count}</text></screen>`);
      const span = root.children![0];
      expect(span.hasInterpolation).toBe(true);
      expect(span.text).toBe("taps: {count}");
    });

    it("leaves plain text unchanged (no hasInterpolation flag)", () => {
      const root = parseHtml(`<screen><text>taps: 0</text></screen>`);
      const span = root.children![0];
      expect(span.hasInterpolation).toBe(false);
      expect(span.text).toBe("taps: 0");
    });

    it("detects multiple interpolations in one text node", () => {
      const root = parseHtml(`<screen><text>a:{x} b:{y}</text></screen>`);
      const span = root.children![0];
      expect(span.hasInterpolation).toBe(true);
      expect(span.text).toBe("a:{x} b:{y}");
    });

    it("ignores braces with no content (literal '{}')", () => {
      // An empty {} is not a valid interpolation; treat as literal text and do
      // not flag. (v1: no {{ }} escape; literal braces are unsupported.)
      const root = parseHtml(`<screen><text>not interp: {}</text></screen>`);
      const span = root.children![0];
      expect(span.hasInterpolation).toBe(false);
    });
  });

  describe("lowerInterpolationText (raw text → snprintf body)", () => {
    it("lowers a single interpolation to a %d snprintf", () => {
      expect(lowerInterpolationText("taps: {count}"))
        .toBe('snprintf(buf, size, "taps: %d", count);');
    });

    it("lowers multiple interpolations to multiple specifiers", () => {
      expect(lowerInterpolationText("a:{x} b:{y}"))
        .toBe('snprintf(buf, size, "a:%d b:%d", x, y);');
    });

    it("lowers an expression interpolation", () => {
      expect(lowerInterpolationText("sum: {a + b}"))
        .toBe('snprintf(buf, size, "sum: %d", a + b);');
    });

    it("preserves literal text around interpolations", () => {
      expect(lowerInterpolationText("Count is {n}!"))
        .toBe('snprintf(buf, size, "Count is %d!", n);');
    });

    it("escapes % in literal text so snprintf doesn't misread it", () => {
      // A literal % in the surrounding text must become %% in the format string.
      expect(lowerInterpolationText("{n}% done"))
        .toBe('snprintf(buf, size, "%d%% done", n);');
    });
  });
});
