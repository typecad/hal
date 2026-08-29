// ---------------------------------------------------------------------------
// Diagnostics Report — JSON Schema Types
// ---------------------------------------------------------------------------

import type { PeripheralUsageIR } from "../api/index.js";
import type { CallGraph } from "../ir/call-graph.js";
import type { Diagnostic, SourceSpan } from "../types.js";

// ── Pin Usage ──────────────────────────────────────────────────────────────

export interface GpioPinEntry {
  pinName: string;
  pinNumber?: number;
  mode: "OUTPUT" | "INPUT" | "INPUT_PULLUP" | "INPUT_PULLDOWN" | "ANALOG" | "PWM";
  /** If this pin is also allocated to a peripheral, list the peripheral name */
  peripheralRole?: string;
}

export interface PeripheralAllocation {
  type: "i2c" | "spi" | "uart" | "adc" | "pwm" | "interrupt";
  instance: number;
  displayName: string;
  pins: string[];
}

// ── Execution Flow ─────────────────────────────────────────────────────────

export interface CallGraphNodeEntry {
  name: string;
  kind: "function" | "class" | "enum" | "variable" | "type_alias";
  dependencies: string[];
  source?: { line: number; column: number };
}

export interface ExecutionFlow {
  callGraph: {
    nodes: Record<string, CallGraphNodeEntry>;
    referencedBy: Record<string, string[]>;
  };
  entryPoints: string[];
  /** Functions that are ISR handlers (attached via attachInterrupt or similar) */
  isrHandlers: string[];
  /** Async task names discovered during transpilation */
  asyncTaskNames: string[];
  /** Whether millis/micros timer is engaged */
  usesTimers: boolean;
}

// ── Async Task Info ────────────────────────────────────────────────────────

export interface AsyncTaskEntry {
  name: string;
  /** If a JSDoc @interval annotation was found */
  intervalMs?: number;
}

// ── Heap / Memory Estimate ─────────────────────────────────────────────────

export interface HeapEstimate {
  globalVariables: { name: string; cppType: string; estimatedBytes: number }[];
  structSizes: Record<string, number>;
  stringLiterals: { value: string; estimatedBytes: number }[];
  totalStaticBytes: number;
  /** Approximate stack depth derived from call graph maximum path length */
  estimatedStackDepth: number;
  /** The deepest call paths discovered during analysis */
  stackPaths: string[][];
  notes: string[];
}

// ── Peripheral Conflicts ───────────────────────────────────────────────────

export interface PeripheralConflictEntry {
  pinName: string;
  peripheralName: string;
  role: string;
  severity: "error" | "warning";
  message: string;
  suggestion: string;
  sourceSpan?: SourceSpan;
}

// ── Module Graph ───────────────────────────────────────────────────────────

export interface ModuleGraph {
  nodes: string[];
  edges: { from: string; to: string }[];
}

// ── Tree Shaking ───────────────────────────────────────────────────────────

export interface TreeShakingReport {
  removedSymbols: string[];
}

// ── Source Maps ───────────────────────────────────────────────────────────

export interface SourceMapEntry {
  generatedStartLine: number;
  generatedStartColumn: number;
  generatedEndLine: number;
  generatedEndColumn: number;
  tsSpan: SourceSpan;
  nodeKind: string;
  symbolName?: string;
}

// ── Build Timing ───────────────────────────────────────────────────────────

export interface BuildTiming {
  phases: Record<string, number>;
  totalMs: number;
}

// ── Top-Level Report ───────────────────────────────────────────────────────

export interface DiagnosticsReport {
  metadata: {
    timestamp: string;
    sourceFile: string;
    target: string;
    board?: string;
    framework?: string;
    buildTarget?: string;
    outputFile: string;
    boardDetails?: {
      mcu?: string;
      architecture?: string;
      flashKb?: number;
      sramKb?: number;
      clockSpeedMhz?: number;
    };
  };
  executionFlow: ExecutionFlow;
  pinUsage: {
    gpio: GpioPinEntry[];
    peripherals: PeripheralAllocation[];
    summary: {
      totalPins: number;
      usedPins: number;
      unusedPins: number;
    };
  };
  asyncTasks: AsyncTaskEntry[];
  heapEstimate: HeapEstimate;
  peripheralConflicts: PeripheralConflictEntry[];
  /** Available in JSON only — excluded from Markdown per user request */
  moduleGraph?: ModuleGraph;
  /** Available in JSON only */
  treeShaking?: TreeShakingReport;
  /** Available in JSON only */
  sourceMaps?: SourceMapEntry[];
  /** Available in JSON only */
  buildTiming?: BuildTiming;
  /** Available in JSON only */
  transpileDiagnostics?: Diagnostic[];
}

// ── Pin Role Inference ─────────────────────────────────────────────────────

/**
 * Infer the GPIO mode for a pin based on peripheral usage data.
 * Uses PeripheralUsageIR from core (the type available at runtime).
 */
export function inferGpioMode(
  usage: PeripheralUsageIR,
  _pinName: string,
  pinNumber: number | undefined,
): GpioPinEntry["mode"] {
  if (pinNumber !== undefined) {
    if (usage.pwmPinsUsed.has(pinNumber)) return "PWM";
    if (usage.adcChannelsUsed.has(pinNumber)) return "ANALOG";
    if (usage.interruptPinsUsed.has(pinNumber)) return "INPUT_PULLUP";
    if (usage.outputPins.has(pinNumber)) return "OUTPUT";
    if (usage.inputPullupPins.has(pinNumber)) return "INPUT_PULLUP";
    if (usage.inputPulldownPins.has(pinNumber)) return "INPUT_PULLDOWN";
    if (usage.inputPins.has(pinNumber)) return "INPUT";
  }
  return "INPUT";
}
