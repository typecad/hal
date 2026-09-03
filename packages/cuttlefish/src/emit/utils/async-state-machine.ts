/**
 * Async state machine generation utilities.
 * Handles conversion of async functions to cooperative state machines.
 * Extracted from cpp-emitter.ts
 */

import type { StatementIR, ExpressionIR } from "../../api/index.js";
import type { HALOpIR, PlatformStrategy } from "../../api/shared/index.js";
import { escapeCppStringLiteral } from "../../utils/strings.js";
import { routeHALOp } from "../route-hal-op.js";

/**
 * Converts a string to PascalCase.
 * Used for generating class names from function names.
 * 
 * @param str The input string (e.g., "my_function" or "myFunction")
 * @returns PascalCase string (e.g., "MyFunction")
 */
function toPascalCaseLocal(str: string): string {
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
  /** Source span of the awaited call (for diagnostics). */
  awaitedSpan?: StatementIR["sourceSpan"];
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
  /** For async METHODS: the definition of the starter function the in-class
   *  body calls (binds the owner and arms STATE_0). Emitted after the task
   *  class; the matching prototype must precede the owning class. */
  starterDef?: string;
}

/** Awaited callees that legitimately lower to a plain timed wait (their
 *  single numeric argument IS the deadline). Everything else reaching the
 *  plain-wait arm would have its call silently dropped — the embedding
 *  emitter turns that into a diagnostic via onUnsupportedAwait. */
const PLAIN_AWAIT_CALLEES = new Set<string>([
  "Async.sleep",
  "AsyncClass.sleep",
  "__cuttlefish_async_sleep",
  "delay",
  "sleep",
]);

