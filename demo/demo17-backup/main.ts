// ---------------------------------------------------------------------------
// main.ts — task-list tracker driver (cuttlefish demo #17).
//
// A small, idiomatic TypeScript program: a TaskList class that keeps tasks in
// an array and supports adding, completing, counting, and summarizing them.
// The driver seeds a few tasks, completes one, and prints the list plus a
// short summary. Transpiled to C++ by cuttlefish (@typecad/framework-native).
//
// This is the *seventeenth* demo iteration. Like #15/#16 it is deliberately
// small and readable — real, everyday TypeScript — and is *not* a feature-
// exhaustion test. The source uses its natural idiomatic form throughout.
// ---------------------------------------------------------------------------

import { Priority, Task, formatTask, priorityLabel } from './task';

// A small in-memory task list. Class -> C++ class. Tasks live in a
// std::vector<Task>; the counter tracks the next free id.
class TaskList {
  private tasks: Task[] = [];
  private nextId: int32_t = 1;

  // Add a task by title + priority; returns the assigned id.
  add(title: string, priority: Priority): int32_t {
    const id: int32_t = this.nextId;
    this.nextId = this.nextId + 1;
    const t: Task = {
      id: id,
      title: title,
      priority: priority,
      done: false,
    };
    this.tasks.push(t);
    return id;
  }

  // Mark a task done by id. Returns true if the id was found. Natural
  // `for...of` form: the loop variable `t` is mutated via `t.done = true`,
  // so the transpiler auto-demotes it from `const` to a mutable reference
  // (`for (Task& t : ...)`) — matching TS semantics (the mutation writes
  // through to the vector element). See README — Finding A, now FIXED.
  complete(id: int32_t): boolean {
    for (const t of this.tasks) {
      if (t.id === id) {
        t.done = true;
        return true;
      }
    }
    return false;
  }

  // How many tasks are still open. A plain counting loop (the idiomatic
  // .filter().length is lint-gated by cuttlefish/no-container-functional-methods).
  openCount(): int32_t {
    let n: int32_t = 0;
    for (const t of this.tasks) {
      if (!t.done) {
        n = n + 1;
      }
    }
    return n;
  }

  // The highest priority among open tasks, or Low if there are none.
  // Math.max is idiomatic here; both operands are int so it returns int.
  topPriority(): Priority {
    let top: Priority = Priority.Low;
    for (const t of this.tasks) {
      if (!t.done && t.priority > top) {
        top = t.priority;
      }
    }
    return top;
  }

  // Print every task, one per line.
  printAll(): void {
    for (const t of this.tasks) {
      console.log(formatTask(t));
    }
  }
}

// Entry point.
function main(): void {
  const list: TaskList = new TaskList();

  // Seed a few everyday tasks.
  list.add('buy milk', Priority.Medium);
  list.add('fix bike', Priority.High);
  list.add('read book', Priority.Low);
  list.add('pay rent', Priority.High);

  // Complete the bike fix and verify the lookup behaved.
  const found: boolean = list.complete(2);
  console.log(`complete_found=${found}`);

  // Report the summary: total, open, and the top remaining priority.
  console.log(`top=${priorityLabel(list.topPriority())}`);
  console.log(`open=${list.openCount()}`);

  console.log('---');
  list.printAll();
  console.log('done');
}

main();
