// ---------------------------------------------------------------------------
// Placeholder⇔diagnostic pairing invariant — every placeholder comment the
// transpiler can emit must be paired with a diagnostic, so no failure mode
// is silent. Round 2's Async.yield emitted `/* unhandled hal-op: raw */`
// with no diagnostic; the pairing here makes that class a test failure.
//
// Mechanism: scan the engine sources for lines producing a placeholder
// comment (a C++ comment template whose text marks an unhandled/unsupported
// lowering). Each must have a diagnostic push within the surrounding lines
// or sit in the reviewed allowlist with a reason.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "packages/cuttlefish/src");

// Placeholder-producer patterns: comment templates marking an unhandled or
// unsupported lowering result.
const PLACEHOLDER_PATTERNS = [
  /\/\* unhandled /,
  /\/\* \$\{[^}]*\} unsupported \*\//,
  /0 \/\* [a-zA-Z.$ ]+ unsupported \*\//,
  /false \/\* [a-zA-Z.$ ]+ unsupported \*\//,
];

// Lines reviewed as intentionally unpaired, with reasons.
const ALLOWLIST: Record<string, string> = {
  "output-finalizer.ts: void unhandled_exception()": "C++ stdexcept shim text, not a placeholder marker",
  "unhandled awa": "async-state-machine netWaitInfo fallback — routed through onUnsupportedAwait, which pushes the await-unsupported-call error in setup.ts (indirect pairing)",
};

describe("placeholder⇔diagnostic pairing invariant", () => {
  it("every placeholder producer emits a diagnostic (or is allowlisted)", () => {
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const text = fs.readFileSync(full, "utf8");
        if (entry.name.endsWith(".test.ts")) continue;
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!PLACEHOLDER_PATTERNS.some(p => p.test(line))) continue;
          if (line.trimStart().startsWith("//")) continue;
          if (Object.entries(ALLOWLIST).some(([k]) => line.includes(k.split(": ")[1] ?? k))) continue;
          // Diagnostic push within ±12 lines (the pairing is local by design).
          const window = lines.slice(Math.max(0, i - 12), i + 13).join("\n");
          const paired = /diagnostics\.push|_diagnostics\.push|pushDiagnostic|makeDiagnostic/.test(window);
          if (!paired) {
            offenders.push(`${path.relative(ROOT, full)}:${i + 1}: ${line.trim().slice(0, 100)}`);
          }
        }
      }
    };
    walk(SRC);

    expect(offenders).toEqual([]);
  });
});
