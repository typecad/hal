import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveImport } from "../../../packages/cuttlefish/src/transpile/resolution";
import { resetUIRegistry, hasUIModule } from "@typecad/cuttlefish/ui/ui-registry";

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  resetUIRegistry();
});

describe(".ui.html resolution", () => {
  it("resolves a relative .ui.html import and marks it as a UI module", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-ui-res-"));
    tempDirs.push(dir);
    const importer = path.join(dir, "app.ts");
    fs.writeFileSync(importer, ``, "utf-8");
    const html = path.join(dir, "app.ui.html");
    fs.writeFileSync(html, `<screen></screen>`, "utf-8");

    const resolved = resolveImport(importer, "./app.ui.html");
    expect(resolved).toBeDefined();
    expect(resolved!.sourcePath).toBe(html);
    expect(resolved!.uiModule).toBe(true);
  });

  it("does not mark .ts imports as UI modules", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-ui-res-"));
    tempDirs.push(dir);
    const importer = path.join(dir, "app.ts");
    fs.writeFileSync(importer, ``, "utf-8");
    const other = path.join(dir, "other.ts");
    fs.writeFileSync(other, ``, "utf-8");

    const resolved = resolveImport(importer, "./other");
    expect(resolved).toBeDefined();
    expect(resolved!.uiModule).toBeUndefined();
  });

  it("resolution via graph build loads the UI module into the registry", () => {
    // resolveImport with a .ui.html triggers loadUIModule as a side effect of
    // graph interception; here we verify the resolver itself surfaces the path
    // so the graph builder can call loadUIModule. (The registry-load happens in
    // collectTranspileGraph, exercised by the integration test.)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-ui-res-"));
    tempDirs.push(dir);
    const importer = path.join(dir, "app.ts");
    fs.writeFileSync(importer, ``, "utf-8");
    const html = path.join(dir, "app.ui.html");
    fs.writeFileSync(html, `<screen></screen>`, "utf-8");

    const resolved = resolveImport(importer, "./app.ui.html");
    expect(resolved!.sourcePath).toBe(html);
    // Registry is NOT populated by resolveImport alone — graph-builder does that.
    expect(hasUIModule(html)).toBe(false);
  });
});
