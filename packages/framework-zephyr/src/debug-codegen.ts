// ---------------------------------------------------------------------------
// Zephyr debug code generator — printk-based debug output
//
// The Zephyr counterpart to framework-esp32/src/debug-codegen.ts. Zephyr's
// minimal C++ config has no <iostream> (manifest: needsIostream=false,
// stdlibSupport.hasIostream=false), so the GenericStrategy's std::cout fallback
// used by the debug preprocessor would NOT compile. This module routes every
// debug line through printk("...\n") — the always-available Zephyr console,
// with no CONFIG_CONSOLE dependency — so `typecad-hal build --debug` produces
// compiling output.
//
// The halt primitive is __tc_debug_wait_for_continue() (emitted in
// ZephyrStrategy.shimLines when --debug is active): a k_console-input / busy
// poll that yields to the scheduler so an unattended breakpoint does not trip
// any watchdog. ENTER continues; 's' disables this breakpoint for the run.
//
// Used by ZephyrStrategy's generateDebug* overrides, dispatched by the
// cuttlefish debug preprocessor (cuttlefish/src/debug/preprocessor.ts).
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
 * Generate the debug-mode banner. printk is always wired (Zephyr console), so
 * there is no init to perform — just confirm debug instrumentation is live.
 */
export function generateZephyrInitCode(): string[] {
  return [
    `// === DEBUG: Zephyr console (printk) ===`,
    `printk("[TypeCAD] Debug Mode Active\\n");`,
    `// === END DEBUG INIT ===`,
    ``,
  ];
}

/**
 * Generate Zephyr code for a breakpoint.
 *
 * The halt is __tc_debug_wait_for_continue() (emitted in ZephyrStrategy.shimLines
 * under --debug): blocks until a byte arrives on the console, yielding to the
 * scheduler between polls. The user must have a console attached (`west serial`
 * or a terminal on the USB-CDC port); ENTER continues, 's' skips this breakpoint
 * for the rest of the run.
 *
 * When `breakpointId` is set, the whole halt block is wrapped in
 * `if (!__tc_bp_disabled_<id>)`, so a skipped breakpoint becomes a no-op until
 * reboot. The flag is `static` so it persists across loop() iterations.
 */
export function generateZephyrBreakpointCode(
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

  lines.push(`${indent}printk("----------------------------------------\\n");`);

  const headerText = normalizedCondition
    ? `[BREAK] ${fileName}:${lineNum} (condition: ${escapeString(normalizedCondition)})`
    : `[BREAK] ${fileName}:${lineNum}`;
  lines.push(`${indent}printk("%s\\n", "${headerText}");`);

  lines.push(`${indent}printk("  %s\\n", "${escapeString(originalLine)}");`);

  if (variables.length > 0) {
    lines.push(`${indent}printk("  Variables:\\n");`);
    for (const v of variables) {
      if (v.isFunction) {
        lines.push(`${indent}printk("  - %s = [function]\\n", "${v.name}");`);
      } else {
        const { spec, arg } = formatSpecFor(v.name, v.cppType);
        lines.push(`${indent}printk("  - %s = ${spec}\\n", "${v.name}", ${arg});`);
      }
    }
  } else {
    lines.push(`${indent}printk("  (no variables in scope)\\n");`);
  }

  lines.push(`${indent}printk("  [ENTER: continue | s: skip this breakpoint]\\n");`);
  lines.push(`${indent}printk("----------------------------------------\\n");`);

  // Halt — block on console input, scheduler-yielding. 's' records this id as
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
 * Generate Zephyr code for a logpoint (logs a message without halting).
 */
export function generateZephyrLogpointCode(
  fileName: string,
  lineNum: number,
  parts: LogMessagePart[],
  variables: CapturedVariable[],
): string[] {
  const lines: string[] = [];

  lines.push(`  // === LOGPOINT: ${fileName}:${lineNum} ===`);
  lines.push(`  printk("[LOG ${fileName}:${lineNum}] ");`);

  for (const part of parts) {
    if (part.type === 'text') {
      lines.push(`  printk("${escapeString(part.value)}");`);
    } else {
      // variable part: only printable if it is a non-function value in scope.
      const match = variables.find((v) => v.name === part.value && !v.isFunction);
      if (match) {
        const { spec, arg } = formatSpecFor(match.name, match.cppType);
        lines.push(`  printk("${spec}", ${arg});`);
      } else {
        lines.push(`  printk("{${escapeString(part.value)}}"); // variable not in scope`);
      }
    }
  }

  lines.push(`  printk("\\n");`);
  lines.push(`  // === END LOGPOINT ===`);

  return lines;
}

/**
 * Escape a string for use inside printk("..."). Same rules as the ESP-IDF
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
 * Pick a printk format specifier + argument expression for a debug variable.
 *
 * The debug preprocessor has no TypeChecker, so `cppType` is a coarse category
 * inferred from AST shape. For `unknown` we cast to `double` and use `%g` so
 * the generated printk always compiles for any numeric/bool variable. printk
 * supports the standard printf format specifiers.
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
      // Cast to double so printk compiles regardless of the real C++ type.
      return { spec: '%g', arg: `static_cast<double>(${varName})` };
  }
}
