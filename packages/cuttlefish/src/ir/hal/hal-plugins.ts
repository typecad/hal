import ts from "typescript";
import { HALOpIR } from "../../api/index.js";
import { HALInstance } from "./hal-parser.js";
import { getCurrentBoardConstants, halInstances, getContext } from "../build-ir-state.js";
import { resolveExpressionText, extractAndRegisterCallbacks } from "./hal-emitter.js";
import { renderExprAsText } from "../render-expr.js";
import type { ExpressionIR } from "../../api/index.js";
import { hasSafetyHook, requireSafetyHook } from "../../safety-hook.js";

/**
 * Split a comma-joined argument list back into individual arguments, respecting
 * nesting (parens/brackets/braces) and string literals so a comma inside one of
 * those does not split. Used to recover the per-arg array from the spread
 * mechanism's comma-joined text (e.g. for printf varargs).
 */
function splitArgList(joined: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  let inString: '"' | "'" | null = null;
  for (let i = 0; i < joined.length; i++) {
    const ch = joined[i];
    if (inString) {
      current += ch;
      if (ch === "\\") {
        // Keep the escaped char with its backslash.
        current += joined[++i] ?? "";
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function resolveI2cBufferArg(
  args: readonly ts.Expression[],
  idx: number,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
  callArgs: ExpressionIR[] | undefined,
): { kind: "bytes"; bytes: (number | string)[] } | { kind: "buffer"; data: string } | null {
  const arg = args[idx];
  if (!arg) return null;

  if (ts.isArrayLiteralExpression(arg)) {
    const bytes = arg.elements.map((element) => {
      if (ts.isNumericLiteral(element)) return Number(element.text);
      return resolveExpressionText(element, instance, paramNames, callArgTexts, paramDefaults) ?? "0";
    });
    return { kind: "bytes", bytes };
  }

  if (ts.isIdentifier(arg) && callArgs) {
    const paramIdx = paramNames.indexOf(arg.text);
    if (paramIdx !== -1) {
      const paramArg = callArgs[paramIdx];
      if (paramArg?.kind === "array") {
        const bytes = paramArg.elements.map((element) => renderExprAsText(element) ?? "0");
        return { kind: "bytes", bytes };
      }
    }
  }

  const data = resolveSemanticArg(args, idx, instance, paramNames, callArgTexts, paramDefaults);
  if (data === null) return null;
  return { kind: "buffer", data };
}

/** Resolve a single argument from a semantic call's AST node list. */
/** Normalize an inline-override text from an instance field: strip the
 *  quotes of a stored string literal and reject unresolved source text
 *  (`this->_x`, expressions) — only clean identifiers/tokens pass. */
function cleanOverrideText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/^["']+|["']+$/g, "").trim();
  return t !== "" && /^[A-Za-z0-9_.:-]+$/.test(t) ? t : undefined;
}

export function resolveSemanticArg(
  args: readonly ts.Expression[],
  idx: number,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
): string | null {
  const arg = args[idx];
  if (!arg) return null;
  return resolveExpressionText(arg, instance, paramNames, callArgTexts, paramDefaults);
}

/** Resolve a numeric argument, returning its numeric value or null. */
export function resolveNumericArg(
  args: readonly ts.Expression[],
  idx: number,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
): number | null {
  const text = resolveSemanticArg(args, idx, instance, paramNames, callArgTexts, paramDefaults);
  if (text === null) return null;
  // R1: Boolean coercion — true → 1, false → 0
  if (text === "true") return 1;
  if (text === "false") return 0;
  const n = Number(text);
  return isNaN(n) ? null : n;
}

/**
 * Resolve an argument that may be a compile-time literal OR a runtime expression.
 * Tries numeric resolution first (for compile-time folding); falls back to the
 * raw expression text for runtime values (variables, computed expressions).
 * Returns the number (if literal) or the expression string, or null if unresolvable.
 */
function resolveNumericOrExpression(
  args: readonly ts.Expression[],
  idx: number,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
): number | string | null {
  const num = resolveNumericArg(args, idx, instance, paramNames, callArgTexts, paramDefaults);
  if (num !== null) return num;
  return resolveSemanticArg(args, idx, instance, paramNames, callArgTexts, paramDefaults);
}

/** Normalize an optional resolved arg: an omitted optional parameter with no
 *  default resolves to the literal text "undefined" (see resolveExpressionText);
 *  map that to null so op builders can omit the field entirely. */
function dropUndefined(value: string | null): string | null {
  return value === "undefined" ? null : value;
}

/** Quote a resolved string value unless it is already a quoted literal or a
 *  plain single identifier (i.e. a runtime variable reference). Dotted text
 *  is NOT passed through: every consumer of this helper feeds a C++ string
 *  parameter (fs paths, preference keys, BLE names, URLs), and a dotted form
 *  like `a.txt` is far more likely a field-tracked literal that lost its
 *  quotes than a valid member-expression argument — emitting it bare is a
 *  compile error ('a' was not declared). */
function quoteNonIdentifier(value: string): string {
  const t = value.trim();
  if (/^".*"$/.test(t)) return t;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) return t;
  return JSON.stringify(t);
}

/** Resolve a BlePerm expression to its numeric bitmask.
 *  Handles: plain numbers (3), "BlePerm.Read", "BlePerm.Read | BlePerm.Notify". */
const BLE_PERM_VALUES: Record<string, number> = {
  Read: 1, Write: 2, Notify: 4,
};
function resolveBlePermExpr(raw: string | number | null): number {
  if (raw === null) return 0;
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return Number(s);
  // Extract all BlePerm.X member names and sum their values.
  let sum = 0;
  const re = /BlePerm\.(\w+)/g;
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = re.exec(s)) !== null) {
    matched = true;
    sum += BLE_PERM_VALUES[m[1]] ?? 0;
  }
  return matched ? sum : 0;
}

/** Extract the MCU port name from the current HAL instance, if available. */
export function portFromInstance(instance: HALInstance): string | undefined {
  const port = instance.fieldValues.get('_port');
  return port && port !== '' ? port : undefined;
}

/**
 * Resolve a boardResolve() argument to a dot-path string.
 * Handles both static string paths ("peripherals.adc.0.resolution") and
 * dynamic paths ("peripherals.adc.0.referenceVoltages." + this._reference).
 */
export function tryResolveBoardResolveArg(
  args: ts.NodeArray<ts.Expression>,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
): string | null {
  const arg = args[0];
  if (!arg) return null;

  // Static string literal: boardResolve("peripherals.adc.0.resolution")
  if (ts.isStringLiteral(arg)) return arg.text;

  // Dynamic path via string concat or template literal. Flatten the expression
  // into a dot-path WITHOUT going through resolveExpressionText (which renders
  // `+` as a C++ expression "a + b", corrupting the path). String literals
  // contribute their text; this._field contributes the resolved field value;
  // template literals contribute head + interpolated spans.
  return resolveConcatPath(arg, instance, paramNames, callArgTexts, paramDefaults);
}

/**
 * Recursively flatten a `+`-concatenation / template-literal expression into a
 * board-resolve dot-path string. Returns null if any operand cannot be
 * resolved to a concrete string fragment.
 */
export function resolveConcatPath(
  expr: ts.Expression,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
): string | null {
  // String literal fragment
  if (ts.isStringLiteral(expr)) return expr.text;

  // No-substitution template literal: `text`
  if (ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;

  // Template expression: `text ${expr} more`
  if (ts.isTemplateExpression(expr)) {
    let result = expr.head.text;
    for (const span of expr.templateSpans) {
      const resolved = resolveConcatPath(span.expression, instance, paramNames, callArgTexts, paramDefaults);
      if (resolved === null) return null;
      result += resolved + span.literal.text;
    }
    return result;
  }

  // Binary `+` concatenation — recurse on both sides
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveConcatPath(expr.left, instance, paramNames, callArgTexts, paramDefaults);
    const right = resolveConcatPath(expr.right, instance, paramNames, callArgTexts, paramDefaults);
    if (left === null || right === null) return null;
    return left + right;
  }

  // Parenthesized expression — unwrap
  if (ts.isParenthesizedExpression(expr)) {
    return resolveConcatPath(expr.expression, instance, paramNames, callArgTexts, paramDefaults);
  }

  // this._field → resolved instance field value (e.g. this._instance → "1")
  if (ts.isPropertyAccessExpression(expr)) {
    const isThis = expr.expression.kind === ts.SyntaxKind.ThisKeyword
      || (ts.isIdentifier(expr.expression) && expr.expression.text === "this")
      || expr.expression.getText() === "this";
    if (isThis) {
      const fieldName = expr.name.text;
      const val = instance.fieldValues.get(fieldName)
        ?? instance.fieldValues.get(fieldName.startsWith("_") ? fieldName.slice(1) : "_" + fieldName);
      if (val !== undefined && val !== null) return val;
    }
  }

  return null;
}

/**
 * Try to resolve a compound return expression that contains semantic calls.
 * For example, `(gpioRead(this._pin) === HIGH)` should produce a halOp for
 * `gpioRead` and return a combined expression with the strategy-resolved form.
 * Returns the resolved text with placeholders, or null if no semantic calls found.
 */
export function tryResolveCompoundSemanticReturn(
  expr: ts.Expression,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
  halOps: HALOpIR[],
  callArgs: any[],
): string | null {
  const semanticPlaceholders: Map<ts.Node, number> = new Map();

  // Walk the expression tree looking for semantic calls
  function findSemanticCalls(node: ts.Expression): boolean {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const semanticOp = tryResolveSemanticCall(
        node.expression.text,
        node.arguments,
        instance, paramNames, callArgTexts, paramDefaults,
        callArgs,
      );
      if (semanticOp) {
        halOps.push(semanticOp);
        semanticPlaceholders.set(node, halOps.length - 1);
        return true;
      }
    }
    let found = false;
    if (ts.isBinaryExpression(node)) {
      found = findSemanticCalls(node.left) || findSemanticCalls(node.right);
    } else if (ts.isParenthesizedExpression(node)) {
      found = findSemanticCalls(node.expression);
    } else if (ts.isAsExpression(node)) {
      found = findSemanticCalls(node.expression);
    } else if (ts.isPrefixUnaryExpression(node)) {
      found = findSemanticCalls(node.operand);
    } else if (ts.isConditionalExpression(node)) {
      found = findSemanticCalls(node.condition) || findSemanticCalls(node.whenTrue) || findSemanticCalls(node.whenFalse);
    }
    return found;
  }

  if (!findSemanticCalls(expr)) return null;

  // Now resolve the expression text, substituting semantic calls with their resolved forms
  function resolveWithSemantics(node: ts.Expression): string | null {
    // If this node was a semantic call, return a placeholder for the halOp expression
    const opIdx = semanticPlaceholders.get(node);
    if (opIdx !== undefined) {
      return `__hal_op_expr_${opIdx}__`;
    }

    // Delegate non-semantic parts to resolveExpressionText
    if (ts.isBinaryExpression(node)) {
      const left = resolveWithSemantics(node.left);
      const right = resolveWithSemantics(node.right);
      if (left === null || right === null) return null;
      let op = node.operatorToken.getText();
      if (op === "===") op = "==";
      else if (op === "!==") op = "!=";
      return `${left} ${op} ${right}`;
    }

    if (ts.isParenthesizedExpression(node)) {
      const inner = resolveWithSemantics(node.expression);
      return inner !== null ? `(${inner})` : null;
    }

    if (ts.isAsExpression(node)) {
      // Unwrap type assertions (e.g., gpioRead(pin) as unknown as boolean)
      return resolveWithSemantics(node.expression);
    }

    if (ts.isPrefixUnaryExpression(node)) {
      const operand = resolveWithSemantics(node.operand);
      if (operand === null) return null;
      const op = node.operator === ts.SyntaxKind.ExclamationToken ? "!" : node.operator === ts.SyntaxKind.MinusToken ? "-" : "";
      return `${op}${operand}`;
    }

    // Fall back to text resolution for non-semantic parts
    return resolveExpressionText(node, instance, paramNames, callArgTexts, paramDefaults);
  }

  const resolved = resolveWithSemantics(expr);
  if (resolved === null) return null;

  return resolved.replace(/===/g, "==").replace(/!==/g, "!=");
}

