// ---------------------------------------------------------------------------
// task.ts — domain types for the task-list demo (cuttlefish demo #17).
//
// Plain idiomatic TypeScript: a numeric const enum for priority, an interface
// describing a Task, and a couple of pure formatting helpers. These lower
// cleanly to C++ enums, structs, and free functions.
// ---------------------------------------------------------------------------

// Priority levels. `const enum` so members are inlined (a plain `enum` is
// lint-gated in scaffolded projects — by design).
export const enum Priority {
  Low = 1,
  Medium = 2,
  High = 3,
}

// A single to-do item. Interface -> C++ struct. Fixed-width ints keep the
// generated code tidy; `done` maps to a C++ bool.
export interface Task {
  id: int32_t;
  title: string;
  priority: Priority;
  done: boolean;
}

// Format a task for display, e.g. "[#3] (High) buy milk". Template literal +
// a numeric switch on the enum value.
export function priorityLabel(p: Priority): string {
  switch (p) {
    case Priority.High:
      return 'High';
    case Priority.Medium:
      return 'Medium';
    case Priority.Low:
      return 'Low';
    default:
      return 'Unknown';
  }
}

// Render a full task line. Uses the helper above and a ternary for the done
// flag so the output reads naturally in both states.
export function formatTask(t: Task): string {
  const mark: string = t.done ? 'x' : ' ';
  return `[${mark}] #${t.id} (${priorityLabel(t.priority)}) ${t.title}`;
}
