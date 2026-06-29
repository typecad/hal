import { describe, it, expect } from "vitest";
import path from "node:path";
import { parseConfigFile } from "../../../packages/cuttlefish/src/config-loader";
import { buildPreviewSnapshot } from "../../../packages/cuttlefish/src/preview/build-program";
import { PreviewUIRuntime } from "../../../packages/cuttlefish/src/preview/host-ui-runtime";

// The preview executes author callback bodies (setInterval, onClick, ui.bind,
// etc.) in an isolated `Function`. The device transpiler hoists module-scoped
// `let`/`const`/`var` declarations to C++ globals, so a body like
//   let gaugeAngle = 180;
//   setInterval(() => { gaugeAngle = gaugeAngle + 3; ... }, 60);
// works on hardware. The preview used to drop module-level declarations, so the
// interval body threw `ReferenceError: gaugeAngle is not defined` and surfaced
// as "preview callback failed: gaugeAngle = gaugeAngle + 3".
//
// This locks down the fix: module-scoped variables are captured, seeded with
// their initializers, and shared (mutably) across every callback invocation.

const DEMO_ROOT = path.resolve(__dirname, "../../../demo-ui");

describe("preview: module-scoped variables are visible to callback bodies", () => {
  it("captures gaugeAngle as a module var seeded with its initializer", async () => {
    const configPath = path.join(DEMO_ROOT, "cuttlefish.config.ts");
    const config = parseConfigFile(configPath)!;
    const snapshot = await buildPreviewSnapshot({ config, projectRoot: DEMO_ROOT });

    const vars = (snapshot as unknown as { moduleVars?: Array<{ name: string; initializer?: string }> }).moduleVars ?? [];
    const gauge = vars.find((v) => v.name === "gaugeAngle");
    expect(gauge).toBeDefined();
    expect(gauge!.initializer).toBe("180");
  }, 15000);

  it("runs the gauge interval without a ReferenceError and advances gaugeAngle", async () => {
    const configPath = path.join(DEMO_ROOT, "cuttlefish.config.ts");
    const config = parseConfigFile(configPath)!;
    const snapshot = await buildPreviewSnapshot({ config, projectRoot: DEMO_ROOT });

    const diagnostics: string[] = [];
    const rt = new PreviewUIRuntime(snapshot, {
      onFrame: () => {},
      onDiagnostics: (msg) => diagnostics.push(msg),
    });
    rt.start();

    // The interval uses a real setInterval(60ms), so wait wall-clock time for it
    // to fire a few times rather than driving it via tick().
    await new Promise((resolve) => setTimeout(resolve, 250));
    rt.stop();

    // No "preview callback failed" should mention gaugeAngle.
    const failures = diagnostics.filter((m) => /gaugeAngle/i.test(m));
    expect(failures).toEqual([]);

    // The module scope should reflect the mutated value (180 + 3 per tick that fired).
    const scope = (rt as unknown as { moduleScope: Record<string, unknown> }).moduleScope;
    expect(typeof scope.gaugeAngle).toBe("number");
    expect(scope.gaugeAngle).toBeGreaterThan(180);
  }, 15000);
});