/**
 * Try to resolve a semantic HAL function call to a HALOpIR node.
 * Returns the HALOpIR if the function name is recognized, or null.
 */
export function tryResolveSemanticCall(
  fnName: string,
  args: readonly ts.Expression[],
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
  callArgs?: ExpressionIR[],
): HALOpIR | null {
  // ── Safety (@typecad/safety — safe.read) ────────────────────────────────
  // The safety package owns lowering for `safe.*` callees (v2: only safe.read;
  // safe.pinMode was removed — mode config is the HAL's job via Pin.asInput()
  // etc.). Check the hook before the switch so safety calls never fall
  // through to GPIO/etc. hasSafetyHook() guards the call site (no-op when
  // @typecad/safety absent).
  if (hasSafetyHook()) {
    const op = requireSafetyHook().resolveSemanticCall?.(fnName, callArgs ?? []);
    if (op) return op;
  }

  // Extract MCU port name from instance (set by Pin.fromPort())
  const port = portFromInstance(instance);

  switch (fnName) {
    // ── GPIO ──
    case "gpioWrite": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      // Try literal resolution first (compile-time 0/1/true/false)
      const numValue = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (numValue !== null) {
        return { operation: "gpio.write", port, pin, value: (numValue ? 1 : 0) as 0 | 1 };
      }
      // Fall back to runtime expression (e.g. a variable, negated expression)
      const exprValue = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (exprValue !== null) {
        return { operation: "gpio.write", port, pin, value: exprValue };
      }
      return null;
    }
    case "gpioRead": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "gpio.read", port, pin };
    }
    case "gpioToggle": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "gpio.toggle", port, pin };
    }

