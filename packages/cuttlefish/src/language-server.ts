// ---------------------------------------------------------------------------
// language-server.ts — the editor-facing, no-emit analysis surface.
//
// The vendored TypeCAD Intel VS Code extension (scaffolds install it from
// cuttlefish's assets alongside the .ui grammar and debug extensions)
// resolves the PROJECT's own @typecad/cuttlefish copy and dynamic-imports
// this module, so the editor's analysis always matches the engine that
// builds the project — zero version drift, no engine bundled in the
// extension. The API is deliberately shaped like LSP handler results (the
// same Diagnostic objects the CLI prints, 1-based lines/columns) so a stdio
// server for other editors can wrap it later without redesign.
//
// Errors throw with actionable messages ("No entry file…", "Entry file not
// found: …") — callers surface them in a status line, they are not bugs.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import { analyzeProject, resolveQueryInvocation } from "./query.js";
import { listUsbSerialPorts } from "./test-runner/port-discovery.js";
import type { Diagnostic } from "./api/index.js";

export interface EditorAnalysisOptions {
  /** Workspace root — the directory typecad-hal.config.ts is looked up from. */
  workspaceRoot: string;
}

/** One GPIO pin the program claims (from the analysis report's usage table). */
export interface EditorPinUsage {
  pinName: string;
  mode: string;
  peripheralRole?: string;
}

/** Headline numbers for a status line: memory estimate + task inventory. */
export interface EditorAnalysisSummary {
  staticBytes: number;
  stackDepth: number;
  asyncTasks: number;
  isrHandlers: number;
  usesTimers: boolean;
}

export interface EditorAnalysisResult {
  /** Absolute path of the analyzed entry (from the config unless overridden). */
  entryFile: string;
  /** Every file in the entry's import graph (entry included). */
  files: string[];
  /** The config's board target, when one is configured. */
  board?: string;
  /** The config's framework package, when one is configured. */
  framework?: string;
  /**
   * Diagnostics from every file in the graph, each carrying the file it
   * refers to. Lines and columns are 1-based, matching CLI output.
   */
  diagnostics: Diagnostic[];
  /** Pins the program claims and how (board facts + program facts joined). */
  pinUsage: EditorPinUsage[];
  /** Memory estimate and task counts for status display. */
  summary: EditorAnalysisSummary;
}

/**
 * One no-emit analysis pass over the configured project — the same graph
 * walk, IR build, and validation suite `typecad-hal query` runs, stopping
 * before emit/type-check/lint. Nothing is written to disk.
 */
export async function analyzeForEditor(opts: EditorAnalysisOptions): Promise<EditorAnalysisResult> {
  const invocation = resolveQueryInvocation({}, opts.workspaceRoot);
  if (!fs.existsSync(invocation.entryFile)) {
    throw new Error(`Entry file not found: ${invocation.entryFile}`);
  }
  const { files, report, allDiagnostics } = await analyzeProject(invocation);
  return {
    entryFile: invocation.entryFile,
    files,
    board: report.metadata.board,
    framework: report.metadata.framework,
    diagnostics: allDiagnostics,
    pinUsage: report.pinUsage.gpio.map((p) => ({
      pinName: p.pinName,
      mode: p.mode,
      ...(p.peripheralRole !== undefined ? { peripheralRole: p.peripheralRole } : {}),
    })),
    summary: {
      staticBytes: report.heapEstimate.totalStaticBytes,
      stackDepth: report.heapEstimate.estimatedStackDepth,
      asyncTasks: report.asyncTasks.length,
      isrHandlers: report.executionFlow.isrHandlers.length,
      usesTimers: report.executionFlow.usesTimers,
    },
  };
}

/** One attached USB serial port, normalized (see test-runner port-discovery). */
export interface EditorSerialPort {
  path: string;
  vid: string;
  pid: string;
  serialNumber?: string;
  manufacturer?: string;
}

/**
 * Enumerate attached USB serial ports — the port picker behind the editor's
 * Flash & Monitor / Run-on-Hardware commands. Throws when the optional
 * `serialport` native dependency is not installed; callers fall back to a
 * manual port entry.
 */
export async function listPorts(): Promise<EditorSerialPort[]> {
  return listUsbSerialPorts();
}
