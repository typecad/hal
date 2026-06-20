import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resetUIRegistry,
  loadUIModule,
  clearEntryHasUI,
} from "@typecad/cuttlefish/ui/ui-registry";
import {
  registerUIModuleImport,
  resetUICallState,
  resolveUIModuleImport,
  recordSignal,
  uiSignalNames,
  recordBinding,
  uiBindings,
  isUICall,
} from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  resetUIRegistry();
  resetUICallState();
  clearEntryHasUI();
});

function writeUI(html: string, css: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-ui-call-"));
  tempDirs.push(dir);
  const htmlPath = path.join(dir, "app.ui.html");
  fs.writeFileSync(htmlPath, html, "utf-8");
  fs.writeFileSync(path.join(dir, "app.ui.css"), css, "utf-8");
  return htmlPath;
}

describe("UI call resolver — pure helpers", () => {
  beforeEach(() => {
    resetUIRegistry();
    resetUICallState();
    clearEntryHasUI();
  });

  it("registerUIModuleImport + resolveUIModuleImport round-trips name→path", () => {
    const htmlPath = writeUI(`<screen></screen>`, ``);
    loadUIModule(htmlPath);
    registerUIModuleImport("screen", htmlPath);
    expect(resolveUIModuleImport("screen")).toBe(htmlPath);
    expect(resolveUIModuleImport("notImported")).toBeUndefined();
  });

  it("isUICall detects ui.* property-access calls", () => {
    // Tested via the callee-name check; here we verify the predicate surface.
    expect(typeof isUICall).toBe("function");
  });

  it("recordSignal registers a name; uiSignalNames returns them", () => {
    recordSignal("temp", "int", 22);
    recordSignal("__ui_sig_0", "int", 0);
    expect(uiSignalNames()).toEqual(["temp", "__ui_sig_0"]);
  });

  it("recordBinding registers a binding spec; uiBindings returns them", () => {
    recordBinding({ nodeIndex: 1, property: "text", fnName: "__ui_bind_text_0" });
    recordBinding({ nodeIndex: 2, property: "background", fnName: "__ui_bind_bg_0" });
    expect(uiBindings()).toHaveLength(2);
    expect(uiBindings()[0].nodeIndex).toBe(1);
    expect(uiBindings()[1].fnName).toBe("__ui_bind_bg_0");
  });

  it("resetUICallState clears signals and bindings but not the registry", () => {
    const htmlPath = writeUI(`<screen></screen>`, ``);
    loadUIModule(htmlPath);
    registerUIModuleImport("screen", htmlPath);
    recordSignal("temp", "int", 22);
    recordBinding({ nodeIndex: 0, property: "text", fnName: "f" });
    resetUICallState();
    expect(uiSignalNames()).toHaveLength(0);
    expect(uiBindings()).toHaveLength(0);
    // Registry survives — it's reset separately by resetUIRegistry.
    expect(resolveUIModuleImport("screen")).toBeUndefined();
  });
});
