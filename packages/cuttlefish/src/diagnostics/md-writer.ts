// ---------------------------------------------------------------------------
// Markdown Report Writer
//
// Assembles the human-readable diagnostics.md file with embedded
// Mermaid diagrams and summary tables.
//
// Note: Source maps and transpile diagnostics are EXCLUDED from the 
// Markdown report (they appear only in JSON).
// ---------------------------------------------------------------------------

import type { CallGraph } from "../ir/call-graph.js";
import type {
  DiagnosticsReport,
  ExecutionFlow,
  GpioPinEntry,
  PeripheralAllocation,
  AsyncTaskEntry,
  HeapEstimate,
  PeripheralConflictEntry,
  ModuleGraph,
  TreeShakingReport,
  BuildTiming,
} from "./json-schema.js";
import {
  buildExecutionFlowDiagram,
  buildPinUsagePie,
  buildPinDetailTable,
  buildPeripheralDiagram,
  buildPeripheralTable,
  buildAsyncTaskDiagram,
  buildHeapPie,
  buildConflictTable,
  buildInterruptMap,
  buildMemoryMap,
  buildStackPathsMap,
  buildModuleGraphDiagram,
  buildTreeShakingTable,
  buildTimingTable,
} from "./mermaid-builder.js";

// ── Section Builders ────────────────────────────────────────────────────────

function buildMetadataSection(report: DiagnosticsReport): string {
  const m = report.metadata;
  const lines: string[] = [];
  lines.push(`# Build Diagnostics`);
  lines.push("");
  lines.push(`> **Source:** \`${m.sourceFile}\` | **Target:** \`${m.target}\` | **Generated:** ${new Date(m.timestamp).toLocaleString()}`);
  if (m.board) lines.push(`> **Board:** ${m.board} | **Framework:** ${m.framework || "None"}`);
  
  if (m.boardDetails) {
    const d = m.boardDetails;
    const specs: string[] = [];
    if (d.mcu) specs.push(`**MCU:** ${d.mcu}`);
    if (d.flashKb) specs.push(`**Flash:** ${d.flashKb}KB`);
    if (d.sramKb) specs.push(`**SRAM:** ${d.sramKb}KB`);
    if (d.clockSpeedMhz) specs.push(`**Clock:** ${d.clockSpeedMhz}MHz`);
    if (specs.length > 0) lines.push(`> ${specs.join(" | ")}`);
  }

  lines.push("");
  lines.push("---");
  return lines.join("\n");
}

function buildSummarySection(report: DiagnosticsReport): string {
  const lines: string[] = [];
  lines.push("## Project Summary");
  lines.push("");
  lines.push("| Metric | Status / Value |");
  lines.push("| :--- | :--- |");
  lines.push(`| **Output File** | \`${report.metadata.outputFile}\` |`);
  lines.push(`| **Entry Points** | ${report.executionFlow.entryPoints.length} |`);
  lines.push(`| **Static Memory** | ${report.heapEstimate.totalStaticBytes} bytes |`);
  lines.push(`| **Async Tasks** | ${report.asyncTasks.length || "None"} |`);
  
  const pins = report.pinUsage.summary;
  lines.push(`| **Pin Usage** | ${pins.usedPins} / ${pins.totalPins} pins |`);
  
  lines.push("");
  lines.push("---");
  return lines.join("\n");
}

function buildExecutionFlowSection(flow: ExecutionFlow, callGraph: CallGraph): string {
  const lines: string[] = [];
  lines.push("## Execution Flow");
  lines.push("");
  lines.push("> This graph shows the relationships between entry points, HAL objects, and framework APIs.");
  lines.push("");
  lines.push(buildExecutionFlowDiagram(flow, callGraph));
  lines.push("");

  if (flow.isrHandlers.length > 0) {
    lines.push("### Interrupt Logic Map");
    lines.push("");
    lines.push("> Specialized view showing only hardware-triggered event paths.");
    lines.push("");
    lines.push(buildInterruptMap(flow, callGraph));
    lines.push("");
  }

  if (flow.entryPoints.length > 0) {
    lines.push("### Entry Points");
    for (const ep of flow.entryPoints) {
      lines.push(`- \`${ep}()\``);
    }
    lines.push("");
  }

  if (flow.isrHandlers.length > 0) {
    lines.push("### ISR Handlers");
    for (const isr of flow.isrHandlers) {
      lines.push(`- \`${isr}()\` ⚡ (interrupt service routine)`);
    }
    lines.push("");
  }

  if (flow.usesTimers) {
    lines.push("### Timer Usage");
    lines.push("- ⏱ `millis()` / `micros()` timer is **active**");
    lines.push("");
  }

  return lines.join("\n");
}

