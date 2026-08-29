// ---------------------------------------------------------------------------
// Mermaid Diagram Builder
//
// Generates Mermaid.js diagram markup strings from diagnostic data.
// Used by the Markdown report writer to embed visualizations.
// ---------------------------------------------------------------------------

import type { CallGraph } from "../ir/call-graph.js";
import type { PeripheralUsage } from "../ir/peripheral-usage.js";
import type {
  GpioPinEntry,
  PeripheralAllocation,
  AsyncTaskEntry,
  ExecutionFlow,
  HeapEstimate,
  PeripheralConflictEntry,
  ModuleGraph,
  TreeShakingReport,
  BuildTiming,
} from "./json-schema.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Escape Mermaid labels to avoid syntax issues */
function esc(label: string): string {
  return label
    .replace(/"/g, "#quot;")
    .replace(/\n/g, " ")
    .replace(/\\/g, "/")
    .trim();
}

/**
 * Wrap a label for use in Mermaid bracket syntax.
 * If the label contains characters that confuse the parser
 * (parentheses, brackets, etc.), wraps it in double-quote form.
 */
function safeLabel(label: string): string {
  const safe = esc(label);
  // Always use quotes if the label contains any non-alphanumeric characters
  // (except spaces), to avoid confusing the Mermaid parser.
  if (/[^a-zA-Z0-9 ]/.test(safe)) {
    return `["${safe}"]`;
  }
  return `[${safe}]`;
}

function indent(level: number, str: string): string {
  return "  ".repeat(level) + str;
}

// ── Symbol classification (shared across diagram builders) ──────────────────

/** Symbols that are low-value leaf nodes — filter them out of diagrams. */
const NOISE = new Set([
  "true", "false", "HIGH", "LOW", "OUTPUT", "INPUT", "INPUT_PULLUP",
  "__EMIT__", "__top_level__", "LED", "LED_BUILTIN",
]);

/** Symbols from the TypeCAD board descriptor namespace chain. */
const BOARD_CHAIN = new Set([
  "TypeCAD", "Arduino", "Uno", "Nano", "Mega", "Mega2560",
  "Demo", "Board", "ATmega328P", "Features", "Esp32", "DevKit",
]);

/**
 * Known HAL runtime API call names used for diagram coloring/grouping.
 *
 * This is the cross-framework Wiring-derived HAL surface (the call names that
 * appear in emitted C++ across Arduino-core, ESP32 Arduino, RP2040 Arduino,
 * etc.). It is a diagnostic heuristic for grouping nodes in the mermaid
 * execution-flow and interrupt-map diagrams — not emitted code. The set is
 * generic: it identifies "this is a HAL/runtime call" for coloring purposes,
 * regardless of which Wiring-derived framework produced it.
 */
const HAL_API_NAMES: ReadonlySet<string> = new Set<string>([
  // GPIO
  "digitalWrite", "digitalRead", "analogWrite", "analogRead", "pinMode",
  // Serial
  "Serial", "println", "print", "read", "write",
  // Audio
  "tone", "noTone",
  // Timing
  "millis", "micros", "delay", "delayMicroseconds",
  // Interrupts
  "attachInterrupt", "detachInterrupt",
  // SPI / Shift
  "shiftOut", "shiftIn", "pulseIn",
  // HAL event tokens (from Button, etc.)
  "pressed", "released", "input",
]);

/** Recognize a HAL/runtime API call name for diagram coloring. */
function isHalApi(name: string): boolean {
  return HAL_API_NAMES.has(name);
}

// ── Execution Flow Diagram ──────────────────────────────────────────────────

/**
 * Build a categorized architecture diagram showing how the program
 * is organized: entry points, HAL objects, HAL APIs (grouped by
 * subsystem), state variables, and custom functions.
 *
 * Noise symbols (true/false/HIGH/board chain) are filtered out.
 * Nodes are laid out horizontally within subgraphs for readability.
 */
export function buildExecutionFlowDiagram(
  flow: ExecutionFlow,
  callGraph: CallGraph,
): string {
  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#e1f5fe', 'edgeColor': '#546e7a', 'fontFamily': 'Segoe UI, Roboto, Helvetica Neue, sans-serif' } } }%%");
  lines.push("flowchart TD");

  // ── 0. Styles ─────────────────────────────────────────────────────
  lines.push("  classDef entry fill:#4caf50,stroke:#2e7d32,color:#fff,stroke-width:2px;");
  lines.push("  classDef api fill:#fff9c4,stroke:#fbc02d,color:#333,stroke-width:1px;");
  lines.push("  classDef var fill:#e1f5fe,stroke:#0288d1,color:#01579b,stroke-width:1px;");
  lines.push("  classDef fn fill:#e8f5e9,stroke:#43a047,color:#1b5e20,stroke-width:1px;");
  lines.push("  classDef obj fill:#f3e5f5,stroke:#8e24aa,color:#4a148c,stroke-width:1px;");
  lines.push("  classDef board fill:#fafafa,stroke:#9e9e9e,color:#616161,stroke-width:1px,stroke-dasharray: 5 5;");


  // ── 1. Walk call graph, collecting non-noise symbols ──────────────

  const relevant = new Set<string>();
  const visited = new Set<string>();

  function walk(name: string) {
    if (visited.has(name)) return;
    if (name === "__top_level__") return;
    visited.add(name);
    if (!NOISE.has(name) && !BOARD_CHAIN.has(name)) {
      relevant.add(name);
    }
    const node = callGraph.nodes.get(name);
    if (node) {
      for (const dep of node.dependencies) {
        walk(dep);
      }
    }
  }

  for (const ep of flow.entryPoints) walk(ep);
  for (const ep of flow.isrHandlers) walk(ep);
  for (const task of flow.asyncTaskNames) walk(task);

  if (relevant.size === 0) {
    for (const [name] of callGraph.nodes) {
      if (!NOISE.has(name) && !BOARD_CHAIN.has(name) && name !== "__top_level__") {
        walk(name);
      }
    }
  }

  // Collect board chain symbols that were reached (for one collapsed node)
  const boardUsed: string[] = [];
  for (const name of visited) {
    if (BOARD_CHAIN.has(name)) boardUsed.push(name);
  }

  // ── 2. Sort into semantic categories ──────────────────────────────

  const entry = new Set(flow.entryPoints.filter((e) => relevant.has(e)));
  const isr = new Set(flow.isrHandlers.filter((e) => relevant.has(e)));
  const async = new Set(flow.asyncTaskNames.filter((e) => relevant.has(e)));

  const halObjects: string[] = [];
  const userVars: string[] = [];
  const userFns: string[] = [];
  const apis: string[] = [];
  const other: string[] = [];

  for (const name of relevant) {
    if (entry.has(name) || isr.has(name) || async.has(name)) continue;
    const node = callGraph.nodes.get(name);

    if (isHalApi(name)) {
      apis.push(name);
    } else if (node?.kind === "function") {
      userFns.push(name);
    } else if (node?.kind === "variable") {
      // Heuristic: short camelCase names without Time/Phase/State suffixes
      // are likely HAL objects; longer or snake_case names are state vars.
      if (
        /^[a-z][a-zA-Z]*$/.test(name) &&
        name.length <= 10 &&
        !/(Time|Phase|State|Edge)$/i.test(name)
      ) {
        halObjects.push(name);
      } else {
        userVars.push(name);
      }
    } else if (node?.kind === "class" || node?.kind === "enum") {
      other.push(name);
    } else {
      // Nodes not in callGraph (leaf constants, external symbols)
      other.push(name);
    }
  }

  // ── 3. Draw categorized subgraphs ─────────────────────────────────

  // --- Top: Entry Points ────────────────────────────────────────────
  const hasEntry = entry.size > 0 || isr.size > 0 || async.size > 0;
  if (hasEntry) {
    lines.push("  subgraph Entry[\"Entry Points\"]");
    lines.push("    direction LR");
    for (const name of entry) {
      lines.push(`    ${name}([${esc(name)}]):::entry`);
    }
    for (const name of isr) {
      lines.push(`    ${name}([ISR: ${esc(name)}]):::entry`);
    }
    for (const name of async) {
      lines.push(`    ${name}([async: ${esc(name)}]):::entry`);
    }
    lines.push("  end");
    lines.push("");
  }

  // --- HAL Objects ─────────────────────────────────────────────────
  if (halObjects.length > 0) {
    lines.push("  subgraph Objects[\"HAL Objects\"]");
    lines.push("    direction LR");
    for (const name of halObjects) {
      lines.push(`    ${name}{{${esc(name)}}}:::obj`);
    }
    lines.push("  end");
    lines.push("");
  }

  // --- HAL APIs (grouped by subsystem) ─────────────────────────────
  if (apis.length > 0) {
    lines.push("  subgraph APIs[\"HAL APIs\"]");
    lines.push("    direction LR");

    const groups: Record<string, string[]> = {
      "GPIO": ["digitalWrite", "digitalRead", "analogWrite", "analogRead", "pinMode"],
      "Serial": ["Serial", "println", "print", "read", "write"],
      "Audio": ["tone", "noTone"],
      "Timing": ["millis", "micros", "delay", "delayMicroseconds"],
    };

    const accounted = new Set<string>();
    for (const [label, members] of Object.entries(groups)) {
      const present = apis.filter((a) => members.includes(a));
      if (present.length > 0) {
        present.forEach((p) => accounted.add(p));
        lines.push(`    subgraph ${label.toLowerCase()}[${label}]`);
        lines.push("      direction LR");
        for (const name of present) {
          lines.push(`      ${name}${safeLabel(name)}:::api`);
        }
        lines.push("    end");
      }
    }

    const remaining = apis.filter((a) => !accounted.has(a));
    if (remaining.length > 0) {
      lines.push("    subgraph other[\"Other\"]");
      lines.push("      direction LR");
      for (const name of remaining) {
        lines.push(`      ${name}${safeLabel(name)}:::api`);
      }
      lines.push("    end");
    }

    lines.push("  end");
    lines.push("");
  }

  // --- State Variables ─────────────────────────────────────────────
  if (userVars.length > 0) {
    lines.push("  subgraph Vars[\"State Variables\"]");
    lines.push("    direction LR");
    for (const name of userVars) {
      lines.push(`    ${name}[(${esc(name)})]:::var`);
    }
    lines.push("  end");
    lines.push("");
  }

  // --- Custom Functions ────────────────────────────────────────────
  if (userFns.length > 0) {
    lines.push("  subgraph Fns[\"Functions\"]");
    lines.push("    direction LR");
    for (const name of userFns) {
      lines.push(`    ${name}[[${esc(name)}]]:::fn`);
    }
    lines.push("  end");
    lines.push("");
  }

  // --- Other Symbols (classes, enums, external refs) ───────────────
  if (other.length > 0) {
    lines.push("  subgraph Misc[\"Other\"]");
    lines.push("    direction LR");
    for (const name of other) {
      lines.push(`    ${name}${safeLabel(name)}`);
    }
    lines.push("  end");
    lines.push("");
  }

  // --- Board descriptor (collapsed into one node) ──────────────────
  if (boardUsed.length > 0) {
    const chain = boardUsed.join(" → ");
    lines.push(`  board_collapsed[\"Board: ${esc(chain)}\"]:::board`);
    lines.push("");
  }

  // ── 4. Edges: cross-category only, dotted ────────────────────────

  const drawnEdges = new Set<string>();

  for (const name of relevant) {
    const node = callGraph.nodes.get(name);
    if (!node) continue;
    for (const dep of node.dependencies) {
      if (!relevant.has(dep)) continue;
      if (dep === "__top_level__") continue;

      const nameCat = _category(name);
      const depCat = _category(dep);

      // Only draw edges that cross category boundaries.
      // Intra-category edges are implicit from the subgraph containment.
      if (nameCat !== depCat) {
        const key = `${name}-->${dep}`;
        if (!drawnEdges.has(key)) {
          drawnEdges.add(key);
          lines.push(`  ${name} -.-> ${dep}`);
        }
      }
    }
  }

  // Board chain connections
  if (boardUsed.length > 0) {
    for (const ep of entry) {
      lines.push(`  ${ep} -.-> board_collapsed`);
    }
  }

  lines.push("```");
  return lines.join("\n");

  // ── local helpers ────────────────────────────────────────────────

  function _category(name: string): string {
    if (entry.has(name)) return "entry";
    if (isr.has(name)) return "isr";
    if (async.has(name)) return "async";
    if (halObjects.includes(name)) return "hal";
    if (userVars.includes(name)) return "var";
    if (userFns.includes(name)) return "fn";
    if (apis.includes(name)) return "api";
    if (other.includes(name)) return "other";
    return "unknown";
  }
}

/**
 * Build a specialized flow diagram for ISR (Interrupt) handlers.
 * Shows only the paths starting from hardware events to their deep dependencies.
 */
export function buildInterruptMap(
  flow: ExecutionFlow,
  callGraph: CallGraph,
): string {
  const isrs = flow.isrHandlers;
  if (isrs.length === 0) return "";

  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#ffebee', 'edgeColor': '#c62828' } } }%%");
  lines.push("flowchart LR");
  lines.push("  classDef isr fill:#f44336,stroke:#b71c1c,color:#fff,font-weight:bold;");
  lines.push("  classDef logic fill:#ffffff,stroke:#c62828,color:#b71c1c,stroke-width:1px;");
  lines.push("  classDef api fill:#fff9c4,stroke:#fbc02d,color:#333,font-size:11px;");

  const visited = new Set<string>();
  const edges = new Set<string>();

  function walk(name: string, isRoot = false) {
    if (visited.has(name)) return;
    visited.add(name);

    const node = callGraph.nodes.get(name);
    const style = isRoot ? ":::isr" : (isHalApi(name) ? ":::api" : ":::logic");
    const shape = isRoot ? `[[${esc(name)}]]` : `(${esc(name)})`;
    lines.push(`  ${name}${shape}${style}`);

    if (node) {
      for (const dep of node.dependencies) {
        if (dep === "__top_level__" || NOISE.has(dep)) continue;
        const edge = `${name}-->${dep}`;
        if (!edges.has(edge)) {
          edges.add(edge);
          lines.push(`  ${name} -- calls --> ${dep}`);
        }
        walk(dep);
      }
    }
  }

  for (const isr of isrs) {
    walk(isr, true);
  }

  lines.push("```");
  return lines.join("\n");
}

// ── Pin Usage Diagram ───────────────────────────────────────────────────────

/**
 * Build a pie chart showing pin usage distribution.
 */
export function buildPinUsagePie(
  gpio: GpioPinEntry[],
  summary: { totalPins: number; usedPins: number; unusedPins: number },
): string {
  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("%%{init: { 'theme': 'base', 'themeVariables': { 'pie1': '#4caf50', 'pie2': '#2196f3', 'pie3': '#ff9800', 'pie4': '#f44336', 'pie5': '#9c27b0', 'pie6': '#795548', 'pie7': '#9e9e9e' } } }%%");
  lines.push("pie showData");
  lines.push("  title Pin Usage Distribution");

  const modeCounts: Record<string, number> = {};
  for (const pin of gpio) {
    modeCounts[pin.mode] = (modeCounts[pin.mode] ?? 0) + 1;
  }

  const modeLabels: Record<string, string> = {
    OUTPUT: "Digital Output",
    INPUT: "Digital Input",
    INPUT_PULLUP: "Input w/ Pullup",
    INPUT_PULLDOWN: "Input w/ Pulldown",
    ANALOG: "Analog Input",
    PWM: "PWM Output",
  };

  for (const [mode, count] of Object.entries(modeCounts)) {
    const label = modeLabels[mode] ?? mode;
    lines.push(`  "${label}" : ${count}`);
  }

  if (summary.unusedPins > 0) {
    lines.push(`  "Unused" : ${summary.unusedPins}`);
  }

  lines.push("```");
  return lines.join("\n");
}

// ── Pin Detail Table (not a diagram, but embedded in md-writer) ────────────

/**
 * Build a markdown table of individual pin assignments.
 */
export function buildPinDetailTable(gpio: GpioPinEntry[]): string {
  if (gpio.length === 0) return "_No GPIO pins configured._";

  const lines: string[] = [];
  lines.push("| Pin | Mode | Peripheral Role |");
  lines.push("|-----|------|-----------------|");

  for (const pin of gpio) {
    const role = pin.peripheralRole ?? "—";
    lines.push(`| \`${esc(pin.pinName)}\` | ${pin.mode} | ${role} |`);
  }

  return lines.join("\n");
}

// ── Peripheral Allocation Diagram ───────────────────────────────────────────

/**
 * Build a flowchart showing peripheral resource allocation.
 */
export function buildPeripheralDiagram(peripherals: PeripheralAllocation[]): string {
  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#f3e5f5', 'edgeColor': '#7b1fa2' } } }%%");
  lines.push("flowchart LR");
  lines.push("  classDef peri fill:#f3e5f5,stroke:#8e24aa,color:#4a148c,stroke-width:1px;");
  lines.push("  classDef pin fill:#ffffff,stroke:#9c27b0,color:#333,stroke-width:1px;");

  const drawn = new Set<string>();

  for (const p of peripherals) {
    const subgraphId = p.displayName.replace(/[^a-zA-Z0-9_]/g, "_");

    if (!drawn.has(subgraphId)) {
      drawn.add(subgraphId);
      lines.push(indent(1, `subgraph ${subgraphId}${safeLabel(p.displayName)}`));
      lines.push(indent(2, `direction LR`));

      // List pins assigned to this peripheral
      for (const pin of peripherals.filter((pp) => pp.displayName === p.displayName)) {
        for (const pinName of pin.pins) {
          const pinId = `${subgraphId}_${pinName.replace(/[^a-zA-Z0-9_]/g, "_")}`;
          lines.push(indent(2, `${pinId}${safeLabel(pinName)}:::pin`));
        }
      }

      lines.push(indent(1, "end"));
      lines.push(indent(1, `${subgraphId}:::peri`));
    }
  }

  // If no peripherals are active, show a note
  if (peripherals.length === 0) {
    lines.push(indent(1, "NONE[No peripherals configured]"));
  }

  lines.push("```");
  return lines.join("\n");
}

// ── Peripheral Detail Table ─────────────────────────────────────────────────

export function buildPeripheralTable(peripherals: PeripheralAllocation[]): string {
  if (peripherals.length === 0) return "_No peripherals in use._";

  const lines: string[] = [];
  lines.push("| Peripheral | Instance | Pins |");
  lines.push("|------------|----------|------|");

  for (const p of peripherals) {
    const pinList = p.pins.map((n) => `\`${esc(n)}\``).join(", ") || "—";
    lines.push(`| ${p.displayName} | ${p.instance} | ${pinList} |`);
  }

  return lines.join("\n");
}

// ── Async Task Timeline ─────────────────────────────────────────────────────

/**
 * Build a Gantt chart showing async task intervals (if timing data is available).
 */
export function buildAsyncTaskDiagram(tasks: AsyncTaskEntry[]): string {
  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("gantt");
  lines.push("  title Async Task Schedule");
  lines.push("  dateFormat X");
  lines.push("  axisFormat %");

  for (const task of tasks) {
    const intervalMs = task.intervalMs ?? 1000; // default 1000ms for unknown
    // Show one "cycle" of the task
    lines.push(`  section ${esc(task.name)}`);
    lines.push(`  ${esc(task.name)} : 0, ${intervalMs}`);
  }

  if (tasks.length === 0) {
    lines.push("  section No Async Tasks");
    lines.push("  idle : 0, 1000");
  }

  lines.push("```");
  return lines.join("\n");
}

// ── Heap Estimation Diagram ─────────────────────────────────────────────────

/**
 * Build a pie chart showing static memory allocation breakdown.
 */
export function buildHeapPie(heap: HeapEstimate): string {
  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("%%{init: { 'theme': 'base', 'themeVariables': { 'pie1': '#03a9f4', 'pie2': '#673ab7', 'pie3': '#ff5722', 'pie4': '#4caf50' } } }%%");
  lines.push("pie showData");
  lines.push("  title Static Memory Allocation (bytes)");

  if (heap.globalVariables.length > 0) {
    let varTotal = 0;
    for (const v of heap.globalVariables) varTotal += v.estimatedBytes;
    if (varTotal > 0) lines.push(`  "Global Variables" : ${varTotal}`);
  }

  let structTotal = 0;
  for (const [, size] of Object.entries(heap.structSizes)) {
    structTotal += size;
  }
  if (structTotal > 0) lines.push(`  "Struct/Class Instances" : ${structTotal}`);

  let strTotal = 0;
  for (const sl of heap.stringLiterals) {
    strTotal += sl.estimatedBytes;
  }
  if (strTotal > 0) lines.push(`  "String Literals" : ${strTotal}`);

  if (heap.totalStaticBytes === 0) {
    lines.push(`  "No static allocations" : 1`);
  }

  lines.push("```");

  // Add summary data table
  lines.push("");
  lines.push("| Category | Bytes |");
  lines.push("|----------|-------|");

  let varBytes = 0;
  for (const v of heap.globalVariables) varBytes += v.estimatedBytes;
  lines.push(`| Global Variables | ${varBytes} |`);
  lines.push(`| Struct/Class Sizes | ${structTotal} |`);
  lines.push(`| String Literals | ${strTotal} |`);
  lines.push(`| **Total Static** | **${heap.totalStaticBytes}** |`);
  lines.push(`| Est. Max Stack Depth | ${heap.estimatedStackDepth} frames |`);

  return lines.join("\n");
}

/**
 * Build a vertical "stack" visualization of static memory allocation.
 */
export function buildMemoryMap(heap: HeapEstimate): string {
  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#37474f', 'edgeColor': '#ffffff' } } }%%");
  lines.push("flowchart TD");
  lines.push("  classDef section fill:#263238,stroke:#eceff1,color:#fff,font-weight:bold;");
  lines.push("  classDef item fill:#455a64,stroke:#607d8b,color:#cfd8dc,font-size:12px;");
  lines.push("  classDef stack fill:#eceff1,stroke:#b0bec5,color:#455a64,stroke-dasharray: 5 5;");

  lines.push("  subgraph SRAM[\"SRAM Memory Layout\"]");
  lines.push("    direction TB");

  // Stack section
  lines.push("    subgraph StackS[\"ESTIMATED STACK\"]");
  lines.push(`      StackFrame[\"~${heap.estimatedStackDepth} Recursive Frames\"]:::stack`);
  lines.push("    end");
  lines.push("    StackS:::section");

  // Globals section
  if (heap.globalVariables.length > 0) {
    lines.push("    subgraph GlobalsS[\"GLOBAL VARIABLES\"]");
    for (const v of heap.globalVariables.slice(0, 10)) {
      lines.push(`      v_${v.name.replace(/[^a-zA-Z0-9]/g, "_")}[\"${esc(v.name)} (${v.estimatedBytes}b)\"]:::item`);
    }
    if (heap.globalVariables.length > 10) {
      lines.push(`      v_more[\"...and ${heap.globalVariables.length - 10} more\"]:::item`);
    }
    lines.push("    end");
    lines.push("    GlobalsS:::section");
  }

  // Strings section
  if (heap.stringLiterals.length > 0) {
    lines.push("    subgraph StringsS[\"STRING LITERALS\"]");
    for (let i = 0; i < Math.min(heap.stringLiterals.length, 5); i++) {
      const s = heap.stringLiterals[i];
      const preview = s.value.length > 15 ? s.value.substring(0, 12) + "..." : s.value;
      lines.push(`      s_${i}[\"\\\"${esc(preview)}\\\" (${s.estimatedBytes}b)\"]:::item`);
    }
    if (heap.stringLiterals.length > 5) {
      lines.push(`      s_more[\"...and ${heap.stringLiterals.length - 5} more\"]:::item`);
    }
    lines.push("    end");
    lines.push("    StringsS:::section");
  }

  lines.push("  end");
  lines.push("```");
  return lines.join("\n");
}
/**
 * Build a visualization of the deepest call paths.
 */
export function buildStackPathsMap(paths: string[][]): string {
  if (!paths || paths.length === 0) return "_No deep call paths detected._";

  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#e1f5fe', 'edgeColor': '#0288d1' } } }%%");
  lines.push("flowchart LR");
  lines.push("  classDef frame fill:#ffffff,stroke:#0288d1,color:#01579b,font-size:11px;");
  lines.push("  classDef entry fill:#4caf50,stroke:#2e7d32,color:#fff,font-weight:bold;");

  paths.forEach((path, pathIdx) => {
    const pathNodes: string[] = [];
    path.forEach((node, nodeIdx) => {
      const id = `p${pathIdx}_n${nodeIdx}`;
      const cls = nodeIdx === 0 ? ":::entry" : ":::frame";
      lines.push(`  ${id}[${esc(node)}]${cls}`);
      pathNodes.push(id);
    });
    
    for (let i = 0; i < pathNodes.length - 1; i++) {
      lines.push(`  ${pathNodes[i]} --> ${pathNodes[i+1]}`);
    }
  });

  lines.push("```");
  return lines.join("\n");
}

// ── Peripheral Conflicts ────────────────────────────────────────────────────

// ── Peripheral Conflicts ────────────────────────────────────────────────────

/**
 * Build a conflict table for the markdown report.
 */
export function buildConflictTable(conflicts: PeripheralConflictEntry[]): string {
  if (conflicts.length === 0) return "_No peripheral conflicts detected._";

  const lines: string[] = [];
  lines.push("| Severity | Pin | Peripheral | Role | Suggestion |");
  lines.push("|----------|-----|------------|------|------------|");

  for (const c of conflicts) {
    const sev = c.severity === "error" ? "🔴 Error" : "🟡 Warning";
    lines.push(`| ${sev} | \`${esc(c.pinName)}\` | ${esc(c.peripheralName)} | ${esc(c.role)} | ${esc(c.suggestion)} |`);
  }

  return lines.join("\n");
}

// ── Additional Diagnostic Sections ──────────────────────────────────────────

/**
 * Build a Mermaid dependency graph of imported modules.
 */
export function buildModuleGraphDiagram(graph: ModuleGraph): string {
  if (!graph || graph.nodes.length === 0) return "_No module data available._";

  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("flowchart TD");
  lines.push("  classDef module_file fill:#fafafa,stroke:#9e9e9e,color:#333,stroke-width:1px;");

  const uniqueNodes = new Set(graph.nodes);
  for (const node of uniqueNodes) {
    // Ensure ID starts with a letter and contains only valid chars
    let id = node.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+/, "");
    if (/^[0-9]/.test(id)) id = "m" + id;
    if (!id) id = "module";
    
    lines.push(`  ${id}${safeLabel(node)}:::module_file`);
  }

  for (const edge of graph.edges) {
    let from = edge.from.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+/, "");
    if (/^[0-9]/.test(from)) from = "m" + from;
    
    let to = edge.to.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+/, "");
    if (/^[0-9]/.test(to)) to = "m" + to;
    
    lines.push(`  ${from} --> ${to}`);
  }

  lines.push("```");
  return lines.join("\n");
}

/**
 * Build a table showing symbols removed by tree shaking.
 */
export function buildTreeShakingTable(report: TreeShakingReport): string {
  if (!report || report.removedSymbols.length === 0) {
    return "_No symbols were removed by tree shaking._";
  }

  const lines: string[] = [];
  lines.push("| Removed Symbol |");
  lines.push("|----------------|");

  for (const sym of report.removedSymbols) {
    lines.push(`| \`${esc(sym)}\` |`);
  }

  return lines.join("\n");
}

/**
 * Build a table showing build timing phases.
 */
export function buildTimingTable(timing: BuildTiming): string {
  if (!timing || !timing.phases || Object.keys(timing.phases).length === 0) {
    return "_No timing data available._";
  }

  const lines: string[] = [];
  lines.push("| Phase | Time (ms) |");
  lines.push("|-------|-----------|");

  for (const [phase, ms] of Object.entries(timing.phases)) {
    lines.push(`| ${phase} | ${ms.toFixed(2)} |`);
  }
  
  lines.push(`| **Total** | **${timing.totalMs.toFixed(2)}** |`);

  return lines.join("\n");
}