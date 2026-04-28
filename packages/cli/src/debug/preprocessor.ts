// ---------------------------------------------------------------------------
// @typehal/debug — Debug Preprocessor
//
// Transforms TypeScript source by injecting Serial debug code at breakpoint
// locations. The injected code prints variable values and waits for user
// input to continue execution.
// ---------------------------------------------------------------------------

import ts from 'typescript';
import path from 'node:path';
import type { BreakpointMap, CapturedVariable, RichBreakpoint } from './types';
import { getBreakpointsForFile } from './breakpoint-loader';
import { loadFrameworkPackage } from '../framework-package';

type LogMessagePart = { type: 'text' | 'variable'; value: string };

const DEBUG_FRAMEWORK_PACKAGE = '@typehal/framework-arduino';

function getArduinoDebugPackage(): any {
  return loadFrameworkPackage(DEBUG_FRAMEWORK_PACKAGE, process.cwd());
}

function generateSerialInitCode(): string[] {
  return getArduinoDebugPackage().generateSerialInitCode();
}

function generateArduinoBreakpointCode(
  fileName: string,
  lineNum: number,
  originalLine: string,
  variables: CapturedVariable[],
  breakpoint: RichBreakpoint,
): string[] {
  return getArduinoDebugPackage().generateBreakpointCode(fileName, lineNum, originalLine, variables, breakpoint);
}