function buildResourceAccessMatrixSection(
  flow: ExecutionFlow,
  callGraph: CallGraph,
  pinUsage: { gpio: GpioPinEntry[]; peripherals: PeripheralAllocation[] }
): string {
  const entries = [...flow.entryPoints, ...flow.isrHandlers, ...flow.asyncTaskNames];
  if (entries.length === 0) return "";

  const lines: string[] = [];
  lines.push("### Resource Access Matrix");
  lines.push("");
  lines.push("> High-level overview of hardware resources accessed by each entry point.");
  lines.push("");
  
  // Collect all unique resources used in the project
  const resources = new Set<string>();
  for (const p of pinUsage.peripherals) resources.add(p.displayName);
  for (const g of pinUsage.gpio) resources.add(g.pinName);
  
  const resourceList = [...resources].sort();
  if (resourceList.length === 0) return "";

  lines.push(`| Entry Point | ${resourceList.join(" | ")} |`);
  lines.push(`| :--- | ${resourceList.map(() => ":---:").join(" | ")} |`);

  for (const entry of entries) {
    // Find all APIs called by this entry (recursive)
    const calledAPIs = new Set<string>();
    const visited = new Set<string>();
    const walk = (name: string) => {
      if (visited.has(name)) return;
      visited.add(name);
      const node = callGraph.nodes.get(name);
      if (node) {
        for (const dep of node.dependencies) {
          calledAPIs.add(dep);
          walk(dep);
        }
      }
    };
    walk(entry);

    const row: string[] = [`\`${entry}()\``];
    for (const res of resourceList) {
      let used = false;
      // Check peripherals
      const peri = pinUsage.peripherals.find(p => p.displayName === res);
      if (peri) {
        if (calledAPIs.has(res) || peri.pins.some(p => calledAPIs.has(p))) used = true;
        // Also check for common API names associated with the peripheral
        if (res === "Serial" && (calledAPIs.has("println") || calledAPIs.has("print"))) used = true;
      } else {
        // Check GPIO pins
        if (calledAPIs.has(res)) used = true;
      }
      row.push(used ? "✅" : "—");
    }
    lines.push(`| ${row.join(" | ")} |`);
  }

  lines.push("");
  return lines.join("\n");
}


function buildPinUsageSection(
  gpio: GpioPinEntry[],
  peripherals: PeripheralAllocation[],
  summary: { totalPins: number; usedPins: number; unusedPins: number },
): string {
  const lines: string[] = [];
  lines.push("## Pin Configuration");
  lines.push("");
  lines.push("> **Tip:** Unused pins are available for connecting additional sensors, actuators, or peripherals.");
  lines.push("");
  lines.push(buildPinUsagePie(gpio, summary));
  lines.push("");

  lines.push("### 🔌 GPIO Assignments");
  lines.push("");
  lines.push(buildPinDetailTable(gpio));
  lines.push("");

  lines.push("### 🧩 Peripheral Resource Allocation");
  lines.push("");
  lines.push(buildPeripheralTable(peripherals));
  lines.push("");
  lines.push(buildPeripheralDiagram(peripherals));
  lines.push("");

  return lines.join("\n");
}

