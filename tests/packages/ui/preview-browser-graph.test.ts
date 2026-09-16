// The preview's browser client imports the host runtime from @typecad/ui
// dist via an import map. Any module in that graph importing node builtins
// (node:fs, node:path) kills the whole browser module load — the canvas
// stays black with only a console error to show for it. This walks the
// compiled import graph from the host runtime and fails on any node builtin
// or missing relative import.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_DIST = path.resolve(HERE, "../../../packages/ui/dist");

describe("preview browser module graph", () => {
  it("host runtime's dist import graph is browser-safe (no node builtins)", () => {
    const entry = path.join(UI_DIST, "preview/host-ui-runtime.js");
    expect(fs.existsSync(entry), `${entry} exists (build @typecad/ui first)`).toBe(true);

    const seen = new Set<string>();
    const queue = [entry];
    const offenders: string[] = [];
    const importRe = /(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;

    while (queue.length > 0) {
      const file = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(importRe)) {
        const spec = m[1] ?? m[2];
        if (!spec) continue;
        if (spec.startsWith("node:") || /^node-\w+/.test(spec) || spec.startsWith("fs") || spec.startsWith("path")) {
          offenders.push(`${path.relative(UI_DIST, file)} -> ${spec}`);
          continue;
        }
        if (spec.startsWith(".")) {
          const resolved = path.resolve(path.dirname(file), spec);
          for (const cand of [resolved, `${resolved}.js`, path.join(resolved, "index.js")]) {
            if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
              queue.push(cand);
              break;
            }
          }
        }
        // Bare specifiers other than node builtins (chalk etc.) would also
        // break the browser, but the import map only maps @typecad/* — flag
        // anything the browser cannot resolve.
        if (!spec.startsWith(".") && !spec.startsWith("@typecad/") && !spec.startsWith("node:")) {
          offenders.push(`${path.relative(UI_DIST, file)} -> ${spec} (bare, unmapped)`);
        }
      }
    }

    expect(seen.size, "graph walked more than the entry").toBeGreaterThan(1);
    expect(offenders, `node/bare imports in the preview graph:\n${offenders.join("\n")}`).toEqual([]);
  });
});
