// ---------------------------------------------------------------------------
// Scheduler.ts — a round-robin / priority task scheduler.
//
// Moderately-complex core of the demo. Written in idiomatic TypeScript; after
// the demo #14 transpiler fixes it lowers cleanly without source workarounds:
//   - Getters (`get x()`, `static get x()`) rewrite to getX()/Cls::getX() (E)
//   - `peek(): Task | null` returns `null` / `?? null` and lowers to return {} (A)
//   - `PriorityScheduler extends Scheduler` needs no explicit constructor (B)
//   - Same-file helpers used in class bodies are forward-declared (D)
//
// One genuine constraint remains (lint-gated, Finding C): a struct fetched from
// a Map is a VALUE copy in C++, so mutating its fields is lost. Per-task
// mutable progress is therefore kept in a separate primitive `Map<string,
// int32_t>` and `.set()` back — the idiomatic shape for this transpiler.
// ---------------------------------------------------------------------------

import { Task, TickResult, isUrgent } from './Task';
import { byPriorityThenId, clamp, totalRemaining, idKey } from './util';

// Abstract base class with a pure-virtual method.
export abstract class Scheduler {
  // Map registry of task definitions (read-only after enqueue).
  protected tasks: Map<string, Task> = new Map();
  // Mutable per-task remaining budget (primitive values mutate cleanly).
  protected remaining: Map<string, int32_t> = new Map();
  // Set of currently runnable ids.
  protected ready: Set<int32_t> = new Set();
  // Static counter for global dispatch count.
  static dispatches: int32_t = 0;

  constructor(protected quantum: int32_t = 2) {}

  // Instance getter → getQueueSize().
  get queueSize(): int32_t {
    let n: int32_t = 0;
    for (const id of this.ready) { n += 1; }
    return n;
  }

  // Static getter → Scheduler::getTotalDispatches().
  static get totalDispatches(): int32_t {
    return Scheduler.dispatches;
  }

  // Register a task. Throws on duplicate id.
  enqueue(t: Task): void {
    const key: string = idKey(t.id);
    if (this.tasks.has(key)) {
      throw new Error('duplicate task id');
    }
    this.tasks.set(key, t);
    this.remaining.set(key, t.burst);
    this.ready.add(t.id);
  }

  // Look up a task definition by id. Caller guarantees presence (use .has()).
  getTask(id: int32_t): Task {
    return this.tasks.get(idKey(id))!;
  }

  // Struct-returning peek. `T | null` strips to T; `return null` lowers to
  // `return {};` (Finding A) so the value-init compiles.
  peek(): Task | null {
    const next: int32_t = this.pickNext();
    if (next < 0) return null;
    return this.tasks.get(idKey(next)) ?? null;
  }

  // Run one scheduling quantum. Returns what happened.
  tick(): TickResult {
    const id: int32_t = this.pickNext();
    if (id < 0) {
      return { ranId: -1, consumed: 0, queued: 0, idle: true };
    }
    const key: string = idKey(id);
    let left: int32_t = this.remaining.get(key)!;
    const budget: int32_t = clamp(this.quantum, 1, left);
    const consumed: int32_t = Math.min(budget, left);
    left -= consumed;
    this.remaining.set(key, left);
    Scheduler.dispatches += 1;

    if (left <= 0) {
      this.ready.delete(id);
    }

    return { ranId: id, consumed: consumed, queued: this.queueSize, idle: false };
  }

  // Pure virtual: subclasses decide ordering.
  abstract pickNext(): int32_t;

  // Sum remaining work across ready tasks.
  pendingLoad(): number {
    const acc: Task[] = this.taskSnapshot();
    return totalRemaining(acc);
  }

  // Count urgent tasks via the bitwise helper.
  countUrgent(): int32_t {
    let n: int32_t = 0;
    for (const t of this.taskSnapshot()) {
      if (isUrgent(t)) { n += 1; }
    }
    return n;
  }

  // Materialize the ready set into a vector of Task structs.
  protected taskSnapshot(): Task[] {
    const out: Task[] = [];
    for (const id of this.ready) {
      out.push(this.tasks.get(idKey(id))!);
    }
    return out;
  }
}

// Concrete subclass: priority-ordered selection. No explicit constructor —
// the transpiler synthesizes one forwarding to the base (Finding B).
export class PriorityScheduler extends Scheduler {
  pickNext(): int32_t {
    let snapshot: Task[] = this.taskSnapshot();
    if (snapshot.length === 0) return -1;
    snapshot.sort(byPriorityThenId);
    return snapshot[0]!.id;
  }
}