function buildAsyncTasksSection(tasks: AsyncTaskEntry[]): string {
  const lines: string[] = [];
  lines.push("## Cooperative Multitasking");
  lines.push("");

  if (tasks.length === 0) {
    lines.push("> _No async tasks registered in this program._");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("### 📅 Task Schedule");
  lines.push("");
  lines.push("| Task | Interval |");
  lines.push("| :--- | :--- |");

  for (const task of tasks) {
    const interval = task.intervalMs ? `${task.intervalMs} ms` : "unspecified";
    lines.push(`| \`fn ${task.name}()\` | ${interval} |`);
  }
  lines.push("");

  lines.push("### 📊 Timeline Visualization");
  lines.push("");
  lines.push(buildAsyncTaskDiagram(tasks));
  lines.push("");

  return lines.join("\n");
}

function buildHeapEstimateSection(heap: HeapEstimate): string {
  const lines: string[] = [];
  lines.push("## Memory Estimate");
  lines.push("");
  lines.push("> ⚠️ Static estimate only — excludes dynamic heap allocations (malloc/new).");
  lines.push("> String literals may be deduplicated by the compiler/linker.");
  lines.push("> **Tip:** Compare this static estimate to the total SRAM of your target board.");
  lines.push("");

  lines.push(buildHeapPie(heap));
  lines.push("");

  lines.push("### 🧱 SRAM Memory Map");
  lines.push("");
  lines.push(buildMemoryMap(heap));
  lines.push("");

  if (heap.stackPaths.length > 0) {
    lines.push("### Stack Analysis (Deepest Paths)");
    lines.push("");
    lines.push("> The following call sequences represent the maximum stack depth detected.");
    lines.push("");
    lines.push(buildStackPathsMap(heap.stackPaths));
    lines.push("");
  }

  if (heap.globalVariables.length > 0) {
    lines.push("### Global Variables");
    lines.push("");
    lines.push("| Variable | Type | Est. Bytes |");
    lines.push("|----------|------|------------|");

    for (const v of heap.globalVariables) {
      lines.push(`| \`${v.name}\` | \`${v.cppType}\` | ${v.estimatedBytes} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildConflictsSection(conflicts: PeripheralConflictEntry[]): string {
  const lines: string[] = [];
  lines.push("## Peripheral Conflicts");
  lines.push("");
  lines.push(buildConflictTable(conflicts));
  lines.push("");
  return lines.join("\n");
}

function buildModuleGraphSection(graph?: ModuleGraph): string {
  if (!graph) return "";
  const lines: string[] = [];
  lines.push("## Module Dependency Graph");
  lines.push("");
  lines.push("> Displays the file import hierarchy and dependencies.");
  lines.push("");
  lines.push(buildModuleGraphDiagram(graph));
  lines.push("");
  return lines.join("\n");
}

function buildTreeShakingSection(report?: TreeShakingReport): string {
  if (!report) return "";
  const lines: string[] = [];
  lines.push("## Tree Shaking Report");
  lines.push("");
  lines.push("> Symbols that were removed by the transpiler because they were unused.");
  lines.push("");
  lines.push(buildTreeShakingTable(report));
  lines.push("");
  return lines.join("\n");
}

function buildTimingSection(timing?: BuildTiming): string {
  if (!timing) return "";
  const lines: string[] = [];
  lines.push("## Build Timing Breakdown");
  lines.push("");
  lines.push("> Execution time for each transpiler phase.");
  lines.push("");
  lines.push(buildTimingTable(timing));
  lines.push("");
  return lines.join("\n");
}

function buildDiagnosticsSection(diagnostics?: any[]): string {
  if (!diagnostics || diagnostics.length === 0) return "";
  
  const lines: string[] = [];
  lines.push("## Transpile Diagnostics");
  lines.push("");
  lines.push("> Issues detected during code generation.");
  lines.push("");
  lines.push("| Severity | Message | Location |");
  lines.push("| :--- | :--- | :--- |");
  
  for (const d of diagnostics) {
    const sev = d.severity === "error" ? "🔴 Error" : "🟡 Warning";
    const loc = d.startLine !== undefined ? `Line ${d.startLine}` : "—";
    lines.push(`| ${sev} | ${d.message} | ${loc} |`);
  }
  
  lines.push("");
  return lines.join("\n");
}

// ── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Generate the complete diagnostics.md report as a string.
 *
 * @param report - The full diagnostics report with all data populated.
 * @param callGraph - The raw CallGraph (Map-based) for Mermaid node walk.
 * @returns The complete Markdown string ready to write to disk.
 */
export function generateMarkdownReport(
  report: DiagnosticsReport,
  callGraph: CallGraph,
): string {
  const sections: string[] = [];

  // 1. Metadata header & Summary
  sections.push(buildMetadataSection(report));
  sections.push(buildSummarySection(report));

  // 2. Execution flow (call graph, entry points, ISRs)
  sections.push(buildExecutionFlowSection(report.executionFlow, callGraph));

  // 2b. Resource Access Matrix
  sections.push(buildResourceAccessMatrixSection(report.executionFlow, callGraph, report.pinUsage));


  // 3. Pin usage (GPIO + peripheral allocation)
  sections.push(
    buildPinUsageSection(
      report.pinUsage.gpio,
      report.pinUsage.peripherals,
      report.pinUsage.summary,
    ),
  );

  // 4. Peripheral conflicts (only if there are any)
  if (report.peripheralConflicts.length > 0) {
    sections.push(buildConflictsSection(report.peripheralConflicts));
  }

  // 5. Async tasks
  sections.push(buildAsyncTasksSection(report.asyncTasks));

  // 6. Heap / memory estimate
  sections.push(buildHeapEstimateSection(report.heapEstimate));

  // 7. Module Graph
  if (report.moduleGraph) {
    sections.push(buildModuleGraphSection(report.moduleGraph));
  }

  // 8. Tree Shaking
  if (report.treeShaking) {
    sections.push(buildTreeShakingSection(report.treeShaking));
  }

  // 9. Build Timing
  if (report.buildTiming) {
    sections.push(buildTimingSection(report.buildTiming));
  }

  // 10. Transpile Diagnostics
  if (report.transpileDiagnostics) {
    sections.push(buildDiagnosticsSection(report.transpileDiagnostics));
  }

  return sections.join("\n\n");
}