import ts from "typescript";
import { Diagnostic } from "../types.js";
import { makeDiagnostic } from "./ast-node-utils.js";
import { getKindEntry, checkContextSensitive } from "./feature-registry.js";

function extractSourceLine(sourceText: string, line1Indexed: number): string {
  const lines = sourceText.split("\n");
  const idx = line1Indexed - 1;
  if (idx >= 0 && idx < lines.length) {
    return lines[idx];
  }
  return "";
}

export function prescanUnsupportedFeatures(
  source: ts.SourceFile,
  sourceText: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  function severityFor(code: string, status?: string): Diagnostic["severity"] {
    if (status === "approximation" || code === "TS2CPP_APPROXIMATE") {
      return "warning";
    }
    return "error";
  }

  function addDiag(
    position: number,
    message: string,
    code: string,
    hint?: string,
    status?: string,
  ): void {
    const diag = makeDiagnostic(sourceText, position, message, severityFor(code, status), code);
    if (hint) {
      diag.hint = hint;
    }
    if (diag.line != null) {
      diag.sourceLine = extractSourceLine(sourceText, diag.line);
    }
    diagnostics.push(diag);
  }

  function visit(node: ts.Node): void {
    const kindEntry = getKindEntry(node.kind);
    if (kindEntry) {
      addDiag(node.pos, kindEntry.message, kindEntry.code, kindEntry.hint, kindEntry.status);
    }

    const contextMatch = checkContextSensitive(node, sourceText);
    if (contextMatch) {
      addDiag(node.pos, contextMatch.message, contextMatch.code, contextMatch.hint, contextMatch.status);
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(source, visit);
  return diagnostics;
}
