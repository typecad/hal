import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { loadTypecadConfig } from "./config-loader.js";
import { collectTranspileGraph } from "./orchestrator/graph-builder.js";
import { buildProgramIR } from "./ir/build-ir.js";
import { CompilationContext, contextStorage, resetTranspileResolvedHalOps } from "./ir/build-ir-state.js";
import { classDeclarationToIR } from "./ir/declaration-builders.js";
import { setActiveStrategy, loadHALModules, setHALProjectDir } from "./ir/hal-resolver.js";
import { getBoardPins } from "./ir/board-pin-utils.js";
import { buildDiagnosticsReport } from "./diagnostics/diagnostics-report.js";
import type { DiagnosticsReport } from "./diagnostics/json-schema.js";
import { loadPlatformStrategy } from "./transpile.js";
import { resetCuttlefishLibraries } from "./library-packages.js";
import type { ClassIR, Diagnostic, ProgramIR } from "./api/index.js";
import type { PlatformStrategy } from "./api/shared/index.js";
import type { QueryCommandOptions } from "./types.js";
import * as ui from "./utils/ui.js";
import chalk from "chalk";

/**
 * `typecad-hal query` — agent-friendly, read-only inspection of a firmware
 * project, ported from the PCB repo's `typecad-pcb query` ergonomics:
 * subject-specific views of the design with a stable `--json` contract, so
 * agents ask instead of grepping source.
 *
 * The analysis mirrors transpile.ts's setup and IR stages (graph walk,
 * cross-module class registry, per-file ProgramIR) but stops before emit,
 * type-checking, and lint — query is best-effort inspection; `build` remains
 * the correctness gate. Nothing is written to disk.
 */

export const QUERY_SUBJECTS = [
  "summary",
  "pins",
  "peripherals",
  "tasks",
  "memory",
  "modules",
  "diagnostics",
] as const;

export type QuerySubject = (typeof QUERY_SUBJECTS)[number];

export interface AnalyzeOptions {
  entryFile: string;
  boardTarget?: string;
  frameworkPackage?: string;
  projectRoot?: string;
}

export interface AnalyzeResult {
  entryFile: string;
  /** Every file in the entry's import graph (entry included). */
  files: string[];
  /** The entry module's IR (carries peripheralUsage, callbacks, diagnostics). */
  program: ProgramIR;
  /** The aggregated diagnostics report every subject projects from. */
  report: DiagnosticsReport;
  /**
   * Diagnostics from EVERY file in the graph, not just the entry — each
   * carrying the file it refers to (filePath defaults to the IR that produced
   * it), deduped, sorted by file then position. Editor surfaces (the
   * ./language-server subpath) map these straight onto squiggles; the CLI's
   * `diagnostics` subject keeps printing the entry's program.diagnostics.
   */
  allDiagnostics: Diagnostic[];
}

