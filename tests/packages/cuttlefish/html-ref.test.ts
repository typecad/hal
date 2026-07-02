import { describe, it, expect } from "vitest";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";

describe("ref attribute (TS handle separate from CSS id)", () => {
  it("captures ref when present", () => {
    const root = parseHtml(`<screen><button id="primaryButton" ref="saveButton">Save</button></screen>`);
    const btn = root.children![0];
    expect(btn.id).toBe("primaryButton");
    expect(btn.ref).toBe("saveButton");
  });

  it("leaves ref undefined when absent (backward-compat fallback to id)", () => {
    const root = parseHtml(`<screen><button id="plainBtn">Save</button></screen>`);
    const btn = root.children![0];
    expect(btn.id).toBe("plainBtn");
    expect(btn.ref).toBeUndefined();
  });

  it("captures ref even without an id", () => {
    const root = parseHtml(`<screen><button ref="anonHandler">Save</button></screen>`);
    const btn = root.children![0];
    expect(btn.id).toBeUndefined();
    expect(btn.ref).toBe("anonHandler");
  });
});
