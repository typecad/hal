// ---------------------------------------------------------------------------
// Arduino profile resolution
//
// Resolves Arduino-specific profile settings based on FQBN and program IR.
// ---------------------------------------------------------------------------

import type { ExpressionIR, ProgramIR, StatementIR, Diagnostic, PlatformContext, ArduinoPlatformContext, TypecodeReceiverKind } from "@typecode/core/shared";
import type { ArduinoCliMetadata } from "./cli-metadata";
import { loadArduinoCliMetadata } from "./cli-metadata";

/**
 * Extract architecture from FQBN string.
 * FQBN format: vendor:arch:board[:menu=options]
 * e.g., "arduino:avr:uno" -> "avr"
 */
function toArchitectureFromFqbn(fqbn?: string): string | undefined {
  if (!fqbn) return undefined;
  const parts = fqbn.split(":");
  return parts.length >= 2 ? parts[1] : undefined;
}

interface ArduinoProfileVariant {
  architecture: string;
  forcedIncludes: string[];
  symbolAliases?: Record<string, string>;
}

interface ArduinoCapabilities {
  architecture: string;
  builtinFunctions: Set<string>;
  builtinGlobals: Set<string>;
  fallbackPins: {
    A0?: number;
  };
}

interface FqbnPinOverride {
  fqbnIncludes: string;
  pins: {
    A0?: number;
  };
}

const PROFILE_VARIANTS: ArduinoProfileVariant[] = [
  { architecture: "avr", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "esp32", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "samd", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "rp2040", forcedIncludes: ["<Arduino.h>"] },
];

const DEFAULT_PROFILE: ArduinoProfileVariant = {
  architecture: "default",
  forcedIncludes: ["<Arduino.h>"],
};

const CAPABILITY_TABLE: ArduinoCapabilities[] = [
  {
    architecture: "avr",
    builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "delay", "millis", "micros"]),
    builtinGlobals: new Set(["A0", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
    fallbackPins: { A0: 14 },
  },
  {
    architecture: "esp32",
    builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "delay", "millis", "micros"]),
    builtinGlobals: new Set(["A0", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
    fallbackPins: { A0: 36 },
  },
  {
    architecture: "samd",
    builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "delay", "millis", "micros"]),
    builtinGlobals: new Set(["A0", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
    fallbackPins: { A0: 14 },
  },
  {
    architecture: "rp2040",
    builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "delay", "millis", "micros"]),
    builtinGlobals: new Set(["A0", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
    fallbackPins: { A0: 26 },
  },
];