export async function analyzeProject(opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const entryFile = path.resolve(opts.entryFile);
  const entryDir = path.dirname(entryFile);

  // Same anchor + warm-up order transpileFile uses, so the HAL registry and
  // resolved-op seams reflect THIS project and THIS run only.
  setHALProjectDir(opts.projectRoot ?? entryDir);
  const strategy: PlatformStrategy | undefined = loadPlatformStrategy(opts.frameworkPackage, opts.boardTarget, entryDir, false);
  if (strategy) setActiveStrategy(strategy);
  loadHALModules(true);
  resetTranspileResolvedHalOps();
  resetCuttlefishLibraries();

  const graph = await collectTranspileGraph(entryFile, opts.boardTarget, {});
  const files = graph.files;

  // Phase 0 (mirrors transpile.ts): pre-register every class so cross-module
  // property access resolves to the declared C++ type during IR building.
  const prebuiltClassMap = new Map<string, ClassIR>();
  const classSources: Array<{ filePath: string; sourceText: string; declarations: ts.ClassDeclaration[] }> = [];
  for (const filePath of files) {
    try {
      const sourceText = fs.readFileSync(filePath, "utf8");
      const source = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
      classSources.push({ filePath, sourceText, declarations: source.statements.filter(ts.isClassDeclaration) });
    } catch {
      // read/parse errors surface during IR building below
    }
  }
  const prebuildContext = new CompilationContext();
  prebuildContext.activeStrategy = strategy ?? null;
  for (const { declarations } of classSources) {
    for (const declaration of declarations) {
      if (!declaration.name) continue;
      prebuildContext.topLevelClassNames.add(declaration.name.text);
      prebuildContext.classTypeNames.add(declaration.name.text);
    }
  }
  contextStorage.run(prebuildContext, () => {
    for (const { filePath, sourceText, declarations } of classSources) {
      for (const declaration of declarations) {
        const classIR = classDeclarationToIR(declaration, filePath, sourceText, [], new Map(), new Map(), [], new Map());
        if (classIR && !prebuiltClassMap.has(classIR.name)) {
          prebuiltClassMap.set(classIR.name, classIR);
          prebuildContext.topLevelClasses.set(classIR.name, classIR);
        }
      }
    }
  });

  // Phase A (mirrors transpile.ts): IR per file. buildProgramIR already
  // attaches peripheralUsage, boardConstants, registeredCallbacks and
  // isrHandlerFunctions — everything query needs, with no emit.
  const rawIRs = files.map((filePath) => ({
    filePath,
    programIR: buildProgramIR(filePath, fs.readFileSync(filePath, "utf8"), opts.boardTarget, prebuiltClassMap),
  }));
  const entryIR = rawIRs.find((r) => r.filePath === entryFile)?.programIR ?? rawIRs[0]!.programIR;

  // The board import is traversed while building whichever file imports it
  // first — scan every IR for the populated constants map (transpile.ts does
  // the same when assembling the diagnostics report).
  let boardConstants: Map<string, string | number | boolean> | undefined;
  for (const { programIR } of rawIRs) {
    const bc = programIR.boardConstants as Map<string, string | number | boolean> | undefined;
    if (bc && bc.size > 0) {
      boardConstants = bc;
      break;
    }
  }

  // Async tasks are an emit-stage discovery; derive them from the IR the same
  // way the emitter setup does (program.functions.filter(isAsync)).
  const asyncTaskNames = entryIR.functions.filter((fn) => fn.isAsync).map((fn) => fn.originalName);
  // Timer engagement is normally detected while emitting Time.sleep calls; a
  // parse-level scan over the graph keeps query read-only and close enough.
  const usesTimers = rawIRs.some(({ filePath }) => /\bTime\.sleep\s*\(/.test(fs.readFileSync(filePath, "utf8")));

  const report = buildDiagnosticsReport({
    entryFile,
    program: entryIR,
    diagnostics: entryIR.diagnostics ?? [],
    asyncTaskNames,
    usesTimers,
    target: opts.boardTarget ?? "generic",
    boardTarget: opts.boardTarget,
    frameworkPackage: opts.frameworkPackage,
    preBuilt: new Map(rawIRs.map((r) => [r.filePath, { programIR: r.programIR }])),
    removedSymbols: [],
    boardPins: getBoardPins(boardConstants),
    boardConstants,
  });

  // Cross-file diagnostics: same Diagnostic objects the per-file IRs carry,
  // with filePath defaulted to the file whose IR produced them (positional
  // diagnostics already name their own file via sourceSpan).
  const seen = new Set<string>();
  const allDiagnostics: Diagnostic[] = [];
  for (const { filePath, programIR } of rawIRs) {
    for (const d of programIR.diagnostics ?? []) {
      const withFile: Diagnostic = { ...d, filePath: d.filePath ?? filePath };
      const key = `${withFile.severity}|${withFile.code ?? ""}|${withFile.filePath}|${withFile.line ?? ""}|${withFile.column ?? ""}|${withFile.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allDiagnostics.push(withFile);
    }
  }
  const severityRank: Record<string, number> = { error: 0, warning: 1, info: 2 };
  allDiagnostics.sort(
    (a, b) =>
      (a.filePath ?? "").localeCompare(b.filePath ?? "")
      || (a.line ?? 0) - (b.line ?? 0)
      || (a.column ?? 0) - (b.column ?? 0)
      || (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3),
  );

  return { entryFile, files, program: entryIR, report, allDiagnostics };
}

// ─── Command entry ──────────────────────────────────────────────────────────

export interface ResolvedQueryInvocation {
  entryFile: string;
  projectRoot?: string;
  boardTarget?: string;
  frameworkPackage?: string;
}

/**
 * Resolve the query invocation's entry/board/framework. The config (found
 * from the cwd, like every other command) is the BASE for all three: a
 * positional entry overrides only the entry, so `query pins src/main.ts`
 * inside a configured project still analyzes against the project's board —
 * `--board`/`--framework` override only their own field.
 */
export function resolveQueryInvocation(
  options: Pick<QueryCommandOptions, "entryFile" | "board" | "framework">,
  cwd: string = process.cwd(),
): ResolvedQueryInvocation {
  const config = loadTypecadConfig(cwd);
  const projectRoot = config ? path.dirname(config.configPath) : undefined;
  let entryFile = options.entryFile;
  if (!entryFile) {
    if (!config?.entry) {
      throw new Error(
        "No entry file. Pass one (typecad-hal query summary src/main.ts) or set 'entry' in typecad-hal.config.ts.",
      );
    }
    entryFile = path.resolve(path.dirname(config.configPath), config.entry);
  }
  return {
    entryFile,
    projectRoot,
    boardTarget: options.board ?? config?.board,
    frameworkPackage: options.framework ?? config?.framework,
  };
}

export async function runQuery(options: QueryCommandOptions): Promise<void> {
  const subject = options.subject;
  if (!subject || subject === "help") {
    printSubjectList();
    return;
  }
  if (!QUERY_SUBJECTS.includes(subject as QuerySubject)) {
    throw new Error(`Unknown subject '${subject}'. Valid subjects: ${QUERY_SUBJECTS.join(", ")}.`);
  }
  const querySubject = subject as QuerySubject;

  const { entryFile, projectRoot, boardTarget, frameworkPackage } = resolveQueryInvocation(options);
  if (!fs.existsSync(entryFile)) {
    throw new Error(`Entry file not found: ${entryFile}`);
  }

  const { report, files, program } = await analyzeProject({ entryFile, boardTarget, frameworkPackage, projectRoot });

  if (options.json) {
    console.log(JSON.stringify(subjectPayload(querySubject, { report, files, program }), null, 2));
    return;
  }
  printSubject(querySubject, { report, files, program });
}

// ─── Payloads ───────────────────────────────────────────────────────────────

interface QueryData {
  report: DiagnosticsReport;
  files: string[];
  program: ProgramIR;
}

function peripheralKinds(report: DiagnosticsReport): string[] {
  return [...new Set(report.pinUsage.peripherals.map((p) => p.type.toUpperCase()))].sort();
}

function subjectPayload(subject: QuerySubject, data: QueryData): unknown {
  const { report, files, program } = data;
  const m = report.metadata;
  switch (subject) {
    case "summary":
      return {
        entry: m.sourceFile,
        board: m.board,
        framework: m.framework,
        target: m.target,
        boardDetails: m.boardDetails,
        modules: files.length,
        pins: report.pinUsage.summary,
        peripherals: peripheralKinds(report),
        asyncTasks: report.asyncTasks.length,
        isrHandlers: report.executionFlow.isrHandlers,
        usesTimers: report.executionFlow.usesTimers,
        staticBytes: report.heapEstimate.totalStaticBytes,
        estimatedStackDepth: report.heapEstimate.estimatedStackDepth,
        diagnostics: countDiagnostics(program),
      };
    case "pins":
      return { summary: report.pinUsage.summary, gpio: report.pinUsage.gpio };
    case "peripherals":
      return { peripherals: report.pinUsage.peripherals, conflicts: report.peripheralConflicts };
    case "tasks":
      return {
        asyncTasks: report.asyncTasks,
        isrHandlers: report.executionFlow.isrHandlers,
        entryPoints: report.executionFlow.entryPoints,
        usesTimers: report.executionFlow.usesTimers,
      };
    case "memory":
      return {
        totalStaticBytes: report.heapEstimate.totalStaticBytes,
        estimatedStackDepth: report.heapEstimate.estimatedStackDepth,
        stackPaths: report.heapEstimate.stackPaths,
        globalVariables: report.heapEstimate.globalVariables,
        structSizes: report.heapEstimate.structSizes,
        notes: report.heapEstimate.notes,
      };
    case "modules":
      return report.moduleGraph ?? { nodes: [], edges: [] };
    case "diagnostics":
      return { diagnostics: program.diagnostics ?? [] };
  }
}

function countDiagnostics(program: ProgramIR): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const d of program.diagnostics ?? []) {
    if (d.severity === "error") errors++;
    else if (d.severity === "warning") warnings++;
  }
  return { errors, warnings };
}

// ─── Pretty printing ────────────────────────────────────────────────────────

function printSubjectList(): void {
  ui.printHeader();
  console.log(chalk.bold("typecad-hal query") + chalk.gray(" — inspect the firmware design"));
  console.log("");
  console.log("  typecad-hal query summary        board, framework, usage totals");
  console.log("  typecad-hal query pins           GPIO assignments (name, mode, role)");
  console.log("  typecad-hal query peripherals    UART/I2C/SPI/ADC/PWM/USB allocations");
  console.log("  typecad-hal query tasks          async tasks, ISR handlers, entry points");
  console.log("  typecad-hal query memory         static RAM estimate and stack paths");
  console.log("  typecad-hal query modules        import graph");
  console.log("  typecad-hal query diagnostics    transpiler diagnostics");
  console.log("");
  console.log("Analyzes the entry (from typecad-hal.config.ts or a path argument)");
  console.log("in-process without emitting. Add --json for machine output.");
}

function printSubject(subject: QuerySubject, data: QueryData): void {
  const { report, files, program } = data;
  const m = report.metadata;
  ui.printHeader();
  console.log(chalk.bold(`typecad-hal query ${subject}`));
  console.log(chalk.gray(`  (${m.sourceFile})`));
  console.log("");

  switch (subject) {
    case "summary": {
      const s = report.pinUsage.summary;
      const d = countDiagnostics(program);
      row("board", m.board ?? "(none)");
      row("framework", m.framework ?? "(none)");
      row("target", m.target);
      row("modules", `${files.length} file${files.length === 1 ? "" : "s"} in the import graph`);
      row("pins", `${s.usedPins} / ${s.totalPins} used (${s.unusedPins} free)`);
      row("peripherals", peripheralKinds(report).join(", ") || "none");
      row(
        "tasks",
        `${report.asyncTasks.length} async, ${report.executionFlow.isrHandlers.length} ISR` +
          `, timers ${report.executionFlow.usesTimers ? "on" : "off"}`,
      );
      row("static RAM", `~${report.heapEstimate.totalStaticBytes} bytes (stack depth ${report.heapEstimate.estimatedStackDepth})`);
      row("diagnostics", d.errors === 0 && d.warnings === 0 ? "clean" : `${d.errors} error(s), ${d.warnings} warning(s)`);
      break;
    }
    case "pins": {
      const s = report.pinUsage.summary;
      console.log(`  ${s.usedPins} / ${s.totalPins} pins used, ${s.unusedPins} free`);
      console.log("");
      if (report.pinUsage.gpio.length === 0) {
        console.log("  (no GPIO pins configured)");
        break;
      }
      console.log(`  ${"PIN".padEnd(14)}${"MODE".padEnd(15)}ROLE`);
      for (const pin of report.pinUsage.gpio) {
        console.log(`  ${String(pin.pinName).padEnd(14)}${pin.mode.padEnd(15)}${pin.peripheralRole ?? ""}`);
      }
      break;
    }
    case "peripherals": {
      if (report.pinUsage.peripherals.length === 0) {
        console.log("  (no peripherals used)");
        break;
      }
      console.log(`  ${"TYPE".padEnd(10)}${"INSTANCE".padEnd(10)}${"NODE".padEnd(18)}PINS`);
      for (const p of report.pinUsage.peripherals) {
        console.log(`  ${p.type.toUpperCase().padEnd(10)}${String(p.instance).padEnd(10)}${String(p.dtLabel ?? "—").padEnd(18)}${p.pins?.join(", ") || "—"}`);
      }
      if (report.peripheralConflicts.length > 0) {
        console.log("");
        ui.printWarning(`${report.peripheralConflicts.length} peripheral conflict(s):`);
        for (const c of report.peripheralConflicts) console.log(`    ${c.severity}: ${c.message}`);
      }
      break;
    }
    case "tasks": {
      const flow = report.executionFlow;
      console.log(`  async tasks (${report.asyncTasks.length}):`);
      if (report.asyncTasks.length === 0) console.log("    (none)");
      for (const t of report.asyncTasks) console.log(`    ${t.name}${t.intervalMs !== undefined ? ` (every ${t.intervalMs} ms)` : ""}`);
      console.log(`  ISR handlers (${flow.isrHandlers.length}):`);
      if (flow.isrHandlers.length === 0) console.log("    (none)");
      for (const isr of flow.isrHandlers) console.log(`    ⚡ ${isr}`);
      console.log(`  entry points: ${flow.entryPoints.join(", ") || "(none)"}`);
      console.log(`  timers: ${flow.usesTimers ? "engaged (Time.sleep)" : "not used"}`);
      break;
    }
    case "memory": {
      const h = report.heapEstimate;
      row("static bytes", `~${h.totalStaticBytes}`);
      row("stack depth", String(h.estimatedStackDepth));
      console.log("");
      console.log(`  globals (${h.globalVariables.length}):`);
      if (h.globalVariables.length === 0) console.log("    (none)");
      for (const g of h.globalVariables) console.log(`    ${g.name.padEnd(20)}${g.cppType.padEnd(14)}${g.estimatedBytes} B`);
      if (h.stackPaths.length > 0) {
        console.log("  deepest call paths:");
        for (const p of h.stackPaths.slice(0, 5)) console.log(`    ${p.join(" → ")}`);
      }
      for (const note of h.notes) console.log(`  note: ${note}`);
      break;
    }
    case "modules": {
      const g = report.moduleGraph;
      if (!g || g.nodes.length === 0) {
        console.log("  (no module graph)");
        break;
      }
      console.log(`  nodes (${g.nodes.length}):`);
      for (const n of g.nodes) console.log(`    ${n}`);
      console.log(`  edges (${g.edges.length}):`);
      for (const e of g.edges) console.log(`    ${e.from} → ${e.to}`);
      break;
    }
    case "diagnostics": {
      const diagnostics = program.diagnostics ?? [];
      if (diagnostics.length === 0) {
        console.log("  ✅ No transpiler diagnostics.");
        break;
      }
      for (const d of diagnostics) {
        const icon = d.severity === "warning" ? "⚠" : d.severity === "error" ? "✖" : "ℹ";
        const where = d.filePath ? ` (${d.filePath}${d.line !== undefined ? `:${d.line}` : ""})` : "";
        console.log(`  ${icon} [${d.code ?? "unknown"}] ${d.message}${where}`);
      }
      break;
    }
  }
  console.log("");
}

function row(label: string, value: string): void {
  console.log(`  ${label.padEnd(14)}${value}`);
}
