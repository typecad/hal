import { describe, it, expect } from "vitest";
import { renderArxml } from "../../../../packages/cuttlefish/src/emit/compliance/arxml-writer";
import { ComplianceContext } from "../../../../packages/cuttlefish/src/emit/compliance/compliance-context";

describe("arxml-writer", () => {
  it("renders well-formed ARXML XML projecting the ledger", () => {
    const ctx = new ComplianceContext("strict");
    ctx.emitWithDeviation(
      "Adafruit_ST7796S __tc_display(...);",
      "M3-2-1",
      "Adafruit HAL global.",
      42,
    );
    const arxml = renderArxml(ctx, "main.cpp");
    expect(arxml).toContain("<?xml");
    expect(arxml).toContain("<AUTOSAR");
    expect(arxml).toContain("M3-2-1");
    expect(arxml).toContain("Adafruit HAL global.");
    expect(arxml).toContain('ARTIFACT="main.cpp"');
  });

  it("escapes XML special characters in justifications and snippets", () => {
    const ctx = new ComplianceContext("strict");
    ctx.emitWithDeviation(
      'foo < bar && baz > "qux";',
      "M5-0-7",
      'Uses < and > and & characters.',
      1,
    );
    const arxml = renderArxml(ctx, "main.cpp");
    // The entity-encoded forms must be present...
    expect(arxml).toContain("&lt;");
    expect(arxml).toContain("&gt;");
    expect(arxml).toContain("&amp;");
    expect(arxml).toContain("&quot;");
    // ...and after un-escaping, the original text is recoverable. Easiest
    // correct check: replace entities back and confirm no raw special chars
    // remain in the deviation text content (between tags).
    const unescaped = arxml
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    // After un-escaping, the only < and > should be the XML tags themselves
    // (which start with '<' followed by a letter, '/', or '?').
    // A raw '<' in text content would appear as '< ' (space after) or similar.
    const stripped = unescaped.replace(/<\/?[A-Za-z?][^>]*>/g, "").replace(/[A-Z-]+="[^"]*"/g, "");
    // Whitespace and the original text content should be all that's left —
    // no stray tag-like constructs.
    expect(stripped).not.toMatch(/<\/?[a-zA-Z]/);
  });

  it("renders an empty AUTOSAR element when there are no deviations", () => {
    const ctx = new ComplianceContext("warn");
    const arxml = renderArxml(ctx, "main.cpp");
    expect(arxml).toContain("<AUTOSAR");
    expect(arxml).not.toContain("<DEVIATION");
  });

  it("projects the source-traceability field when present", () => {
    const ctx = new ComplianceContext("strict");
    ctx.emitWithDeviation(
      "Adafruit_ST7796S __tc_display(...);",
      "M3-2-1",
      "Adafruit HAL global.",
      42,
      "source",
      { tsFile: "src/hardware/display.ts", tsLine: 12, kind: "hal-instance" },
    );
    const arxml = renderArxml(ctx, "main.cpp");
    expect(arxml).toContain('TS-FILE="src/hardware/display.ts"');
    expect(arxml).toContain('TS-LINE="12"');
    expect(arxml).toContain('KIND="hal-instance"');
  });
});
