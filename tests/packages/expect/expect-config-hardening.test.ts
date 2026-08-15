// ---------------------------------------------------------------------------
// @typecad/expect config parser hardening — the harness's AST parser had the
// same silent-drop class as the CLI loader plus two corruptions: quoted keys
// ('target': 'avr') were dropped entirely and hex numerics were parsed with
// parseInt(text, 10) (0x38 → 0).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseConfigAST } from "../../../packages/expect/src/host/config";

function writeConfig(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-expect-"));
  const file = path.join(dir, "cuttlefish.config.ts");
  fs.writeFileSync(file, source, "utf-8");
  return file;
}

describe("parseConfigAST hardening", () => {
  it("accepts quoted-string keys", () => {
    const file = writeConfig(`
      const config = { 'target': 'avr', framework: '@typecad/framework-arduino' };
      export default config;
    `);
    const raw = parseConfigAST(file);
    expect(raw.target).toBe("avr");
    expect(raw.framework).toBe("@typecad/framework-arduino");
  });

  it("parses hex and negative numerics via Number() (not parseInt base 10)", () => {
    const file = writeConfig(`
      const config = {
        test: { baudRate: 0x38, timeout: -1 },
        console: { baudRate: 115200 },
      };
      export default config;
    `);
    const raw = parseConfigAST(file);
    expect(raw.test?.baudRate).toBe(0x38);
    expect(raw.test?.timeout).toBe(-1);
    expect(raw.console?.baudRate).toBe(115200);
  });

  it("extracts test.verbose (previously declared but never read)", () => {
    const file = writeConfig(`
      const config = { test: { verbose: true } };
      export default config;
    `);
    const raw = parseConfigAST(file);
    expect(raw.test?.verbose).toBe(true);
  });

  it("unwraps satisfies/as-cast on the config object", () => {
    const file = writeConfig(`
      const config = { target: 'esp32' } satisfies Record<string, unknown>;
      export default config;
    `);
    const raw = parseConfigAST(file);
    expect(raw.target).toBe("esp32");
  });

  it("accepts no-substitution template literals as strings", () => {
    const file = writeConfig(`
      const config = { target: \`avr\` };
      export default config;
    `);
    const raw = parseConfigAST(file);
    expect(raw.target).toBe("avr");
  });
});
