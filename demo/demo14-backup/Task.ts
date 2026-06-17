// ---------------------------------------------------------------------------
// Task.ts — core domain types for the round-robin scheduler demo.
//
// Idiomatic TypeScript: an enum, interfaces, and small helper functions.
// Plain data + behavior that lowers cleanly to C++ structs and free funcs.
// ---------------------------------------------------------------------------

// Numeric enum with explicit bit-flag values (bitwise membership applies).
export enum TaskKind {
  Idle = 0,
  Sensor = 1,
  Telemetry = 2,
  Control = 4,
  Diagnostics = 8,
}

// Interface → C++ struct.
export interface Task {
  id: int32_t;
  kind: TaskKind;
  priority: int32_t;
  burst: int32_t;       // CPU ticks this task needs per dispatch
  remaining: int32_t;   // ticks left until the task completes
  name: string;
}

// Stats accumulator returned by Scheduler.tick().
export interface TickResult {
  ranId: int32_t;
  consumed: int32_t;
  queued: int32_t;
  idle: boolean;
}

// Factory + formatter as free functions (lower to plain C++ free functions).
export function makeTask(id: int32_t, kind: TaskKind, priority: int32_t, burst: int32_t, name: string): Task {
  return { id: id, kind: kind, priority: priority, burst: burst, remaining: burst, name: name };
}

// String method (toUpperCase) + template literal.
export function label(t: Task): string {
  return `[${t.name.toUpperCase()}#${t.id}]`;
}

// Bitwise ops on enum operands.
export function isUrgent(t: Task): boolean {
  return (t.kind & TaskKind.Control) !== 0 || t.priority >= 8;
}
