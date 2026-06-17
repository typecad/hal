// ---------------------------------------------------------------------------
// main.ts — round-robin / priority task scheduler simulation (demo #14).
//
// Idiomatic form (post-transpiler-fixes): uses getters, a struct-returning
// peek(), a parameter-property constructor, and int32_t template interpolation
// directly. Drives a PriorityScheduler over a small workload until the queue
// drains, printing per-tick results and a final summary.
// ---------------------------------------------------------------------------

import { Task, TaskKind, TickResult, makeTask, label } from './models/Task';
import { PriorityScheduler, Scheduler } from './models/Scheduler';
import { severityRank, clamp } from './models/util';

function buildWorkload(): Task[] {
  return [
    makeTask(1, TaskKind.Sensor,      5, 4, 'temp'),
    makeTask(2, TaskKind.Telemetry,   3, 6, 'downlink'),
    makeTask(3, TaskKind.Control,     9, 3, 'pid'),
    makeTask(4, TaskKind.Diagnostics, 1, 5, 'selftest'),
    makeTask(5, TaskKind.Control,     8, 2, 'watchdog'),
  ];
}

function runSim(): void {
  const sched: Scheduler = new PriorityScheduler(2);

  try {
    for (const t of buildWorkload()) {
      sched.enqueue(t);
    }
    console.log(`loaded=${sched.queueSize} urgent=${sched.countUrgent()}`);
  } catch (e) {
    console.log('load_failed');
    return;
  }

  const maxTicks: int32_t = 64;
  let tick: int32_t = 0;
  while (tick < maxTicks) {
    tick += 1;
    const r: TickResult = sched.tick();
    if (r.idle) {
      console.log(`tick=${tick} idle`);
      break;
    }
    const current: Task = sched.getTask(r.ranId);
    console.log(`tick=${tick} ${label(current)} ran=${r.ranId} used=${r.consumed} left=${r.queued}`);
  }

  // Static getter access.
  console.log(`dispatches=${Scheduler.totalDispatches}`);
}

runSim();

console.log(`sev_err=${severityRank(3)}`);
console.log(`clamp=${clamp(42, 0, 10)}`);
console.log('done');