/** Options for generateAsyncTaskClass. */
export interface AsyncTaskClassOptions {
  /** Owning class name for async METHODS: the task binds `this` to an owner
   *  pointer set by start(owner); segment code that renders `this->x` is
   *  rewritten to `_owner->x` by the embedding renderStatement callback. */
  ownerClassName?: string;
  /** Invoked for every awaited call that has no cooperative lowering (the
   *  call would be silently dropped). The emitter surfaces it as a
   *  diagnostic instead of emitting wrong code. */
  onUnsupportedAwait?: (callee: string, span: StatementIR["sourceSpan"] | undefined) => void;
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
  options?: AsyncTaskClassOptions,
): AsyncTaskClassResult {
  const className = toPascalCaseLocal(fnName) + "Task";
  const instanceName = `${fnName}Task`;
  const owner = options?.ownerClassName;
  const starterName = `__tc_async_start_${fnName}`;

  // Detect whether the body is a single while-loop (cyclic) or linear statements
  let bodyStatements: StatementIR[];
  let isCyclic = false;

  if (fnStatements.length === 1 && fnStatements[0].kind === "while") {
    isCyclic = true;
    bodyStatements = fnStatements[0].body as StatementIR[];
  } else {
    bodyStatements = fnStatements;
  }

  // Split body into segments at each awaited call
  const segments: Segment[] = [];
  let currentPre: StatementIR[] = [];

  for (const stmt of bodyStatements) {
    if (stmt.kind === "call" && stmt.isAwaited) {
      segments.push({ preStatements: currentPre, awaitedCallee: stmt.callee, awaitedArgs: stmt.args, awaitedSpan: stmt.sourceSpan });
      currentPre = [];
    } else if (
      // Chained HAL calls (e.g. `await Http.get(url).send()`) resolve to a
      // block of hal-ops whose LAST statement is the awaited wait marker.
      // Flatten it so the split sees the marker; the leading ops (begin,
      // setters) run as pre-statements of the same segment.
      stmt.kind === "block" &&
      stmt.body.length > 0 &&
      stmt.body[stmt.body.length - 1].kind === "call" &&
      (stmt.body[stmt.body.length - 1] as Extract<StatementIR, { kind: "call" }>).isAwaited
    ) {
      const last = stmt.body[stmt.body.length - 1] as Extract<StatementIR, { kind: "call" }>;
      currentPre.push(...stmt.body.slice(0, -1));
      segments.push({ preStatements: currentPre, awaitedCallee: last.callee, awaitedArgs: last.args, awaitedSpan: last.sourceSpan });
      currentPre = [];
    } else {
      currentPre.push(stmt);
    }
  }
  // Terminal segment (trailing statements after the last await, or the whole body if no awaits)
  segments.push({ preStatements: currentPre, awaitedArgs: [] });

  const awaitCount = segments.filter((s) => s.awaitedCallee !== undefined).length;
  const stateCount = awaitCount + 1; // STATE_0 … STATE_{awaitCount}; cyclic loops back, linear adds STATE_DONE

  // State enum is emitted as `enum class State` (AUTOSAR A7-2-1), so all
  // references must be scope-qualified as `State::STATE_X`. The stateEnumList
  // (used inside `enum class State { ... }`) uses the bare names; everywhere
  // else (assignments, case labels, comparisons) uses the qualified form.
  const stateNames: string[] = [];
  const qualifiedStateNames: string[] = [];
  for (let i = 0; i < stateCount; i++) {
    stateNames.push(`STATE_${i}`);
    qualifiedStateNames.push(`State::STATE_${i}`);
  }
  if (!isCyclic) {
    stateNames.push("STATE_DONE");
    qualifiedStateNames.push("State::STATE_DONE");
  }
  const Q = (i: number) => qualifiedStateNames[i];
  const Q_DONE = "State::STATE_DONE";
  const Q_0 = "State::STATE_0";

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

  // Collect awaitable-tap markers (await ui.onTap()). args[0] is the node
  // filter: -1 = any tap, >=0 = a specific node index. Each tap-await needs a
  // per-await snapshot of __ui_tap_seq to detect the NEXT bump.
  const tapInfoMap = new Map<number, { nodeIndex: number }>();
  const tapMembers = new Map<string, number>(); // member name → segment index

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.awaitedCallee === "__UI_TAP__" && seg.awaitedArgs.length > 0) {
      const nodeArg = seg.awaitedArgs[0];
      const nodeIndex = nodeArg.kind === "number"
        ? (nodeArg as Extract<ExpressionIR, { kind: "number" }>).value
        : -1;
      const member = `_tapPrev_${i}`;
      tapInfoMap.set(i, { nodeIndex });
      tapMembers.set(member, i);
    }
  }

  // Collect net-wait (WiFi/HTTP/HAL) markers: awaited hal-ops rewritten to
  // __WIFI_WAIT__/__HTTP_WAIT__/__HAL_WAIT__ calls carrying the op as a
  // hal-expr arg. The strategy lowers the op to start code + poll condition.
  const netInfoMap = new Map<number, NetWaitInfo>();
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (
      (seg.awaitedCallee === "__WIFI_WAIT__" || seg.awaitedCallee === "__HTTP_WAIT__" || seg.awaitedCallee === "__BLE_WAIT__" || seg.awaitedCallee === "__HAL_WAIT__") &&
      seg.awaitedArgs[0]?.kind === "hal-expr"
    ) {
      const op = (seg.awaitedArgs[0] as Extract<ExpressionIR, { kind: "hal-expr" }>).operation;
      netInfoMap.set(i, netWaitInfo(op, strategy));
    }
  }

  // ── Render each state ──────────────────────────────────────────────────
  // Decomposition: a state's ENTRY condition comes from the await that ended
  // the PREVIOUS segment (edge / tap / net poll / timed deadline); once the
  // condition fires, the segment body runs and the await ending THIS segment
  // is armed (pin snapshot / tap snapshot / net start op / deadline).

  // Lines that arm the await ending segment i and advance the state.
  const armNextLines = (i: number, pad: string): string[] => {
    const seg = segments[i];
    const lines: string[] = [];
    if (seg.awaitedCallee === undefined) {
      lines.push(`${pad}_state = ${isCyclic ? Q_0 : Q_DONE};`);
      return lines;
    }
    const edge = edgeInfoMap.get(i);
    const tap = tapInfoMap.get(i);
    const net = netInfoMap.get(i);
    if (edge) {
      lines.push(`${pad}_edgePrev_p${edge.pin} = ${strategy.readDigitalPin?.(String(edge.pin)) ?? `digitalRead(${edge.pin})`};`);
      if (edge.timeout !== null) {
        lines.push(`${pad}_waitUntil = ${strategy.currentTimeMillis()} + ${edge.timeout};`);
      }
    } else if (tap) {
      lines.push(`${pad}_tapPrev_${i} = __ui_tap_seq;`);
    } else if (net) {
      for (const startLine of net.startLines) lines.push(`${pad}${startLine}`);
      if (net.timeoutExpr !== null) {
        lines.push(`${pad}_waitUntil = ${strategy.currentTimeMillis()} + ${net.timeoutExpr};`);
      }
    } else {
      // Plain timed wait (await delay(ms)) — arm its deadline. Anything whose
      // callee is not a known timer shape has no cooperative lowering here:
      // the call itself is NOT rendered (only marker/net awaits carry start
      // code), so report it instead of silently dropping it.
      if (!PLAIN_AWAIT_CALLEES.has(seg.awaitedCallee)) {
        options?.onUnsupportedAwait?.(seg.awaitedCallee, seg.awaitedSpan);
      }
      const ms = seg.awaitedArgs[0] ? renderExpression(seg.awaitedArgs[0], strategy) : "0";
      lines.push(`${pad}_waitUntil = ${strategy.currentTimeMillis()} + ${ms};`);
    }
    lines.push(`${pad}_state = ${Q(i + 1)};`);
    return lines;
  };

  const caseLines: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const stateName = Q(i);
    const body: string[] = [];

    const edgePoll = i > 0 ? edgeInfoMap.get(i - 1) : undefined;
    const tapPoll = i > 0 ? tapInfoMap.get(i - 1) : undefined;
    const netPoll = i > 0 ? netInfoMap.get(i - 1) : undefined;

    // Segment body + arming of the next await, at the given indent.
    const runSegment = (pad: string): string[] => {
      const lines: string[] = [];
      for (const stmt of seg.preStatements) lines.push(`${pad}${renderStmt(stmt)}`);
      lines.push(...armNextLines(i, pad));
      return lines;
    };

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
      body.push(`          int _cur = ${strategy.readDigitalPin?.(String(edgePoll.pin)) ?? `digitalRead(${edgePoll.pin})`};`);
      body.push(`          if (${fullCond}) {`);
      body.push(`            ${prevVar} = _cur;`);
      body.push(...runSegment(`            `));
      body.push(`          } else {`);
      body.push(`            ${prevVar} = _cur;`);
      body.push(`          }`);
      body.push(`        }`);
    } else if (tapPoll) {
      // Tap-poll state: a previous segment ended with `await ui.onTap()`.
      // Wait until __ui_tap_seq bumps from the captured snapshot. A per-node
      // await also requires __ui_tap_node to match the awaited node index.
      const prevVar = `_tapPrev_${i - 1}`;
      const nodeFilter = tapPoll.nodeIndex;
      const cond = nodeFilter < 0
        ? `__ui_tap_seq != ${prevVar}`
        : `(__ui_tap_seq != ${prevVar}) && (__ui_tap_node == ${nodeFilter})`;
      body.push(`        if (${cond}) {`);
      body.push(...runSegment(`          `));
      body.push(`        }`);
    } else if (netPoll) {
      // Net-poll state: a previous segment ended with an awaited WiFi/HTTP
      // op. Wait until its poll condition fires (or its deadline expires).
      const deadline = `${strategy.currentTimeMillis()} >= _waitUntil`;
      const cond = netPoll.pollCond === null
        ? deadline
        : netPoll.timeoutExpr !== null
          ? `(${netPoll.pollCond}) || ${deadline}`
          : netPoll.pollCond;
      body.push(`        if (${cond}) {`);
      body.push(...runSegment(`          `));
      body.push(`        }`);
    } else if (i === 0) {
      // First state runs immediately.
      body.push(...runSegment(`        `));
    } else {
      // Previous await was a plain timed wait — poll its deadline.
      body.push(`        if (${strategy.currentTimeMillis()} >= _waitUntil) {`);
      body.push(...runSegment(`          `));
      body.push(`        }`);
    }

    caseLines.push(`      case ${stateName}:`, `        {`, ...body, `        }`, `        break;`);
  }

  if (!isCyclic) caseLines.push(`      case ${Q_DONE}:`, `        break;`);

  const stateEnumList = stateNames.join(", ");
  const isCompleteExpr = isCyclic ? "false" : `_state == ${Q_DONE}`;

  // Build constructor initializer list and edge/tap member declarations
  const edgeMemberArr = Array.from(edgeMembers);
  const tapMemberArr = Array.from(tapMembers.keys());
  const inits: string[] = [`_state(${Q_0})`, `_waitUntil(0)`];
  for (const m of edgeMemberArr) inits.push(`${m}(LOW)`);
  for (const m of tapMemberArr) inits.push(`${m}(0)`);
  // Owner pointer (async methods): initialized null, bound by start(owner).
  // Declared last / initialized last so the initializer list order matches.
  if (owner) inits.push("_owner(nullptr)");
  const ctorInitList = inits.join(", ");
  const edgeResetList = edgeMemberArr.map(m => ` ${m} = LOW;`).join("");
  const tapResetList = tapMemberArr.map(m => ` ${m} = 0;`).join("");
  const edgeMemberDecls = edgeMemberArr.map(m => `  int ${m};`);
  // __ui_tap_seq is uint32_t; the snapshot must match to detect bumps correctly.
  const tapMemberDecls = tapMemberArr.map(m => `  uint32_t ${m};`);
  const ownerMemberDecl = owner ? [`  ${owner}* _owner;`] : [];
  const runGuard = owner ? [`    if (_owner == nullptr) { return; }`] : [];
  // start(owner): (re)bind the receiver and rewind the machine. Calling the
  // async method again restarts the task with the new receiver — the task
  // is a singleton per method, mirroring the free-function tasks.
  const startMethod = owner ? [
    `  void start(${owner}* owner) {`,
    `    _owner = owner;`,
    `    _state = ${Q_0};`,
    `    _waitUntil = 0;${edgeResetList}${tapResetList}`,
    `  }`,
  ] : [];

  const classDef = [
    `// Async state machine for ${fnName}`,
    `class ${className} {`,
    `public:`,
    `  enum class State { ${stateEnumList} };`,
    `  ${className}() : ${ctorInitList} {}`,
    ...startMethod,
    `  void run() {`,
    ...runGuard,
    `    switch (_state) {`,
    ...caseLines,
    `    }`,
    `  }`,
    `  bool isComplete() const { return ${isCompleteExpr}; }`,
    `  void reset() { _state = ${Q_0}; _waitUntil = 0;${edgeResetList}${tapResetList} }`,
    `private:`,
    `  State _state;`,
    `  unsigned long _waitUntil;`,
    ...edgeMemberDecls,
    ...tapMemberDecls,
    ...ownerMemberDecl,
    `};`,
  ].join("\n");

  const starterDef = owner
    ? `void ${starterName}(${owner}* owner) { ${instanceName}.start(owner); }`
    : undefined;

  return { classDef, instanceDecl: `${className} ${instanceName};`, taskVarName: instanceName, starterDef };
}