;
    case "wdtDisable":
      return { operation: "wdt.disable" };

    case "wifiJoin": {
      const R = resolveSemanticArg;
      const N = resolveNumericArg;
      const ssid = R(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const psk = dropUndefined(R(args, 1, instance, paramNames, callArgTexts, paramDefaults));
      const security = N(args, 2, instance, paramNames, callArgTexts, paramDefaults) ?? (psk !== null ? 1 : 0);
      const channel = N(args, 3, instance, paramNames, callArgTexts, paramDefaults) ?? 0;
      const band = N(args, 4, instance, paramNames, callArgTexts, paramDefaults) ?? 0;
      const timeoutMs = N(args, 5, instance, paramNames, callArgTexts, paramDefaults) ?? 15000;
      const ps = N(args, 6, instance, paramNames, callArgTexts, paramDefaults) ?? 0;
      const ipAddr = dropUndefined(R(args, 7, instance, paramNames, callArgTexts, paramDefaults));
      const gateway = dropUndefined(R(args, 8, instance, paramNames, callArgTexts, paramDefaults));
      const netmask = dropUndefined(R(args, 9, instance, paramNames, callArgTexts, paramDefaults));
      if (ssid === null) return null;
      return {
        operation: "wifi.join", ssid,
        ...(psk !== null ? { psk } : {}),
        security, channel, band, timeoutMs, ps,
        ...(ipAddr !== null && gateway !== null && netmask !== null ? { ipAddr, gateway, netmask } : {}),
      };
    }
    case "wifiConnectStart": {
      const ssid = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const password = dropUndefined(resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults));
      if (ssid === null) return null;
      return { operation: "wifi.connect_start", ssid, ...(password !== null ? { password } : {}) };
    }
    case "wifiDisconnect":
      return { operation: "wifi.disconnect" };
