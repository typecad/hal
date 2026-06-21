/**
 * Performance profiler for the transpilation pipeline.
 *
 * Usage:
 *   const profiler = initProfiler({ enabled: true });
 *   profiler.startSession();
 *   profiler.timeSync('phase:name', () => { ... });
 *   await profiler.timeAsync('phase:async', async () => { ... });
 *   const report = profiler.endSession();
 */

import { performance } from "node:perf_hooks";
import {
  ProfilerOptions,
  TimingEntry,
  MemorySnapshot,
  ProfilerSession,
  PhaseStatistics,
  ProfilerReport,
  DEFAULT_PROFILER_OPTIONS,
} from "./types.js";

export class Profiler {
  private enabled: boolean;
  private trackMemory: boolean;
  private threshold: number;
  private timings: Map<string, TimingEntry> = new Map();
  private activeTimers: Map<string, number> = new Map();
  private memorySnapshots: MemorySnapshot[] = [];
  private sessionStart: number = 0;
  private parentStack: string[] = [];
  private timerCounter: number = 0;

  constructor(options: Partial<ProfilerOptions> = {}) {
    this.enabled = options.enabled ?? DEFAULT_PROFILER_OPTIONS.enabled;
    this.trackMemory = options.trackMemory ?? DEFAULT_PROFILER_OPTIONS.trackMemory;
    this.threshold = options.threshold ?? DEFAULT_PROFILER_OPTIONS.threshold;
  }

  /**
   * Check if profiling is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Start a timing measurement
   */
  startTimer(name: string, metadata?: Record<string, unknown>): void {
    if (!this.enabled) return;

    const uniqueName = `${name}#${this.timerCounter++}`;
    const startTime = performance.now();
    this.activeTimers.set(uniqueName, startTime);

    // Track parent-child relationships
    if (this.parentStack.length > 0) {
      const parentName = this.parentStack[this.parentStack.length - 1];
      const parentEntry = this.timings.get(parentName);
      if (parentEntry) {
        parentEntry.children.push(uniqueName);
      }
    }

    // Store initial entry
    const entry: TimingEntry = {
      name: uniqueName,
      startTime,
      endTime: 0,
      duration: 0,
      parent: this.parentStack[this.parentStack.length - 1],
      children: [],
      metadata,
    };
    this.timings.set(uniqueName, entry);

    if (this.trackMemory) {
      this.captureMemorySnapshot(`${name}:start`);
    }
  }

  /**
   * End a timing measurement
   */
  endTimer(name: string): number {
    if (!this.enabled) return 0;

    // Find the most recent timer with this base name
    let uniqueName: string | undefined;
    for (const [key] of [...this.timings.entries()].reverse()) {
      if (key.startsWith(`${name}#`)) {
        uniqueName = key;
        break;
      }
    }

    if (!uniqueName) return 0;

    const entry = this.timings.get(uniqueName);
    if (!entry) return 0;

    const endTime = performance.now();
    const duration = endTime - entry.startTime;

    entry.endTime = endTime;
    entry.duration = duration;

    // Remove from active timers
    this.activeTimers.delete(uniqueName);

    // If duration is below threshold, remove the entry
    if (duration < this.threshold) {
      this.timings.delete(uniqueName);
    }

    return duration;
  }

  /**
   * Time a synchronous function
   */
  timeSync<T>(name: string, fn: () => T, metadata?: Record<string, unknown>): T {
    if (!this.enabled) return fn();

    const uniqueName = `${name}#${this.timerCounter}`;
    this.startTimer(name, metadata);
    this.parentStack.push(uniqueName);
    try {
      const result = fn();
      return result;
    } finally {
      this.parentStack.pop();
      this.endTimer(name);
    }
  }

  /**
   * Time an asynchronous function
   */
  async timeAsync<T>(name: string, fn: () => Promise<T>, metadata?: Record<string, unknown>): Promise<T> {
    if (!this.enabled) return fn();

    const uniqueName = `${name}#${this.timerCounter}`;
    this.startTimer(name, metadata);
    this.parentStack.push(uniqueName);
    try {
      const result = await fn();
      return result;
    } finally {
      this.parentStack.pop();
      this.endTimer(name);
    }
  }

  /**
   * Capture a memory snapshot
   */
  captureMemorySnapshot(name: string): void {
    if (!this.enabled || !this.trackMemory) return;

    const mem = process.memoryUsage();
    this.memorySnapshots.push({
      name,
      timestamp: performance.now(),
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
    });
  }

  /**
   * Start a profiling session
   */
  startSession(): void {
    if (!this.enabled) return;

    this.sessionStart = performance.now();
    this.timings.clear();
    this.memorySnapshots = [];
    this.parentStack = [];
    this.timerCounter = 0;
    this.captureMemorySnapshot("session:start");
  }

  /**
   * End a profiling session and return the session data
   */
  endSession(): ProfilerSession {
    const endTime = performance.now();
    this.captureMemorySnapshot("session:end");

    const phaseStats = this.computePhaseStatistics(endTime - this.sessionStart);

    return {
      startTime: this.sessionStart,
      endTime,
      totalDuration: endTime - this.sessionStart,
      timings: new Map(this.timings),
      memorySnapshots: [...this.memorySnapshots],
      phaseStats,
    };
  }

