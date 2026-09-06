// ---------------------------------------------------------------------------
// Generic/native debug code generator — printf-based debug output
//
// The debug preprocessor injects these lines into the user's TypeScript, so
// every injected line must be TS-parseable AND lower faithfully. Raw C++ in
// an injected line does not survive: the TS parser reads `std::cout << ...`
// as a label plus garbage, and the emitted C++ was `std: :` noise that could
// never compile. Every line therefore rides the rawCpp() passthrough — the
// call lowers to __EMIT__ and its string argument is emitted as verbatim
// C++ — so the generator can author arbitrary C++ (printf, static_cast,
// the static skip flag) without the TS parser ever seeing it.
//
// printf/getchar need <cstdio>: program-analysis marks usesCstdio from
// __EMIT__ string arguments, and the native/generic forcedIncludes gate
// <cstdio> on that flag.
//
// Used by GenericStrategy's generateDebug* overrides (the debug preprocessor
// falls back to GenericStrategy for every framework whose strategy does not
// define its own codegen — e.g. @typecad/framework-native). The Zephyr
// counterpart is framework-zephyr/src/debug-codegen.ts (printk + a shim-side
// halt). Dispatched by cuttlefish/src/debug/preprocessor.ts.
// ---------------------------------------------------------------------------

import { escapeCppStringLiteral } from "../utils/strings.js";

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
 * Wrap a C++ text fragment as an injectable TS statement. The rawCpp() call
 * lowers to __EMIT__, whose string argument the emitter writes out verbatim
 * (a trailing `;` is added by the emitter when the fragment lacks one).
 * JSON.stringify produces a valid single-line TS double-quoted literal for
 * any fragment, newlines included.
 */
function raw(cpp: string): string {
  return `rawCpp(${JSON.stringify(cpp)});`;
}

/** printf a string literal. */
function printLiteral(text: string, indent: string): string {
  return raw(`${indent}printf("%s", "${escapeCppStringLiteral(text)}");`);
}

/**
 * Generate the debug-mode banner. The host console needs no setup, but the
 * printf/getchar calls below need <cstdio>: include() registers it on the
 * program (the generic strategy's forcedIncludes is deliberately empty), and
 * the strategy-side usesCstdio gates (e.g. native) also pick the banner up
 * from the rawCpp text.
 */
export function generateGenericInitCode(): string[] {
  return [
    '// === DEBUG: host console (printf) ===',
    "include('<cstdio>');",
    raw('printf("[TypeCAD] Debug Mode Active\\n");'),
    '// === END DEBUG INIT ===',
    '',
  ];
}

/**
 * Generate generic/native code for a breakpoint.
 *
 * The halt reads stdin until ENTER; any 's' typed before it marks this
 * breakpoint skipped for the rest of the run. The flag is a C++ static local
 * inside the emitted block (safe here — unlike TS-injected declarations, the
 * rawCpp text bypasses the TS parser entirely), so the skip persists across
 * loop() iterations. EOF on stdin exits the halt instead of spinning.
 *
 * When `breakpointId` is set the whole block is guarded by that flag; the
 * preprocessor assigns ids to every halting breakpoint.
 */
