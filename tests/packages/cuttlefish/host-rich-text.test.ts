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

  it("defines a run hit-test helper for inline links", () => {
    expect(src).toMatch(/richLinkHit\s*\(/);
  });

  it("the tap path consults the run hit-test and navigates on a link hit", () => {
    expect(src).toMatch(/richLinkHit[\s\S]*?navigate/);
  });
});
