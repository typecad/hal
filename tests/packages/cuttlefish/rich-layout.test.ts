import { describe, it, expect } from "vitest";
import { layoutRuns } from "@typecad/ui/ui-engine/rich-layout";

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

  it("consecutive hardBreaks reserve height for a blank line", () => {
    const runs = [
      { text: "a", measureText: mono, height: 16, ascent: 14 },
      { text: "\n", hardBreak: true, measureText: mono, height: 16, ascent: 14 },
      { text: "\n", hardBreak: true, measureText: mono, height: 16, ascent: 14 },
      { text: "b", measureText: mono, height: 16, ascent: 14 },
    ];
    const r = layoutRuns(runs, { maxWidth: 200, whiteSpace: "normal" });
    expect(r.lines).toHaveLength(3);
    expect(r.lines[1]).toMatchObject({ width: 0, height: 16, ascent: 14 });
    expect(r.height).toBe(48);
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

  it("wraps within a single run as words accumulate past maxWidth", () => {
    // One run "aaa bb" at 10px/char. "aaa"=30 fits in 50, but "aaa bb"=60
    // overflows, so "bb" must wrap to its own line. This is the worst case for
    // intra-run wrapping: lineW is 0 (the in-progress segment isn't flushed
    // yet), so the candidate-width check must account for the segment already
    // accumulated in `cur` — not subtract it.
    const runs = [{ text: "aaa bb", measureText: mono, height: 16, ascent: 14 }];
    const r = layoutRuns(runs, { maxWidth: 50, whiteSpace: "normal" });
    expect(r.lines.length).toBe(2);
    expect(r.lines[0].segments[0].text).toBe("aaa");
    expect(r.lines[1].segments[0].text).toBe("bb");
    // No laid-out line may exceed maxWidth.
    for (const line of r.lines) expect(line.width).toBeLessThanOrEqual(50);
  });

  it("wraps a long same-run tail after earlier runs fill the line", () => {
    // Mirrors the showcase richMixed case: a short run fills the start of the
    // line, then a longer run whose own words must wrap within the remaining
    // space. "foo"(30) + "aa bbbb"(20/40): "foo aa"=50 fits, "foo aa bbbb" would
    // overflow, so "bbbb" wraps. maxWidth 50.
    const runs = [
      { text: "foo", measureText: mono, height: 16, ascent: 14 },
      { text: "aa bbbb", measureText: mono, height: 16, ascent: 14 },
    ];
    const r = layoutRuns(runs, { maxWidth: 50, whiteSpace: "normal" });
    // Line 0: "foo aa" (30+10+20... actually "foo"+"aa" adjacent: 30+20=50, fits).
    // "bbbb"(40) doesn't fit beside them → wraps to line 1.
    expect(r.lines.length).toBe(2);
    for (const line of r.lines) expect(line.width).toBeLessThanOrEqual(50);
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
