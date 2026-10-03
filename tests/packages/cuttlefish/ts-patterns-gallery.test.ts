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
  let out = src.replace(IMPORT_LINE, SEAM);
  for (const file of COMPANIONS) {
    out = out.replaceAll(`'./${file.replace(/\.ts$/, "")}'`, `'./${file.replace(/\.ts$/, ".mjs")}'`);
  }
  return out;
}

/** Companion modules that do NOT use the seam: transpile with the real
 *  compiler (the same strip the main source gets) and write as .mjs so
 *  Node ESM resolves the relative import. The main case source's
 *  './helpers' specifier is rewritten to './helpers.mjs'. */
const COMPANIONS = ["helpers.ts"];
function writeCompanions(dir: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tsCompiler = require("typescript");
  for (const file of COMPANIONS) {
    const src = fs.readFileSync(path.join(process.cwd(), GALLERY_DIR, file), "utf8");
    const js = tsCompiler.transpileModule(src, {
      compilerOptions: { target: tsCompiler.ScriptTarget.ES2022 },
    }).outputText;
    fs.writeFileSync(path.join(dir, file.replace(/\.ts$/, ".mjs")), js);
  }
}

describe("ts-patterns gallery — Node oracle vs transpiled native", () => {
  for (const { tag, file } of CASES) {
    it(`${tag} produces identical output on both sides`, () => {
      const ts = moduleSource(file);
      const dir = path.join(".build", "ts-patterns", tag);
      fs.mkdirSync(dir, { recursive: true });
      writeCompanions(dir);
      const nodeOut = runNode(ts, dir).replace(/\r\n/g, "\n");
      // The Windows C runtime translates "\n" to "\r\n" in stdio text mode;
      // compare line content, not the platform's newline.
      // The native harness is single-TU: bundle the companions ahead of the
      // entry source with imports stripped (bundler-style concatenation -
      // same computation, one TU). The real multi-file emission is
      // verified by the CLI build + on-device run.
      const companionSrc = COMPANIONS.map((file) => {
        const raw = fs.readFileSync(path.join(process.cwd(), GALLERY_DIR, file), "utf8");
        return raw.replace(/^import .*$/gm, "");
      }).join("\n");
      // The stripped import lines leave the aliased call sites (score(...))
      // unbound; substitute them with the companion's exported name directly.
      const bundledTs = companionSrc + ts.split('\n').filter((l) => !l.includes('./helpers')).join('\n')
        .replace(/\bscore\(/g, 'computeScore(');
      const nativeOut = runNative(bundledTs, dir, tag).replace(/\r\n/g, "\n");
      if (nodeOut !== nativeOut) {
        throw new Error(
          `output mismatch in ${tag}:\n--- node ---\n${nodeOut}\n--- native ---\n${nativeOut}`,
        );
      }
    }, 300000);
  }
});
