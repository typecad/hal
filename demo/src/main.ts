// ---------------------------------------------------------------------------
// main.ts — priority-queue job scheduler (cuttlefish demo #23).
//
// A mid-complexity, idiomatic TypeScript program implementing a **binary
// min-heap** that schedules jobs by priority. Jobs are inserted with an
// integer priority (lower = sooner) and a small payload, then drained in
// priority order. The heap is a classic sift-up / sift-down over a flat
// array — a deliberately different data shape from demo #22's
// shunting-yard (discriminated Token + operator stack):
//
//   • a **`class MinHeap`** that owns a **`Job[]` instance field** and does
//     heavy **indexed array read / write / swap** on `this.heap[i]`
//     (`swap`, `siftUp`, `siftDown`, parent/child index arithmetic),
//   • **struct mutation through an array index** (`this.heap[i] = tmp`),
//   • a **`Map<string, int32_t>` per-kind cost table** keyed by a short
//     tag, with `.has`-guarded `.get` (the idiomatic keyed-table shape),
//   • a **`const enum JobKind`** + a **`switch`** on it (numeric enum
//     dispatch — re-exercises §1.7/§2.4 in a different context than #22),
//   • module-scope free functions called from class methods, a `while`
//     loop with `break`, `Math.min` / `Math.max`, and template literals
//     interpolating struct fields.
//
// The previous iteration (#22, infix→RPN shunting-yard) is preserved in
// `demo22-backup/`.
//
// Idiomatic constraints honored up front (per SUPPORT_MATRIX / eslint rules):
// only `const enum`; no `any`; no typed-array fields/returns; no object
// spread; no `instanceof`; no `keyof`/conditional/mapped types; no mutating
// array *parameters* (heap methods return/keep state internally); no
// comparing a `Map.get()` result to `undefined` (guarded with `.has`).
// ---------------------------------------------------------------------------

// A fixed roster of jobs fed into the scheduler. Each is (priority, kind,
// label). The scheduler drains them lowest-priority-first; ties keep
// insertion order (the heap compares on (priority, seq), fully deterministic).
interface SeedJob {
  priority: int32_t;
  kind: JobKind;
  label: string;
}

// Kinds of job the scheduler knows about. `const enum` so members are
// inlined (a plain `enum` is lint-gated in scaffolded projects — by design,
// see SUPPORT_MATRIX §1.7 / demo #15 note D).
const enum JobKind {
  Telemetry = 0,
  Log = 1,
  Alarm = 2,
  Housekeeping = 3,
}

// Render a JobKind as a short uppercase tag for printing. A small free
// function (SUPPORT_MATRIX §3.1) driven by a numeric `switch` on the enum
// (§2.4 / §1.7 — the discriminant emits a plain comparison, never a
// `std::string(...)` wrap).
function kindTag(kind: JobKind): string {
  switch (kind) {
    case JobKind.Telemetry:
      return 'TELE';
    case JobKind.Log:
      return 'LOG';
    case JobKind.Alarm:
      return 'ALARM';
    case JobKind.Housekeeping:
      return 'HOUSE';
    default:
      return '?';
  }
}

// Per-kind nominal cost (arbitrary units). Stored in a module-scope
// `Map<string, int32_t>` (→ `std::map<std::string, int32_t>`, SUPPORT_MATRIX
// §1.5). Declared with `let` because we populate it with `.set()` below; a
// `const`-bound map mutated via `.set()` is auto-demoted anyway (and the
// `no-mutating-method-on-const-collection` lint would warn), so `let`
// expresses the intent up front (demo #15 fix C / #17).
//
// NOTE on the choice of Map over Record<K,V>: a `Record<string, int32_t>`
// is, at the TypeScript level, a *plain indexed object* — it has NO `.has()`
// method (that is a `Map` API), and `rec[k]` under `noUncheckedIndexedAccess`
// is `int32_t | undefined` even after an `in` guard. The idiomatic, type-safe
// keyed-table shape is therefore `Map<string, int32_t>` with `.has`/`.get`.
// (See README Finding A — the first compile attempt used `Record` + `.has`,
// which is a TS type error, not a transpiler gap.)
let COST: Map<string, int32_t> = new Map();
COST.set('TELE', 5);
COST.set('LOG', 1);
COST.set('ALARM', 50);
COST.set('HOUSE', 3);

// Look up the nominal cost of a job kind, returning 0 if the tag is not in
// the table. Guards the `.get` with `.has` (SUPPORT_MATRIX §1.5 — comparing
// a primitive-valued `Map.get` to `undefined` is rejected by
// `TS2CPP_GET_NULLISH_COMPARE`; the idiomatic pattern is `.has` first, then
// `.get(k)!`).
function costFor(kind: JobKind): int32_t {
  const tag: string = kindTag(kind);
  if (!COST.has(tag)) {
    return 0;
  }
  return COST.get(tag)!;
}

// ---------------------------------------------------------------------------
// Job: a heap entry. An interface → a value-typed C++ struct. Carries the
// priority, kind, label, and a monotonically-increasing sequence number
// used to break ties (so the heap order is fully deterministic).
// ---------------------------------------------------------------------------
interface Job {
  priority: int32_t;
  kind: JobKind;
  label: string;
  seq: int32_t;
}

// Compare two jobs by the heap ordering: lower priority first; on a tie,
// the lower sequence number (earlier insert) first. Returns true iff `a`
// should sit *above* `b` in the min-heap. A small free function called
// from the sift helpers (class-method → free-function call path,
// SUPPORT_MATRIX §4.3).
function comesBefore(a: Job, b: Job): boolean {
  if (a.priority !== b.priority) {
    return a.priority < b.priority;
  }
  return a.seq < b.seq;
}

