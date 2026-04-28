// ---------------------------------------------------------------------------
// Arduino debug code generator — Serial-based debug output
//
// Generates Arduino Serial.print/println code for debug breakpoints,
// logpoints, and initialization. Used by the CLI debug preprocessor.
// ---------------------------------------------------------------------------

export interface CapturedVariable {
  name: string;
  isFunction?: boolean;
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
    `Serial.println("🔧 TypeHAL Debug Mode Active");`,
    `Serial.println("");`,
    `// === END DEBUG INIT ===`,
    ``,
  ];
}

/**
 * Generate the Serial debug code for a breakpoint.
 */
export function generateBreakpointCode(
  fileName: string,
  lineNum: number,
  originalLine: string,
  variables: CapturedVariable[],
  normalizedCondition: string | undefined,
): string[] {
  const lines: string[] = [];

  // Comment marker
  lines.push(`  // === BREAKPOINT: ${fileName}:${lineNum} ===`);

  // If conditional, wrap everything in an if statement
  if (normalizedCondition) {
    lines.push(`  if (${normalizedCondition}) {`);
  }

  // Visual separator
  lines.push(`  ${normalizedCondition ? '  ' : ''}Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");`);

  // Breakpoint header (with condition indicator if present)
  const headerText = normalizedCondition 
    ? `⏸️  BREAKPOINT: ${fileName}:${lineNum} (condition: ${escapeString(normalizedCondition)})`
    : `⏸️  BREAKPOINT: ${fileName}:${lineNum}`;
  lines.push(`  ${normalizedCondition ? '  ' : ''}Serial.println("${headerText}");`);

  // Original source line (escaped)
  const escapedLine = escapeString(originalLine);
  lines.push(`  ${normalizedCondition ? '  ' : ''}Serial.println("  ${escapedLine}");`);

  // Blank line
  lines.push(`  ${normalizedCondition ? '  ' : ''}Serial.println("");`);

  // Variables section
  if (variables.length > 0) {
    lines.push(`  ${normalizedCondition ? '  ' : ''}Serial.println("  Variables:");`);
    for (const v of variables) {
      if (v.isFunction) {
        lines.push(`  ${normalizedCondition ? '  ' : ''}Serial.println("  • ${v.name} = [function]");`);
      } else {
        lines.push(`  ${normalizedCondition ? '  ' : ''}Serial.print("  • ${v.name} = "); Serial.println(${v.name});`);
      }
    }
  } else {
    lines.push(`  ${normalizedCondition ? '  ' : ''}Serial.println("  (no variables in scope)");`);
  }

  // Blank line
  lines.push(`  ${normalizedCondition ? '  ' : ''}Serial.println("");`);

  // Continue prompt
  lines.push(`  ${normalizedCondition ? '  ' : ''}Serial.println("  [Press ENTER to continue...]");`);

  // Visual separator (end)
  lines.push(`  ${normalizedCondition ? '  ' : ''}Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");`);

  // Blocking wait for serial input
  lines.push(`  ${normalizedCondition ? '  ' : ''}while(Serial.available() == 0) { delay(10); }`);
  lines.push(`  ${normalizedCondition ? '  ' : ''}while(Serial.available() > 0) { Serial.read(); delay(10); }`);

  // Close conditional if statement
  if (normalizedCondition) {
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
