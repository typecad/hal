/**
 * Async state machine generation utilities.
 * Handles conversion of async functions to cooperative state machines.
 * Extracted from cpp-emitter.ts
 */

import type { StatementIR, ExpressionIR } from "../../api/index.js";
import type { HALOpIR, PlatformStrategy } from "../../api/shared/index.js";
import { escapeCppStringLiteral, escapeCppKeyword } from "../../utils/strings.js";
import { routeHALOp } from "../route-hal-op.js";
import { cppTypeForHalOp } from "./hal-op-cpp-type.js";

/**
 * Converts a string to PascalCase.
 * Used for generating class names from function names.
 *
 * @param str The input string (e.g., "my_function" or "myFunction")
 * @returns PascalCase string (e.g., "MyFunction" or "MyFunction")
 */
function toPascalCaseLocal(str: string): string {
  return str
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
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

/** Marker callees the awaited-call classifier recognizes. */
type AwaitMarker =
  | { kind: "plain" }
  | { kind: "pass" }
  | { kind: "edge"; pin: string; edge: "rising" | "falling"; timeout: number | null }
  | { kind: "tap"; nodeIndex: number }
  | { kind: "net"; info: NetWaitInfo };

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
  /** Invoked for async-body constructs the state machine cannot represent
   *  (switch/try/labeled statements, value-position awaits, redeclared
   *  locals). The emitter surfaces these as diagnostics instead of emitting
   *  wrong code. */
  onUnsupportedStatement?: (code: string, message: string, span: StatementIR["sourceSpan"] | undefined) => void;
  /** Invoked once per hoisted local (original name and the `_v_` member),
   *  carrying its C++ type — the embedding emitter feeds these into the
   *  statement renderer's known-variable-type map so snprintf specifier
   *  picking inside the task body sees function locals (top-level scope
   *  alone would classify `localValue / 1000` as an int and corrupt the
   *  output). */
  registerLocalType?: (name: string, cppType: string) => void;
}

/** A function local hoisted to a task member. */
interface HoistedLocal {
  /** Original name. */
  name: string;
  /** Member name (`_v_<name>` — prefixed to never collide with the machine's
   *  own members or the class's methods). */
  member: string;
  /** The declaration's C++ type. */
  cppType: string;
}

