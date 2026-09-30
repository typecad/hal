import ts from "typescript";
import { ExpressionIR } from "../api/index.js";
import { nestedFunctionAliases, getContext, activeEnumNames, activeStringEnumNames } from "./build-ir-state.js";
import { getCurrentIrTypeScope } from "./symbol-types.js";
import { escapeCppKeyword, escapeCppStringLiteral } from "../utils/strings.js";
import { routeHALOp } from "../emit/route-hal-op.js";

export function calleeToText(expr: ts.LeftHandSideExpression): string {
  if (ts.isIdentifier(expr)) {
    const alias = nestedFunctionAliases.get(expr.text);
    return alias ?? expr.text;
  }

  if (ts.isPropertyAccessExpression(expr)) {
    return `${calleeToText(expr.expression as ts.LeftHandSideExpression)}.${expr.name.text}`;
  }

  return expr.getText();
}

/**
 * Push a diagnostic onto the current build's diagnostics sink (the same array
 * returned in ProgramIR.diagnostics). No-op if no build is in progress (e.g.
 * ad-hoc calls from tests), so renderExprAsText remains usable in isolation.
 */
function pushDiagnostic(severity: "error" | "warning", code: string, message: string): void {
  const diagnostics = getContext().diagnostics;
  if (!diagnostics) return;
  diagnostics.push({ severity, message, code });
}