/**
 * Renders an expression to a string (simplified version for async state machine).
 * This is a minimal implementation - full rendering should use ExpressionRenderer.
 */
function renderExpression(expr: ExpressionIR, strategy: PlatformStrategy): string {
  switch (expr.kind) {
    case "number": {
      if (expr.cppType === "float" || expr.cppType === "double" || !Number.isInteger(expr.value)) {
        const str = `${expr.value}`;
        return str.includes('.') || str.includes('e') || str.includes('E')
          ? `${str}f`
          : `${str}.0f`;
      }
      return `${expr.value}`;
    }
    case "string":
      // Shared escaper — see render-expr.ts / expression-renderer.ts (demo #29
      // Finding A family). The prior quote-only escape emitted a raw control
      // char inside the C++ string literal for any `\n`/`\t`/`\\` value.
      return `"${escapeCppStringLiteral(expr.value)}"`;
    case "boolean":
      return expr.value ? "true" : "false";
    case "identifier":
      return expr.value;
    case "raw":
      return expr.value;
    case "hal-expr":
      return `/* hal-expr: ${expr.operation.operation} */`;
    default:
      return "/* complex expr */";
  }
}

/**
 * Start/poll split for an awaited network (or timed) HAL op.
 * Produced by netWaitInfo from the op carried on a __WIFI_WAIT__ /
 * __HTTP_WAIT__ / __HAL_WAIT__ marker.
 */