// ---------------------------------------------------------------------------
// MinHeap: a binary min-heap of Jobs over a flat `Job[]` array field.
//
// Indexing (0-based):
//   parent(i) = (i - 1) / 2        (integer division)
//   left(i)   = 2 * i + 1
//   right(i)  = 2 * i + 2
//
// This stresses a data shape that no prior demo hit head-on: **indexed
// array read/write/swap on an instance-field receiver** (`this.heap[i]`),
// plus **struct assignment through an array index** (`this.heap[i] = tmp`).
// ---------------------------------------------------------------------------
class MinHeap {
  // The backing store. A `Job[]` → `std::vector<Job>` owned by the
  // instance. Initializer `[]` → empty vector.
  private heap: Job[] = [];

  // Monotonic sequence counter for tie-breaking. Incremented on every
  // insert so each job gets a unique `seq`.
  private counter: int32_t = 0;

  // Number of jobs currently in the heap.
  size(): int32_t {
    return this.heap.length;
  }

  // True iff the heap holds no jobs.
  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  // Peek the minimum job without removing it. Returns a fresh copy so the
  // caller cannot mutate the heap's internal entry.
  peek(): Job {
    return this.heap[0]!;
  }

  // Insert a job. Builds the full Job struct (assigning the next sequence
  // number), appends it, and sifts it up to its heap position.
  push(priority: int32_t, kind: JobKind, label: string): void {
    const job: Job = {
      priority: priority,
      kind: kind,
      label: label,
      seq: this.counter,
    };
    this.counter = this.counter + 1;
    this.heap.push(job);
    this.siftUp(this.heap.length - 1);
  }

  // Remove and return the minimum job. Moves the last element to the root,
  // shrinks, and sifts the new root down.
  pop(): Job {
    const top: Job = this.heap[0]!;
    const last: Job = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  // Swap two entries by index. Uses a local struct temp — exercises the
  // struct-through-index read *and* write path on a member receiver.
  private swap(i: int32_t, j: int32_t): void {
    const tmp: Job = this.heap[i]!;
    this.heap[i] = this.heap[j]!;
    this.heap[j] = tmp;
  }

  // Sift the entry at `i` up toward the root until the heap property holds.
  private siftUp(i: int32_t): void {
    while (i > 0) {
      const parent: int32_t = (i - 1) / 2;
      const cur: Job = this.heap[i]!;
      const par: Job = this.heap[parent]!;
      if (comesBefore(cur, par)) {
        this.swap(i, parent);
        i = parent;
      } else {
        break;
      }
    }
  }

  // Sift the entry at `i` down toward the leaves until the heap property
  // holds. Picks the smaller child each step.
  private siftDown(i: int32_t): void {
    const n: int32_t = this.heap.length;
    while (true) {
      const left: int32_t = 2 * i + 1;
      const right: int32_t = 2 * i + 2;
      let best: int32_t = i;
      const cur: Job = this.heap[best]!;
      if (left < n) {
        const lc: Job = this.heap[left]!;
        if (comesBefore(lc, cur)) {
          best = left;
        }
      }
      if (right < n) {
        const bc: Job = this.heap[best]!;
        const rc: Job = this.heap[right]!;
        if (comesBefore(rc, bc)) {
          best = right;
        }
      }
      if (best !== i) {
        this.swap(i, best);
        i = best;
      } else {
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helper for printing a drained job. A free function that interpolates
// struct fields into a template literal (SUPPORT_MATRIX §1.4 — struct-field
// interpolation infers the specifier from the declared field type).
// ---------------------------------------------------------------------------
function formatJob(job: Job): string {
  const tag: string = kindTag(job.kind);
  const cost: int32_t = costFor(job.kind);
  return `#${job.seq} [${tag}] pri=${job.priority} cost=${cost} ${job.label}`;
}

// The fixed input. (Lower priority number = runs sooner.)
const SEEDS: SeedJob[] = [
  { priority: 5, kind: JobKind.Telemetry, label: 'read sensors' },
  { priority: 1, kind: JobKind.Alarm, label: 'over-temp!' },
  { priority: 3, kind: JobKind.Log, label: 'boot complete' },
  { priority: 1, kind: JobKind.Housekeeping, label: 'gc sweep' },
  { priority: 2, kind: JobKind.Log, label: 'link up' },
  { priority: 5, kind: JobKind.Telemetry, label: 'read sensors (2)' },
];

// Entry point. Loads the seeds, reports heap size, drains everything in
// priority order, and prints a summary built from Math.min / Math.max over
// the drained priorities.
function main(): void {
  const heap: MinHeap = new MinHeap();

  console.log('--- loading ---');
  const n: int32_t = SEEDS.length;
  for (let i: int32_t = 0; i < n; i = i + 1) {
    const s: SeedJob = SEEDS[i]!;
    heap.push(s.priority, s.kind, s.label);
  }
  console.log(`loaded ${heap.size()} jobs`);

  console.log('--- draining (priority order) ---');
  let minPri: int32_t = 2147483647;
  let maxPri: int32_t = -2147483648;
  let count: int32_t = 0;
  while (!heap.isEmpty()) {
    const job: Job = heap.pop();
    console.log(formatJob(job));
    minPri = Math.min(minPri, job.priority);
    maxPri = Math.max(maxPri, job.priority);
    count = count + 1;
  }

  console.log('--- summary ---');
  console.log(`drained ${count} jobs; pri range [${minPri} .. ${maxPri}]`);
  console.log('done');
}

main();