const DEFAULT_CAPABILITIES: ArduinoCapabilities = {
  architecture: "default",
  builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "delay", "millis", "micros"]),
  builtinGlobals: new Set(["A0", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
  fallbackPins: { A0: 0 },
};

const FQBN_PIN_OVERRIDES: FqbnPinOverride[] = [
  { fqbnIncludes: "arduino:avr:uno", pins: { A0: 14 } },
  { fqbnIncludes: "arduino:avr:nano", pins: { A0: 14 } },
  { fqbnIncludes: "arduino:avr:mega", pins: { A0: 54 } },
  { fqbnIncludes: "arduino:samd:mkrzero", pins: { A0: 15 } },
  { fqbnIncludes: "esp32:esp32:", pins: { A0: 36 } },
  { fqbnIncludes: "rp2040:rp2040:", pins: { A0: 26 } },
];

export interface ResolvedArduinoProfile {
  forcedIncludes: string[];
  symbolAliases: Record<string, string>;
  shimLines: string[];
  diagnostics: Diagnostic[];
}

function walkStatements(statements: StatementIR[], onStatement: (statement: StatementIR) => void): void {
  for (const statement of statements) {
    onStatement(statement);
    if (statement.kind === "while") {
      walkStatements(statement.body, onStatement);
    }
  }
}

function collectUsedIdentifiers(program: ProgramIR): Set<string> {
  const used = new Set<string>();

  function collectExpression(expr?: ExpressionIR): void {
    if (!expr) {
      return;
    }

    if (expr.kind === "identifier") {
      used.add(expr.value);
      return;
    }

    if (expr.kind === "raw") {
      for (const token of expr.value.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
        used.add(token);
      }
    }
  }

  const collectFromStatement = (statement: StatementIR): void => {
    if (statement.kind === "call") {
      const root = statement.callee.split(".")[0];
      if (root) {
        used.add(root);
      }
      for (const arg of statement.args) {
        collectExpression(arg);
      }
      return;
    }

    if (statement.kind === "assign") {
      used.add(statement.target);
      collectExpression(statement.value);
      return;
    }

    if (statement.kind === "update") {
      used.add(statement.target);
      return;
    }

    if (statement.kind === "var_decl") {
      collectExpression(statement.initializer);
      return;
    }

    if (statement.kind === "return") {
      collectExpression(statement.value);
      return;
    }

    if (statement.kind === "while") {
      collectExpression(statement.condition);
    }
  };

  walkStatements(program.topLevelStatements, collectFromStatement);
  for (const fn of program.functions) {
    walkStatements(fn.statements, collectFromStatement);
  }

  return used;
}

function collectCalledFunctions(program: ProgramIR): Set<string> {
  const called = new Set<string>();

  const collectFromStatement = (statement: StatementIR): void => {
    if (statement.kind === "call") {
      // Exclude method calls (both . and -> syntax) from built-in function checking
      if (!statement.callee.includes(".") && !statement.callee.includes("->")) {
        called.add(statement.callee);
      }
      return;
    }

    if (statement.kind === "while") {
      return;
    }
  };

  walkStatements(program.topLevelStatements, collectFromStatement);
  for (const fn of program.functions) {
    walkStatements(fn.statements, collectFromStatement);
  }

  return called;
}

function collectTopLevelDeclarations(program: ProgramIR): Set<string> {
  const declared = new Set<string>();
  for (const statement of program.topLevelStatements) {
    if (statement.kind === "var_decl") {
      declared.add(statement.name);
    }
  }

  for (const fn of program.functions) {
    declared.add(fn.originalName);
  }

  return declared;
}

function collectTypecodeReceiverKinds(program: ProgramIR): Set<TypecodeReceiverKind> {
  const kinds = new Set<TypecodeReceiverKind>();

  // Forward-declare so collectFromExpr and collectFromStatement can call each other
  let collectFromStatement: (s: StatementIR) => void;

  const collectFromExpr = (expr: ExpressionIR | undefined): void => {
    if (!expr || typeof expr !== 'object') return;
    switch (expr.kind) {
      case "typecode-call":
        kinds.add(expr.receiverKind);
        break;
      case "callback":
        for (const s of (expr as any).statements ?? []) collectFromStatement(s as StatementIR);
        break;
      case "lambda":
        for (const s of (expr as any).body ?? []) collectFromStatement(s as StatementIR);
        break;
      case "ternary":
        collectFromExpr(expr.condition);
        collectFromExpr(expr.whenTrue);
        collectFromExpr(expr.whenFalse);
        break;
      case "binary":
        collectFromExpr(expr.left);
        collectFromExpr(expr.right);
        break;
      case "unary":
        collectFromExpr(expr.operand);
        break;
      case "await":
        collectFromExpr(expr.value);
        break;
      case "paren":
        collectFromExpr(expr.inner);
        break;
      case "array":
        for (const el of expr.elements) collectFromExpr(el);
        break;
      case "string_concat":
        for (const p of expr.parts) collectFromExpr(p);
        break;
      case "template_string":
        collectFromExpr(expr.expression);
        break;
      case "object":
        for (const f of expr.fields) collectFromExpr(f.value);
        break;
      // Leaf kinds — nothing to recurse into
      default:
        break;
    }
  };

  collectFromStatement = (statement: StatementIR): void => {
    if (!statement || typeof statement !== 'object') return;
    switch (statement.kind) {
      case "typecode-call":
        kinds.add(statement.receiverKind);
        break;
      case "var_decl":
        collectFromExpr(statement.initializer);
        break;
      case "return":
        collectFromExpr((statement as any).value);
        break;
      case "assign":
        collectFromExpr((statement as any).value);
        break;
      case "if":
        collectFromExpr((statement as any).condition);
        for (const s of (statement as any).thenBranch ?? []) collectFromStatement(s);
        for (const s of (statement as any).elseBranch ?? []) collectFromStatement(s);
        break;
      case "while":
      case "do_while":
        collectFromExpr((statement as any).condition);
        for (const s of (statement as any).body ?? []) collectFromStatement(s);
        break;
      case "for":
        collectFromStatement((statement as any).initializer as StatementIR);
        collectFromExpr((statement as any).condition);
        collectFromStatement((statement as any).increment as StatementIR);
        for (const s of (statement as any).body ?? []) collectFromStatement(s);
        break;
      case "for_of":
      case "for_in":
        for (const s of (statement as any).body ?? []) collectFromStatement(s);
        break;
      case "block":
        for (const s of (statement as any).statements ?? []) collectFromStatement(s);
        break;
      case "try":
        for (const s of (statement as any).tryBlock ?? []) collectFromStatement(s);
        for (const s of (statement as any).catchBlock ?? []) collectFromStatement(s);
        for (const s of (statement as any).finallyBlock ?? []) collectFromStatement(s);
        break;
      case "call":
        for (const arg of (statement as any).args ?? []) collectFromExpr(arg as ExpressionIR);
        break;
      default:
        break;
    }
  };

  walkStatements(program.topLevelStatements, collectFromStatement);
  for (const fn of program.functions) {
    walkStatements(fn.statements, collectFromStatement);
  }
  for (const cls of program.classes ?? []) {
    for (const method of cls.methods ?? []) {
      walkStatements(method.statements, collectFromStatement);
    }
    if (cls.constructor) {
      walkStatements(cls.constructor.statements, collectFromStatement);
    }
  }

  return kinds;
}

function resolveVariant(context?: ArduinoPlatformContext): ArduinoProfileVariant {
  const architecture = toArchitectureFromFqbn(context?.fqbn);
  if (!architecture) {
    return DEFAULT_PROFILE;
  }

  return PROFILE_VARIANTS.find((item) => item.architecture === architecture) ?? DEFAULT_PROFILE;
}

function resolveCapabilities(context?: ArduinoPlatformContext): ArduinoCapabilities {
  const architecture = toArchitectureFromFqbn(context?.fqbn);
  if (!architecture) {
    return DEFAULT_CAPABILITIES;
  }

  return CAPABILITY_TABLE.find((item) => item.architecture === architecture) ?? DEFAULT_CAPABILITIES;
}

function mergeCapabilities(base: ArduinoCapabilities, metadata?: ArduinoCliMetadata): ArduinoCapabilities {
  if (!metadata) {
    return base;
  }

  return {
    architecture: metadata.architecture ?? base.architecture,
    builtinFunctions: new Set<string>([...base.builtinFunctions, ...metadata.builtinFunctions]),
    builtinGlobals: new Set<string>([...base.builtinGlobals, ...metadata.builtinGlobals]),
    fallbackPins: {
      A0: metadata.pins.A0 ?? base.fallbackPins.A0,
    },
  };
}

function resolveA0Fallback(
  context: ArduinoPlatformContext | undefined,
  capabilities: ArduinoCapabilities,
  metadata?: ArduinoCliMetadata,
): number {
  if (metadata?.pins.A0 !== undefined) {
    return metadata.pins.A0;
  }

  const fqbn = context?.fqbn?.toLowerCase() ?? "";
  if (fqbn) {
    const override = FQBN_PIN_OVERRIDES.find((item) => fqbn.includes(item.fqbnIncludes.toLowerCase()));
    if (override?.pins.A0 !== undefined) {
      return override.pins.A0;
    }
  }

  return capabilities.fallbackPins.A0 ?? 0;
}

export function resolveArduinoProfile(program: ProgramIR, platformContext?: PlatformContext): ResolvedArduinoProfile {
  const context = platformContext?.arduino;
  const metadataResult = loadArduinoCliMetadata(context);
  const variant = resolveVariant(context);
  const capabilities = mergeCapabilities(resolveCapabilities(context), metadataResult.metadata);

  const diagnostics: Diagnostic[] = [...metadataResult.diagnostics];

  const used = collectUsedIdentifiers(program);
  const calledFunctions = collectCalledFunctions(program);
  const declared = collectTopLevelDeclarations(program);
  const receiverKinds = collectTypecodeReceiverKinds(program);
  const shimLines: string[] = [];

  for (const functionName of calledFunctions) {
    if (declared.has(functionName)) {
      continue;
    }

    if (!capabilities.builtinFunctions.has(functionName)) {
      diagnostics.push({
        severity: "warning",
        code: "TYPECODE_ARDUINO_FUNC_UNKNOWN",
        message: `Function '${functionName}' is not in the known Arduino built-in function set for architecture '${capabilities.architecture}'.`,
      });
    }
  }

  for (const identifier of used) {
    if (declared.has(identifier)) {
      continue;
    }

    if (
      identifier === "HIGH" ||
      identifier === "LOW" ||
      identifier === "A0" ||
      identifier === "INPUT" ||
      identifier === "OUTPUT" ||
      identifier === "INPUT_PULLUP" ||
      identifier === "Serial"
    ) {
      if (!capabilities.builtinGlobals.has(identifier)) {
        diagnostics.push({
          severity: "warning",
          code: "TYPECODE_ARDUINO_GLOBAL_UNKNOWN",
          message: `Global '${identifier}' is not in the known Arduino built-in set for architecture '${capabilities.architecture}'.`,
        });
      }
    }
  }

  const needsHigh = used.has("HIGH") && !declared.has("HIGH") && !capabilities.builtinGlobals.has("HIGH");
  const needsLow = used.has("LOW") && !declared.has("LOW") && !capabilities.builtinGlobals.has("LOW");
  const needsA0 = used.has("A0") && !declared.has("A0") && !capabilities.builtinGlobals.has("A0");

  if (needsHigh) {
    shimLines.push("#ifndef HIGH", "#define HIGH 0x1", "#endif");
    diagnostics.push({
      severity: "warning",
      code: "TYPECODE_ARDUINO_SHIM_HIGH",
      message: "Injected fallback HIGH shim. Verify platform-specific value if your core overrides it.",
    });
  }

  if (needsLow) {
    shimLines.push("#ifndef LOW", "#define LOW 0x0", "#endif");
    diagnostics.push({
      severity: "warning",
      code: "TYPECODE_ARDUINO_SHIM_LOW",
      message: "Injected fallback LOW shim. Verify platform-specific value if your core overrides it.",
    });
  }

  if (needsA0) {
    const a0Fallback = resolveA0Fallback(context, capabilities, metadataResult.metadata);
    shimLines.push("#ifndef A0", `#define A0 ${a0Fallback}`, "#endif");
    diagnostics.push({
      severity: "warning",
      code: "TYPECODE_ARDUINO_SHIM_A0",
      message: `Injected fallback A0 shim as '${a0Fallback}'. Board-specific analog pin mapping may differ; set --fqbn for accurate pin mapping.`,
    });
  }

  const extraIncludes: string[] = [];
  if (receiverKinds.has('i2c')) extraIncludes.push('<Wire.h>');
  if (receiverKinds.has('spi')) extraIncludes.push('<SPI.h>');
  if (receiverKinds.has('eeprom')) extraIncludes.push('<EEPROM.h>');
  if (receiverKinds.has('wdt')) extraIncludes.push('<avr/wdt.h>');

  return {
    forcedIncludes: [...variant.forcedIncludes, ...extraIncludes],
    symbolAliases: {
      ...(variant.symbolAliases ?? {}),
    },
    shimLines,
    diagnostics,
  };
}