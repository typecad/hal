// ---------------------------------------------------------------------------
// main.ts — gradebook demo (cuttlefish demo #20).
//
// A mid-complexity, idiomatic TypeScript program: a Gradebook records a list of
// scores (0–100) per student in a Map, computes each student's average, maps it
// to a letter grade, and prints a class report with the top student. The driver
// enrolls three students, records a handful of scores each, drops the single
// lowest score per student, and prints the report. Transpiled to C++ by
// cuttlefish (@typecad/framework-native).
//
// This is the *twentieth* demo iteration. Like #15–#19 it is deliberately
// readable — real, everyday TypeScript — and is *not* a feature-exhaustion
// test. The source uses its natural idiomatic form, adjusted only where a
// transpiler gap forced it (see README — *Findings*). Three gaps it surfaced
// are notated there: `Array.from`, tuple destructuring of Map entries, and the
// `=== undefined` guard on a `Map.get` whose value type is a container.
// ---------------------------------------------------------------------------

// Letter grades. `const enum` so members are inlined (a plain `enum` is
// lint-gated in scaffolded projects — by design).
const enum Grade {
  A = 0,
  B = 1,
  C = 2,
  D = 3,
  F = 4,
}

// Map a numeric average to a letter grade. A module-scope free function. A
// cascade of comparisons against fixed thresholds.
function letterFor(average: double): Grade {
  if (average >= 90.0) {
    return Grade.A;
  } else if (average >= 80.0) {
    return Grade.B;
  } else if (average >= 70.0) {
    return Grade.C;
  } else if (average >= 60.0) {
    return Grade.D;
  } else {
    return Grade.F;
  }
}

// A short, human-readable label for a letter grade. Numeric switch with a
// default branch. A module-scope free function.
function gradeLabel(g: Grade): string {
  switch (g) {
    case Grade.A:
      return 'A';
    case Grade.B:
      return 'B';
    case Grade.C:
      return 'C';
    case Grade.D:
      return 'D';
    case Grade.F:
      return 'F';
    default:
      return '?';
  }
}

// A small in-memory gradebook. Class -> C++ class. Scores live in a
// std::map<std::string, std::vector<double>> (a Map<string, number[]>).
//
// NOTE (Finding C): the natural nullable return of `Map.get()` —
// `T | undefined` — is fine when T is a primitive, but when T is a container
// (here a number[]) the transpiled `m.at(k)` returns the element BY VALUE and
// THROWS on a missing key. So methods that read a student's array guard with
// `Map.has(name)` first and never rely on `=== undefined` for the container.
class Gradebook {
  // The natural TS shape: one mutable array of scores per student name.
  private scores: Map<string, double[]> = new Map();

  // Enroll a student with no scores yet. Returns true if the student was newly
  // added, false if they already existed. The idiomatic Map.has + Map.set form.
  enroll(name: string): boolean {
    if (this.scores.has(name)) {
      return false;
    }
    this.scores.set(name, []);
    return true;
  }

  // Record a single score for a student. Returns true on success, false if the
  // student is not enrolled. Map.has guards the lookup (Finding C); the array
  // is read out, mutated, and set back (the documented value-copy workaround
  // for Map.get on a struct/container — SUPPORT_MATRIX §1.5/§1.8).
  record(name: string, score: double): boolean {
    if (!this.scores.has(name)) {
      return false;
    }
    const current: double[] = this.scores.get(name)!;
    current.push(score);
    this.scores.set(name, current);
    return true;
  }

  // Drop the single lowest score for a student (a common "drop one" policy).
  // Returns true on success, false if the student is unknown or has no scores.
  dropLowest(name: string): boolean {
    if (!this.scores.has(name)) {
      return false;
    }
    const current: double[] = this.scores.get(name)!;
    if (current.length === 0) {
      return false;
    }
    // Find the index of the minimum by a plain loop. The loop counter is
    // declared int32_t; comparing it against `current.length` would warn
    // (-Wsign-compare: int32_t vs size_t), so the bound is captured once into
    // a fixed-width local. (Finding D — see README.)
    const count: int32_t = current.length;
    let minIndex: int32_t = 0;
    for (let i: int32_t = 1; i < count; i = i + 1) {
      if (current[i]! < current[minIndex]!) {
        minIndex = i;
      }
    }
    // Remove the lowest score. `splice` lowers to std::vector::erase via the
    // __tc_splice2 polyfill.
    current.splice(minIndex, 1);
    this.scores.set(name, current);
    return true;
  }