export function generateGenericBreakpointCode(
  fileName: string,
  lineNum: number,
  originalLine: string,
  variables: CapturedVariable[],
  normalizedCondition: string | undefined,
  breakpointId?: number,
): string[] {
  const lines: string[] = [];
  const indent = '  ' + (normalizedCondition ? '  ' : '');

  lines.push(`  // === BREAKPOINT: ${fileName}:${lineNum} ===`);

  if (normalizedCondition) {
    lines.push(`  if (${normalizedCondition}) {`);
  }

  // The whole breakpoint is one rawCpp block: a braced C++ compound
  // statement. The emitter only appends a `;` when the fragment lacks one,
  // so a block ending in `}` is written out verbatim.
  const flag = breakpointId !== undefined ? `__tc_bp${breakpointId}_skipped` : undefined;
  const b: string[] = ['{'];
  const inner = flag ? '  ' : '';
  if (flag) {
    b.push(`  static bool ${flag} = false;`);
    b.push(`  if (!${flag}) {`);
  }

  b.push(`${inner}printf("----------------------------------------\\n");`);
  const headerText = normalizedCondition
    ? `[BREAK] ${fileName}:${lineNum} (condition: ${escapeCppStringLiteral(normalizedCondition)})`
    : `[BREAK] ${fileName}:${lineNum}`;
  b.push(`${inner}printf("%s\\n", "${escapeCppStringLiteral(headerText)}");`);
  b.push(`${inner}printf("  %s\\n", "${escapeCppStringLiteral(originalLine)}");`);

  if (variables.length > 0) {
    b.push(`${inner}printf("  Variables:\\n");`);
    for (const v of variables) {
      if (v.isFunction) {
        b.push(`${inner}printf("  - %s = [function]\\n", "${escapeCppStringLiteral(v.name)}");`);
      } else {
        const { spec, arg } = formatSpecFor(v.name, v.cppType);
        b.push(`${inner}printf("  - %s = ${spec}\\n", "${escapeCppStringLiteral(v.name)}", ${arg});`);
      }
    }
  } else {
    b.push(`${inner}printf("  (no variables in scope)\\n");`);
  }

  b.push(`${inner}printf("  [ENTER: continue | s: skip this breakpoint]\\n");`);
  b.push(`${inner}int __tc_c;`);
  if (flag) {
    b.push(`${inner}do {`);
    b.push(`${inner}  __tc_c = getchar();`);
    b.push(`${inner}  if (__tc_c == 's') { ${flag} = true; }`);
    b.push(`${inner}} while (__tc_c != '\\n' && __tc_c != EOF);`);
  } else {
    b.push(`${inner}do {`);
    b.push(`${inner}  __tc_c = getchar();`);
    b.push(`${inner}} while (__tc_c != '\\n' && __tc_c != EOF);`);
  }

  if (flag) {
    b.push('  }');
  }
  b.push('}');

  lines.push(indent + raw(b.join('\n')));

  if (normalizedCondition) {
    lines.push(`  }`);
  }

  lines.push(`  // === END BREAKPOINT ===`);

  return lines;
}

/**
 * Generate generic/native code for a logpoint (logs a message without
 * halting). Each part is its own printf, then a newline.
 */
export function generateGenericLogpointCode(
  fileName: string,
  lineNum: number,
  parts: LogMessagePart[],
  variables: CapturedVariable[],
): string[] {
  const lines: string[] = [];

  lines.push(`  // === LOGPOINT: ${fileName}:${lineNum} ===`);
  lines.push(raw(`  printf("%s", "${escapeCppStringLiteral(`[LOG ${fileName}:${lineNum}] `)}");`));

  for (const part of parts) {
    if (part.type === 'text') {
      lines.push(raw(`  printf("%s", "${escapeCppStringLiteral(part.value)}");`));
    } else {
      // Variable part: only printable if it is a non-function value in scope.
      const match = variables.find((v) => v.name === part.value && !v.isFunction);
      if (match) {
        const { spec, arg } = formatSpecFor(match.name, match.cppType);
        lines.push(raw(`  printf("${spec}", ${arg});`));
      } else {
        lines.push(raw(`  printf("%s", "{${escapeCppStringLiteral(part.value)}}"); // variable not in scope`));
      }
    }
  }

  lines.push(raw(`  printf("\\n");`));
  lines.push(`  // === END LOGPOINT ===`);

  return lines;
}

/**
 * Pick a printf format specifier + argument expression for a debug variable.
 *
 * The debug preprocessor has no TypeChecker, so `cppType` is a coarse
 * category inferred from AST shape. Native/generic mappings:
 *   - bool        → %d via static_cast<int>
 *   - int/long    → %lld via static_cast<long long> (native `number` is long
 *                   long; int32_t widens into the same cast)
 *   - float       → %g via static_cast<double> (float literal widens)
 *   - string      → %s via .c_str() (native strings are std::string)
 *   - unknown     → %g via static_cast<double>, the documented fallback that
 *                   compiles for any numeric/bool variable.
 */
function formatSpecFor(
  varName: string,
  cppType: CapturedVariable['cppType'],
): { spec: string; arg: string } {
  switch (cppType) {
    case 'bool':
      return { spec: '%d', arg: `static_cast<int>(${varName})` };
    case 'int':
    case 'long':
      return { spec: '%lld', arg: `static_cast<long long>(${varName})` };
    case 'float':
      return { spec: '%g', arg: `static_cast<double>(${varName})` };
    case 'string':
      return { spec: '%s', arg: `${varName}.c_str()` };
    case 'unknown':
    default:
      // Cast to double so printf compiles regardless of the real C++ type.
      return { spec: '%g', arg: `static_cast<double>(${varName})` };
  }
}
