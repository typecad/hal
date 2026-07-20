import ts from "typescript";
import { HALOpIR } from "../../api/index.js";
import { HALInstance } from "./hal-parser.js";
import { getCurrentBoardConstants, halInstances } from "../build-ir-state.js";
import { resolveExpressionText, extractAndRegisterCallbacks } from "./hal-emitter.js";
import { renderExprAsText } from "../render-expr.js";
import type { ExpressionIR } from "../../api/index.js";

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
 *  plain identifier / member-access expression (i.e. a runtime variable). */
function quoteNonIdentifier(value: string): string {
  const t = value.trim();
  if (/^".*"$/.test(t)) return t;
  if (/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(t)) return t;
  return JSON.stringify(t);
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
    case "gpioSetMode": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const mode = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || mode === null) return null;
      return { operation: "gpio.set_mode", port, pin, mode };
    }

    // ── PWM ──
    case "pwmWrite": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const duty = resolveNumericOrExpression(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || duty === null) return null;
      return { operation: "pwm.write", port, pin, duty };
    }

    // ── ADC ──
    case "adcRead": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "adc.read", port, pin };
    }
    case "adcSetReference": {
      const ref = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ref === null) return null;
      const numRef = Number(ref);
      return { operation: "adc.set_reference", reference: isNaN(numRef) ? ref : numRef };
    }
    case "adcReadVoltage": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      const op: Record<string, unknown> = { operation: "adc.read_voltage", port, pin };
      const bc = getCurrentBoardConstants();
      if (bc) {
        // Check if ADC has a non-default reference set
        const adcInst = halInstances.get("ADC");
        const ref = adcInst?.fieldValues.get("_reference");
        const refKey = ref && ref !== "DEFAULT" ? ref : null;
        const vRefPath = refKey
          ? `peripherals.adc.0.referenceVoltages.${refKey}`
          : `peripherals.adc.0.referenceVoltage`;
        const vRef = bc.get(vRefPath);
        const maxValue = bc.get("peripherals.adc.0.maxValue");
        if (vRef !== undefined) op.vRef = Number(vRef);
        if (maxValue !== undefined) op.maxValue = Number(maxValue);
      }
      return op as unknown as HALOpIR;
    }

    // ── DAC ──
    case "dacWrite": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericOrExpression(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || value === null) return null;
      return { operation: "dac.write", port, pin, value };
    }

    // ── Watchdog timer ──
    case "wdtEnable": {
      const timeout = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (timeout === null) return null;
      return { operation: "wdt.enable", timeout };
    }
    case "wdtReset":
      return { operation: "wdt.reset" };
    case "wdtDisable":
      return { operation: "wdt.disable" };

    // ── Power ──
    case "powerDeepSleep": {
      const ms = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ms === null) return null;
      return { operation: "power.deep_sleep", ms };
    }
    case "powerLightSleep":
      return { operation: "power.light_sleep" };
    case "powerSetCpuFrequency": {
      const mhz = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (mhz === null) return null;
      return { operation: "power.set_cpu_frequency", mhz };
    }

    // ── WiFi ──
    // Optional string args (password, dns) resolve to the text "undefined"
    // when omitted at the call site (no default in the HAL signature). Treat
    // that as absent so the backend emits its own default ("").
    case "wifiConnect": {
      const ssid = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const password = dropUndefined(resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults));
      const timeoutMs = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults) ?? 15000;
      if (ssid === null) return null;
      return {
        operation: "wifi.connect",
        ssid,
        ...(password !== null ? { password } : {}),
        timeoutMs,
        blocking: true,
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
    case "wifiStatus":
      return { operation: "wifi.status" };
    case "wifiIsConnected":
      return { operation: "wifi.is_connected" };
    case "wifiLocalIp":
      return { operation: "wifi.local_ip" };
    case "wifiRssi":
      return { operation: "wifi.rssi" };
    case "wifiMac":
      return { operation: "wifi.mac" };
    case "wifiSetHostname": {
      const name = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (name === null) return null;
      return { operation: "wifi.set_hostname", name };
    }
    case "wifiSetStaticIp": {
      const ip = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const gateway = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const subnet = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const dns = dropUndefined(resolveSemanticArg(args, 3, instance, paramNames, callArgTexts, paramDefaults));
      if (ip === null || gateway === null || subnet === null) return null;
      return { operation: "wifi.set_static_ip", ip, gateway, subnet, ...(dns !== null ? { dns } : {}) };
    }
    case "wifiSetAutoReconnect": {
      const enabled = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (enabled === null) return null;
      return { operation: "wifi.set_auto_reconnect", enabled: enabled === "true" };
    }
    case "wifiSetPowerSave": {
      const mode = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (mode === null) return null;
      return { operation: "wifi.set_power_save", mode };
    }
    case "wifiSetTxPower": {
      const dbm = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (dbm === null) return null;
      return { operation: "wifi.set_tx_power", dbm };
    }
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
    case "wifiApClientCount":
      return { operation: "wifi.ap_client_count" };
    case "wifiApIp":
      return { operation: "wifi.ap_ip" };
    case "wifiApSetChannel": {
      const channel = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (channel === null) return null;
      return { operation: "wifi.ap_set_channel", channel };
    }
    case "wifiApSetHidden": {
      const hidden = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (hidden === null) return null;
      return { operation: "wifi.ap_set_hidden", hidden };
    }
    case "wifiApSetMaxClients": {
      const maxClients = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (maxClients === null) return null;
      return { operation: "wifi.ap_set_max_clients", maxClients };
    }
    case "wifiScan":
      return { operation: "wifi.scan" };
    case "wifiScanStart":
      return { operation: "wifi.scan_start" };
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
    case "wifiSaveCredentials": {
      const ssid = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const password = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (ssid === null || password === null) return null;
      return { operation: "wifi.save_credentials", ssid, password };
    }
    case "wifiConnectSaved": {
      const timeoutMs = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults) ?? 15000;
      return { operation: "wifi.connect_saved", timeoutMs };
    }
    case "wifiClearCredentials":
      return { operation: "wifi.clear_credentials" };
    case "wifiWaitConnected": {
      const timeoutMs = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults) ?? 15000;
      return { operation: "wifi.wait_connected", timeoutMs };
    }
    case "wifiWaitDisconnected":
      return { operation: "wifi.wait_disconnected" };

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
    case "httpReset":
      return { operation: "http.reset" };
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
    case "httpSetInsecure":
      return { operation: "http.set_insecure" };
    case "httpSetCaCert": {
      const pem = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pem === null) return null;
      return { operation: "http.set_ca_cert", pem };
    }
    case "httpSend":
      return { operation: "http.send", blocking: true };
    case "httpSendStart":
      return { operation: "http.send_start" };
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

    // ── Interrupts ──
    case "interruptAttach": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const handler = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const mode = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || handler === null || mode === null) return null;
      return { operation: "interrupt.attach", port, pin, handler, mode };
    }
    case "interruptDetach": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "interrupt.detach", port, pin };
    }

    // ── Tone ──
    case "tonePlay": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const frequency = resolveNumericOrExpression(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const duration = resolveNumericOrExpression(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || frequency === null) return null;
      return { operation: "tone.play", port, pin, frequency, ...(duration !== null ? { duration } : {}) };
    }
    case "toneStop": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "tone.stop", port, pin };
    }

    // ── Timing ──
    case "delayMs": {
      const ms = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (ms === null) return null;
      return { operation: "timing.delay", ms };
    }
    case "delayMicro": {
      const us = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (us === null) return null;
      return { operation: "timing.delay_microseconds", us };
    }
    case "getMillis":
      return { operation: "timing.millis" };
    case "getMicros":
      return { operation: "timing.micros" };
    case "getFreeHeap":
      return { operation: "timing.free_heap" };

    // ── I2C ──
    case "i2cBegin": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const address = resolveNumericOrExpression(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "i2c.begin", bus, ...(address !== null ? { address } : {}) };
    }
    case "i2cEnd": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "i2c.end", bus };
    }
    case "i2cSetClock": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const hz = resolveNumericOrExpression(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || hz === null) return null;
      return { operation: "i2c.set_clock", bus, hz };
    }
    case "i2cBeginTx": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const address = resolveNumericOrExpression(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || address === null) return null;
      return { operation: "i2c.begin_transmission", bus, address };
    }
    case "i2cWrite": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      const resolved = resolveI2cBufferArg(args, 1, instance, paramNames, callArgTexts, paramDefaults, callArgs);
      if (!resolved) return null;
      if (resolved.kind === "bytes") {
        return { operation: "i2c.write_bytes", bus, bytes: resolved.bytes };
      }
      return { operation: "i2c.write", bus, data: resolved.data };
    }
    case "i2cWriteBuffer": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      const resolved = resolveI2cBufferArg(args, 1, instance, paramNames, callArgTexts, paramDefaults, callArgs);
      if (!resolved) return null;
      if (resolved.kind === "bytes") {
        return { operation: "i2c.write_bytes", bus, bytes: resolved.bytes };
      }
      return { operation: "i2c.write_buffer", bus, data: resolved.data };
    }
    case "i2cReadBuffer": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const count = resolveNumericOrExpression(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || count === null) return null;
      return { operation: "i2c.read_buffer", bus, count, buffer: "__HAL_READ_BUF__" };
    }
    case "i2cEndTx": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const stop = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || stop === null) return null;
      return { operation: "i2c.end_transmission", bus, stop: stop !== "false" };
    }
    case "i2cRequestFrom": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const address = resolveNumericOrExpression(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const quantity = resolveNumericOrExpression(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || address === null || quantity === null) return null;
      // stop is optional; default to true (Arduino sends a STOP by default).
      const stopRaw = resolveSemanticArg(args, 3, instance, paramNames, callArgTexts, paramDefaults);
      const stop = stopRaw === null ? true : stopRaw !== "false";
      return { operation: "i2c.request_from", bus, address, quantity, stop };
    }
    case "i2cAvailable": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "i2c.available", bus };
    }
    case "i2cRead": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "i2c.read", bus };
    }

    // ── SPI ──
    case "spiBegin": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "spi.begin", bus };
    }
    case "spiEnd": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "spi.end", bus };
    }
    case "spiTransfer": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const data = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || data === null) return null;
      return { operation: "spi.transfer", bus, data };
    }
    case "spiBeginTx": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const settings = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || settings === null) return null;
      return { operation: "spi.begin_transaction", bus, settings };
    }
    case "spiEndTx": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null) return null;
      return { operation: "spi.end_transaction", bus };
    }
    case "spiCsLow": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "spi.cs_low", port, pin };
    }
    case "spiCsHigh": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null) return null;
      return { operation: "spi.cs_high", port, pin };
    }
    case "spiSetMode": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const mode = resolveNumericOrExpression(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || mode === null) return null;
      return { operation: "spi.set_mode", bus, mode };
    }
    case "spiSetBitOrder": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const order = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || order === null) return null;
      return { operation: "spi.set_bit_order", bus, order };
    }
    case "spiReadBuffer": {
      const bus = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const count = resolveNumericOrExpression(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (bus === null || count === null) return null;
      // The buffer arg (args[2]) is only a placeholder for type resolution;
      // the real target is the caller's variable, rewritten from
      // __HAL_READ_BUF__ by replaceHalReadBufferPlaceholder.
      return { operation: "spi.read_buffer", bus, count, buffer: "__HAL_READ_BUF__" };
    }

    // ── UART ──
    case "uartBegin": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const baud = resolveNumericOrExpression(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || baud === null) return null;
      return { operation: "uart.begin", port, baud };
    }
    case "uartEnd": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "uart.end", port };
    }
    case "uartPrint": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || value === null) return null;
      return { operation: "uart.print", port, value };
    }
    case "uartPrintln": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || value === null) return null;
      return { operation: "uart.println", port, value };
    }
    case "uartWrite": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const data = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || data === null) return null;
      return { operation: "uart.write", port, data };
    }
    case "uartRead": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "uart.read", port };
    }
    case "uartPeek": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "uart.peek", port };
    }
    case "uartAvailable": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "uart.available", port };
    }
    case "uartFlush": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null) return null;
      return { operation: "uart.flush", port };
    }
    case "uartPrintf": {
      const port = resolveSemanticArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const format = resolveSemanticArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (port === null || format === null) return null;
      // The HAL declares `...args: any[]`; the third semantic-call arg is the
      // `args` rest identifier. resolveSemanticArg expands it via the spread
      // mechanism into a comma-joined string — split it back into the per-arg
      // list the UartPrintfOp expects.
      const spreadText = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const varArgs = spreadText !== null && spreadText !== "" ? splitArgList(spreadText) : [];
      return { operation: "uart.printf", port, format, args: varArgs };
    }

    // ── Pulse ──
    case "pulseIn_": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const timeout = resolveNumericArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || value === null) return null;
      return { operation: "pulse.in", port, pin, value: (value ? 1 : 0) as 0 | 1, ...(timeout !== null ? { timeout } : {}) };
    }
    case "pulseInLong_": {
      const pin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      if (pin === null || value === null) return null;
      return { operation: "pulse.in_long", port, pin, value: (value ? 1 : 0) as 0 | 1 };
    }

    // ── Shift ──
    case "shiftOut_": {
      const dataPin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const clockPin = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const bitOrder = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      const value = resolveNumericArg(args, 3, instance, paramNames, callArgTexts, paramDefaults);
      if (dataPin === null || clockPin === null || bitOrder === null || value === null) return null;
      return { operation: "shift.out", dataPin, clockPin, bitOrder, value };
    }
    case "shiftIn_": {
      const dataPin = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
      const clockPin = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
      const bitOrder = resolveSemanticArg(args, 2, instance, paramNames, callArgTexts, paramDefaults);
      if (dataPin === null || clockPin === null || bitOrder === null) return null;
      return { operation: "shift.in", dataPin, clockPin, bitOrder };
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

    default:
      return null;
  }
}
