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