;
    case "wifiIsConnected":
      return { operation: "wifi.is_connected" };
    case "wifiLocalIp":
      return { operation: "wifi.local_ip" };
    case "wifiRssi":
      return { operation: "wifi.rssi" };
    case "wifiMac":
      return { operation: "wifi.mac" };
    case "wifiOnEvent": {
      const event = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const handler = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (event === null || handler === null) return null;
      return { operation: "wifi.on_event", event: String(event).replace(/^["']|["']$/g, ""), handler };
    }
    case "wifiApStart": {
      const ssid = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const password = dropUndefined(resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults));
      const channel = dropUndefined(resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults));
      const hidden = dropUndefined(resolveSemanticArg(args, 3, instance, paramNames, callArgTexts, paramDefaults));
      const maxClients = dropUndefined(resolveSemanticArg(args, 4, instance, paramNames, callArgTexts, paramDefaults));
      if (ssid === null) return null;
      return {
        operation: "wifi.ap_start",
        ssid,
        ...(password !== null ? { password } : {}),
        ...(channel !== null ? { channel } : {}),
        ...(hidden !== null ? { hidden } : {}),
        ...(maxClients !== null ? { maxClients } : {}),
      };
    }
    case "wifiApStop":
      return { operation: "wifi.ap_stop" };
;
;
    case "wifiScan":
      return { operation: "wifi.scan" };
    case "wifiScanCount":
      return { operation: "wifi.scan_count" };
    case "wifiScanSsid": {
      const index = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (index === null) return null;
      return { operation: "wifi.scan_ssid", index };
    }
    case "wifiScanRssi": {
      const index = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (index === null) return null;
      return { operation: "wifi.scan_rssi", index };
    }
    case "wifiScanEncryption": {
      const index = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (index === null) return null;
      return { operation: "wifi.scan_encryption", index };
    }
    case "wifiScanChannel": {
      const index = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (index === null) return null;
      return { operation: "wifi.scan_channel", index };
    }
;
;

    // ── HTTP ──
    case "httpBegin": {
      const method = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const url = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (method === null || url === null) return null;
      // this._url resolved through `new HttpRequest(...)` ctor fields stores
      // string literals without quotes; re-quote anything that isn't already
      // a quoted literal or a plain identifier/member expression so the
      // lowering emits valid C++.
      return { operation: "http.begin", method, url: quoteNonIdentifier(url) };
    }
    case "httpSetHeader": {
      const name = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (name === null || value === null) return null;
      return { operation: "http.set_header", name, value };
    }
    case "httpSetTimeout": {
      const ms = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ms === null) return null;
      return { operation: "http.set_timeout", ms };
    }
    case "httpSetMaxBody": {
      const bytes = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bytes === null) return null;
      return { operation: "http.set_max_body", bytes };
    }
    case "httpSetBody": {
      const data = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const json = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (data === null) return null;
      return { operation: "http.set_body", data, json: json === "true" };
    }
    case "httpSetInsecure": {
      const insecure = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (insecure === null) return null;
      return { operation: "http.set_insecure", insecure: insecure === "true" };
    }
    case "httpSetCaCert": {
      const pem = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pem === null) return null;
      return { operation: "http.set_ca_cert", pem };
    }
    case "httpSend":
      return { operation: "http.send", blocking: true };
    case "httpStatus":
      return { operation: "http.status" };
    case "httpOk":
      return { operation: "http.ok" };
    case "httpBody":
      return { operation: "http.body" };
    case "httpContentLength":
      return { operation: "http.content_length" };
    case "httpResponseHeader": {
      const name = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (name === null) return null;
      return { operation: "http.response_header", name };
    }

    // ── BLE (NimBLE GATT peripheral) ──
    case "bleServerBegin": {
      const name = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (name === null) return null;
      return { operation: "ble.server_begin", name: quoteNonIdentifier(name) };
    }
    case "bleAdvertiseStart":
      return { operation: "ble.advertise_start" };
    case "bleAdvertiseStop":
      return { operation: "ble.advertise_stop" };
    case "bleAddService": {
      const uuid = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (uuid === null) return null;
      return { operation: "ble.add_service", uuid: quoteNonIdentifier(uuid) };
    }
    case "bleAddChar": {
      // The characteristic index is assigned HERE from a per-file counter, not
      // resolved from `this._charCount`. resolveHALReceiver re-resolves the
      // receiver (Ble.server(name)) freshly for each chain level when emitting,
      // so a value stamped onto the instance field in the resolver would be
      // dropped — leaving every characteristic on slot 0, clobbering the
      // previous on_read/on_write handler. Consuming the counter at the single
      // emit site (this plugin, called once per characteristic in declaration
      // order) makes indices sequential (0,1,2,…) and stable. The counter is
      // per-file (reset in resetHALResolver). onRead/onWrite/onConnect don't
      // need a compile-time index — the C++ shim keys them off
      // __tc_ble.current_char, which __tc_ble_add_char sets at runtime from
      // this index.
      const uuid = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const type = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      // Perms arrive as token text ("BlePerm.Read | BlePerm.Notify") —
      // resolveBlePermExpr maps the member names to the bitmask.
      const perms = resolveSemanticArg(args, 3, instance, paramNames, callArgTexts, paramDefaults);
      const svcIndex = resolveNumericArg(args, 4, instance, paramNames, callArgTexts, paramDefaults);
      if (uuid === null || type === null) return null;
      // Resolve BleValueType.X → the enum's string value (e.g. Int16 → 'int16').
      const resolvedType = type.startsWith("BleValueType.")
        ? JSON.stringify(type.replace(/^BleValueType\./, "").toLowerCase())
        : quoteNonIdentifier(type);
      // Resolve BlePerm.X | BlePerm.Y → numeric bitmask.
      // The | expression renders as "BlePerm.Read | BlePerm.Notify" via the
      // binary-expression handler in resolveExpressionText, which keeps the
      // raw text. Evaluate it by extracting member names and mapping to values.
      const resolvedPerms = resolveBlePermExpr(perms);
      return {
        operation: "ble.add_char",
        index: getContext().bleCharCounter++,
        uuid: quoteNonIdentifier(uuid),
        type: resolvedType,
        perms: resolvedPerms,
        svcIndex: svcIndex ?? 0,
      };
    }
    case "bleOnRead": {
      const index = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const handler = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (handler === null) return null;
      return { operation: "ble.on_read", index: index ?? 0, handler };
    }
    case "bleOnWrite": {
      const index = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const handler = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (handler === null) return null;
      return { operation: "ble.on_write", index: index ?? 0, handler };
    }
    case "bleOnConnect": {
      const handler = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (handler === null) return null;
      return { operation: "ble.on_connect", handler };
    }
    case "bleOnDisconnect": {
      const handler = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (handler === null) return null;
      return { operation: "ble.on_disconnect", handler };
    }
    case "bleNotify": {
      const index = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (value === null) return null;
      return { operation: "ble.notify", index: index ?? 0, value };
    }
    case "bleIsConnected":
      return { operation: "ble.is_connected" };
    case "bleClientCount":
      return { operation: "ble.client_count" };




    case "preferencesClear": {
      const ns = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ns === null) return null;
      return { operation: "preferences.clear", ns: quoteNonIdentifier(ns) };
    }
    case "preferencesRemove": {
      const ns = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ns === null) return null;
      const key = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (key === null) return null;
      return { operation: "preferences.remove", ns: quoteNonIdentifier(ns), key: quoteNonIdentifier(key) };
    }
    case "preferencesPutInt": {
      const ns = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ns === null) return null;
      const key = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericOrExpression(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (key === null || value === null) return null;
      return { operation: "preferences.put_int", ns: quoteNonIdentifier(ns), key: quoteNonIdentifier(key), value };
    }
    case "preferencesGetInt": {
      const ns = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ns === null) return null;
      const key = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const def = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults) ?? 0;
      if (key === null) return null;
      return { operation: "preferences.get_int", ns: quoteNonIdentifier(ns), key: quoteNonIdentifier(key), defaultValue: def };
    }
    case "preferencesPutBool": {
      const ns = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ns === null) return null;
      const key = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (key === null || value === null) return null;
      return { operation: "preferences.put_bool", ns: quoteNonIdentifier(ns), key: quoteNonIdentifier(key), value: value === "true" };
    }
    case "preferencesGetBool": {
      const ns = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ns === null) return null;
      const key = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const def = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (key === null) return null;
      return { operation: "preferences.get_bool", ns: quoteNonIdentifier(ns), key: quoteNonIdentifier(key), defaultValue: def === "true" };
    }
    case "preferencesPutFloat": {
      const ns = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ns === null) return null;
      const key = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericOrExpression(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (key === null || value === null) return null;
      return { operation: "preferences.put_float", ns: quoteNonIdentifier(ns), key: quoteNonIdentifier(key), value };
    }
    case "preferencesGetFloat": {
      const ns = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ns === null) return null;
      const key = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const def = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults) ?? 0;
      if (key === null) return null;
      return { operation: "preferences.get_float", ns: quoteNonIdentifier(ns), key: quoteNonIdentifier(key), defaultValue: def };
    }
    case "preferencesPutString": {
      const ns = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ns === null) return null;
      const key = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (key === null || value === null) return null;
      return { operation: "preferences.put_string", ns: quoteNonIdentifier(ns), key: quoteNonIdentifier(key), value: quoteNonIdentifier(value) };
    }
    case "preferencesGetString": {
      const ns = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ns === null) return null;
      const key = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const def = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults) ?? '""';
      if (key === null) return null;
      return { operation: "preferences.get_string", ns: quoteNonIdentifier(ns), key: quoteNonIdentifier(key), defaultValue: quoteNonIdentifier(def) };
    }

    // ── FS (littlefs on the storage partition — lazy mount, no session) ──
    case "fsReadText": {
      const path = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (path === null) return null;
      return { operation: "fs.read_text", path: quoteNonIdentifier(path) };
    }
    case "fsWriteText": {
      const path = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const content = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (path === null || content === null) return null;
      return { operation: "fs.write_text", path: quoteNonIdentifier(path), content: quoteNonIdentifier(content) };
    }
    case "fsExists": {
      const path = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (path === null) return null;
      return { operation: "fs.exists", path: quoteNonIdentifier(path) };
    }
    case "fsRemove": {
      const path = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (path === null) return null;
      return { operation: "fs.remove", path: quoteNonIdentifier(path) };
    }

    // ── MQTT ──
    case "mqttConnect": {
      const uri = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const clientId = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (uri === null || clientId === null) return null;
      return { operation: "mqtt.connect", brokerUri: quoteNonIdentifier(uri), clientId: quoteNonIdentifier(clientId) };
    }
    case "mqttOnMessage": {
      const handler = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (handler === null) return null;
      return { operation: "mqtt.on_message", handler };
    }
    case "mqttSubscribe": {
      const topic = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (topic === null) return null;
      return { operation: "mqtt.subscribe", topic: quoteNonIdentifier(topic) };
    }
    case "mqttPublish": {
      const topic = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const data = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (topic === null || data === null) return null;
      return { operation: "mqtt.publish", topic: quoteNonIdentifier(topic), data: quoteNonIdentifier(data) };
    }
    case "mqttConnected":
      return { operation: "mqtt.connected" };
    case "mqttDisconnect":
      return { operation: "mqtt.disconnect" };

    case "interruptDetach": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "interrupt.detach", port, pin };
    }

