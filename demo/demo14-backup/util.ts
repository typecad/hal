// ---------------------------------------------------------------------------
// util.ts — pure helpers: a task comparator, clamping, and a sum reduction.
//
// Module-level free functions → plain C++ free functions. `idKey` lives here
// (imported before the Scheduler class) so it is in scope inside class method
// bodies even though, after the demo #14 transpiler fix (Finding D), same-file
// free functions are now forward-declared before class bodies regardless.
// ---------------------------------------------------------------------------

import { Task } from './Task';

// Comparator passed to Array.sort. Negative => a before b (demo #12 convention).
export function byPriorityThenId(a: Task, b: Task): int32_t {
  if (a.priority !== b.priority) {
    return b.priority - a.priority; // higher priority runs first
  }
  return a.id - b.id; // tie-break: lower id first (FIFO)
}

// Numeric switch with default.
export function severityRank(code: int32_t): int32_t {
  switch (code) {
    case 3:
      return 100; // error
    case 2:
      return 50;  // warn
    case 1:
    default:
      return 10;  // info
  }
}

// Math.min / Math.max clamping.
export function clamp(v: int32_t, lo: int32_t, hi: int32_t): int32_t {
  return Math.max(lo, Math.min(hi, v));
}

// Reduce over an array to sum a field. Returns double (number).
export function totalRemaining(tasks: Task[]): number {
  let sum: number = 0;
  for (const t of tasks) {
    sum += t.remaining;
  }
  return sum;
}

// Stable string key for a task id.
export function idKey(id: int32_t): string {
  return `t${id}`;
}
