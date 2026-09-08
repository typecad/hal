import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  transpileFile,
  renderExprAsText,
  contextStorage,
  CompilationContext,
} from "@typecad/cuttlefish/testing";
import type { ExpressionIR } from "@typecad/cuttlefish/testing";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dirPath of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
});

describe("fatal transpiler diagnostics", () => {
  it("aborts transpilation before emission for unsupported prescan features", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecad-hal-fatal-"));
    tempDirs.push(workspaceDir);

    const entryPath = path.join(workspaceDir, "main.ts");
    fs.writeFileSync(
      entryPath,
      [
        "const base = { a: 1 };",
        "const merged = { ...base, b: 2 };",
        "const _log1 = merged.b;",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(transpileFile({
      inputFile: entryPath,
      emitMode: "cpp",
      target: "generic",
      emitMaps: true,
      skipTypeCheck: true,
    })).rejects.toThrow(/TS2CPP_NO_EQUIVALENT|Object spread/);
  });

  // Regression: renderExprAsText's default arm previously returned the silent
  // placeholder "0 /* unsupported_expr */" with no diagnostic, which could leak
  // into generated C++ because renderExprAsText runs during IR lowering —
  // before the fatal-gate check in transpile.ts. It must now (a) push a
  // TS2CPP_UNSUPPORTED_EXPR error diagnostic onto the build sink so the fatal
  // gate aborts, and (b) throw so out-of-build callers fail loudly.
  it("renderExprAsText fails closed on an unknown ExpressionIR kind", () => {
    const unknownExpr = { kind: "__never_emitted_kind__" } as unknown as ExpressionIR;

    // Outside a build context: must throw (no silent placeholder).
    expect(() => renderExprAsText(unknownExpr)).toThrow(/unsupported ExpressionIR kind/);

    // Inside a build context: must push a TS2CPP_UNSUPPORTED_EXPR error before
    // throwing, so throwIfFatalDiagnostics aborts the build.
    const ctx = new CompilationContext();
    const result = contextStorage.run(ctx, () => {
      expect(() => renderExprAsText(unknownExpr)).toThrow(/unsupported ExpressionIR kind/);
      return ctx.diagnostics;
    });

    expect(result.some(
      (d) => d.severity === "error" && d.code === "TS2CPP_UNSUPPORTED_EXPR",
    )).toBe(true);
  });
});