  // The arithmetic mean of a student's scores, or -1.0 if they have none.
  // Map.has guards the lookup; the caller is expected to have checked it, but
  // the length check makes this safe to call on an empty roster too.
  average(name: string): double {
    if (!this.scores.has(name)) {
      return -1.0;
    }
    const current: double[] = this.scores.get(name)!;
    if (current.length === 0) {
      return -1.0;
    }
    let sum: double = 0.0;
    for (const s of current) {
      sum = sum + s;
    }
    return sum / current.length;
  }

  // The student with the highest current average, or the empty string if no
  // enrolled student has any scores. A plain linear scan over the roster.
  //
  // NOTE (Findings A + B): the idiomatic form
  //   `for (const [name, scores] of this.scores)` / `Array.from(this.scores)`
  // does not lower — `Array.from` emits verbatim and tuple destructuring of a
  // Map entry lowers each binding to `0 /* unsupported_expr */`. So the roster
  // is kept in a parallel string[] and iterated by index, reading the arrays
  // back through Map.get (guarded by Map.has). See README.
  topStudent(roster: string[]): string {
    let best: string = '';
    let bestAvg: double = -1.0;
    for (const name of roster) {
      if (!this.scores.has(name)) {
        continue;
      }
      const scores: double[] = this.scores.get(name)!;
      if (scores.length === 0) {
        continue;
      }
      const avg: double = this.average(name);
      if (avg > bestAvg) {
        bestAvg = avg;
        best = name;
      }
    }
    return best;
  }

  // Print the report: one line per enrolled student showing count, letter, and
  // average. Iterates the caller-supplied roster (see topStudent) for the same
  // reason. Calls the free functions letterFor / gradeLabel from this class
  // method body (the demo #18 lowering).
  printReport(roster: string[]): void {
    for (const name of roster) {
      const avg: double = this.average(name);
      const scores: double[] = this.scores.get(name)!;
      const letter: string = gradeLabel(letterFor(avg));
      console.log(`${name}: ${scores.length} scores, avg ${avg}, grade ${letter}`);
    }
  }
}

// Entry point.
function main(): void {
  const book: Gradebook = new Gradebook();

  // Enroll three students. The roster is the iteration source for the report
  // and the top-student scan (Finding A/B workaround).
  const roster: string[] = ['Alice', 'Bob', 'Cara'];
  book.enroll('Alice');
  book.enroll('Bob');
  book.enroll('Cara');
  // Re-enrolling an existing student is refused.
  const reenroll: boolean = book.enroll('Alice');
  // Recording a score for an unknown student is refused.
  const unknown: boolean = book.record('Zed', 100.0);

  // Record a handful of scores per student (one low score each, to be dropped).
  book.record('Alice', 88.0);
  book.record('Alice', 92.0);
  book.record('Alice', 50.0);   // dropped
  book.record('Alice', 96.0);

  book.record('Bob', 70.0);
  book.record('Bob', 75.0);
  book.record('Bob', 40.0);     // dropped
  book.record('Bob', 80.0);

  book.record('Cara', 100.0);
  book.record('Cara', 98.0);

  // Drop each student's single lowest score.
  book.dropLowest('Alice');
  book.dropLowest('Bob');
  book.dropLowest('Cara');      // Cara's 98 is dropped; she keeps the 100.

  // Report the outcomes of the refused operations.
  console.log(`reenroll_refused=${reenroll}`);
  console.log(`unknown_refused=${unknown}`);

  // The report.
  console.log('---');
  book.printReport(roster);
  console.log('---');

  // Top student.
  console.log(`top=${book.topStudent(roster)}`);
  console.log('done');
}

main();
