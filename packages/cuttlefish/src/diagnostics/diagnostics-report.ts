// ---------------------------------------------------------------------------
// Diagnostics Report Orchestrator
//
// Collects all available build data and generates:
//   1. diagnostics.md  — human-readable report with Mermaid diagrams
//   2. diagnostics.json — machine-readable structured data
//
// Note: Source maps and transpile diagnostics are EXCLUDED from the
// Markdown report per user spec. The JSON report includes everything.
// ---------------------------------------------------------------------------

import * as path from "path";
import * as fs from "fs";
import type { CallGraph } from "../ir/call-graph.js";
import type { ProgramIR } from "../api/index.js";
import type { Diagnostic } from "../types.js";
import { analyzeHeapUsage } from "../ir/heap-analysis.js";
import { buildCallGraph } from "../ir/call-graph.js";
import { generateMarkdownReport } from "./md-writer.js";
import type {
  DiagnosticsReport,
  ExecutionFlow,
  GpioPinEntry,
  PeripheralAllocation,
  AsyncTaskEntry,
  PeripheralConflictEntry,
  ModuleGraph,
  TreeShakingReport,
  BuildTiming,
} from "./json-schema.js";
import { inferGpioMode } from "./json-schema.js";

// ── Report Input (what the transpile pipeline provides) ────────────────────

