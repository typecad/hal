/**
 * Types for the transpilation performance profiler.
 */

export interface TimingEntry {
  /** Unique name for this timing entry */
  name: string;
  /** Start time from performance.now() */
  startTime: number;
  /** End time from performance.now() */
  endTime: number;
  /** Duration in milliseconds */
  duration: number;
  /** Parent timer name (for hierarchical timing) */
  parent?: string;
  /** Child timer names */
  children: string[];
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface MemorySnapshot {
  /** Name/label for this snapshot */
  name: string;
  /** Timestamp from performance.now() */
  timestamp: number;
  /** Heap used in bytes */
  heapUsed: number;
  /** Heap total in bytes */
  heapTotal: number;
  /** External memory in bytes */
  external: number;
}

export interface PhaseStatistics {
  /** Phase name (base name without file-specific suffixes) */
  phase: string;
  /** Total duration in milliseconds */
  totalDuration: number;
  /** Number of times this phase was called */
  callCount: number;
  /** Average duration per call in milliseconds */
  avgDuration: number;
  /** Minimum duration in milliseconds */
  minDuration: number;
  /** Maximum duration in milliseconds */
  maxDuration: number;
  /** Percentage of total transpilation time */
  percentageOfTotal: number;
}

export interface ProfilerSession {
  /** Session start time from performance.now() */
  startTime: number;
  /** Session end time from performance.now() */
  endTime: number;
  /** Total session duration in milliseconds */
  totalDuration: number;
  /** All timing entries by name */
  timings: Map<string, TimingEntry>;
  /** Memory snapshots taken during profiling */
  memorySnapshots: MemorySnapshot[];
  /** Aggregated statistics by phase */
  phaseStats: PhaseStatistics[];
}

export interface ProfilerOptions {
  /** Enable profiling (default: false) */
  enabled: boolean;
  /** Track memory usage (default: false) */
  trackMemory: boolean;
  /** Output format for reports */
  outputFormat: "console" | "json" | "markdown";
  /** Output file path (default: console output) */
  outputPath?: string;
  /** Minimum duration (ms) to include in report (default: 0) */
  threshold: number;
}

export interface ProfilerReport {
  /** The profiling session data */
  session: ProfilerSession;
  /** Human-readable summary */
  summary: string;
  /** Identified bottlenecks (>10% of total time) */
  bottlenecks: string[];
  /** Optimization recommendations */
  recommendations: string[];
}

/**
 * Default profiler options
 */
export const DEFAULT_PROFILER_OPTIONS: ProfilerOptions = {
  enabled: false,
  trackMemory: false,
  outputFormat: "console",
  threshold: 0,
};