  /**
   * Compute aggregated statistics by phase
   */
  private computePhaseStatistics(totalDuration: number): PhaseStatistics[] {
    const phaseMap = new Map<string, { total: number; count: number; min: number; max: number }>();

    for (const [, entry] of this.timings) {
      // Extract base phase name (remove counter suffix and file-specific parts)
      const basePhase = this.extractBasePhase(entry.name);
      const existing = phaseMap.get(basePhase);

      if (existing) {
        existing.total += entry.duration;
        existing.count++;
        existing.min = Math.min(existing.min, entry.duration);
        existing.max = Math.max(existing.max, entry.duration);
      } else {
        phaseMap.set(basePhase, {
          total: entry.duration,
          count: 1,
          min: entry.duration,
          max: entry.duration,
        });
      }
    }

    const stats: PhaseStatistics[] = [];

    for (const [phase, data] of phaseMap) {
      stats.push({
        phase,
        totalDuration: data.total,
        callCount: data.count,
        avgDuration: data.total / data.count,
        minDuration: data.min,
        maxDuration: data.max,
        percentageOfTotal: totalDuration > 0 ? (data.total / totalDuration) * 100 : 0,
      });
    }

    // Sort by total duration descending
    stats.sort((a, b) => b.totalDuration - a.totalDuration);

    return stats;
  }

  /**
   * Extract the base phase name from a timer name
   */
  private extractBasePhase(name: string): string {
    // Remove counter suffix (e.g., "phase#123" -> "phase")
    let base = name.replace(/#\d+$/, "");
    return base;
  }

  /**
   * Generate a profiler report from a session
   */
  generateReport(session: ProfilerSession): ProfilerReport {
    const bottlenecks = this.identifyBottlenecks(session);
    const recommendations = this.generateRecommendations(session, bottlenecks);

    return {
      session,
      summary: this.generateSummary(session),
      bottlenecks,
      recommendations,
    };
  }

  /**
   * Identify phases that are bottlenecks (>10% of total time)
   */
  private identifyBottlenecks(session: ProfilerSession): string[] {
    const bottlenecks: string[] = [];
    const threshold = session.totalDuration * 0.1; // 10% threshold

    for (const stat of session.phaseStats) {
      if (stat.totalDuration > threshold) {
        bottlenecks.push(`${stat.phase}: ${stat.totalDuration.toFixed(2)}ms (${stat.percentageOfTotal.toFixed(1)}%)`);
      }
    }

    return bottlenecks;
  }

  /**
   * Generate optimization recommendations based on profiling data
   */
  private generateRecommendations(session: ProfilerSession, bottlenecks: string[]): string[] {
    const recommendations: Set<string> = new Set();

    for (const stat of session.phaseStats) {
      // Type-checking recommendations
      if (stat.phase.includes("typecheck") && stat.percentageOfTotal > 30) {
        recommendations.add("Consider using --skipTypeCheck during development for faster iteration");
      }

      // IR building recommendations
      if (stat.phase.includes("ir:build") && stat.percentageOfTotal > 25) {
        recommendations.add("IR building is slow - check if incremental cache is working properly");
      }

      // Emission recommendations
      if (stat.phase.includes("emit") && stat.percentageOfTotal > 40) {
        recommendations.add("Emission phase is slow - consider optimizing emitter or reducing output complexity");
      }

      // Graph collection recommendations
      if (stat.phase.includes("graph:collect") && stat.percentageOfTotal > 15) {
        recommendations.add("Graph collection is slow - consider caching import resolution results");
      }
    }

    // Memory recommendations
    if (session.memorySnapshots.length > 1) {
      const startMem = session.memorySnapshots[0];
      const endMem = session.memorySnapshots[session.memorySnapshots.length - 1];
      const memDelta = endMem.heapUsed - startMem.heapUsed;

      if (memDelta > 100 * 1024 * 1024) {
        // > 100MB
        recommendations.add(`High memory usage (${(memDelta / 1024 / 1024).toFixed(0)}MB delta) - consider streaming large files`);
      }
    }

    return Array.from(recommendations);
  }

  /**
   * Generate a human-readable summary
   */
  private generateSummary(session: ProfilerSession): string {
    const lines = [
      `Total transpilation time: ${session.totalDuration.toFixed(2)}ms`,
      `Phases measured: ${session.phaseStats.length}`,
    ];

    if (session.memorySnapshots.length > 1) {
      const start = session.memorySnapshots[0];
      const end = session.memorySnapshots[session.memorySnapshots.length - 1];
      const delta = end.heapUsed - start.heapUsed;
      const sign = delta >= 0 ? "+" : "";
      lines.push(`Memory delta: ${sign}${(delta / 1024 / 1024).toFixed(2)}MB`);
    }

    return lines.join("\n");
  }

  /**
   * Get all timing durations as a flat record (for diagnostics integration).
   */
  getTimings(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [name, entry] of this.timings) {
      result[name] = entry.duration;
    }
    return result;
  }

  /**
   * Clear all profiling data
   */
  clear(): void {
    this.timings.clear();
    this.activeTimers.clear();
    this.memorySnapshots = [];
    this.parentStack = [];
    this.timerCounter = 0;
  }
}

// Global profiler instance
let globalProfiler: Profiler | null = null;

/**
 * Get the global profiler instance (creates one if not exists)
 */
export function getProfiler(): Profiler {
  if (!globalProfiler) {
    globalProfiler = new Profiler();
  }
  return globalProfiler;
}

/**
 * Initialize the global profiler with options
 */
export function initProfiler(options: Partial<ProfilerOptions> = {}): Profiler {
  globalProfiler = new Profiler(options);
  return globalProfiler;
}