;
;


    // ── USB CDC-ACM serial ──
    case "usbBegin": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "usb.begin", port };
    }
    case "usbWaitReady": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const timeoutMs = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults) ?? 0;
      if (port === null) return null;
      return { operation: "usb.wait_ready", port, timeoutMs };
    }
    case "usbEnd": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "usb.end", port };
    }
    case "usbPrint": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || value === null) return null;
      return { operation: "usb.print", port, value };
    }
    case "usbPrintln": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || value === null) return null;
      return { operation: "usb.println", port, value };
    }
    case "usbRead": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "usb.read", port };
    }
    case "usbAvailable": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "usb.available", port };
    }
    case "usbConnected": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "usb.connected", port };
    }

    // ── Board ──
    case "boardResolve": {
      const p = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (p === null) return null;
      return { operation: "board.resolve", path: p };
    }

    // ── Raw C++ passthrough ──
    case "rawCpp": {
      const code = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (code === null) return null;
      return { operation: "raw", code };
    }

    case "gpioConfigure": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const flags = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || flags === null) return null;
      return { operation: "gpio.configure", pin, flags };
    }

    case "gpioReadCfg": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const flags = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || flags === null) return null;
      return { operation: "gpio.read_cfg", pin, flags };
    }

    case "gpioShiftOut": {
      const dataPin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const clockPin = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const msbFirstRaw = resolveSemanticArg(args, 3, instance, paramNames, callArgTexts, paramDefaults);
      if (dataPin === null || clockPin === null || value === null || msbFirstRaw === null) return null;
      return { operation: "gpio.shift_out", dataPin, clockPin, value, msbFirst: msbFirstRaw !== "false" };
    }

    case "gpioShiftIn": {
      const dataPin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const clockPin = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const msbFirstRaw = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (dataPin === null || clockPin === null || msbFirstRaw === null) return null;
      return { operation: "gpio.shift_in", dataPin, clockPin, msbFirst: msbFirstRaw !== "false" };
    }

    case "pwmSetPulse":
    case "pwmSetDuty":
    case "pwmSetPeriod": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const periodNs = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || periodNs === null) return null;
      // Inline routing overrides (the escape hatch): read the CONSTRUCTION
      // fields off the instance — the inlined method-body args arrive as
      // unresolved text (quoted literals, `this->_x`), while fieldValues
      // carry what the constructor actually assigned.
      const pwmPulse = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const pwmDuty = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const controllerOverride = cleanOverrideText(instance.fieldValues.get("_controller"));
      const pwmCh = Number(instance.fieldValues.get("_channel"));
      const channelOverride = Number.isFinite(pwmCh) && pwmCh >= 0 ? pwmCh : undefined;
      const routing = {
        ...(controllerOverride !== undefined ? { controllerOverride } : {}),
        ...(channelOverride !== undefined ? { channelOverride } : {}),
      };
      if (fnName === "pwmSetPulse") {
        if (pwmPulse === null || typeof pwmPulse !== "number") return null;
        return { operation: "pwm.set_pulse", pin, periodNs, pulseNs: pwmPulse, ...routing };
      }
      if (fnName === "pwmSetDuty") {
        if (pwmDuty === null) return null;
        return { operation: "pwm.set_duty", pin, periodNs, duty: pwmDuty, ...routing };
      }
      return { operation: "pwm.set_period", pin, periodNs, ...routing };
    }

    case "adcReadRaw":
    case "adcReadMv": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const gain = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const reference = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || gain === null || reference === null) return null;
      // Inline routing overrides (the escape hatch): read the CONSTRUCTION
      // fields off the instance — inlined method-body args arrive as
      // unresolved text, fieldValues carry what the constructor assigned.
      const adcCh = Number(instance.fieldValues.get("_channel"));
      const channelOverride = Number.isFinite(adcCh) && adcCh >= 0 ? adcCh : undefined;
      const deviceOverride = cleanOverrideText(instance.fieldValues.get("_device"));
      const pinctrlOverride = cleanOverrideText(instance.fieldValues.get("_pinctrl"));
      return {
        operation: fnName === "adcReadRaw" ? "adc.read_raw" : "adc.read_mv",
        pin,
        gain,
        reference,
        ...(channelOverride !== undefined ? { channelOverride } : {}),
        ...(deviceOverride !== undefined ? { deviceOverride } : {}),
        ...(pinctrlOverride !== undefined ? { pinctrlOverride } : {}),
      };
    }

    case "interruptAttachFlags": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const handler = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const intFlags = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || handler === null || intFlags === null) return null;
      return { operation: "interrupt.attach_flags", pin, handler, intFlags };
    }

    case "timeSleep": {
      const ms = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ms === null) return null;
      return { operation: "timing.sleep", ms };
    }

    case "timeNow":
      return { operation: "timing.now" };

    case "timeNowUs":
      return { operation: "timing.now_us" };

    case "timeBusyWaitUs": {
      const us = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (us === null) return null;
      return { operation: "timing.busy_wait_us", us };
    }

    case "i2cRegWrite": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const address = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const hz = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const reg = resolveNumericArg(args, 3, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 4, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || address === null || hz === null || reg === null || value === null) return null;
      return { operation: "i2c.reg_write", bus, address, hz, reg, value };
    }

    case "i2cRegRead": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const address = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const hz = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const reg = resolveNumericArg(args, 3, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || address === null || hz === null || reg === null) return null;
      return { operation: "i2c.reg_read", bus, address, hz, reg };
    }

    case "i2cRegUpdate": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const address = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const hz = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const reg = resolveNumericArg(args, 3, instance, paramNames, callArgTexts, paramDefaults);
      const mask = resolveNumericArg(args, 4, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 5, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || address === null || hz === null || reg === null || mask === null || value === null) return null;
      return { operation: "i2c.reg_update", bus, address, hz, reg, mask, value };
    }

    case "i2cDevWrite": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const address = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const hz = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const data = resolveI2cBufferArg(args, 3, instance, paramNames, callArgTexts, paramDefaults, callArgs);
      if (bus === null || address === null || hz === null || data === null) return null;
      if (data.kind === "bytes") {
        return { operation: "i2c.dev_write", bus, address, hz, bytes: data.bytes };
      }
      return { operation: "i2c.dev_write", bus, address, hz, bytes: [data.data] };
    }

    case "dacWriteValue": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const resolution = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || value === null || resolution === null) return null;
      return { operation: "dac.write_value", pin, value, resolution };
    }

    case "wdtSetup": {
      const timeoutMs = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (timeoutMs === null) return null;
      return { operation: "wdt.setup", timeoutMs };
    }

    case "wdtFeed":
      return { operation: "wdt.feed" };

    case "counterOnAlarm": {
      const inst = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const handler = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (inst === null || handler === null) return null;
      return { operation: "counter.on_alarm", instance: inst, handler };
    }

    case "counterStart": {
      const inst = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const hz = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (inst === null || hz === null) return null;
      return { operation: "counter.start", instance: inst, hz };
    }

    case "counterStop": {
      const inst = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (inst === null) return null;
      return { operation: "counter.stop", instance: inst };
    }

    case "spiTransceiveDt": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const cs = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const hz = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const mode = resolveNumericArg(args, 3, instance, paramNames, callArgTexts, paramDefaults);
      const txData = resolveI2cBufferArg(args, 4, instance, paramNames, callArgTexts, paramDefaults, callArgs);
      let rx = resolveSemanticArg(args, 5, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || cs === null || hz === null || mode === null || txData === null || rx === null) return null;
      // The class body's `rx ?? new Uint8Array(0)` arrives nullish-lowered as
      // `X != CUTTLEFISH_UNDEFINED ? X : new Uint8Array(0)` — the caller's
      // buffer identifier is the X branch ('' = write-only when omitted).
      if (rx.includes(" != CUTTLEFISH_UNDEFINED ? ")) {
        // Take the taken branch and strip the nullish wrapper's parens.
        rx = rx.split(" != CUTTLEFISH_UNDEFINED ? ")[0].replace(/^\(+/, "").trim();
        if (rx === "undefined" || rx === "null") rx = "";
      }
      const tx = txData.kind === "bytes" ? txData.bytes : [txData.data];
      return { operation: "spi.transceive", bus, cs, hz, mode, tx, rx };
    }

    case "spiWriteDt": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const cs = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const hz = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const mode = resolveNumericArg(args, 3, instance, paramNames, callArgTexts, paramDefaults);
      const txData = resolveI2cBufferArg(args, 4, instance, paramNames, callArgTexts, paramDefaults, callArgs);
      if (bus === null || cs === null || hz === null || mode === null || txData === null) return null;
      const tx = txData.kind === "bytes" ? txData.bytes : [txData.data];
      return { operation: "spi.dev_write", bus, cs, hz, mode, tx };
    }

    case "spiReadReg": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const cs = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const hz = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const mode = resolveNumericArg(args, 3, instance, paramNames, callArgTexts, paramDefaults);
      const reg = resolveNumericArg(args, 4, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || cs === null || hz === null || mode === null || reg === null) return null;
      return { operation: "spi.reg_read", bus, cs, hz, mode, reg };
    }

    case "uartPollWrite": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const baud = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const data = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || baud === null || data === null) return null;
      return { operation: "uart.poll_write", port, baud, data };
    }

    case "uartRxAvailable": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const ring = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || ring === null) return null;
      return { operation: "uart.rx_available", port, ring };
    }

    case "uartRxPeek": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const ring = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || ring === null) return null;
      return { operation: "uart.rx_peek", port, ring };
    }

    case "uartRxRead": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const ring = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || ring === null) return null;
      return { operation: "uart.rx_read", port, ring };
    }

    case "threadStart": {
      const inst = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const stackBytes = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      // The class computes `opts?.priority ?? 5` — only stackKb is captured at
      // instance creation, so apply the constructor's default here.
      const priority = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults) ?? 5;
      const handler = resolveSemanticArg(args, 3, instance, paramNames, callArgTexts, paramDefaults);
      if (inst === null || stackBytes === null || handler === null) return null;
      return { operation: "thread.start", instance: inst, stackBytes, priority, handler };
    }

    case "threadJoin": {
      const inst = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (inst === null) return null;
      return { operation: "thread.join", instance: inst };
    }

    case "sensorFetch": {
      const part = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const bus = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const port = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const busKind = resolveSemanticArg(args, 3, instance, paramNames, callArgTexts, paramDefaults);
      const spiHz = resolveNumericArg(args, 4, instance, paramNames, callArgTexts, paramDefaults);
      const spiMode = resolveSemanticArg(args, 5, instance, paramNames, callArgTexts, paramDefaults);
      const alertPin = resolveSemanticArg(args, 6, instance, paramNames, callArgTexts, paramDefaults);
      if (part === null || bus === null || port === null || busKind === null || spiHz === null || spiMode === null || alertPin === null) return null;
      return { operation: "sensor.fetch", part, bus, port, busKind, spiHz, spiMode, alertPin };
    }

    case "sensorGet": {
      const part = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const bus = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const port = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const busKind = resolveSemanticArg(args, 3, instance, paramNames, callArgTexts, paramDefaults);
      const spiHz = resolveNumericArg(args, 4, instance, paramNames, callArgTexts, paramDefaults);
      const spiMode = resolveSemanticArg(args, 5, instance, paramNames, callArgTexts, paramDefaults);
      const alertPin = resolveSemanticArg(args, 6, instance, paramNames, callArgTexts, paramDefaults);
      const chan = resolveSemanticArg(args, 7, instance, paramNames, callArgTexts, paramDefaults);
      if (part === null || bus === null || port === null || busKind === null || spiHz === null || spiMode === null || alertPin === null || chan === null) return null;
      return { operation: "sensor.get", part, bus, port, busKind, spiHz, spiMode, alertPin, chan };
    }

    default:
      return null;
  }
}