function generateArduinoLogpointCode(
  fileName: string,
  lineNum: number,
  parts: LogMessagePart[],
  variables: CapturedVariable[],
): string[] {
  return getArduinoDebugPackage().generateLogpointCode(fileName, lineNum, parts, variables);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PreprocessOptions {
  /** The source file path (for line number calculation) */
  fileName: string;
  /** The breakpoint map loaded from .typehal/breakpoints.json */
  breakpoints: BreakpointMap;
  /** The source text to transform */
  source: string;
}

/**
 * Preprocess a source file by injecting debug code at breakpoint locations.
 *
 * @param options Preprocess options
 * @returns Transformed source with debug instrumentation
 */
export function preprocess(options: PreprocessOptions): string {
  const { fileName, breakpoints, source } = options;
  const breakpointLines = getBreakpointsForFile(breakpoints, fileName);

  if (breakpointLines.length === 0) {
    return source; // No breakpoints, return unchanged
  }

  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = source.split('\n');
  const outputLines: string[] = [];
  const relativeFileName = path.basename(fileName);

  // Create a map of line number (0-indexed) to breakpoint
  const breakpointMap = new Map<number, RichBreakpoint>();
  for (const bp of breakpointLines) {
    breakpointMap.set(bp.line - 1, bp);
  }

  // Collect variables in scope at each breakpoint
  const scopeAnalyzer = new ScopeAnalyzer(sf);

  // Find the first non-import, non-comment line to insert Serial.begin
  let insertIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Skip import statements and comments
    if (trimmed.startsWith('import ') || trimmed.startsWith('//') || trimmed === '') {
      insertIndex = i + 1;
    } else {
      break;
    }
  }

  // Process each line
  for (let i = 0; i < lines.length; i++) {
    // Insert Serial.begin after imports, before first actual code
    if (i === insertIndex) {
      outputLines.push(...generateSerialInitCode());
    }

    const lineNum = i; // 0-indexed
    const lineText = lines[i];

    const bp = breakpointMap.get(lineNum);
    if (bp) {
      // Get the original line content (trimmed, for display)
      const displayLine = lineText.trim();

      // Collect variables in scope at this line
      const vars = scopeAnalyzer.getVariablesInScope(lineNum);

      // Inject debug code BEFORE the breakpoint line
      outputLines.push(...generateBreakpointCode(relativeFileName, lineNum + 1, displayLine, vars, bp));
    }

    // Always include the original line
    outputLines.push(lineText);
  }

  // If all lines were imports/comments, append at end
  if (insertIndex >= lines.length) {
    outputLines.push(...generateSerialInitCode());
  }

  return outputLines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal — Breakpoint Code Generation
// ---------------------------------------------------------------------------

/**
 * Generate the Serial debug code for a breakpoint.
 * Handles regular breakpoints, conditional breakpoints, and logpoints.
 */
function generateBreakpointCode(
  fileName: string,
  lineNum: number,
  originalLine: string,
  variables: CapturedVariable[],
  bp: RichBreakpoint,
): string[] {
  // If this is a logpoint (has logMessage), generate log-only code
  if (bp.logMessage) {
    const parts = parseLogMessage(bp.logMessage);
    return generateArduinoLogpointCode(fileName, lineNum, parts, variables);
  }

  // Normalize condition for C++ (convert === to ==, strip semicolons, etc.)
  const normalizedCondition = bp.condition ? normalizeCondition(bp.condition) : undefined;

  return generateArduinoBreakpointCode(fileName, lineNum, originalLine, variables, bp);
}

/**
 * Parse a log message into text and variable parts.
 * Example: "counter = {counter}, x = {x}" -> [
 *   { type: 'text', value: 'counter = ' },
 *   { type: 'variable', value: 'counter' },
 *   { type: 'text', value: ', x = ' },
 *   { type: 'variable', value: 'x' }
 * ]
 */
function parseLogMessage(message: string): Array<{ type: 'text' | 'variable'; value: string }> {
  const parts: Array<{ type: 'text' | 'variable'; value: string }> = [];
  let current = '';
  let i = 0;

  while (i < message.length) {
    if (message[i] === '{') {
      // Start of variable
      if (current) {
        parts.push({ type: 'text', value: current });
        current = '';
      }
      
      // Find closing brace
      let varName = '';
      i++; // Skip opening brace
      while (i < message.length && message[i] !== '}') {
        varName += message[i];
        i++;
      }
      i++; // Skip closing brace
      
      parts.push({ type: 'variable', value: varName.trim() });
    } else {
      current += message[i];
      i++;
    }
  }

  if (current) {
    parts.push({ type: 'text', value: current });
  }

  return parts;
}

/**
 * Normalize a TypeScript condition expression for use in C++.
 * - Strips trailing semicolons
 * - Converts === to ==
 * - Converts !== to !=
 */
function normalizeCondition(condition: string): string {
  return condition
    .replace(/;+$/, '')           // Strip trailing semicolons
    .replace(/===/g, '==')        // TypeScript strict equality -> C++ equality
    .replace(/!==/g, '!=')        // TypeScript strict inequality -> C++ inequality
    .trim();
}

// ---------------------------------------------------------------------------
// Internal — Scope Analysis
// ---------------------------------------------------------------------------

/**
 * Analyzes a TypeScript source file to determine variable scope.
 */
class ScopeAnalyzer {
  private sf: ts.SourceFile;
  private functionVars: Map<number, CapturedVariable[]> = new Map();

  constructor(sf: ts.SourceFile) {
    this.sf = sf;
    this.analyze();
  }

  /**
   * Get variables in scope at a given line (0-indexed).
   */
  getVariablesInScope(line: number): CapturedVariable[] {
    // First check if we have vars for this exact line (inside a function)
    if (this.functionVars.has(line)) {
      return this.functionVars.get(line)!;
    }

    // Fall back to top-level vars
    return this.functionVars.get(-1) || [];
  }

  /**
   * Analyze the source file to collect variable declarations.
   */
  private analyze(): void {
    // Start with top-level variables
    const topLevelVars: CapturedVariable[] = [];
    this.collectVariables(this.sf, topLevelVars);

    // Store top-level vars for lines outside any function
    this.functionVars.set(-1, topLevelVars);

    const visit = (node: ts.Node, currentVars: CapturedVariable[]): CapturedVariable[] => {
      if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) {
        const startLine = this.sf.getLineAndCharacterOfPosition(node.getStart()).line;
        const endLine = node.body 
          ? this.sf.getLineAndCharacterOfPosition(node.body.getEnd()).line 
          : startLine;
        const localVars: CapturedVariable[] = [...currentVars];

        // Collect parameters
        for (const param of node.parameters) {
          if (ts.isIdentifier(param.name)) {
            localVars.push({ name: param.name.text });
          }
        }

        // Collect variable declarations in the function body
        if (node.body) {
          this.collectVariables(node.body, localVars);
        }

        // Store vars for all lines in this function
        for (let line = startLine; line <= endLine; line++) {
          this.functionVars.set(line, localVars);
        }
        return localVars;
      }

      // Visit children
      ts.forEachChild(node, child => visit(child, currentVars));
      return currentVars;
    };

    visit(this.sf, topLevelVars);
  }

  /**
   * Collect variable declarations from a node and its children.
   */
  private collectVariables(node: ts.Node, vars: CapturedVariable[]): void {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const isFunction = decl.initializer !== undefined && this.isFunctionExpression(decl.initializer);
          vars.push({ name: decl.name.text, isFunction });
        }
      }
    }

    ts.forEachChild(node, child => {
      // Don't descend into nested functions - they have their own scope
      if (!ts.isFunctionDeclaration(child) && !ts.isArrowFunction(child) && !ts.isMethodDeclaration(child)) {
        this.collectVariables(child, vars);
      }
    });
  }

  /**
   * Check if an expression is a function/arrow function.
   */
  private isFunctionExpression(expr: ts.Expression): boolean {
    return ts.isArrowFunction(expr) || ts.isFunctionExpression(expr);
  }
}