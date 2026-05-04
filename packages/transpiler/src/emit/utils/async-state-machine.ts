/**
 * Async state machine generation utilities.
 * Handles conversion of async functions to cooperative state machines.
 * Extracted from cpp-emitter.ts
 */

import type { StatementIR, ExpressionIR } from "@typehal/core";
import type { PlatformStrategy } from "@typehal/core/shared";

/**
 * Converts a string to PascalCase.
 * Used for generating class names from function names.
 * 
 * @param str The input string (e.g., "my_function" or "myFunction")
 * @returns PascalCase string (e.g., "MyFunction")
 */
export function toPascalCaseLocal(str: string): string {
  return str
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

/**
 * Segment of an async function body split at await points.
 */
interface Segment {
  /** Statements before the awaited call */
  preStatements: StatementIR[];
  /** The awaited callee (if this segment ends with an await) */
  awaitedCallee?: string;
  /** Arguments to the awaited call */
  awaitedArgs: ExpressionIR[];
}

/**
 * Result of generating an async task class.
 */
export interface AsyncTaskClassResult {
  /** The class definition as a string */
  classDef: string;
  /** The instance declaration (e.g., "blinkTask blinkTask;") */
  instanceDecl: string;
  /** The task variable name for use in loop() */
  taskVarName: string;
}

/**
 * Generates a cooperative state-machine class for an async function.
 *
 * Handles two patterns:
 *   1. Cyclic: single `while(true)` body containing `await delay()` calls.
 *   2. Linear: sequential statements with `await delay()` calls.
 *
 * Each `await delay(ms)` call becomes a timed wait state that polls `millis()`.
 * 
 * @param fnName The original function name
 * @param fnStatements The function body statements
 * @param strategy The platform strategy for rendering
 * @param knownFunctionReturnTypes Map of function names to their return types
 * @returns The class definition, instance declaration, and task variable name
 */
export function generateAsyncTaskClass(
  fnName: string,
  fnStatements: StatementIR[],
  strategy: PlatformStrategy,
  knownFunctionReturnTypes: Map<string, string>,
  renderStatement: (stmt: StatementIR, forHeader: boolean, strategy: PlatformStrategy, pointerVarTypes?: Map<string, string>, calleeTransformer?: (callee: string) => string, knownFunctionReturnTypes?: Map<string, string>) => string,
): AsyncTaskClassResult {
  const className = toPascalCaseLocal(fnName) + "Task";
  const instanceName = `${fnName}Task`;

  // Detect whether the body is a single while-loop (cyclic) or linear statements
  let bodyStatements: StatementIR[];
  let isCyclic = false;

  if (fnStatements.length === 1 && fnStatements[0].kind === "while") {
    isCyclic = true;
    bodyStatements = (fnStatements[0] as any).body as StatementIR[];
  } else {
    bodyStatements = fnStatements;
  }

  // Split body into segments at each awaited call
  const segments: Segment[] = [];
  let currentPre: StatementIR[] = [];

  for (const stmt of bodyStatements) {
    if (stmt.kind === "call" && (stmt as any).isAwaited) {
      segments.push({ preStatements: currentPre, awaitedCallee: stmt.callee, awaitedArgs: stmt.args });
      currentPre = [];
    } else {
      currentPre.push(stmt);
    }
  }
  // Terminal segment (trailing statements after the last await, or the whole body if no awaits)
  segments.push({ preStatements: currentPre, awaitedArgs: [] });

  const awaitCount = segments.filter((s) => s.awaitedCallee !== undefined).length;
  const stateCount = awaitCount + 1; // STATE_0 … STATE_{awaitCount}; cyclic loops back, linear adds STATE_DONE

  const stateNames: string[] = [];
  for (let i = 0; i < stateCount; i++) stateNames.push(`STATE_${i}`);
  if (!isCyclic) stateNames.push("STATE_DONE");

  // Helper: render a non-await statement as a single C++ line
  const renderStmt = (stmt: StatementIR): string =>
    renderStatement(stmt, false, strategy, undefined, undefined, knownFunctionReturnTypes);

  // Collect edge-detection markers from segments
  const edgeInfoMap = new Map<number, { pin: string; edge: "rising" | "falling"; timeout: number | null }>();
  const edgeMembers = new Set<string>();

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.awaitedCallee === "__EMIT__" && seg.awaitedArgs.length > 0) {
      const argText = seg.awaitedArgs[0].kind === "string"
        ? (seg.awaitedArgs[0] as Extract<ExpressionIR, { kind: "string" }>).value
        : renderExpression(seg.awaitedArgs[0], strategy);
      const info = parseEdgeMarker(argText);
      if (info) {
        edgeInfoMap.set(i, info);
        edgeMembers.add(`_edgePrev_p${info.pin}`);
      }
    }
  }

  const caseLines: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const stateName = `STATE_${i}`;
    const isTerminal = seg.awaitedCallee === undefined;
    const body: string[] = [];

    const edgeSetup = edgeInfoMap.get(i);
    const edgePoll = i > 0 ? edgeInfoMap.get(i - 1) : undefined;

    if (edgePoll) {
      // Poll state: check pin transition via digitalRead
      const prevVar = `_edgePrev_p${edgePoll.pin}`;
      const cond = edgePoll.edge === "rising"
        ? `${prevVar} == LOW && _cur == HIGH`
        : `${prevVar} == HIGH && _cur == LOW`;
      const fullCond = edgePoll.timeout !== null
        ? `(${cond}) || ${strategy.currentTimeMillis()} >= _waitUntil`
        : cond;

      body.push(`        {`);
      body.push(`          int _cur = digitalRead(${edgePoll.pin});`);
      body.push(`          if (${fullCond}) {`);
      body.push(`            ${prevVar} = _cur;`);
      for (const stmt of seg.preStatements) body.push(`            ${renderStmt(stmt)}`);
      if (edgeSetup) {
        // Next await is also edge detection — set up its pin tracking
        body.push(`            _edgePrev_p${edgeSetup.pin} = digitalRead(${edgeSetup.pin});`);
        if (edgeSetup.timeout !== null) {
          body.push(`            _waitUntil = ${strategy.currentTimeMillis()} + ${edgeSetup.timeout};`);
        }
        body.push(`            _state = STATE_${i + 1};`);
      } else if (!isTerminal) {
        const ms = seg.awaitedArgs[0] ? renderExpression(seg.awaitedArgs[0], strategy) : "0";
        body.push(`            _waitUntil = ${strategy.currentTimeMillis()} + ${ms};`);
        body.push(`            _state = STATE_${i + 1};`);
      } else {
        body.push(`            _state = ${isCyclic ? "STATE_0" : "STATE_DONE"};`);
      }
      body.push(`          } else {`);
      body.push(`            ${prevVar} = _cur;`);
      body.push(`          }`);
      body.push(`        }`);
    } else if (edgeSetup) {
      // Setup state: capture initial pin state before polling
      const prevVar = `_edgePrev_p${edgeSetup.pin}`;
      if (i === 0) {
        for (const stmt of seg.preStatements) body.push(`        ${renderStmt(stmt)}`);
        body.push(`        ${prevVar} = digitalRead(${edgeSetup.pin});`);
        if (edgeSetup.timeout !== null) {
          body.push(`        _waitUntil = ${strategy.currentTimeMillis()} + ${edgeSetup.timeout};`);
        }
        body.push(`        _state = STATE_${i + 1};`);
      } else {
        body.push(`        if (${strategy.currentTimeMillis()} >= _waitUntil) {`);
        for (const stmt of seg.preStatements) body.push(`          ${renderStmt(stmt)}`);
        body.push(`          ${prevVar} = digitalRead(${edgeSetup.pin});`);
        if (edgeSetup.timeout !== null) {
          body.push(`          _waitUntil = ${strategy.currentTimeMillis()} + ${edgeSetup.timeout};`);
        }
        body.push(`          _state = STATE_${i + 1};`);
        body.push(`        }`);
      }
    } else {
      // Normal timed-wait state
      if (i === 0) {
        for (const stmt of seg.preStatements) body.push(`        ${renderStmt(stmt)}`);
        if (!isTerminal) {
          const ms = seg.awaitedArgs[0] ? renderExpression(seg.awaitedArgs[0], strategy) : "0";
          body.push(`        _waitUntil = ${strategy.currentTimeMillis()} + ${ms};`);
          body.push(`        _state = STATE_${i + 1};`);
        } else {
          body.push(`        _state = ${isCyclic ? "STATE_0" : "STATE_DONE"};`);
        }
      } else {
        body.push(`        if (${strategy.currentTimeMillis()} >= _waitUntil) {`);
        for (const stmt of seg.preStatements) body.push(`          ${renderStmt(stmt)}`);
        if (!isTerminal) {
          const ms = seg.awaitedArgs[0] ? renderExpression(seg.awaitedArgs[0], strategy) : "0";
          body.push(`          _waitUntil = ${strategy.currentTimeMillis()} + ${ms};`);
          body.push(`          _state = STATE_${i + 1};`);
        } else {
          body.push(`          _state = ${isCyclic ? "STATE_0" : "STATE_DONE"};`);
        }
        body.push(`        }`);
      }
    }

    caseLines.push(`      case ${stateName}:`, ...body, `        break;`);
  }

  if (!isCyclic) caseLines.push(`      case STATE_DONE:`, `        break;`);

  const stateEnumList = stateNames.join(", ");
  const isCompleteExpr = isCyclic ? "false" : "_state == STATE_DONE";

  // Build constructor initializer list and edge member declarations
  const edgeMemberArr = Array.from(edgeMembers);
  const ctorInitList = edgeMemberArr.length > 0
    ? `_state(STATE_0), _waitUntil(0), ${edgeMemberArr.map(m => `${m}(LOW)`).join(", ")}`
    : `_state(STATE_0), _waitUntil(0)`;
  const edgeResetList = edgeMemberArr.map(m => ` ${m} = LOW;`).join("");
  const edgeMemberDecls = edgeMemberArr.map(m => `  int ${m};`);

  const classDef = [
    `// Async state machine for ${fnName}`,
    `class ${className} {`,
    `public:`,
    `  enum State { ${stateEnumList} };`,
    `  ${className}() : ${ctorInitList} {}`,
    `  void run() {`,
    `    switch (_state) {`,
    ...caseLines,
    `    }`,
    `  }`,
    `  bool isComplete() const { return ${isCompleteExpr}; }`,
    `  void reset() { _state = STATE_0; _waitUntil = 0;${edgeResetList} }`,
    `private:`,
    `  State _state;`,
    `  unsigned long _waitUntil;`,
    ...edgeMemberDecls,
    `};`,
  ].join("\n");

  return { classDef, instanceDecl: `${className} ${instanceName};`, taskVarName: instanceName };
}

