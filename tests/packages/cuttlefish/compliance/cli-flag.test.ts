import { describe, it, expect } from "vitest";
import { parseCommandLine } from "../../../../packages/cuttlefish/src/utils/cli";
import type { CommandLineOptions } from "../../../../packages/cuttlefish/src/types";

describe("--autosar CLI flag parsing", () => {
  function buildOpts(argv: string[]): CommandLineOptions {
    const opts = parseCommandLine(argv);
    if (typeof opts === "object" && "emitMode" in opts) {
      return opts as CommandLineOptions;
    }
    throw new Error("not a build options object");
  }

  it("parses --autosar=strict (= syntax)", () => {
    const opts = buildOpts(["node", "cuttlefish", "build", "x.ts", "--autosar=strict"]);
    expect(opts.autosar).toBe("strict");
  });

  it("parses --autosar=warn", () => {
    const opts = buildOpts(["node", "cuttlefish", "build", "x.ts", "--autosar=warn"]);
    expect(opts.autosar).toBe("warn");
  });

  it("parses --autosar=off explicitly", () => {
    const opts = buildOpts(["node", "cuttlefish", "build", "x.ts", "--autosar=off"]);
    expect(opts.autosar).toBe("off");
  });

  it("bare --autosar means strict", () => {
    const opts = buildOpts(["node", "cuttlefish", "build", "x.ts", "--autosar"]);
    expect(opts.autosar).toBe("strict");
  });

  it("no --autosar leaves it undefined (emitter treats undefined as off)", () => {
    const opts = buildOpts(["node", "cuttlefish", "build", "x.ts"]);
    expect(opts.autosar).toBeUndefined();
  });

  it("rejects an unknown value with a helpful error", () => {
    expect(() =>
      parseCommandLine(["node", "cuttlefish", "build", "x.ts", "--autosar=garbage"]),
    ).toThrow(/must be one of: strict, warn, off/);
  });
});
