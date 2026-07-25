// ---------------------------------------------------------------------------
// ESP32 debug code generator — native ESP-IDF (printf) based debug output
//
// Generates printf/ESP-IDF code for debug breakpoints, logpoints, and
// initialization. This is the ESP-IDF counterpart to
// framework-arduino/src/debug-codegen.ts: instead of Serial.print/println
// (which does not exist under native ESP-IDF — Esp32Strategy strips
// <HardwareSerial.h>), it routes every line through printf("...\n") so output
// lands on the IDF default console (UART0 / USB-Serial-JTAG), matching the
// established idiom in Esp32Strategy.transformConsoleCall.
//
// Used by Esp32Strategy's generateDebug* overrides, which are dispatched by
// the cuttlefish debug preprocessor (cuttlefish/src/debug/preprocessor.ts)
// when `cuttlefish build --debug` runs against an ESP-IDF target.
// ---------------------------------------------------------------------------

export interface CapturedVariable {
  name: string;
  isFunction?: boolean;
  /** Coarse C++ type category (inferred by the preprocessor without a checker). */
  cppType?: 'bool' | 'int' | 'long' | 'float' | 'string' | 'unknown';
}

export interface LogMessagePart {
  type: 'text' | 'variable';
  value: string;
}

/**
 * Generate the debug-mode banner. ESP-IDF's console + log system is wired by
 * app startup, so there is no Serial.begin() equivalent — just confirm to the
 * user that debug instrumentation is live.
 */
export function generateEspIdfInitCode(): string[] {
  return [
    `// === DEBUG: ESP-IDF console ===`,
    `printf("🔧 TypeCAD Debug Mode Active\\n");`,
    `// === END DEBUG INIT ===`,
    ``,
  ];
}

/**
 * Generate ESP-IDF code for a breakpoint.
 *
 * The halt is __tc_debug_wait_for_continue() (defined in Esp32Strategy.shimLines):
 * a getchar() loop that feeds the task watchdog so an unattended breakpoint
 * does not reboot the chip. The user must have idf.py monitor (or equivalent)
 * attached; ENTER continues, 's' disables this breakpoint for the rest of the run.
 *
 * When `breakpointId` is set, the whole halt block is wrapped in
 * `if (!__tc_bp_disabled_<id>)`, so a skipped breakpoint becomes a no-op until
 * reboot. The flag is `static` so it persists across loop() iterations.
 */
export function generateEspIdfBreakpointCode(
  fileName: string,
  lineNum: number,
  originalLine: string,
  variables: CapturedVariable[],
  normalizedCondition: string | undefined,
  breakpointId?: number,
): string[] {
  const lines: string[] = [];
  const hasDisableGuard = breakpointId !== undefined;
  // Each wrap level adds two spaces of indent: the disable guard (outermost)
  // then the condition (if any).
  const indent = '  ' + (hasDisableGuard ? '  ' : '') + (normalizedCondition ? '  ' : '');

  lines.push(`  // === BREAKPOINT: ${fileName}:${lineNum} ===`);

  // Disable guard: a skipped breakpoint becomes a no-op until reboot. The
  // disable state lives in the framework's debug shim (a static registry keyed
  // by breakpointId) — NOT as a per-breakpoint declaration here, because the
  // transpiler mangles `static bool` declarations injected into the source.
  if (hasDisableGuard) {
    lines.push(`  if (!__tc_bp_is_disabled(${breakpointId})) {`);
  }

  if (normalizedCondition) {
    lines.push(`  ${hasDisableGuard ? '  ' : ''}if (${normalizedCondition}) {`);
  }

  lines.push(`${indent}printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n");`);

  const headerText = normalizedCondition
    ? `⏸️  BREAKPOINT: ${fileName}:${lineNum} (condition: ${escapeString(normalizedCondition)})`
    : `⏸️  BREAKPOINT: ${fileName}:${lineNum}`;
  lines.push(`${indent}printf("${headerText}\\n");`);

  lines.push(`${indent}printf("  ${escapeString(originalLine)}\\n");`);

  if (variables.length > 0) {
    lines.push(`${indent}printf("  Variables:\\n");`);
    for (const v of variables) {
      if (v.isFunction) {
        lines.push(`${indent}printf("  • ${v.name} = [function]\\n");`);
      } else {
        const { spec, arg } = formatSpecFor(v.name, v.cppType);
        lines.push(`${indent}printf("  • ${v.name} = ${spec}\\n", ${arg});`);
      }
    }
  } else {
    lines.push(`${indent}printf("  (no variables in scope)\\n");`);
  }

  lines.push(`${indent}printf("  [ENTER: continue | s: skip this breakpoint]\\n");`);
  lines.push(`${indent}printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n");`);

  // Halt — block on console input, watchdog-fed. 's' records this id as
  // disabled in the shim's registry. Pass -1 when no id (never disable).
  lines.push(`${indent}__tc_debug_wait_for_continue(${hasDisableGuard ? breakpointId : -1});`);

  if (normalizedCondition) {
    lines.push(`  ${hasDisableGuard ? '  ' : ''}}`);
  }

  if (hasDisableGuard) {
    lines.push(`  }`);
  }

  lines.push(`  // === END BREAKPOINT ===`);

  return lines;
}

/**
 * Generate ESP-IDF code for a logpoint (logs a message without halting).
 */
export function generateEspIdfLogpointCode(
  fileName: string,
  lineNum: number,
  parts: LogMessagePart[],
  variables: CapturedVariable[],
): string[] {
  const lines: string[] = [];

  lines.push(`  // === LOGPOINT: ${fileName}:${lineNum} ===`);
  lines.push(`  printf("[LOG ${fileName}:${lineNum}] ");`);

  for (const part of parts) {
    if (part.type === 'text') {
      lines.push(`  printf("${escapeString(part.value)}");`);
    } else {
      // variable part: only printable if it is a non-function value in scope.
      const match = variables.find(v => v.name === part.value && !v.isFunction);
      if (match) {
        const { spec, arg } = formatSpecFor(match.name, match.cppType);
        lines.push(`  printf("${spec}", ${arg});`);
      } else {
        lines.push(`  printf("{${escapeString(part.value)}}"); // variable not in scope`);
      }
    }
  }

  lines.push(`  printf("\\n");`);
  lines.push(`  // === END LOGPOINT ===`);

  return lines;
}

/**
 * Escape a string for use inside printf("..."). Same rules as the Arduino
 * generator: backslash, double-quote, newline, carriage return.
 */
function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Pick a printf format specifier + argument expression for a debug variable.
 *
 * The debug preprocessor has no TypeChecker, so `cppType` is a coarse category
 * inferred from AST shape. For `unknown` we cast to `double` and use `%g` so
 * the generated printf always compiles for any numeric/bool variable (worst
 * case: a `std::string` prints garbage — users can add a `: string` annotation
 * to fix it). Arduino's Serial.println(x) is type-agnostic and never hits this.
 *
 * Returns `{ spec, arg }` where `spec` is the `%`-specifier substring to embed
 * in the format string and `arg` is the C++ argument expression.
 */
function formatSpecFor(
  varName: string,
  cppType: CapturedVariable['cppType'],
): { spec: string; arg: string } {
  switch (cppType) {
    case 'bool':
    case 'int':
      return { spec: '%d', arg: varName };
    case 'long':
      return { spec: '%ld', arg: varName };
    case 'float':
      return { spec: '%g', arg: varName };
    case 'string':
      return { spec: '%s', arg: varName };
    case 'unknown':
    default:
      // Cast to double so printf compiles regardless of the real C++ type.
      return { spec: '%g', arg: `(double)(${varName})` };
  }
}
