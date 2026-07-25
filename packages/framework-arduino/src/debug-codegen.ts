// ---------------------------------------------------------------------------
// Arduino debug code generator — Serial-based debug output
//
// Generates Arduino Serial.print/println code for debug breakpoints,
// logpoints, and initialization. Used by the CLI debug preprocessor.
// ---------------------------------------------------------------------------

export interface CapturedVariable {
  name: string;
  isFunction?: boolean;
  /**
   * Coarse C++ type category (ignored by Arduino — Serial.println is
   * type-agnostic via overload resolution). Present for shape-compatibility
   * with the strategy interface and the ESP-IDF codegen.
   */
  cppType?: 'bool' | 'int' | 'long' | 'float' | 'string' | 'unknown';
}

export interface LogMessagePart {
  type: 'text' | 'variable';
  value: string;
}

/**
 * Generate Serial.begin() initialization code for Arduino debug mode.
 */
export function generateSerialInitCode(): string[] {
  return [
    `// === DEBUG: Initialize Serial ===`,
    `Serial.begin(9600);`,
    `while (!Serial) {`,
    `  delay(10);`,
    `}`,
    `Serial.println("🔧 TypeCAD Debug Mode Active");`,
    `Serial.println("");`,
    `// === END DEBUG INIT ===`,
    ``,
  ];
}

/**
 * Generate the Serial debug code for a breakpoint.
 *
 * When `breakpointId` is set, the whole halt block is wrapped in
 * `if (!__tc_bp_disabled_<id>)`, so a skipped breakpoint becomes a no-op
 * until reboot. The flag is `static` so it persists across loop() iterations.
 */
export function generateBreakpointCode(
  fileName: string,
  lineNum: number,
  originalLine: string,
  variables: CapturedVariable[],
  normalizedCondition: string | undefined,
  breakpointId?: number,
): string[] {
  const lines: string[] = [];
  const hasDisableGuard = breakpointId !== undefined;
  // Inner-block padding: +2 for the condition wrap, +2 for the disable guard.
  const pad = (hasDisableGuard ? '  ' : '') + (normalizedCondition ? '  ' : '');

  // Comment marker
  lines.push(`  // === BREAKPOINT: ${fileName}:${lineNum} ===`);

  // Disable guard: a skipped breakpoint becomes a no-op until reboot. The
  // disable state lives in the framework's debug shim (a static registry keyed
  // by breakpointId) — NOT as a per-breakpoint declaration here, because the
  // transpiler mangles `static bool` declarations injected into the source.
  if (hasDisableGuard) {
    lines.push(`  if (!__tc_bp_is_disabled(${breakpointId})) {`);
  }

  // If conditional, wrap everything in an if statement
  if (normalizedCondition) {
    lines.push(`  ${hasDisableGuard ? '  ' : ''}if (${normalizedCondition}) {`);
  }

  // Visual separator
  lines.push(`  ${pad}Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");`);

  // Breakpoint header (with condition indicator if present)
  const headerText = normalizedCondition
    ? `⏸️  BREAKPOINT: ${fileName}:${lineNum} (condition: ${escapeString(normalizedCondition)})`
    : `⏸️  BREAKPOINT: ${fileName}:${lineNum}`;
  lines.push(`  ${pad}Serial.println("${headerText}");`);

  // Original source line (escaped)
  const escapedLine = escapeString(originalLine);
  lines.push(`  ${pad}Serial.println("  ${escapedLine}");`);

  // Blank line
  lines.push(`  ${pad}Serial.println("");`);

  // Variables section
  if (variables.length > 0) {
    lines.push(`  ${pad}Serial.println("  Variables:");`);
    for (const v of variables) {
      if (v.isFunction) {
        lines.push(`  ${pad}Serial.println("  • ${v.name} = [function]");`);
      } else {
        lines.push(`  ${pad}Serial.print("  • ${v.name} = "); Serial.println(${v.name});`);
      }
    }
  } else {
    lines.push(`  ${pad}Serial.println("  (no variables in scope)");`);
  }

  // Blank line
  lines.push(`  ${pad}Serial.println("");`);

  // Continue prompt
  lines.push(`  ${pad}Serial.println("  [ENTER: continue | s: skip this breakpoint]");`);

  // Visual separator (end)
  lines.push(`  ${pad}Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");`);

  // Blocking wait for one serial byte via the framework's continue/skip helper.
  // 's'/'S' disables this breakpoint (id) for the rest of the run; anything
  // else (typically ENTER '\r'/'\n') just continues. The helper lives in the
  // framework's shim so no declaration is needed here.
  lines.push(`  ${pad}__tc_debug_wait_for_continue(${hasDisableGuard ? breakpointId : -1});`);

  // Close conditional if statement
  if (normalizedCondition) {
    lines.push(`  ${hasDisableGuard ? '  ' : ''}}`);
  }

  // Close disable guard
  if (hasDisableGuard) {
    lines.push(`  }`);
  }

  // End marker
  lines.push(`  // === END BREAKPOINT ===`);

  return lines;
}

/**
 * Generate code for a logpoint (logs message without stopping execution).
 */
export function generateLogpointCode(
  fileName: string,
  lineNum: number,
  parts: LogMessagePart[],
  variables: CapturedVariable[],
): string[] {
  const lines: string[] = [];

  // Comment marker
  lines.push(`  // === LOGPOINT: ${fileName}:${lineNum} ===`);

  // Build the Serial output
  lines.push(`  Serial.print("[LOG ${fileName}:${lineNum}] ");`);
  
  for (const part of parts) {
    if (part.type === 'text') {
      lines.push(`  Serial.print("${escapeString(part.value)}");`);
    } else if (part.type === 'variable') {
      // Check if the variable exists in scope
      const varExists = variables.some(v => v.name === part.value && !v.isFunction);
      if (varExists) {
        lines.push(`  Serial.print(${part.value});`);
      } else {
        lines.push(`  Serial.print("{${part.value}}"); // variable not in scope`);
      }
    }
  }
  
  lines.push(`  Serial.println("");`);
  lines.push(`  // === END LOGPOINT ===`);

  return lines;
}

/**
 * Escape a string for use in Serial.println("...").
 */
function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}