/**
 * Generates a cooperative state-machine class for an async function.
 *
 * The body is transformed with LOCAL CONTINUATIONS (the protothread /
 * Duff's-device shape): the original control flow — loops, ifs, breaks,
 * continues — is emitted as real C++ inside `case STATE_0`, and every
 * awaited call is split in place into
 *
 *     <arm>          // start the wait (deadline / net op / edge snapshot)
 *     _state = STATE_<n>;
 *     return;        // yield the pump
 *     case STATE_<n>:
 *     <gate>         // early-return until the wait has fired
 *
 * so re-entry resumes exactly after the await, at any nesting depth. This
 * replaces the former flat segment model, which could only split awaits at
 * the top level of a lone `while (true)` — an `if` inside the loop made the
 * renderer (header-only for control flow) drop the whole body, and an
 * `await` inside a nested `while (cond)` silently became the next
 * statement's loop body. The shapes the old model supported lower to the
 * same states; everything else used to be wrong and now works.
 *
 * Locals cannot live in run()'s stack frame across the returns (and C++
 * forbids jumping past an initialization into a block), so every `let` /
 * `var` / `const` in the body is hoisted to a `_v_<name>` member, renamed
 * at its declaration site and at every reference, and re-initialized by the
 * body itself on (re)entry to STATE_0 — preserving TS block semantics.
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

  const now = strategy.currentTimeMillis();
  const readPin = (pin: string) => strategy.readDigitalPin?.(pin) ?? `digitalRead(${pin})`;
  const unsupported = (code: string, message: string, span?: StatementIR["sourceSpan"]) =>
    options?.onUnsupportedStatement?.(code, message, span);

  // ── Pass 1: collect local declarations (hoist candidates) ────────────────
  const declSites = new Map<string, { cppType: string; count: number; initializer?: ExpressionIR }>();
  const collectDecls = (stmts: StatementIR[] | undefined): void => {
    if (!stmts) return;
    for (const stmt of stmts) {
      switch (stmt.kind) {
        case "var_decl": {
          const site = declSites.get(stmt.name);
          if (site) site.count += 1;
          else declSites.set(stmt.name, { cppType: stmt.cppType, count: 1, initializer: stmt.initializer });
          if (stmt.initializer) collectExprAwaits(stmt.initializer, stmt);
          break;
        }
        case "assign":
          collectExprAwaits(stmt.value, stmt);
          break;
        case "update":
          break;
        case "return":
          if (stmt.value) collectExprAwaits(stmt.value, stmt);
          if (stmt.value) {
            unsupported(
              "async-return-value",
              `async function ${fnName}() returns a value — tasks are fire-and-forget; use a shared top-level variable instead of a return value.`,
              stmt.sourceSpan,
            );
          }
          break;
        case "call":
          for (const a of stmt.args) collectExprAwaits(a, stmt);
          break;
        case "hal-op":
          break;
        case "while":
          collectExprAwaits(stmt.condition, stmt);
          collectDecls(stmt.body);
          break;
        case "if":
          collectExprAwaits(stmt.condition, stmt);
          collectDecls(stmt.thenBranch);
          collectDecls(stmt.elseBranch);
          break;
        case "for":
          collectDecls([stmt.initializer].filter(Boolean) as StatementIR[]);
          if (stmt.condition) collectExprAwaits(stmt.condition, stmt);
          collectDecls([stmt.increment].filter(Boolean) as StatementIR[]);
          collectDecls(stmt.body);
          break;
        case "for_of":
          collectDecls([stmt.variable]);
          collectExprAwaits(stmt.iterable, stmt);
          collectDecls(stmt.body);
          break;
        case "for_in":
          collectDecls([stmt.variable]);
          collectExprAwaits(stmt.object, stmt);
          collectDecls(stmt.body);
          break;
        case "do_while":
          collectDecls(stmt.body);
          collectExprAwaits(stmt.condition, stmt);
          break;
        case "switch":
          unsupported(
            "async-unsupported-statement",
            `switch inside async function ${fnName}() is not supported — the cooperative state machine uses case labels for continuations, which a user switch would capture. Use if/else chains instead.`,
            stmt.sourceSpan,
          );
          break;
        case "try":
          unsupported(
            "async-unsupported-statement",
            `try/catch inside async function ${fnName}() is not supported — the targets are built with exceptions disabled. Restructure to check return values.`,
            stmt.sourceSpan,
          );
          break;
        case "throw":
          unsupported(
            "async-unsupported-statement",
            `throw inside async function ${fnName}() is not supported — the targets are built with exceptions disabled.`,
            stmt.sourceSpan,
          );
          break;
        case "yield":
          unsupported(
            "async-unsupported-statement",
            `yield inside async function ${fnName}() is not supported.`,
            stmt.sourceSpan,
          );
          break;
        case "labeled":
          unsupported(
            "async-unsupported-statement",
            `labeled statement inside async function ${fnName}() is not supported — the break-target label would live in a different scope than the lowered goto. Use a flag instead.`,
            stmt.sourceSpan,
          );
          break;
        case "block":
          collectDecls(stmt.body);
          break;
        default:
          break;
      }
    }
  };

  /** Detect await expressions used in VALUE position (`const x = await f()`),
   *  which the in-place split cannot represent (the continuation would have
   *  to re-enter mid-expression). Awaited CALL STATEMENTS never carry an
   *  await-expression node, so any hit here is a value position. */
  function collectExprAwaits(expr: ExpressionIR | undefined, spanHolder: StatementIR): void {
    if (!expr) return;
    switch (expr.kind) {
      case "await":
        unsupported(
          "await-value-position",
          `await in expression position inside ${fnName}() is not supported — await a call as its own statement and read the result afterwards (e.g. \`await req.send(); req.status()\`).`,
          spanHolder.sourceSpan,
        );
        collectExprAwaits(expr.value, spanHolder);
        break;
      case "ternary":
        collectExprAwaits(expr.condition, spanHolder);
        collectExprAwaits(expr.whenTrue, spanHolder);
        collectExprAwaits(expr.whenFalse, spanHolder);
        break;
      case "array":
        for (const p of expr.elements) collectExprAwaits(p, spanHolder);
        break;
      case "string_concat":
        for (const p of expr.parts) collectExprAwaits(p, spanHolder);
        break;
      case "template_string":
        collectExprAwaits(expr.expression, spanHolder);
        break;
      case "object":
        for (const f of expr.fields) collectExprAwaits(f.value, spanHolder);
        break;
      case "instanceof":
        collectExprAwaits(expr.object, spanHolder);
        break;
      case "spread_array":
        collectExprAwaits(expr.spreadExpr, spanHolder);
        for (const e of expr.additionalElements) collectExprAwaits(e, spanHolder);
        break;
      case "binary":
        collectExprAwaits(expr.left, spanHolder);
        collectExprAwaits(expr.right, spanHolder);
        break;
      case "unary":
        collectExprAwaits(expr.operand, spanHolder);
        break;
      case "property-access":
        collectExprAwaits(expr.object, spanHolder);
        break;
      case "method-call":
        collectExprAwaits(expr.receiverExpr, spanHolder);
        for (const a of expr.args) collectExprAwaits(a, spanHolder);
        break;
      case "element-access":
        collectExprAwaits(expr.object, spanHolder);
        collectExprAwaits(expr.index, spanHolder);
        break;
      case "tuple-access":
        collectExprAwaits(expr.object, spanHolder);
        break;
      case "paren":
        collectExprAwaits(expr.inner, spanHolder);
        break;
      default:
        break;
    }
  }

  collectDecls(fnStatements);

  // Hoist every uniquely-named declaration with a known type. A name declared
  // twice cannot share one member honestly — diagnose and leave it in place
  // (the C++ will not compile, but the diagnostic names the reason).
  // Machine-reserved names (_state/_waitUntil — plus anything already in the
  // _v_ namespace) are left in place: hoisting them would make the raw-text
  // rename rewrite the machine's own members.
  const RESERVED_LOCAL_NAMES = new Set(["_state", "_waitUntil", "State"]);
  const hoisted = new Map<string, HoistedLocal>();
  for (const [name, site] of declSites) {
    if (RESERVED_LOCAL_NAMES.has(name) || name.startsWith("_v_")) continue;
    if (site.count > 1) {
      const firstSpan = findDeclSpan(fnStatements, name);
      unsupported(
        "async-local-redecl",
        `local '${name}' is declared ${site.count} times inside async function ${fnName}() — hoisted task members must map 1:1 to names. Rename one of the declarations.`,
        firstSpan,
      );
      continue;
    }
    if (site.cppType === "auto") {
      // Auto-deduced locals must hoist too — an in-place declaration before
      // a resume label is ill-formed C++ ("jump to case label crosses
      // initialization"). The member needs a concrete type; infer it from
      // the initializer (TS source has the type; the IR recorded `auto`).
      const inferred = inferAutoMemberType(site.initializer);
      if (inferred === null) continue; // genuinely unknowable — leave in place
      const local = { name, member: `_v_${name}`, cppType: inferred };
      hoisted.set(name, local);
      options?.registerLocalType?.(name, local.cppType);
      options?.registerLocalType?.(local.member, local.cppType);
      continue;
    }
    if (!site.cppType) {
      // No member type to declare — leave the declaration at its site as a
      // per-segment local. A local that DOES need to survive an await fails
      // the C++ compile loudly ("jump to case label crosses initialization")
      // instead of silently losing the value; annotate its type to hoist it.
      continue;
    }
    const local = { name, member: `_v_${name}`, cppType: site.cppType };
    hoisted.set(name, local);
    // Both spellings: IR identifier nodes carry the member name after the
    // rewrite below, raw/emit text (template-literal fragments, op-carried
    // code) still carries the original.
    options?.registerLocalType?.(name, local.cppType);
    options?.registerLocalType?.(local.member, local.cppType);
  }

  // ── Pass 2: rewrite the tree — hoisted names → members ──────────────────
  // Scopes bind name → member (hoisted here) or null (a declaration that
  // stays in place and shadows an outer hoisted name).
  type Scope = Map<string, string | null>;
  const scopes: Scope[] = [];
  const bindName = (name: string): string | null | undefined => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const binding = scopes[i].get(name);
      if (binding !== undefined) return binding;
    }
    return undefined;
  };

  const rewriteIdentifiers = (expr: ExpressionIR | undefined): ExpressionIR | undefined => {
    if (!expr) return expr;
    switch (expr.kind) {
      case "identifier": {
        const member = bindName(expr.value);
        return member ? { ...expr, value: member } : expr;
      }
      case "await":
        return { ...expr, value: rewriteIdentifiers(expr.value) ?? expr.value };
      case "ternary":
        return { ...expr, condition: rewriteIdentifiers(expr.condition)!, whenTrue: rewriteIdentifiers(expr.whenTrue)!, whenFalse: rewriteIdentifiers(expr.whenFalse)! };
      case "array":
        return { ...expr, elements: expr.elements.map((e) => rewriteIdentifiers(e)!) };
      case "string_concat":
        return { ...expr, parts: expr.parts.map((e) => rewriteIdentifiers(e)!) };
      case "template_string":
        return { ...expr, expression: rewriteIdentifiers(expr.expression)! };
      case "object":
        return { ...expr, fields: expr.fields.map((f) => ({ ...f, value: rewriteIdentifiers(f.value)! })) };
      case "instanceof":
        return { ...expr, object: rewriteIdentifiers(expr.object)! };
      case "spread_array":
        return { ...expr, spreadExpr: rewriteIdentifiers(expr.spreadExpr)!, additionalElements: expr.additionalElements.map((e) => rewriteIdentifiers(e)!) };
      case "binary":
        return { ...expr, left: rewriteIdentifiers(expr.left)!, right: rewriteIdentifiers(expr.right)! };
      case "unary":
        return { ...expr, operand: rewriteIdentifiers(expr.operand)! };
      case "property-access":
        return { ...expr, object: rewriteIdentifiers(expr.object)! };
      case "method-call":
        return {
          ...expr,
          receiverExpr: rewriteIdentifiers(expr.receiverExpr),
          args: expr.args.map((a) => rewriteIdentifiers(a)!),
        };
      case "element-access":
        return { ...expr, object: rewriteIdentifiers(expr.object)!, index: rewriteIdentifiers(expr.index)! };
      case "tuple-access":
        return { ...expr, object: rewriteIdentifiers(expr.object)! };
      case "paren":
        return { ...expr, inner: rewriteIdentifiers(expr.inner)! };
      default:
        return expr;
    }
  };

  /** Rewrite the leading identifier of an assign/update target string
   *  (`seq` / `recent.head` → the hoisted member). */
  const rewriteTarget = (target: string): string => {
    const m = target.match(/^([A-Za-z_$][\w$]*)(\??[.(].*)?$/);
    if (!m) return target;
    const member = bindName(m[1]);
    return member ? `${member}${m[2] ?? ""}` : target;
  };

  const rewriteStmts = (stmts: StatementIR[]): StatementIR[] => {
    scopes.push(new Map());
    const out = stmts.map((stmt) => rewriteStmt(stmt));
    scopes.pop();
    return out;
  };

  const rewriteStmt = (stmt: StatementIR): StatementIR => {
    switch (stmt.kind) {
      case "var_decl": {
        const local = hoisted.get(stmt.name);
        scopes[scopes.length - 1].set(stmt.name, local ? local.member : null);
        const initializer = rewriteIdentifiers(stmt.initializer);
        return local
          ? { ...stmt, name: local.member, initializer }
          : { ...stmt, initializer };
      }
      case "assign":
        return { ...stmt, target: rewriteTarget(stmt.target), value: rewriteIdentifiers(stmt.value)! };
      case "update":
        return { ...stmt, target: rewriteTarget(stmt.target) };
      case "return":
        return { ...stmt, value: rewriteIdentifiers(stmt.value) };
      case "call":
        return { ...stmt, args: stmt.args.map((a) => rewriteIdentifiers(a)!) };
      case "while":
        return { ...stmt, condition: rewriteIdentifiers(stmt.condition)!, body: rewriteStmts(stmt.body) };
      case "if":
        return {
          ...stmt,
          condition: rewriteIdentifiers(stmt.condition)!,
          thenBranch: rewriteStmts(stmt.thenBranch),
          elseBranch: stmt.elseBranch ? rewriteStmts(stmt.elseBranch) : stmt.elseBranch,
        };
      case "for": {
        const initializer = stmt.initializer ? rewriteStmt(stmt.initializer) : stmt.initializer;
        // A hoisted loop variable must not declare in the header — the state
        // switch may jump past it. Rewrite `for (TYPE v = init; …)` to an
        // assign statement so the header renders `for (v = init; …)`.
        if (initializer && initializer.kind === "var_decl") {
          const local = hoisted.get(initializer.name.replace(/^_v_/, ""));
          const isHoistedMember = initializer.name.startsWith("_v_") && local;
          if (isHoistedMember && initializer.initializer) {
            return {
              ...stmt,
              initializer: {
                kind: "assign",
                sourceSpan: stmt.sourceSpan,
                target: initializer.name,
                operator: "=",
                value: initializer.initializer,
              } as StatementIR,
              condition: rewriteIdentifiers(stmt.condition),
              increment: stmt.increment ? rewriteStmt(stmt.increment) : stmt.increment,
              body: rewriteStmts(stmt.body),
            };
          }
        }
        return {
          ...stmt,
          initializer,
          condition: rewriteIdentifiers(stmt.condition),
          increment: stmt.increment ? rewriteStmt(stmt.increment) : stmt.increment,
          body: rewriteStmts(stmt.body),
        };
      }
      case "for_of":
      case "for_in": {
        const variable = rewriteStmt(stmt.variable);
        const iterableKey = stmt.kind === "for_of" ? "iterable" : "object";
        return {
          ...stmt,
          variable,
          [iterableKey]: rewriteIdentifiers((stmt as unknown as { iterable?: ExpressionIR; object?: ExpressionIR })[iterableKey])!,
          body: rewriteStmts(stmt.body),
        } as StatementIR;
      }
      case "do_while":
        return { ...stmt, body: rewriteStmts(stmt.body), condition: rewriteIdentifiers(stmt.condition)! };
      case "block":
        return { ...stmt, body: rewriteStmts(stmt.body) };
      default:
        return stmt;
    }
  };

  const body = rewriteStmts(fnStatements);

  // ── Pass 3: emit — the Duff's-device body with in-place await splits ────
  // Raw/emit text (template-literal fragments, op-carried `k_msleep(waitMs)`,
  // HAL body lines) is PRE-RENDERED at IR-build time, so the identifier-node
  // rewrite above cannot reach names inside it. Post-process every emitted
  // line with a word-boundary rename that skips string literals — a hoisted
  // name inside quotes is text, not a reference. Shadowing (a local sharing
  // a global's name, with raw text referring to the global) is the accepted
  // gap: it fails the C++ compile loudly rather than silently misbehaving.
  const hoistRenames: Array<[RegExp, string]> = [];
  for (const [name, local] of hoisted.entries()) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // The negative lookbehind excludes MEMBER positions (`Metrics::comfort`,
    // `obj.field`) - the word-boundary rename previously hit the member name
    // inside a qualified callee and produced `Metrics::_v_comfort` (a member
    // of the namespace that does not exist). Only BARE identifier references
    // to the hoisted local rename.
    hoistRenames.push([new RegExp(`(?<=[^.:>\\w])${esc}\\b`, "g"), local.member]);
    // A reserved-named local (`const auto = ...`) renders under its ESCAPED
    // spelling in pre-rendered raw text — identifier lowering applies
    // escapeCppKeyword at IR build — while the hoist maps the ORIGINAL name.
    // Without the second rule, template fragments kept `auto_` while the
    // member became `_v_auto` ("'auto_' was not declared").
    const escaped = escapeCppKeyword(name);
    if (escaped !== name) {
      hoistRenames.push([new RegExp(`\\b${escaped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), local.member]);
    }
  }
  // Pointer members: user code writes `obj.method()` / `obj.field` on the TS
  // instance; the hoisted member is a C++ POINTER, so member accesses arrow.
  // The renderer's own arrow fallback only sees global pointer types, and the
  // task body renders outside the scope that declared the local.
  const pointerArrowRenames: Array<[RegExp, string]> = Array.from(hoisted.values())
    .filter((l) => l.cppType.trim().endsWith("*"))
    .map((l) => [new RegExp(`\\b${l.member.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(?=[A-Za-z_])`, "g"), `${l.member}->`] as [RegExp, string]);
  const renameRawText = (line: string): string => {
    if ((hoistRenames.length === 0 && pointerArrowRenames.length === 0) || line.length === 0) return line;
    let out = "";
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      if (c === '"' || c === "'") {
        const quote = c;
        out += c;
        i += 1;
        while (i < line.length) {
          out += line[i];
          if (line[i] === "\\") {
            if (i + 1 < line.length) { out += line[i + 1]; i += 2; continue; }
          } else if (line[i] === quote) {
            i += 1;
            break;
          }
          i += 1;
        }
        continue;
      }
      let next = line.length;
      for (const q of ['"', "'"]) {
        const at = line.indexOf(q, i);
        if (at >= 0 && at < next) next = at;
      }
      let segment = line.slice(i, next);
      for (const [re, member] of hoistRenames) segment = segment.replace(re, member);
      for (const [re, arrow] of pointerArrowRenames) segment = segment.replace(re, arrow);
      out += segment;
      i = next;
    }
    return out;
  };

  // ── Pass 3: emit — the Duff's-device body with in-place await splits ────
  // Pointer-typed hoisted locals (cppType ends in *): the renderer arrows a
  // member call's leading `obj.` → `obj->` only when it can see the receiver's
  // pointer-ness, and the async body renders outside the scope that declared
  // it. Thread the member→type map through the renderStatement channel.
  const hoistedPointerTypes = new Map<string, string>(
    Array.from(hoisted.values())
      .filter((l) => l.cppType.trim().endsWith("*"))
      .map((l) => [l.member, l.cppType] as [string, string]),
  );
  // Helper: render a non-await statement (returns possibly multi-line text:
  // renderWithPrelude joins prelude + statement with newlines).
  const renderStmt = (stmt: StatementIR): string =>
    renderStatement(stmt, false, strategy, hoistedPointerTypes, undefined, knownFunctionReturnTypes);
  const renderHeaderStmt = (stmt: StatementIR): string =>
    renderStatement(stmt, true, strategy, hoistedPointerTypes, undefined, knownFunctionReturnTypes);

  let stateCounter = 1; // STATE_0 is the entry state
  const edgeMembers = new Set<string>();
  const tapSites = new Map<number, { member: string; nodeIndex: number }>();
  const emittedLines: string[] = [];

  /** Render a statement's header (`while (cond)` / `if (cond)`) with the
   *  condition fully lowered. */
  const renderConditionHeader = (kind: "while", condition: ExpressionIR, span: StatementIR["sourceSpan"]): string =>
    renderStmt({ kind, sourceSpan: span, condition, body: [] });

  const classifyAwait = (stmt: Extract<StatementIR, { kind: "call" }>): AwaitMarker => {
    if (stmt.callee === "__EMIT__" && stmt.args.length > 0) {
      const argText = stmt.args[0].kind === "string"
        ? (stmt.args[0] as Extract<ExpressionIR, { kind: "string" }>).value
        : renderExpression(stmt.args[0], strategy);
      const info = parseEdgeMarker(argText);
      if (info) return { kind: "edge", ...info };
    }
    if (stmt.callee === "__UI_TAP__" && stmt.args.length > 0) {
      const nodeArg = stmt.args[0];
      const nodeIndex = nodeArg.kind === "number"
        ? (nodeArg as Extract<ExpressionIR, { kind: "number" }>).value
        : -1;
      return { kind: "tap", nodeIndex };
    }
    if (
      (stmt.callee === "__WIFI_WAIT__" || stmt.callee === "__HTTP_WAIT__" || stmt.callee === "__BLE_WAIT__" || stmt.callee === "__HAL_WAIT__") &&
      stmt.args[0]?.kind === "hal-expr"
    ) {
      const op = (stmt.args[0] as Extract<ExpressionIR, { kind: "hal-expr" }>).operation;
      const info = netWaitInfo(op, strategy, (operation) => {
        options?.onUnsupportedAwait?.(`__HAL_WAIT__(${operation})`, undefined);
      });
      return { kind: "net", info };
    }
    if (stmt.callee === "__ASYNC_YIELD__") {
      // Async.yield(): resume on the NEXT pump pass — the other tasks run
      // once between the yield and the resume. No gate: run() returns after
      // arming the state, and the resume label falls through immediately.
      return { kind: "pass" };
    }
    return { kind: "plain" };
  };

  /** Emit the arm (start the wait) + yield + resume label + gate (early
   *  return until the wait fires) for one awaited call, at nesting depth
   *  `pad`. This is the in-place split that makes nested awaits work. */
  const emitAwaitArm = (stmt: Extract<StatementIR, { kind: "call" }>, pad: string, inRangeFor: boolean): void => {
    if (inRangeFor) {
      unsupported(
        "async-unsupported-statement",
        `await inside a for..of/for..in body of ${fnName}() is not supported — the range-for declares its loop variable in the header, which a resume label cannot jump past. Rewrite as an index loop.`,
        stmt.sourceSpan,
      );
    }
    const idx = stateCounter++;
    const marker = classifyAwait(stmt);
    const label = `State::STATE_${idx}`;

    // ── arm: start the wait before yielding ──
    if (marker.kind === "edge") {
      const member = `_edgePrev_p${marker.pin}`;
      edgeMembers.add(member);
      emittedLines.push(renameRawText(`${pad}${member} = ${readPin(marker.pin)};`));
      if (marker.timeout !== null) {
        emittedLines.push(renameRawText(`${pad}_waitUntil = ${now} + ${marker.timeout};`));
      }
    } else if (marker.kind === "tap") {
      const member = `_tapPrev_${idx}`;
      tapSites.set(idx, { member, nodeIndex: marker.nodeIndex });
      emittedLines.push(renameRawText(`${pad}${member} = __ui_tap_seq;`));
    } else if (marker.kind === "net") {
      for (const startLine of marker.info.startLines) emittedLines.push(renameRawText(`${pad}${startLine}`));
      if (marker.info.timeoutExpr !== null) {
        emittedLines.push(renameRawText(`${pad}_waitUntil = ${now} + ${marker.info.timeoutExpr};`));
      }
    } else if (marker.kind === "pass") {
      // No start statements — the yield IS the state transition below.
    } else {
      // Plain timed wait (await delay(ms)) — arm its deadline. Anything whose
      // callee is not a known timer shape has no cooperative lowering here:
      // the call itself is NOT rendered (only marker/net awaits carry start
      // code), so report it instead of silently dropping it.
      if (!PLAIN_AWAIT_CALLEES.has(stmt.callee)) {
        options?.onUnsupportedAwait?.(stmt.callee, stmt.sourceSpan);
      }
      const ms = stmt.args[0] ? renderExpression(stmt.args[0], strategy) : "0";
      emittedLines.push(renameRawText(`${pad}_waitUntil = ${now} + ${ms};`));
    }

    // ── yield ──
    emittedLines.push(`${pad}_state = ${label};`);
    emittedLines.push(`${pad}return;`);

    // ── resume label + gate ──
    emittedLines.push(`${pad}case ${label}:`);
    if (marker.kind === "edge") {
      const member = `_edgePrev_p${marker.pin}`;
      const cond = marker.edge === "rising"
        ? `${member} == LOW && _cur == HIGH`
        : `${member} == HIGH && _cur == LOW`;
      const fullCond = marker.timeout !== null
        ? `(${cond}) || ${now} >= _waitUntil`
        : cond;
      emittedLines.push(renameRawText(`${pad}{`));
      emittedLines.push(renameRawText(`${pad}  int _cur = ${readPin(marker.pin)};`));
      emittedLines.push(renameRawText(`${pad}  if (!(${fullCond})) { ${member} = _cur; return; }`));
      emittedLines.push(renameRawText(`${pad}  ${member} = _cur;`));
      emittedLines.push(renameRawText(`${pad}}`));
    } else if (marker.kind === "tap") {
      const site = tapSites.get(idx)!;
      const cond = site.nodeIndex < 0
        ? `__ui_tap_seq != ${site.member}`
        : `(__ui_tap_seq != ${site.member}) && (__ui_tap_node == ${site.nodeIndex})`;
      emittedLines.push(renameRawText(`${pad}if (!(${cond})) { return; }`));
    } else if (marker.kind === "net") {
      const info = marker.info;
      const deadline = `${now} >= _waitUntil`;
      const cond = info.pollCond === null
        ? deadline
        : info.timeoutExpr !== null
          ? `(${info.pollCond}) || ${deadline}`
          : info.pollCond;
      emittedLines.push(renameRawText(`${pad}if (!(${cond})) { return; }`));
    } else if (marker.kind === "pass") {
      // No gate — the resume happens on the next pump pass by construction
      // (run() returned; the pump calls it again after the other tasks ran).
      // The label still needs A statement after it (a case label at the end
      // of a compound statement is ill-formed) — the empty statement.
      emittedLines.push(renameRawText(`${pad};`));
    } else {
      emittedLines.push(renameRawText(`${pad}if (${now} < _waitUntil) { return; }`));
    }
  };

  /** A hoisted var_decl renders as `<type> _v_x = <init>;` — strip the
   *  declaration so only the assignment remains (the member persists in the
   *  class). A bare declaration (no initializer) emits nothing. */
  const emitHoistedDecl = (stmt: Extract<StatementIR, { kind: "var_decl" }>, pad: string): void => {
    const text = renderStmt(stmt);
    const lines = text.split("\n");
    const last = lines.pop() ?? "";
    const at = last.indexOf(stmt.name);
    if (at < 0) {
      emittedLines.push(renameRawText(`${pad}${text}`));
      return;
    }
    const tail = last.slice(at + stmt.name.length);
    if (tail.trimStart().startsWith("=")) {
      // keep any prelude lines (snprintf buffers), then the assignment
      for (const l of lines) emittedLines.push(renameRawText(`${pad}${l}`));
      emittedLines.push(renameRawText(`${pad}${stmt.name}${tail}`));
    } else if (lines.length > 0) {
      for (const l of lines) emittedLines.push(renameRawText(`${pad}${l}`));
    }
  };

  const emitStmts = (stmts: StatementIR[], pad: string, inRangeFor: boolean): void => {
    for (const stmt of stmts) emitStmt(stmt, pad, inRangeFor);
  };

  const emitStmt = (stmt: StatementIR, pad: string, inRangeFor: boolean): void => {
    switch (stmt.kind) {
      case "call":
        if (stmt.isAwaited) {
          emitAwaitArm(stmt, pad, inRangeFor);
          return;
        }
        emittedLines.push(renameRawText(`${pad}${renderStmt(stmt)}`));
        return;
      case "var_decl": {
        if (hoisted.has(stmt.name.replace(/^_v_/, "")) && stmt.name.startsWith("_v_")) {
          emitHoistedDecl(stmt, pad);
          return;
        }
        emittedLines.push(renameRawText(`${pad}${renderStmt(stmt)}`));
        return;
      }
      case "while":
        emittedLines.push(renameRawText(`${pad}${renderConditionHeader("while", stmt.condition, stmt.sourceSpan)}`));
        emittedLines.push(renameRawText(`${pad}{`));
        emitStmts(stmt.body, `${pad}  `, inRangeFor);
        emittedLines.push(renameRawText(`${pad}}`));
        return;
      case "if":
        emittedLines.push(renameRawText(`${pad}${renderStmt(stmt)}`));
        emittedLines.push(renameRawText(`${pad}{`));
        emitStmts(stmt.thenBranch, `${pad}  `, inRangeFor);
        emittedLines.push(renameRawText(`${pad}}`));
        if (stmt.elseBranch && stmt.elseBranch.length > 0) {
          emittedLines.push(renameRawText(`${pad}else {`));
          emitStmts(stmt.elseBranch, `${pad}  `, inRangeFor);
          emittedLines.push(renameRawText(`${pad}}`));
        }
        return;
      case "for": {
        // A for header that declares its variable (`for (double i = 0; …)`)
        // puts an initialization where a resume label cannot jump past it.
        // Emit the declaration as its own statement before the loop and
        // render the header initializer-free (`for (; …; …)`). Hoisted
        // initializers were already rewritten to assigns above, which are
        // safe in the header — only var_decl initializers need the split.
        if (stmt.initializer && stmt.initializer.kind === "var_decl") {
          emitStmt(stmt.initializer, pad, inRangeFor);
          emittedLines.push(renameRawText(`${pad}${renderStmt({ ...stmt, initializer: undefined })}`));
        } else {
          emittedLines.push(renameRawText(`${pad}${renderStmt(stmt)}`));
        }
        emittedLines.push(renameRawText(`${pad}{`));
        emitStmts(stmt.body, `${pad}  `, inRangeFor);
        emittedLines.push(renameRawText(`${pad}}`));
        return;
      }
      case "for_of":
      case "for_in": {
        emittedLines.push(renameRawText(`${pad}${renderStmt(stmt)}`));
        emittedLines.push(renameRawText(`${pad}{`));
        emitStmts(stmt.body, `${pad}  `, true);
        emittedLines.push(renameRawText(`${pad}}`));
        return;
      }
      case "do_while": {
        emittedLines.push(renameRawText(`${pad}do`));
        emittedLines.push(renameRawText(`${pad}{`));
        emitStmts(stmt.body, `${pad}  `, inRangeFor);
        // The statement renderer returns only `do` for do_while — render the
        // condition through a synthetic while header and strip the keyword.
        const header = renderConditionHeader("while", stmt.condition, stmt.sourceSpan);
        const cond = header.replace(/^\s*while\s*\(/, "").replace(/\)\s*$/, "");
        emittedLines.push(renameRawText(`${pad}} while (${cond});`));
        return;
      }
      case "block":
        emittedLines.push(renameRawText(`${pad}{`));
        emitStmts(stmt.body, `${pad}  `, inRangeFor);
        emittedLines.push(renameRawText(`${pad}}`));
        return;
      case "return":
        // A bare return exits run() — rewind to DONE so the task completes
        // instead of re-executing the current continuation forever.
        if (stmt.value) {
          emittedLines.push(renameRawText(`${pad}${renderStmt(stmt)}`));
          return;
        }
        emittedLines.push(renameRawText(`${pad}_state = State::STATE_DONE;`));
        emittedLines.push(renameRawText(`${pad}return;`));
        return;
      default:
        emittedLines.push(renameRawText(`${pad}${renderStmt(stmt)}`));
        return;
    }
  };

  emitStmts(body, "      ", false);

  // Fall-off-the-end: the task is done (a `while (true)` body never reaches
  // here — the loop just keeps running inside the case).
  emittedLines.push("      _state = State::STATE_DONE;");
  emittedLines.push("      return;");

  // ── Class assembly ───────────────────────────────────────────────────────
  const stateNames = ["STATE_0"];
  for (let i = 1; i < stateCounter; i++) stateNames.push(`STATE_${i}`);
  stateNames.push("STATE_DONE");

  const hoistedArr = Array.from(hoisted.values());
  const edgeMemberArr = Array.from(edgeMembers);
  const inits: string[] = [`_state(State::STATE_0)`, `_waitUntil(0)`];
  for (const m of edgeMemberArr) inits.push(`${m}(LOW)`);
  for (const site of tapSites.values()) inits.push(`${site.member}(0)`);
  for (const l of hoistedArr) inits.push(`${l.member}{}`);
  // Owner pointer (async methods): initialized null, bound by start(owner).
  // Declared last / initialized last so the initializer list order matches.
  if (owner) inits.push("_owner(nullptr)");
  const ctorInitList = inits.join(", ");
  const edgeResetList = edgeMemberArr.map((m) => ` ${m} = LOW;`).join("");
  const tapResetList = Array.from(tapSites.values()).map((s) => ` ${s.member} = 0;`).join("");
  const edgeMemberDecls = edgeMemberArr.map((m) => `  int ${m};`);
  // __ui_tap_seq is uint32_t; the snapshot must match to detect bumps correctly.
  const tapMemberDecls = Array.from(tapSites.values()).map((s) => `  uint32_t ${s.member};`);
  // Strategy-normalize each hoisted member type: a `string` local's IR type
  // is std::string, but on a const char* string target (Zephyr/Arduino) every
  // helper taking/returning strings is const char* — a `std::string _v_line`
  // member made `dispatch(_v_line)` / `strlen(_v_line)` / substring calls
  // fail g++ ("cannot convert std::string to const char*").
  const hoistedMemberDecls = hoistedArr.map((l) => `  ${strategy.normalizeCppType(l.cppType)} ${l.member};`);
  const ownerMemberDecl = owner ? [`  ${owner}* _owner;`] : [];
  const runGuard = owner ? [`    if (_owner == nullptr) { return; }`] : [];
  // start(owner): (re)bind the receiver and rewind the machine. Calling the
  // async method again restarts the task with the new receiver — the task
  // is a singleton per method, mirroring the free-function tasks.
  const startMethod = owner ? [
    `  void start(${owner}* owner) {`,
    `    _owner = owner;`,
    `    _state = State::STATE_0;`,
    `    _waitUntil = 0;${edgeResetList}${tapResetList}`,
    `  }`,
  ] : [];

  const classDef = [
    `// Async state machine for ${fnName}`,
    `class ${className} {`,
    `public:`,
    `  enum class State { ${stateNames.join(", ")} };`,
    `  ${className}() : ${ctorInitList} {}`,
    ...startMethod,
    `  void run() {`,
    ...runGuard,
    `    switch (_state) {`,
    `      case State::STATE_0: {`,
    ...emittedLines,
    `      }`,
    `      case State::STATE_DONE:`,
    `        break;`,
    `    }`,
    `  }`,
    `  bool isComplete() const { return _state == State::STATE_DONE; }`,
    `  void reset() { _state = State::STATE_0; _waitUntil = 0;${edgeResetList}${tapResetList} }`,
    `private:`,
    `  State _state;`,
    `  unsigned long _waitUntil;`,
    ...edgeMemberDecls,
    ...tapMemberDecls,
    ...hoistedMemberDecls,
    ...ownerMemberDecl,
    `};`,
  ].join("\n");

  const starterDef = owner
    ? `void ${starterName}(${owner}* owner) { ${instanceName}.start(owner); }`
    : undefined;

  return { classDef, instanceDecl: `${className} ${instanceName};`, taskVarName: instanceName, starterDef };
}

/** Infer a concrete member type for an `auto`-deduced local from its
 *  initializer shape, for hoisting into the task class. Returns null when
 *  the shape carries no type signal (leave the declaration in place — the
 *  C++ compile fails loudly if an await then crosses it).
 *
 *  JS-number semantics: numeric-valued initializers are `double` — the
 *  repo-wide lowering of TS `number`. Boolean/comparison shapes are `bool`.
 *  String literals are `const char*`. HAL expressions consult the op's
 *  registered C++ return type. */
function inferAutoMemberType(init: ExpressionIR | undefined): string | null {
  if (!init) return null;
  switch (init.kind) {
    case "boolean":
      return "bool";
    case "number":
      return "double";
    case "string":
      return "const char*";
    case "binary": {
      // Comparisons/logic are boolean; arithmetic is double-valued.
      const ops = ["==", "!=", "<", ">", "<=", ">=", "&&", "||"];
      return ops.includes(init.operator) ? "bool" : "double";
    }
    case "unary":
      return init.operator === "!" ? "bool" : "double";
    case "ternary":
      return "double";
    case "paren":
      return inferAutoMemberType(init.inner);
    case "await":
      return inferAutoMemberType(init.value);
    case "hal-expr":
      return cppTypeForHalOp(init.operation.operation) ?? "double";
    case "raw": {
      const t = init.value.trim();
      if (t === "true" || t === "false") return "bool";
      if (t.startsWith('"')) return "const char*";
      // String-method helper calls (`__tc_charAt(s, i)`, `__tc_toUpperCase(s)`,
      // `__tc_substring2(...)`, ...) produce strings — the strategy normalizes
      // the member declaration (std::string → const char* on embedded). A
      // charAt result used to fall to the numeric default and hoisted as
      // `double _v_ch`, failing g++ on the const char* assignment.
      if (/^__tc_(?:toUpperCase|toLowerCase|trim|replace|charAt|substring\d?|slice\d?|padStart(?:_default)?|padEnd(?:_default)?|repeat|toFixed|jsonStringify)\(/.test(t)) {
        return "std::string";
      }
      if (/^__tc_num_radix\(/.test(t)) return "const char*";
      if (/^static_cast<(?:bool|int\d*_t|uint\d*_t)>/.test(t)) {
        return /bool/.test(t) ? "bool" : "int32_t";
      }
      // static_cast<double>, numeric literals, comma-expr of numeric calls,
      // method-call text — all double under JS-number semantics.
      return "double";
    }
    default:
      // method-call / property-access of unknown return: reportJson-style
      // helpers with recorded returns never arrive here as `auto`; treat
      // the rest as double (JS number) — the overwhelmingly common shape.
      return "double";
  }
}

/** Find the source span of the first declaration of `name` (diagnostics). */
function findDeclSpan(stmts: StatementIR[], name: string): StatementIR["sourceSpan"] | undefined {
  for (const stmt of stmts) {
    if (stmt.kind === "var_decl" && stmt.name === name) return stmt.sourceSpan;
    const nested: StatementIR[][] = [];
    if (stmt.kind === "while" || stmt.kind === "do_while" || stmt.kind === "block") nested.push(stmt.body);
    if (stmt.kind === "if") {
      nested.push(stmt.thenBranch);
      if (stmt.elseBranch) nested.push(stmt.elseBranch);
    }
    if (stmt.kind === "for") {
      if (stmt.initializer) nested.push([stmt.initializer]);
      nested.push(stmt.body);
    }
    if (stmt.kind === "for_of" || stmt.kind === "for_in") {
      nested.push([stmt.variable]);
      nested.push(stmt.body);
    }
    for (const list of nested) {
      const span = findDeclSpan(list, name);
      if (span) return span;
    }
  }
  return undefined;
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
function netWaitInfo(op: HALOpIR, strategy: PlatformStrategy, onUnhandled?: (operation: string) => void): NetWaitInfo {
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
  if (!blocking || (!blocking.code && !blocking.expression)) {
    onUnhandled?.(op.operation);
  }
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