export interface DiagnosticsReportInput {
  /** Entry TypeScript source file path */
  entryFile: string;
  /** Program IR for the entry module (after tree-shaking) */
  program: ProgramIR | null;
  /** All diagnostics collected during transpilation */
  diagnostics: Diagnostic[];
  /** Async task names discovered */
  asyncTaskNames: string[];
  /** Whether timers (millis/micros) are used */
  usesTimers: boolean;
  /** Target architecture (e.g. "avr", "esp32") */
  target: string;
  /** Board package name */
  boardTarget?: string;
  /** Framework package name */
  frameworkPackage?: string;
  /** Build target identifier */
  buildTarget?: string;
  /** Output directory for generated files */
  outDir?: string;
  /** Output file path (relative or absolute) */
  outputFile?: string;
  /** Pre-build compiled modules (for module graph) */
  preBuilt?: Map<string, any>;
  /** Source map entries */
  sourceMaps?: any[];
  /** Profiler timing data */
  profiler?: { getTimings?: () => Record<string, number> };
  /** Tree-shaking removed symbols */
  removedSymbols?: string[];
  /** Board pins from board constants */
  boardPins?: Array<{ name: string; aliases: string[]; number: number }>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getBoardPinsFromConstants(
  program: ProgramIR | null,
): Array<{ name: string; aliases: string[]; number: number }> {
  if (!program?.boardConstants) return [];

  const pins: Array<{ name: string; aliases: string[]; number: number }> = [];

  // Iterate through pins.all.X.name until we find all pins
  for (let i = 0; i < 100; i++) {
    const name = program.boardConstants.get(`pins.all.${i}.name`);
    if (typeof name !== "string") break;

    const numRaw = program.boardConstants.get(`pins.all.${i}.number`);
    const num = typeof numRaw === "number" ? numRaw : i;

    const aliasesRaw = program.boardConstants.get(`pins.all.${i}.aliases`);
    const aliases = typeof aliasesRaw === "string" ? aliasesRaw.split(",") : [];

    pins.push({ name, number: num, aliases });
  }

  return pins;
}

// ── Execution Flow Builder ──────────────────────────────────────────────────

function buildExecutionFlow(
  program: ProgramIR | null,
  callGraph: CallGraph,
  asyncTaskNames: string[],
  usesTimers: boolean,
): ExecutionFlow {
  // Determine entry points
  const entryPoints: string[] = [];
  if (callGraph.nodes.has("setup")) entryPoints.push("setup");
  if (callGraph.nodes.has("loop")) entryPoints.push("loop");

  // If "main" or other standard entry is present add it
  for (const name of callGraph.nodes.keys()) {
    if (
      name !== "setup" &&
      name !== "loop" &&
      name !== "__top_level__" &&
      name.startsWith("main")
    ) {
      entryPoints.push(name);
    }
  }

  // Detect ISR handlers
  const isrHandlers: string[] = [];
  if (program) {
    // Detect ISR handlers: functions referenced by attachInterrupt or HAL ISR registration
    for (const fn of program.functions) {
      // Check if this function appears as a callback in HAL interrupt registration
      // in __top_level__ or setup statements (handled by existing transpiler diagnostics)
      // Heuristic: functions named with "isr", "handler", or attached to interrupts
      const lowerName = fn.originalName.toLowerCase();
      if (lowerName.includes("isr") || lowerName.includes("handler") || lowerName.includes("interrupt")) {
        isrHandlers.push(fn.originalName);
      }
    }
  }

  // Serialize call graph nodes for JSON
  const serializedNodes: Record<string, any> = {};
  for (const [name, node] of callGraph.nodes) {
    serializedNodes[name] = {
      name: node.name,
      kind: node.kind,
      dependencies: [...node.dependencies],
      source: node.source ? { line: node.source.line, column: node.source.column } : undefined,
    };
  }

  const serializedReferencedBy: Record<string, string[]> = {};
  for (const [name, refs] of callGraph.referencedBy) {
    serializedReferencedBy[name] = [...refs];
  }

  return {
    callGraph: {
      nodes: serializedNodes,
      referencedBy: serializedReferencedBy,
    },
    entryPoints,
    isrHandlers,
    asyncTaskNames,
    usesTimers,
  };
}

// ── Pin Usage Builder ──────────────────────────────────────────────────────

function buildPinUsage(
  program: ProgramIR | null,
  boardPinsData: Array<{ name: string; aliases: string[]; number: number }>,
): {
  gpio: GpioPinEntry[];
  peripherals: PeripheralAllocation[];
  summary: { totalPins: number; usedPins: number; unusedPins: number };
} {
  const gpio: GpioPinEntry[] = [];
  const peripherals: PeripheralAllocation[] = [];

  if (!program?.peripheralUsage) {
    return {
      gpio: [],
      peripherals: [],
      summary: { totalPins: boardPinsData.length, usedPins: 0, unusedPins: boardPinsData.length },
    };
  }

  const usage = program.peripheralUsage;

    // Map board pins to GPIO entries
  for (const pin of boardPinsData) {
    // Only include pins that are explicitly used in the program to keep the table clean
    const isExplicitlyUsed = usage.pinsUsed.has(pin.name) || 
                             pin.aliases.some(a => usage.pinsUsed.has(a)) ||
                             (pin.number !== undefined && (
                               usage.outputPins.has(pin.number) || 
                               usage.inputPins.has(pin.number) || 
                               usage.inputPullupPins.has(pin.number) || 
                               usage.inputPulldownPins.has(pin.number) ||
                               usage.pwmPinsUsed.has(pin.number) ||
                               usage.interruptPinsUsed.has(pin.number)
                             ));

    if (isExplicitlyUsed) {
      const mode = inferGpioMode(usage, pin.name, pin.number);
      gpio.push({
        pinName: pin.name,
        pinNumber: pin.number,
        mode,
      });
    }
  }

  // Build peripheral allocations — PeripheralUsageIR only has boolean flags
  if (usage.i2c) {
    peripherals.push({
      type: "i2c",
      instance: 0,
      displayName: "I2C",
      pins: [],
    });
  }
  if (usage.spi) {
    peripherals.push({
      type: "spi",
      instance: 0,
      displayName: "SPI",
      pins: [],
    });
  }
  if (usage.uart) {
    peripherals.push({
      type: "uart",
      instance: 0,
      displayName: "Serial",
      pins: [],
    });
  }
  if (usage.adc) {
    peripherals.push({
      type: "adc",
      instance: 0,
      displayName: "ADC",
      pins: [...usage.adcChannelsUsed].map((ch) => `A${ch}`),
    });
  }
  if (usage.pwm) {
    peripherals.push({
      type: "pwm",
      instance: 0,
      displayName: "PWM",
      pins: [...usage.pwmPinsUsed].map((n) => `D${n}`),
    });
  }
  if (usage.externalInterrupts) {
    peripherals.push({
      type: "interrupt",
      instance: 0,
      displayName: "External Interrupts",
      pins: [...usage.interruptPinsUsed].map((n) => `D${n}`),
    });
  }

  const usedPins = gpio.filter((p) => p.mode !== "INPUT").length;

  return {
    gpio,
    peripherals,
    summary: {
      totalPins: boardPinsData.length,
      usedPins,
      unusedPins: boardPinsData.length - usedPins,
    },
  };
}

// ── Peripheral Conflicts Builder ───────────────────────────────────────────

function buildPeripheralConflicts(
  _program: ProgramIR | null,
): PeripheralConflictEntry[] {
  // This would normally call analyzeResourceConflicts() from resource-analysis.ts
  // For now, return an empty array — the resource analysis is already run
  // independently during transpile and its diagnostics are in the Diagnostic array.
  // We could also import analyzeResourceConflicts directly here, but it requires
  // BoardConstants which we may or may not have access to.
  return [];
}

// ── Async Tasks Builder ────────────────────────────────────────────────────

function buildAsyncTasks(asyncTaskNames: string[]): AsyncTaskEntry[] {
  return asyncTaskNames.map((name) => ({
    name,
    // intervalMs is unknown without JSDoc annotation parsing (future enhancement)
    intervalMs: undefined,
  }));
}

// ── Module Graph Builder ───────────────────────────────────────────────────

function buildModuleGraph(
  program: ProgramIR | null,
  preBuilt?: Map<string, any>,
): ModuleGraph {
  const nodes = new Set<string>();
  const edges: { from: string; to: string }[] = [];

  if (program) {
    const fromName = path.basename(program.fileName);
    nodes.add(fromName);

    for (const imp of program.imports) {
      const toName = imp.moduleSpecifier;
      nodes.add(toName);
      edges.push({ from: fromName, to: toName });
    }
  }

  if (preBuilt) {
    for (const [fullPath] of preBuilt) {
      const baseName = path.basename(fullPath);
      nodes.add(baseName);
    }
  }

  return { nodes: [...nodes], edges };
}

// ── Tree Shaking Report Builder ────────────────────────────────────────────

function buildTreeShakingReport(removedSymbols?: string[]): TreeShakingReport {
  return {
    removedSymbols: removedSymbols ?? [],
  };
}

// ── Build Timing Builder ────────────────────────────────────────────────────

function buildTimingReport(profiler?: { getTimings?: () => Record<string, number> }): BuildTiming {
  const phases = profiler?.getTimings?.() ?? {};
  const values = Object.values(phases);
  const totalMs = values.reduce((sum, v) => sum + v, 0);
  return { phases, totalMs };
}

// ── Main Report Builder ────────────────────────────────────────────────────

/**
 * Build the complete DiagnosticsReport from transpile pipeline data.
 */
export function buildDiagnosticsReport(input: DiagnosticsReportInput): DiagnosticsReport {
  const program = input.program;
  const boardPinsData = input.boardPins ?? getBoardPinsFromConstants(program);

  // Build call graph
  const callGraph: CallGraph = program ? buildCallGraph(program) : { nodes: new Map(), referencedBy: new Map() };

  const executionFlow = buildExecutionFlow(program, callGraph, input.asyncTaskNames, input.usesTimers);
  const pinUsage = buildPinUsage(program, boardPinsData);
  const peripheralConflicts = buildPeripheralConflicts(program);
  const asyncTasks = buildAsyncTasks(input.asyncTaskNames);
  const heapEstimate = analyzeHeapUsage(program, input.target, callGraph.nodes);
  const moduleGraph = buildModuleGraph(program, input.preBuilt);
  const treeShaking = buildTreeShakingReport(input.removedSymbols);
  const timing = buildTimingReport(input.profiler);

  return {
    metadata: {
      timestamp: new Date().toISOString(),
      sourceFile: path.basename(input.entryFile),
      target: input.target,
      board: input.boardTarget,
      framework: input.frameworkPackage,
      buildTarget: input.buildTarget,
      outputFile: input.outputFile ?? path.basename(input.entryFile, path.extname(input.entryFile)) + ".cpp",
      boardDetails: program?.boardConstants ? {
        mcu: program.boardConstants.get("mcu") as string,
        architecture: program.boardConstants.get("architecture") as string,
        flashKb: program.boardConstants.get("memory.flash") as number / 1024,
        sramKb: program.boardConstants.get("memory.sram") as number / 1024,
        clockSpeedMhz: program.boardConstants.get("clockSpeed") as number / 1000000,
      } : undefined,
    },
    executionFlow,
    pinUsage,
    asyncTasks,
    heapEstimate,
    peripheralConflicts,
    moduleGraph,
    treeShaking,
    sourceMaps: input.sourceMaps,
    buildTiming: timing,
    transpileDiagnostics: input.diagnostics.length > 0 ? input.diagnostics : undefined,
  };
}

// ── File Writers ────────────────────────────────────────────────────────────

/**
 * Write diagnostics.md to the output directory.
 */
export function writeDiagnosticsReport(
  report: DiagnosticsReport,
  program: ProgramIR | null,
  outDir: string,
): void {
  const callGraph: CallGraph = program ? buildCallGraph(program) : { nodes: new Map(), referencedBy: new Map() };

  // Ensure output directory exists
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Write Markdown report
  const mdPath = path.join(outDir, "diagnostics.md");
  const mdContent = generateMarkdownReport(report, callGraph);
  fs.writeFileSync(mdPath, mdContent, "utf-8");

  // Write JSON report (includes everything)
  const jsonPath = path.join(outDir, "diagnostics.json");
  // Convert Sets to arrays for JSON serialization
  const jsonReport = serializeForJson(report);
  fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2), "utf-8");
}

/**
 * Recursively convert Set objects to arrays for JSON serialization.
 */
function serializeForJson(obj: any): any {
  if (obj instanceof Set) {
    return [...obj];
  }
  if (obj instanceof Map) {
    const result: Record<string, any> = {};
    for (const [k, v] of obj) {
      result[k] = serializeForJson(v);
    }
    return result;
  }
  if (Array.isArray(obj)) {
    return obj.map(serializeForJson);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = serializeForJson(v);
    }
    return result;
  }
  return obj;
}