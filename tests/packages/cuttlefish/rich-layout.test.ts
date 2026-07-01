import { describe, it, expect } from "vitest";
import { layoutRuns } from "@typecad/cuttlefish/ui/rich-layout";

// measure helpers
const mono = (s: string) => s.length * 10;       // 10px per char (incl. space)
const wide = (s: string) => s.length * 14;       // bold is wider

describe("layoutRuns", () => {
  it("single-style runs wrap on word boundaries to fit maxWidth", () => {
    // text "aaa bbb ccc", 10px/char. maxWidth 30 fits 3 chars per line.
    const runs = [{ text: "aaa bbb ccc", measureText: mono, height: 16, ascent: 14 }];
    const r = layoutRuns(runs, { maxWidth: 30, whiteSpace: "normal" });
    expect(r.lines.length).toBe(3);
    expect(r.lines[0].segments[0].text).toBe("aaa");
    expect(r.lines[1].segments[0].text).toBe("bbb");
    expect(r.lines[2].segments[0].text).toBe("ccc");
  });

  it("a wider (bold) run breaks earlier than mono would predict", () => {
    // "aaaa" mono (40) + space + "bb" wide (28) = 40+10+28=78 > 60 → "bb" wraps.
    const runs = [
      { text: "aaaa", measureText: mono, height: 16, ascent: 14 },
      { text: "bb", measureText: wide, height: 16, ascent: 14 },
    ];
    const r = layoutRuns(runs, { maxWidth: 60, whiteSpace: "normal" });
    // "aaaa" on line 0, "bb" on line 1
    expect(r.lines.length).toBe(2);
    expect(r.lines[0].segments.some(s => s.text.includes("aaaa"))).toBe(true);
    expect(r.lines[1].segments.some(s => s.text.includes("bb"))).toBe(true);
  });

  it("line height is the tallest run on that line", () => {
    const runs = [
      { text: "small ", measureText: mono, height: 16, ascent: 14 },
      { text: "BIG", measureText: (s: string) => s.length * 20, height: 32, ascent: 28 },
    ];
    const r = layoutRuns(runs, { maxWidth: 200, whiteSpace: "normal" });
    expect(r.height).toBe(32);  // one line, BIG is tallest
    expect(r.lines[0].height).toBe(32);
  });

  it("hardBreak forces a line break", () => {
    const runs = [
      { text: "a", measureText: mono, height: 16, ascent: 14 },
      { text: "\n", hardBreak: true, measureText: mono, height: 16, ascent: 14 },
      { text: "b", measureText: mono, height: 16, ascent: 14 },
    ];
    const r = layoutRuns(runs, { maxWidth: 200, whiteSpace: "normal" });
    expect(r.lines.length).toBe(2);
  });

  it("nowrap produces a single line", () => {
    const runs = [{ text: "aaa bbb ccc ddd", measureText: mono, height: 16, ascent: 14 }];
    const r = layoutRuns(runs, { maxWidth: 30, whiteSpace: "nowrap" });
    expect(r.lines.length).toBe(1);
  });

  it("records segment x-offsets (relative to line left) and runIndex for a split run", () => {
    // One run that must split across two lines.
    const runs = [{ text: "aaa bbb", measureText: mono, height: 16, ascent: 14 }];
    const r = layoutRuns(runs, { maxWidth: 30, whiteSpace: "normal" });
    expect(r.lines.length).toBe(2);
    expect(r.lines[0].segments[0].runIndex).toBe(0);
    expect(r.lines[1].segments[0].runIndex).toBe(0);
    expect(r.lines[0].segments[0].x).toBe(0);
    expect(r.lines[1].segments[0].x).toBe(0);
  });

  it("line width sums segment widths (no trailing space)", () => {
    const runs = [{ text: "aaa", measureText: mono, height: 16, ascent: 14 }];
    const r = layoutRuns(runs, { maxWidth: 200, whiteSpace: "normal" });
    expect(r.lines[0].width).toBe(30);  // 3 chars * 10
  });

  it("a single run of adjacent runs on one line keeps their order and offsets", () => {
    const runs = [
      { text: "foo", measureText: mono, height: 16, ascent: 14 },   // width 30
      { text: "bar", measureText: mono, height: 16, ascent: 14 },   // width 30
    ];
    const r = layoutRuns(runs, { maxWidth: 200, whiteSpace: "normal" });
    expect(r.lines.length).toBe(1);
    const segs = r.lines[0].segments;
    expect(segs.length).toBe(2);
    expect(segs[0].text).toBe("foo");
    expect(segs[0].x).toBe(0);
    expect(segs[1].text).toBe("bar");
    expect(segs[1].x).toBe(30);  // after "foo" (no space between adjacent runs here)
  });

  it("splits a single word longer than maxWidth character-by-character", () => {
    const runs = [{ text: "aaaaaaaa", measureText: mono, height: 16, ascent: 14 }];  // 80px
    const r = layoutRuns(runs, { maxWidth: 30, whiteSpace: "normal" });
    // 30px / 10px = 3 chars per line → 8 chars = 3+3+2
    expect(r.lines.length).toBe(3);
    expect(r.lines[0].segments[0].text).toBe("aaa");
    expect(r.lines[2].segments[0].text).toBe("aa");
  });
});
