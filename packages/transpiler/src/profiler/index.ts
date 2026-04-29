/**
 * Performance profiler for transpilation.
 *
 * @example
 * ```typescript
 * import { initProfiler, formatConsoleReport } from './profiler';
 *
 * const profiler = initProfiler({ enabled: true });
 * profiler.startSession();
 *
 * // Time synchronous operations
 * profiler.timeSync('phase:name', () => {
 *   // do work
 * });
 *
 * // Time async operations
 * await profiler.timeAsync('phase:async', async () => {
 *   // do async work
 * });
 *
 * // Generate report
 * const session = profiler.endSession();
 * const report = profiler.generateReport(session);
 * console.log(formatConsoleReport(report));
 * ```
 */

export { Profiler, getProfiler, initProfiler } from "./profiler";
export {
  TimingEntry,
  MemorySnapshot,
  PhaseStatistics,
  ProfilerSession,
  ProfilerOptions,
  ProfilerReport,
  DEFAULT_PROFILER_OPTIONS,
} from "./types";