export function renderExprAsText(expr: ExpressionIR): string {
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
      // Route through the shared `escapeCppStringLiteral` helper (the SAME one
      // the template-literal / snprintf path uses) so a standalone-rendered
      // string literal is escaped identically to one rendered inside a template
      // literal. Previously this only escaped `"` — so a literal whose decoded
      // text held a control char or backslash (e.g. a `'\n'`/`'\t'`/`'\\'`
      // argument to an array/string method) emitted a RAW newline/tab/backslash
      // inside the C++ string literal, producing an unterminated literal that
      // corrupted lexing of the entire rest of the file. Demo #29 Finding A.
      return `"${escapeCppStringLiteral(expr.value)}"`;
    case "boolean":
      return expr.value ? "true" : "false";
    case "identifier":
      return expr.value;
    case "raw":
      return expr.value;
    case "element-access":
      return `${renderExprAsText(expr.object)}[${renderExprAsText(expr.index)}]`;
    case "tuple-access":
      return `std::get<${expr.index}>(${renderExprAsText(expr.object)})`;
    case "await":
      return renderExprAsText(expr.value);
    case "ternary":
      return `(${renderExprAsText(expr.condition)} ? ${renderExprAsText(expr.whenTrue)} : ${renderExprAsText(expr.whenFalse)})`;
    case "array": {
      const elements = expr.elements.map((e) => renderExprAsText(e)).join(", ");
      return `{ ${elements} }`;
    }
    case "object":
      const fieldValues = expr.fields.map((f) => `${renderExprAsText(f.value)}`).join(", ");
      return `{ ${fieldValues} }`;
    case "binary": {
      // JS `/` is real division even for int operands. Text rendered on the
      // IR side (string-method helper args, e.g. `__tc_toFixed(sum / n, 2)`)
      // previously baked integer division into the raw text — the emit-side
      // promotion (expression-renderer renderBinary) never saw it, so the
      // mean truncated. Mirror the same strategy-gated promotion here.
      if (expr.operator === "/" && getContext()?.activeStrategy?.promoteDivisionToDouble?.()) {
        const l = renderExprAsText(expr.left);
        const r = renderExprAsText(expr.right);
        return `static_cast<double>(${l}) / static_cast<double>(${r})`;
      }
      // JS bitwise coercion (IR-flattened twin of the emit renderer's arm):
      // `& | ^ << >>` coerce operands to int32; `>>>` also when the LEFT is
      // floating. C++ `^`/`<<` on doubles is a hard error; helper args
      // flattened here (`hexByte((v >> 4) & 0xF)` into a template part)
      // never reach the emit-side cast. Only identifiers need the type
      // lookup — literals are ints, and a recorded double/auto type means
      // the operand must truncate through static_cast<int>.
      if (["&", "|", "^", "<<", ">>", ">>>"].includes(expr.operator)) {
        const floatText = (e: ExpressionIR): string | undefined => {
          if (e.kind !== "identifier") return undefined;
          const t = getCurrentIrTypeScope()?.locals.get(e.value) ?? getCurrentIrTypeScope()?.globals.get(e.value);
          if (t === undefined || t === "auto" || t === "double" || t === "float") {
            return renderExprAsText(e);
          }
          return undefined;
        };
        const lFloat = floatText(expr.left);
        const rFloat = floatText(expr.right);
        const l = lFloat !== undefined ? `static_cast<int>(${lFloat})` : renderExprAsText(expr.left);
        const r = rFloat !== undefined ? `static_cast<int>(${rFloat})` : renderExprAsText(expr.right);
        if (expr.operator === ">>>") {
          return `(static_cast<unsigned int>(${lFloat ?? renderExprAsText(expr.left)}) >> ${r})`;
        }
        return `(${l} ${expr.operator} ${r})`;
      }
      // Numeric-enum operands in arithmetic/bitwise position: C++ enum class
      // has NO implicit int conversion, so `mode + 1` flattened to raw text
      // fails g++ ("no match for operator+ (Mode and int)"). The emit layer
      // (renderBinary → castEnumOperandsForOperator) handles structured
      // binaries; IR-flattened contexts (an `as Enum` wrapper flattens its
      // inner expression) never reach it — mirror the cast here.
      if (["+", "-", "*", "/", "%", "&", "|", "^", "<<", ">>"].includes(expr.operator)) {
        const leftIsStr = expr.left.kind === "string" || expr.left.kind === "string_concat" || expr.left.kind === "template_string";
        const rightIsStr = expr.right.kind === "string" || expr.right.kind === "string_concat" || expr.right.kind === "template_string";
        if (expr.operator !== "+" || (!leftIsStr && !rightIsStr)) {
          const enumSafe = (e: ExpressionIR, text: string): string => {
            if (e.kind !== "identifier") return text;
            const t = getCurrentIrTypeScope()?.locals.get(e.value) ?? getCurrentIrTypeScope()?.globals.get(e.value);
            if (t && activeEnumNames.has(t) && !activeStringEnumNames.has(t)) {
              return `static_cast<int>(${text})`;
            }
            return text;
          };
          const l = renderExprAsText(expr.left);
          const r = renderExprAsText(expr.right);
          return `${enumSafe(expr.left, l)} ${expr.operator} ${enumSafe(expr.right, r)}`;
        }
      }
      return `${renderExprAsText(expr.left)} ${expr.operator} ${renderExprAsText(expr.right)}`;
    }
    case "unary":
      return `${expr.operator}${renderExprAsText(expr.operand)}`;
    case "property-access": {
      const objText = renderExprAsText(expr.object);
      // The member name is a C++ TOKEN — escape reserved words exactly like
      // the emit-side renderer (escapeCppKeyword). A record field named
      // `auto` rendered here un-escaped (`cfg->auto`) is a hard parse error;
      // the emit renderer already renames it `auto_`, so this side drifted.
      const safeProperty = escapeCppKeyword(expr.property, getContext().activeStrategy?.reservedNames?.());
      if (expr.isEnum || expr.isNamespace || expr.isStatic) {
        return `${objText}::${safeProperty}`;
      }
      const isPointer = expr.isPointer || (expr.object.kind === "raw" && expr.object.value === "this");
      const sep = isPointer ? "->" : ".";
      return `${objText}${sep}${safeProperty}`;
    }
    case "paren":
      return `(${renderExprAsText(expr.inner)})`;
    case "callback":
      return `/* __callback__ */`;
    case "lambda":
      return `/* __lambda__ */`;
    case "method-call": {
      // Structured-receiver path: when the method-call IR carries a receiverExpr
      // (set by the safe.read().ok().fail() chain builder), render the receiver
      // recursively so nested lambda args are NOT flattened into the callee
      // string as /* __lambda__ */ placeholders. The flat callee path below
      // destroys lambdas; this preserves them.
      const receiverExpr = (expr as { receiverExpr?: ExpressionIR }).receiverExpr;
      const methodName = (expr as { methodName?: string }).methodName;
      if (receiverExpr !== undefined && methodName !== undefined) {
        const argsText = expr.args.map(a => renderExprAsText(a)).join(", ");
        return `${renderExprAsText(receiverExpr)}.${methodName}(${argsText})`;
      }
      const argsText = expr.args.map(a => renderExprAsText(a)).join(", ");
      // Rest-parameter functions take ONE vector — collect plain args into
      // the braced init, mirroring renderMethodCall. IR-flattened contexts
      // (a call interpolated into a template literal) used to emit
      // `sum(1, 2, 3)` bare against a `const std::vector<double>&` param.
      const restElementType = (expr as { restElementType?: string }).restElementType;
      const restHasSpread = (expr as { restHasSpread?: boolean }).restHasSpread;
      const finalArgs = restElementType && !restHasSpread
        ? `std::vector<${restElementType}>{${argsText}}`
        : argsText;
      return `${expr.callee}(${finalArgs})`;
    }
    case "template_string":
      // NOTE: deliberately a passthrough. A template string is JS's
      // toString(), but this flattener feeds BOTH pure-IR consumers (map
      // keys — see the element-access conversion in expression-to-ir) and
      // emit-side snprintf part builders that classify and format the text
      // themselves. Wrapping here broke the latter (a part pre-wrapped in a
      // string helper hit a %d/%g slot as std::string). The map-key sites
      // that genuinely need a string convert at their own edge.
      return renderExprAsText(expr.expression);
    case "string_concat":
      return expr.parts.map(p => renderExprAsText(p)).join(" + ");
    case "hal-expr": {
      const strategy = getContext().activeStrategy;
      if (strategy?.resolveHALOperation || strategy?.resolveDisplayOp) {
        const resolved = routeHALOp(expr.operation, strategy);
        if (resolved?.expression) return resolved.expression;
        if (resolved?.code) return resolved.code.replace(/;\s*$/, "");
      }
      // Unregistered HAL op: surface as a warning so the user sees it, but keep
      // HAL as an extensibility point (a strategy may intentionally leave some
      // ops unimplemented). The bare comment is retained as a visual marker.
      pushDiagnostic(
        "warning",
        "TS2CPP_UNHANDLED_HAL",
        `HAL operation '${expr.operation.operation}' is not registered with the platform strategy; emitting a placeholder comment.`,
      );
      return `/* unhandled hal-expr: ${expr.operation.operation} */`;
    }
    case "instanceof":
      return `(typeid(*${renderExprAsText(expr.object)}) == typeid(${expr.className}))`;
    case "spread_array":
      return renderExprAsText(expr.spreadExpr);
    default: {
      // An ExpressionIR kind renderExprAsText doesn't know how to render is a
      // transpiler bug (the renderer should cover every kind the IR builders
      // can produce). Previously this silently emitted "0 /* unsupported_expr */"
      // into the C++ output. Now we push an error diagnostic — the fatal-gate
      // check in transpile.ts aborts the build — and throw so that callers
      // running outside the build (e.g. tests) fail loudly rather than
      // continuing with placeholder C++.
      const kind = (expr as { kind?: string }).kind ?? "<unknown>";
      pushDiagnostic(
        "error",
        "TS2CPP_UNSUPPORTED_EXPR",
        `Expression IR kind '${kind}' has no renderer and cannot be emitted to C++.`,
      );
      throw new Error(`renderExprAsText: unsupported ExpressionIR kind '${kind}'`);
    }
  }
}