/**
 * Renders an expression to a string (simplified version for async state machine).
 * This is a minimal implementation - full rendering should use ExpressionRenderer.
 */
function renderExpression(expr: ExpressionIR, strategy: PlatformStrategy): string {
  switch (expr.kind) {
    case "number": {
      if (expr.cppType === "float" || !Number.isInteger(expr.value)) {
        const str = `${expr.value}`;
        return str.includes('.') || str.includes('e') || str.includes('E')
          ? `${str}f`
          : `${str}.0f`;
      }
      return `${expr.value}`;
    }
    case "string":
      return `"${expr.value.replace(/"/g, '\\"')}"`;
    case "boolean":
      return expr.value ? "true" : "false";
    case "identifier":
      return expr.value;
    case "raw":
      return expr.value;
    default:
      return "/* complex expr */";
  }
}

interface EdgeInfo {
  pin: string;
  edge: "rising" | "falling";
  timeout: number | null;
}

function parseEdgeMarker(argText: string): EdgeInfo | null {
  const match = argText.match(/^__EDGE_(RISING|FALLING)__([a-zA-Z0-9_]+)__T(.*)$/);
  if (!match) return null;
  const edge = match[1] === "RISING" ? "rising" : "falling";
  const pin = match[2];
  const timeoutStr = match[3];
  const timeout = !isNaN(Number(timeoutStr)) && Number(timeoutStr) > 0 ? Number(timeoutStr) : null;
  return { pin, edge, timeout };
}