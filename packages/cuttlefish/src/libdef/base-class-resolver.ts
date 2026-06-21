/**
 * Resolves a base class name to the header file that declares it.
 *
 * Scoped to the set of .h files under a scan root — no parent-directory
 * climbing. See
 * docs/superpowers/specs/2026-06-20-gen-decls-inheritance-design.md.
 */

import fs from "node:fs";
import path from "node:path";
import { parseHeader } from "./header-parser.js";

export type ResolveResult =
  | { kind: "found"; headerPath: string }
  | { kind: "external" };

export class BaseClassResolver {
  constructor(private readonly index: Map<string, string>) {}

  resolve(name: string): ResolveResult {
    const headerPath = this.index.get(name);
    if (headerPath !== undefined) {
      return { kind: "found", headerPath };
    }
    return { kind: "external" };
  }
}

/**
 * Walks a directory tree for .h files and builds Map<className, headerPath>.
 * First declaration wins (deterministic). Recursive.
 */
export function buildClassIndex(dir: string): Map<string, string> {
  const index = new Map<string, string>();
  if (!fs.existsSync(dir)) {
    return index;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [name, hp] of buildClassIndex(full)) {
        if (!index.has(name)) index.set(name, hp);
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".h")) {
      const content = fs.readFileSync(full, "utf8");
      for (const cls of parseHeader(content)) {
        if (!index.has(cls.name)) index.set(cls.name, full);
      }
    }
  }
  return index;
}
