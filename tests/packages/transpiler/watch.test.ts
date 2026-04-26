// ---------------------------------------------------------------------------
// Tests for the file watcher module (packages/transpiler/src/watch.ts)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import path from "node:path";
import { discoverWatchDirs, isRelevantChange } from "../../../packages/transpiler/src/watch";
import { parseCommandLine } from "../../../packages/transpiler/src/utils/cli";

describe("watch", () => {
  describe("discoverWatchDirs", () => {
    it("returns the entry file's directory", () => {
      const dirs = discoverWatchDirs("/project/src/sketch.ts");
      expect(dirs).toHaveLength(1);
      expect(dirs[0]).toBe(path.resolve("/project/src"));
    });

    it("includes config directory when config is in a different directory", () => {
      const dirs = discoverWatchDirs(
        "/project/src/sketch.ts",
        "/project/typecode.config.ts",
      );
      expect(dirs).toHaveLength(2);
      expect(dirs).toContain(path.resolve("/project/src"));
      expect(dirs).toContain(path.resolve("/project"));
    });

    it("deduplicates when entry and config are in the same directory", () => {
      const dirs = discoverWatchDirs(
        "/project/sketch.ts",
        "/project/typecode.config.ts",
      );
      expect(dirs).toHaveLength(1);
      expect(dirs[0]).toBe(path.resolve("/project"));
    });
  });

  describe("isRelevantChange", () => {
    const entryDir = path.resolve("/project/src");

    it("accepts .ts file changes", () => {
      expect(isRelevantChange("/project/src/sketch.ts", entryDir)).toBe(true);
    });

    it("accepts .ts file in subdirectory", () => {
      expect(isRelevantChange("/project/src/lib/sensor.ts", entryDir)).toBe(true);
    });

    it("rejects .d.ts declaration files", () => {
      expect(isRelevantChange("/project/src/types.d.ts", entryDir)).toBe(false);
    });

    it("rejects non-.ts files", () => {
      expect(isRelevantChange("/project/src/data.json", entryDir)).toBe(false);
      expect(isRelevantChange("/project/src/style.css", entryDir)).toBe(false);
    });

    it("rejects node_modules files", () => {
      expect(
        isRelevantChange("/project/node_modules/@typecode/core/src/index.ts", entryDir),
      ).toBe(false);
    });

    it("accepts typecode.config.ts changes", () => {
      const configPath = "/project/typecode.config.ts";
      expect(
        isRelevantChange("/project/typecode.config.ts", entryDir, configPath),
      ).toBe(true);
    });

    it("rejects unrelated config file changes", () => {
      expect(
        isRelevantChange("/project/tsconfig.json", entryDir, "/project/typecode.config.ts"),
      ).toBe(false);
    });

    it("rejects .tsx files... actually .tsx is not .ts so it should be rejected", () => {
      // .tsx has extension ".tsx" not ".ts" so it won't match ext === ".ts"
      expect(isRelevantChange("/project/src/App.tsx", entryDir)).toBe(false);
    });
  });

  describe("watch flag parsing", () => {

    it("parses --watch flag", () => {
      const result = parseCommandLine(["node", "typecode", "sketch.ts", "--watch"]);
      expect(result).toMatchObject({ watch: true, command: "default" });
    });

    it("parses -w short flag", () => {
      const result = parseCommandLine(["node", "typecode", "sketch.ts", "-w"]);
      expect(result).toMatchObject({ watch: true, command: "default" });
    });

    it("defaults watch to false", () => {
      const result = parseCommandLine(["node", "typecode", "sketch.ts"]);
      expect(result).toMatchObject({ watch: false, command: "default" });
    });

    it("rejects --watch --monitor combination", () => {
      expect(() =>
        parseCommandLine(["node", "typecode", "sketch.ts", "--watch", "--monitor", "--port", "COM4"]),
      ).toThrow("--watch and --monitor cannot be used together");
    });

    it("allows --watch --compile", () => {
      const result = parseCommandLine([
        "node", "typecode", "sketch.ts", "--watch", "--compile",
        "--fqbn", "arduino:avr:uno",
      ]);
      expect(result).toMatchObject({ watch: true, compile: true });
    });

    it("allows --watch --compile --upload", () => {
      const result = parseCommandLine([
        "node", "typecode", "sketch.ts", "--watch", "--compile", "--upload",
        "--fqbn", "arduino:avr:uno", "--port", "COM4",
      ]);
      expect(result).toMatchObject({ watch: true, compile: true, upload: true });
    });
  });
});
