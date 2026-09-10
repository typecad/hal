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
import { getBoardPins } from "../ir/board-pin-utils.js";

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
  boardPins?: Array<{ name: string; aliases: string[]; number?: number }>;
  /** The resolved board constants (any module's IR may carry them — the
   *  transpile pipeline scans and passes the populated map here) */
  boardConstants?: Map<string, string | number | boolean>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getBoardPinsFromConstants(
  program: ProgramIR | null,
  reportConstants?: Map<string, string | number | boolean>,
): Array<{ name: string; aliases: string[]; number?: number }> {
  const constants = reportConstants ?? program?.boardConstants;
  if (!constants) return [];
  // getBoardPins walks every pins.all.N.* key — no fixed cap (the derived
  // controller sweep can carry far more pads than the arduino-era 100).
  // A pin without a `.number` constant stays honestly numberless.
  return getBoardPins(constants as Parameters<typeof getBoardPins>[0]).map((p) => ({
    name: p.name,
    aliases: p.aliases,
    number: p.number,
  }));
}

// ── Execution Flow Builder ──────────────────────────────────────────────────

/** C++ keywords/types that leak into the rendered call graph as "callee"
 *  names — the rendered statement text, not source identifiers. Filtered
 *  from the report's graph so it shows program + HAL symbols only. */
const CPP_TOKEN_NOISE = new Set([
  "struct", "const", "static", "bool", "char", "int", "void", "float", "double",
  "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t",
  "size_t", "true", "false", "if", "else", "while", "for", "return", "sizeof",
  "nullptr", "NULL", "auto", "enum", "class", "new", "delete", "BIT", "case", "switch",
  "d", "s", "b", "v", "buf", "cfg", "seq",
]);

function isPlausibleSymbol(name: string): boolean {
  return /^[A-Za-z_][\w$]*$/.test(name) && !CPP_TOKEN_NOISE.has(name) && !name.startsWith("__tc_");
}

