import ts from "typescript";
import { Diagnostic } from "../types";
import { makeDiagnostic } from "./ast-node-utils";
import { getKindEntry, checkContextSensitive } from "./feature-registry";

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

  function addDiag(position: number, message: string, code: string, hint?: string): void {
    const diag = makeDiagnostic(sourceText, position, message, "warning", code);
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
      addDiag(node.pos, kindEntry.message, kindEntry.code, kindEntry.hint);
    }

    const contextMatch = checkContextSensitive(node, sourceText);
    if (contextMatch) {
      addDiag(node.pos, contextMatch.message, contextMatch.code, contextMatch.hint);
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(source, visit);
  return diagnostics;
}
