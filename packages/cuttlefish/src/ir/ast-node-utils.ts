import ts from "typescript";
import { Diagnostic, SourceSpan } from "../types.js";
import { withLineColumn } from "../utils/strings.js";

export function makeDiagnostic(
  sourceText: string,
  position: number,
  message: string,
  severity: Diagnostic["severity"] = "warning",
  code?: string,
): Diagnostic {
  const { line, column } = withLineColumn(sourceText, position);
  return { severity, message, line, column, code };
}

export function makeSourceSpan(node: ts.Node, filePath: string, sourceText: string): SourceSpan {
  // SourceSpan.filePath is load-bearing in two consumers — gdb linemarkers
  // (formatLinemarker resolves it into the emitted C++) and the .thcppmap
  // source maps. A call site that swaps the fileName/sourceText arguments
  // passes the whole program text here, which the linemarker path then
  // spews verbatim into the output (every line of TS inside one giant
  // `# N "..."` marker). No legitimate file path contains a newline, so
  // this boundary refuses the swap instead of shipping a corrupt file.
  if (filePath.includes("\n") || filePath.includes("\r")) {
    throw new Error(
      `makeSourceSpan: filePath must be a file path, not source text — the fileName/sourceText arguments were swapped at this call site (got ${filePath.length} chars starting with ${JSON.stringify(filePath.slice(0, 48))})`,
    );
  }
  const startOffset = node.getStart();
  const endOffset = node.getEnd();
  const start = withLineColumn(sourceText, startOffset);
  const end = withLineColumn(sourceText, endOffset);

  return {
    filePath,
    startOffset,
    endOffset,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

export function extractNodeComments(node: ts.Node, sourceText: string): { leadingComments: string[]; trailingComments: string[] } {
  const leadingRanges = ts.getLeadingCommentRanges(sourceText, node.getFullStart()) ?? [];
  const trailingRanges = ts.getTrailingCommentRanges(sourceText, node.getEnd()) ?? [];

  const normalize = (ranges: ts.CommentRange[]): string[] =>
    ranges
      .map((range) => sourceText.slice(range.pos, range.end).trim())
      .filter((value) => value.length > 0);

  return {
    leadingComments: normalize(leadingRanges),
    trailingComments: normalize(trailingRanges),
  };
}