function buildExecutionFlow(
  program: ProgramIR | null,
  callGraph: CallGraph,
  asyncTaskNames: string[],
  usesTimers: boolean,
): ExecutionFlow {
  // The entry point is the program's top-level code (lowered to `main`);
  // setup()/loop() are not part of this pipeline.
  const entryPoints: string[] = [];
  if (program && program.topLevelStatements.length > 0) entryPoints.push("main");

  // ISR handlers: callbacks registered with isInterruptHandler (the
  // onRising/onFalling/watchdog/thread registration seams) carry the fact;
  // program.isrHandlerFunctions names the free functions attached BY NAME.
  // Prefer the emit-assigned function name (main_isr_N) over the
  // __CALLBACK_N__ placeholder so the table names the symbols the generated
  // C++ defines. The source-name heuristic stays as the last resort for
  // rawcpp-attached handlers.
  const isrHandlers: string[] = [];
  if (program) {
    for (const rc of program.registeredCallbacks ?? []) {
      const cb = rc.callbackIR as { isInterruptHandler?: boolean } | undefined;
      if (!cb?.isInterruptHandler) continue;
      const name = rc.emittedName ?? rc.placeholderName;
      if (!isrHandlers.includes(name)) isrHandlers.push(name);
    }
    for (const name of program.isrHandlerFunctions ?? []) {
      if (!isrHandlers.includes(name)) isrHandlers.push(name);
    }
    for (const fn of program.functions) {
      const lowerName = fn.originalName.toLowerCase();
      if ((lowerName.includes("isr") || lowerName.includes("handler") || lowerName.includes("interrupt"))
        && !entryPoints.includes(fn.originalName) && !isrHandlers.includes(fn.originalName)) {
        isrHandlers.push(fn.originalName);
      }
    }
  }

  // Serialize call graph nodes for JSON — dependencies filtered to plausible
  // source symbols (the graph is built from rendered statement text, so C++
  // tokens appear as dependency names).
  const serializedNodes: Record<string, any> = {};
  for (const [name, node] of callGraph.nodes) {
    serializedNodes[name] = {
      name: node.name,
      kind: node.kind,
      dependencies: [...node.dependencies].filter(isPlausibleSymbol),
      source: node.source ? { line: node.source.line, column: node.source.column } : undefined,
    };
  }

  const serializedReferencedBy: Record<string, string[]> = {};
  for (const [name, refs] of callGraph.referencedBy) {
    serializedReferencedBy[name] = [...refs].filter(isPlausibleSymbol);
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

interface BusControllerFacts {
  nodeLabel?: string;
  pads: { role?: string; pad: string }[];
  routes: string[];
}

/** The board's wired serial-bus controllers, from the generated constants:
 *  `zephyr.<bus>.controllers.N.nodeLabel` + the harvested `pinctrl`/`pads`. */
function busControllerFacts(
  constants: Map<string, string | number | boolean> | undefined,
  kind: "i2c" | "spi" | "uart",
  instance: number,
): BusControllerFacts {
  if (!constants) return { pads: [], routes: [] };
  const nodeLabel = constants.get(`zephyr.${kind}.controllers.${instance}.nodeLabel`);
  const padsRaw = constants.get(`zephyr.${kind}.controllers.${instance}.pads`);
  const pinctrlRaw = constants.get(`zephyr.${kind}.controllers.${instance}.pinctrl`);
  const pads = typeof padsRaw === "string" && padsRaw.length > 0
    ? padsRaw.split(",").map((pair) => {
        const eq = pair.indexOf("=");
        return eq === -1
          ? { pad: pair }
          : { role: pair.slice(0, eq) || undefined, pad: pair.slice(eq + 1) };
      }).filter((p) => p.pad)
    : [];
  const routes = typeof pinctrlRaw === "string" && pinctrlRaw.length > 0 ? pinctrlRaw.split(",") : [];
  return { nodeLabel: typeof nodeLabel === "string" ? nodeLabel : undefined, pads, routes };
}

/** Silicon ADC channels wired to pads: pin number → channel facts. */
function adcChannelMap(
  constants: Map<string, string | number | boolean> | undefined,
): Map<number, { channel: number; pinctrl?: string; device?: string }> {
  const map = new Map<number, { channel: number; pinctrl?: string; device?: string }>();
  if (!constants) return map;
  const device = typeof constants.get("zephyr.adc.nodeLabel") === "string"
    ? (constants.get("zephyr.adc.nodeLabel") as string) : undefined;
  for (const [key, value] of constants) {
    const m = key.match(/^zephyr\.adc\.channels\.(\d+)\.pin$/);
    if (!m || typeof value !== "number") continue;
    const idx = m[1]!;
    const channel = constants.get(`zephyr.adc.channels.${idx}.channel`);
    if (typeof channel !== "number") continue;
    const pinctrl = constants.get(`zephyr.adc.channels.${idx}.pinctrl`);
    map.set(value, {
      channel,
      pinctrl: typeof pinctrl === "string" ? pinctrl : undefined,
      device,
    });
  }
  return map;
}

/** Silicon PWM routes wired to pads: pin number → controller/channel facts. */
function pwmSpecMap(
  constants: Map<string, string | number | boolean> | undefined,
): Map<number, { controller: string; channel: number; pinctrl?: string }> {
  const map = new Map<number, { controller: string; channel: number; pinctrl?: string }>();
  if (!constants) return map;
  for (const [key, value] of constants) {
    const m = key.match(/^zephyr\.pwm\.specs\.(\d+)\.pin$/);
    if (!m || typeof value !== "number") continue;
    const idx = m[1]!;
    const controller = constants.get(`zephyr.pwm.specs.${idx}.controller`);
    const channel = constants.get(`zephyr.pwm.specs.${idx}.channel`);
    if (typeof controller !== "string" || typeof channel !== "number") continue;
    const pinctrl = constants.get(`zephyr.pwm.specs.${idx}.pinctrl`);
    map.set(value, { controller, channel, pinctrl: typeof pinctrl === "string" ? pinctrl : undefined });
  }
  return map;
}

function buildPinUsage(
  program: ProgramIR | null,
  boardPinsData: Array<{ name: string; aliases: string[]; number?: number }>,
  reportConstants?: Map<string, string | number | boolean>,
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
  const constants = reportConstants ?? (program.boardConstants as Map<string, string | number | boolean> | undefined);
  const adcChannels = adcChannelMap(constants);
  const pwmSpecs = pwmSpecMap(constants);

  // Canonical board pin for a used name: exact name first, then a silkscreen
  // alias (LED → PC13), so alias-keyed usage lands on the datasheet pin.
  const pinByAnyName = new Map<string, { name: string; aliases: string[]; number?: number }>();
  for (const p of boardPinsData) {
    pinByAnyName.set(p.name, p);
    for (const a of p.aliases) if (!pinByAnyName.has(a)) pinByAnyName.set(a, p);
  }

  // Collect every used pin as a canonical board-pin entry, keyed by pin name
  // so alias/name/number references to the same pad merge into one row.
  const usedEntries = new Map<string, GpioPinEntry>();
  const addUsedPin = (ref: { name: string; number?: number }): void => {
    const boardPin = pinByAnyName.get(ref.name);
    const pinName = boardPin?.name ?? ref.name;
    const existing = usedEntries.get(pinName);
    if (existing) {
      // A name-first reference may precede the number-bearing one — backfill
      // and re-infer the mode so the number-keyed usage sets still count.
      if (existing.pinNumber === undefined && typeof ref.number === "number" && ref.number >= 0) {
        existing.pinNumber = ref.number;
        existing.mode = inferGpioMode(usage, existing.pinName, existing.pinNumber);
      }
      return;
    }
    const pinNumber = boardPin?.number ?? (typeof ref.number === "number" && ref.number >= 0 ? ref.number : undefined);
    usedEntries.set(pinName, {
      pinName,
      pinNumber,
      mode: inferGpioMode(usage, pinName, pinNumber),
    });
  };
  for (const name of usage.pinsUsed) addUsedPin({ name });
  for (const numSet of [usage.outputPins, usage.inputPins, usage.inputPullupPins, usage.inputPulldownPins, usage.pwmPinsUsed, usage.interruptPinsUsed, usage.adcChannelsUsed]) {
    for (const n of numSet) {
      const name = boardPinsData.find((p) => p.number === n)?.name;
      // A number the board module doesn't export still drove hardware — keep
      // it as a D-form row rather than dropping it from the table silently.
      addUsedPin({ name: name ?? `D${n}`, number: n });
    }
  }

  // Peripheral role annotation per pin (shown in the GPIO table).
  for (const entry of usedEntries.values()) {
    const roles: string[] = [];
    if (entry.pinNumber !== undefined && usage.adcChannelsUsed.has(entry.pinNumber)) {
      const ch = adcChannels.get(entry.pinNumber!);
      roles.push(ch ? `ADC ${ch.channel} (${ch.device ?? "adc"})` : "ADC");
    }
    if (entry.pinNumber !== undefined && usage.pwmPinsUsed.has(entry.pinNumber)) {
      const spec = pwmSpecs.get(entry.pinNumber!);
      roles.push(spec ? `PWM ${spec.controller} ch${spec.channel}` : "PWM");
    }
    if (entry.pinNumber !== undefined && usage.interruptPinsUsed.has(entry.pinNumber)) roles.push("IRQ");
    entry.peripheralRole = roles.length > 0 ? roles.join(", ") : undefined;
    gpio.push(entry);
  }
  gpio.sort((a, b) => (a.pinNumber ?? 1e9) - (b.pinNumber ?? 1e9) || a.pinName.localeCompare(b.pinName));

  // ── Peripheral instances ────────────────────────────────────────────────
  const busKinds: { kind: "uart" | "i2c" | "spi"; label: (i: number) => string; instances: Set<number>; used: boolean }[] = [
    { kind: "uart", label: (i) => `UART${i}`, instances: usage.uartInstancesUsed ?? new Set(), used: usage.uart },
    { kind: "i2c", label: (i) => `I2C${i}`, instances: usage.i2cInstancesUsed ?? new Set(), used: usage.i2c },
    { kind: "spi", label: (i) => `SPI${i}`, instances: usage.spiInstancesUsed ?? new Set(), used: usage.spi },
  ];
  const consoleLabel = typeof constants?.get("zephyr.console") === "string"
    ? (constants!.get("zephyr.console") as string) : undefined;

  for (const { kind, label, instances, used } of busKinds) {
    const list = used && instances.size === 0 ? [0] : [...instances].sort((a, b) => a - b);
    for (const instance of list) {
      const facts = busControllerFacts(constants, kind, instance);
      const displayName = label(instance) + (facts.nodeLabel ? ` (${facts.nodeLabel})` : "")
        + (kind === "uart" && facts.nodeLabel && facts.nodeLabel === consoleLabel ? " — console" : "");
      peripherals.push({
        type: kind,
        instance,
        displayName,
        pins: facts.pads.map((p) => (p.role ? `${p.pad} (${p.role})` : p.pad)),
        dtLabel: facts.nodeLabel,
        detail: facts.routes.length > 0 ? `pinctrl: ${facts.routes.join(", ")}` : undefined,
      });
    }
  }

  if (usage.adc) {
    const device = [...adcChannels.values()].find((c) => c.device)?.device;
    const usedPins = [...usage.adcChannelsUsed].filter((n) => typeof n === "number");
    peripherals.push({
      type: "adc",
      instance: 0,
      displayName: `ADC${device ? ` (${device})` : ""}`,
      pins: usedPins.map((n) => {
        const name = boardPinsData.find((p) => p.number === n)?.name ?? `pin ${n}`;
        const ch = adcChannels.get(n);
        return ch ? `${name} (ch${ch.channel})` : name;
      }),
      dtLabel: device,
      detail: usedPins.map((n) => adcChannels.get(n)?.pinctrl).filter(Boolean).join(", ") || undefined,
    });
  }

  if (usage.pwm) {
    // One row per driven controller (instance = the lowest pin on it).
    const byController = new Map<string, { pins: string[]; routes: string[]; firstPin: number }>();
    for (const n of usage.pwmPinsUsed) {
      const spec = pwmSpecs.get(n);
      const name = boardPinsData.find((p) => p.number === n)?.name ?? `pin ${n}`;
      const key = spec?.controller ?? "pwm";
      const row = byController.get(key) ?? { pins: [], routes: [], firstPin: n };
      row.pins.push(spec ? `${name} (ch${spec.channel})` : name);
      if (spec?.pinctrl) row.routes.push(spec.pinctrl);
      row.firstPin = Math.min(row.firstPin, n);
      byController.set(key, row);
    }
    for (const [controller, row] of [...byController.entries()].sort((a, b) => a[1].firstPin - b[1].firstPin)) {
      peripherals.push({
        type: "pwm",
        instance: row.firstPin,
        displayName: `PWM (${controller})`,
        pins: row.pins,
        dtLabel: controller,
        detail: row.routes.length > 0 ? `pinctrl: ${row.routes.join(", ")}` : undefined,
      });
    }
  }

  for (const instance of usage.usbInstancesUsed ?? []) {
    const controller = constants?.get("zephyr.usb.controller");
    peripherals.push({
      type: "usb",
      instance,
      displayName: `USB CDC${typeof controller === "string" ? ` (${controller})` : ""}`,
      pins: [],
      dtLabel: typeof controller === "string" ? controller : undefined,
      detail: "CDC-ACM serial over the USB device controller",
    });
  }

  if (usage.wdt) {
    const wdt = constants?.get("zephyr.wdt.nodeLabel");
    peripherals.push({
      type: "wdt",
      instance: 0,
      displayName: `Watchdog${typeof wdt === "string" ? ` (${wdt})` : ""}`,
      pins: [],
      dtLabel: typeof wdt === "string" ? wdt : undefined,
    });
  }

  if (usage.counter) {
    for (const instance of usage.counterInstancesUsed ?? []) {
      const nodeLabel = constants?.get(`zephyr.hwtimer.controllers.${instance}.nodeLabel`);
      peripherals.push({
        type: "counter",
        instance,
        displayName: `Counter${instance}`,
        pins: [],
        dtLabel: typeof nodeLabel === "string" ? nodeLabel : undefined,
      });
    }
  }

  for (const key of usage.sensorPartsUsed ?? []) {
    // `${part}|${kind}${busInstance}|${port}` — the lowering's sensor key.
    const [part, bus, port] = key.split("|");
    const kind = bus?.startsWith("spi") ? "spi" : "i2c";
    const instance = parseInt((bus ?? "").replace(/^(spi|i2c)/, ""), 10) || 0;
    const facts = busControllerFacts(constants, kind, instance);
    peripherals.push({
      type: "sensor",
      instance,
      displayName: part ?? "sensor",
      pins: [`${kind.toUpperCase()}${instance}${facts.nodeLabel ? ` (${facts.nodeLabel})` : ""} @ ${port}`],
      dtLabel: facts.nodeLabel,
    });
  }

  return {
    gpio,
    peripherals,
    summary: {
      totalPins: boardPinsData.length,
      usedPins: gpio.length,
      unusedPins: boardPinsData.length - gpio.length,
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
  const boardConstants = input.boardConstants
    ?? (program?.boardConstants as Map<string, string | number | boolean> | undefined);
  const boardPinsData = input.boardPins ?? getBoardPinsFromConstants(program, boardConstants);

  // Build call graph. Dependencies come from rendered statement text, so the
  // first pass filters the C++ token noise once — the flow diagram, stack
  // analysis and JSON serialization below all see source-level symbols only.
  const callGraph: CallGraph = program ? buildCallGraph(program) : { nodes: new Map(), referencedBy: new Map() };
  for (const node of callGraph.nodes.values()) {
    const filtered = [...node.dependencies].filter(isPlausibleSymbol);
    node.dependencies.clear();
    for (const dep of filtered) node.dependencies.add(dep);
  }
  for (const [name, refs] of callGraph.referencedBy) {
    callGraph.referencedBy.set(name, new Set([...refs].filter(isPlausibleSymbol)));
  }

  const executionFlow = buildExecutionFlow(program, callGraph, input.asyncTaskNames, input.usesTimers);
  const pinUsage = buildPinUsage(program, boardPinsData, boardConstants);
  const peripheralConflicts = buildPeripheralConflicts(program);
  const asyncTasks = buildAsyncTasks(input.asyncTaskNames);
  const heapEstimate = analyzeHeapUsage(program, input.target, callGraph.nodes, executionFlow.entryPoints);
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
      boardDetails: boardConstants ? {
        mcu: (boardConstants.get("mcu") as string) ?? undefined,
        architecture: (boardConstants.get("architecture") as string) ?? undefined,
        flashKb: typeof boardConstants.get("memory.flash") === "number"
          ? (boardConstants.get("memory.flash") as number) / 1024 : undefined,
        sramKb: typeof boardConstants.get("memory.sram") === "number"
          ? (boardConstants.get("memory.sram") as number) / 1024 : undefined,
        clockSpeedMhz: typeof boardConstants.get("clockSpeed") === "number"
          ? (boardConstants.get("clockSpeed") as number) / 1000000 : undefined,
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