interface NetWaitInfo {
  /** C++ statements that kick the operation off (may be empty). */
  startLines: string[];
  /** Completion condition polled each tick; null = deadline-only wait. */
  pollCond: string | null;
  /** Deadline (ms expression) to arm `_waitUntil` with; null = no deadline. */
  timeoutExpr: string | null;
}

/** Numeric-or-rendered HAL field → C++ text. */
function ms(v: unknown): string {
  return String(v);
}

/** True when a timeout field is the literal 0 (wait forever, no deadline). */
function isZeroTimeout(v: unknown): boolean {
  return v === undefined || v === null || String(v).trim() === "0";
}

/**
 * Map an awaitable HAL op to its start statements + poll condition, lowering
 * the start op and poll predicate through the platform strategy. Keep the set
 * of handled ops in sync with AWAITABLE_HAL_OPS in ir/transformers/expressions.ts.
 *
 * Falls back to running the blocking form as the "start" with an immediate
 * completion when the strategy can't lower the split ops.
 */
function netWaitInfo(op: HALOpIR, strategy: PlatformStrategy): NetWaitInfo {
  const o = op as any;
  const route = (routedOp: Record<string, unknown>): { code?: string; expression?: string } | undefined =>
    routeHALOp(routedOp as unknown as HALOpIR, strategy);
  const expr = (operation: string): string | null =>
    route({ operation })?.expression ?? null;

  switch (op.operation) {
    case "timing.sleep":
      // Pure deadline wait: no start op, no poll — the machine arms
      // _waitUntil and cooperatively yields until it passes. Bare
      // (non-awaited) calls lower to the blocking form (k_msleep).
      return { startLines: [], pollCond: null, timeoutExpr: ms(o.ms) };
    case "wifi.join": {
      // Awaited join splits into the staged association + the L4 poll.
      // (Static-IPv4/power-save facts are join()-side blocking-path extras;
      // the async form associates with defaults and polls connectivity.)
      const start = route({ operation: "wifi.connect_start", ssid: o.ssid, password: o.psk });
      const poll = expr("wifi.is_connected");
      if (start?.code && poll) {
        return {
          startLines: [start.code],
          pollCond: poll,
          timeoutExpr: isZeroTimeout(o.timeoutMs) ? null : ms(o.timeoutMs),
        };
      }
      break;
    }

    case "wifi.scan": {
      const start = route({ operation: "wifi.scan_start" });
      const poll = expr("wifi.scan_done");
      if (start?.code && poll) {
        return { startLines: [start.code], pollCond: poll, timeoutExpr: null };
      }
      break;
    }
    case "http.send": {
      const start = route({ operation: "http.send_start" });
      const poll = expr("http.done");
      if (start?.code && poll) {
        return { startLines: [start.code], pollCond: poll, timeoutExpr: null };
      }
      break;
    }
  }

  // Fallback: run the blocking form immediately and complete on the next tick.
  const blocking = routeHALOp(op, strategy);
  const line = blocking?.code ?? (blocking?.expression ? `${blocking.expression};` : `/* unhandled awaited hal-op: ${op.operation} */`);
  return { startLines: [line], pollCond: null, timeoutExpr: "0" };
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