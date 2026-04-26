/**
 * Output formatters for profiler reports.
 */

import { ProfilerReport, MemorySnapshot, PhaseStatistics } from "./types";

/**
 * Format a profiler report for console output
 */
export function formatConsoleReport(report: ProfilerReport): string {
  const lines: string[] = [];

  lines.push("═".repeat(60));
  lines.push("TRANSPILATION PERFORMANCE REPORT");
  lines.push("═".repeat(60));
  lines.push("");

  // Summary
  lines.push("SUMMARY");
  lines.push("-".repeat(40));
  lines.push(report.summary);
  lines.push("");

  // Phase breakdown
  lines.push("PHASE BREAKDOWN");
  lines.push("-".repeat(40));
  lines.push(
    "Phase".padEnd(30) + "Duration".padStart(12) + "Calls".padStart(8) + "Avg".padStart(12) + "%".padStart(8)
  );
  lines.push("-".repeat(70));

  for (const stat of report.session.phaseStats) {
    lines.push(
      stat.phase.slice(0, 29).padEnd(30) +
        `${stat.totalDuration.toFixed(2)}ms`.padStart(12) +
        String(stat.callCount).padStart(8) +
        `${stat.avgDuration.toFixed(2)}ms`.padStart(12) +
        `${stat.percentageOfTotal.toFixed(1)}%`.padStart(8)
    );
  }
  lines.push("");

  // Memory usage (if tracked)
  if (report.session.memorySnapshots.length > 0) {
    lines.push("MEMORY USAGE");
    lines.push("-".repeat(40));
    formatMemoryTable(report.session.memorySnapshots, lines);
    lines.push("");
  }

  // Bottlenecks
  if (report.bottlenecks.length > 0) {
    lines.push("BOTTLENECKS (>10% of total time)");
    lines.push("-".repeat(40));
    for (const bottleneck of report.bottlenecks) {
      lines.push(`  - ${bottleneck}`);
    }
    lines.push("");
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push("RECOMMENDATIONS");
    lines.push("-".repeat(40));
    for (const rec of report.recommendations) {
      lines.push(`  - ${rec}`);
    }
  }

  lines.push("═".repeat(60));
  return lines.join("\n");
}

/**
 * Format memory snapshots as a table
 */
function formatMemoryTable(snapshots: MemorySnapshot[], lines: string[]): void {
  lines.push(
    "Snapshot".padEnd(25) + "Heap Used".padStart(12) + "Heap Total".padStart(12) + "External".padStart(12)
  );

  for (const snap of snapshots) {
    lines.push(
      snap.name.slice(0, 24).padEnd(25) +
        `${(snap.heapUsed / 1024 / 1024).toFixed(2)}MB`.padStart(12) +
        `${(snap.heapTotal / 1024 / 1024).toFixed(2)}MB`.padStart(12) +
        `${(snap.external / 1024 / 1024).toFixed(2)}MB`.padStart(12)
    );
  }
}

/**
 * Format a profiler report as JSON
 */
export function formatJsonReport(report: ProfilerReport): string {
  return JSON.stringify(
    {
      summary: report.summary,
      totalDuration: report.session.totalDuration,
      bottlenecks: report.bottlenecks,
      recommendations: report.recommendations,
      phases: report.session.phaseStats.map((stat: PhaseStatistics) => ({
        phase: stat.phase,
        totalDuration: stat.totalDuration,
        callCount: stat.callCount,
        avgDuration: stat.avgDuration,
        minDuration: stat.minDuration,
        maxDuration: stat.maxDuration,
        percentageOfTotal: Math.round(stat.percentageOfTotal * 10) / 10,
      })),
      memory: report.session.memorySnapshots.length > 0 ? report.session.memorySnapshots : undefined,
    },
    null,
    2
  );
}

/**
 * Format a profiler report as Markdown
 */
export function formatMarkdownReport(report: ProfilerReport): string {
  const lines: string[] = [];

  lines.push("# Transpilation Performance Report");
  lines.push("");

  lines.push("## Summary");
  lines.push("```");
  lines.push(report.summary);
  lines.push("```");
  lines.push("");

  lines.push("## Phase Breakdown");
  lines.push("");
  lines.push("| Phase | Duration | Calls | Avg | % |");
  lines.push("|-------|----------|-------|-----|---|");

  for (const stat of report.session.phaseStats) {
    lines.push(
      `| ${stat.phase} | ${stat.totalDuration.toFixed(2)}ms | ${stat.callCount} | ${stat.avgDuration.toFixed(2)}ms | ${stat.percentageOfTotal.toFixed(1)}% |`
    );
  }
  lines.push("");

  if (report.bottlenecks.length > 0) {
    lines.push("## Bottlenecks");
    lines.push("");
    for (const b of report.bottlenecks) {
      lines.push(`- ${b}`);
    }
    lines.push("");
  }

  if (report.recommendations.length > 0) {
    lines.push("## Recommendations");
    lines.push("");
    for (const r of report.recommendations) {
      lines.push(`- ${r}`);
    }
  }

  return lines.join("\n");
}
