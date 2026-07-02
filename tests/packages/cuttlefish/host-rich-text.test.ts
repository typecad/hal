import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The host (preview) runtime must mirror the C++ rich-text path: a drawRichNode
// branch in drawTextNode, and a run hit-test consulted on tap. These structural
// assertions mirror runtime-header.test.ts (which asserts on the C++ string).
// Full preview/device pixel parity is exercised by the lowering tests + the
// showcase compile + preview.

const src = readFileSync(
  resolve("packages/cuttlefish/src/preview/host-ui-runtime.ts"),
  "utf8",
);

describe("host runtime rich-text parity", () => {
  it("defines a drawRichNode method", () => {
    expect(src).toMatch(/drawRichNode\s*\(/);
  });

  it("drawTextNode branches to drawRichNode when the node has runs", () => {
    expect(src).toMatch(/if\s*\(\s*node\.runs\b[\s\S]*?drawRichNode/);
  });

  it("tints rich-text shadow passes with a foreground override", () => {
    expect(src).toMatch(/drawSegs\s*=\s*\([^)]*fgOverride\?: number/);
    expect(src).toMatch(/const fg = fgOverride \?\? run\.fg/);
    expect(src).toMatch(/textShadowCount > 0[\s\S]*drawSegs\(node\.textShadowOffsetX,\s*node\.textShadowOffsetY,\s*shadowColor\)/);
  });

  it("clips rich-text draw work to the active preview clip before drawing segments", () => {
    expect(src).toMatch(/drawRichNode[\s\S]*getClipRect\(\)/);
    expect(src).toMatch(/drawRichNode[\s\S]*for \(let si = 0; si < rl\.segRun\.length; si\+\+\)/);
    expect(src).toMatch(/drawRichNode[\s\S]*lineBottom <= clip\.y \|\| lineTop >= clip\.y \+ clip\.h[\s\S]*continue/);
    expect(src).toMatch(/drawRichNode[\s\S]*sx \+ rl\.segW\[si\] <= clip\.x \|\| sx >= clip\.x \+ clip\.w[\s\S]*continue/);
  });

  it("defines a run hit-test helper for inline links", () => {
    expect(src).toMatch(/richLinkHit\s*\(/);
  });

  it("the tap path consults the run hit-test and navigates on a link hit", () => {
    expect(src).toMatch(/richLinkHit[\s\S]*?navigate/);
  });
});
