// ---------------------------------------------------------------------------
// ts-patterns-gallery.test.ts — differential execution of the gallery.
//
// demos/ts-patterns/src/main.ts (the whole Zephyr gallery) and
// demos/ts-patterns/src/array-methods.ts (the callback-method coverage that
// firmware targets ban — see the module header) are deterministic programs
// printing through the one-line `report` seam. This test runs each twice —
// as Node-judged TypeScript (the JS-semantics oracle) and as
// transpiled→host-g++→native — and requires identical stdout. A mismatch is
// a transpiler semantic bug, the same contract differential.test.ts
// enforces for its inline corpus.
//
// The seam swap is mechanical: the source's
// `import { report } from './report';` becomes
// `declare function report(line: string): void;` so the native side binds
// the harness's report shim and nothing else is target-specific.
// ---------------------------------------------------------------------------

import { describe, it } from "vitest";
import * as fs from "node:fs";
import * as path from "path";
import { runNode, runNative } from "./differential-corpus";

const GALLERY_DIR = path.join("demos", "ts-patterns", "src");

interface GalleryCase {
  tag: string;
  file: string;
}

const CASES: GalleryCase[] = [
  { tag: "main", file: "main.ts" },
  { tag: "array-methods", file: "array-methods.ts" },
];

const IMPORT_LINE = "import { report } from './report';";
const SEAM = "declare function report(line: string): void;";

function moduleSource(file: string): string {
  const src = fs.readFileSync(path.join(process.cwd(), GALLERY_DIR, file), "utf8");
  if (!src.includes(IMPORT_LINE)) {
    throw new Error(`${file} must import the report seam verbatim: ${IMPORT_LINE}`);
  }
  return src.replace(IMPORT_LINE, SEAM);
}

describe("ts-patterns gallery — Node oracle vs transpiled native", () => {
  for (const { tag, file } of CASES) {
    it(`${tag} produces identical output on both sides`, () => {
      const ts = moduleSource(file);
      const dir = path.join(".build", "ts-patterns", tag);
      fs.mkdirSync(dir, { recursive: true });
      const nodeOut = runNode(ts, dir);
      // The Windows C runtime translates "\n" to "\r\n" in stdio text mode;
      // compare line content, not the platform's newline.
      const nativeOut = runNative(ts, dir, tag).replace(/\r\n/g, "\n");
      if (nodeOut !== nativeOut) {
        throw new Error(
          `output mismatch in ${tag}:\n--- node ---\n${nodeOut}\n--- native ---\n${nativeOut}`,
        );
      }
    }, 300000);
  }
});
