// ---------------------------------------------------------------------------
// array-methods.ts — callback array-method gallery (native/differential tier).
//
// This module is deliberately NOT imported by main.ts: on firmware targets
// (framework-zephyr) the callback methods have no lowering at all
// (array-map-unsupported / array-filter-unsupported / ... lint errors), so
// the Zephyr program uses the explicit-loop forms in main.ts instead. The
// native (host g++) strategy lowers them structurally to __tc_* helpers,
// so THIS file runs under the differential harness
// (tests/packages/cuttlefish/ts-patterns-gallery.test.ts) as its own
// Node-vs-native case.
//
// Deterministic; prints through the same report seam.
// ---------------------------------------------------------------------------

import { report } from './report';

export function runArrayMethods(): void {
  const samples: number[] = [4, 8, 15, 16, 23, 42];
  const words: string[] = ['delta', 'alpha', 'charlie', 'bravo'];

  const doubled = samples.map((n) => n * 2);
  const evens = samples.filter((n) => Math.floor(n / 2) * 2 === n);
  let evensCount = 0;
  for (const e of evens) {
    evensCount += 1;
  }
  const total = samples.reduce((acc, n): number => acc + n, 0);
  const product = samples.reduce((acc, n): number => acc * n, 1);
  const found = samples.find((n) => n > 20);
  const foundIdx = samples.findIndex((n) => n > 20);
  const anyBig = samples.some((n) => n > 40);
  const allSmall = samples.every((n) => n < 100);

  let forEachSum = 0;
  samples.forEach((n) => {
    forEachSum += n;
  });

  const sortedWords: string[] = [];
  for (const w of words) {
    sortedWords.push(w);
  }
  sortedWords.sort();
  const byLength: string[] = [];
  for (const w of words) {
    byLength.push(w);
  }
  byLength.sort((a, b) => a.length - b.length);
  const descending: number[] = [];
  for (const n of samples) {
    descending.push(n);
  }
  descending.sort((a, b) => b - a);

  const pipeline = samples
    .filter((n: number): boolean => n > 10)
    .map((n: number): number => n - 10)
    .reduce((acc, n): number => acc * 100 + n, 0);

  const stack: number[] = [];
  stack.push(1);
  stack.push(2);
  stack.push(3); // one push per element (multi-arg push is lint-banned)
  const popped = stack.pop();
  const queue = [9, 8, 7];
  const firstOut = queue.shift();
  queue.unshift(6);

  const copy = [...samples, 99];
  // slice() lowers through the string helper even for number arrays - the
  // loop form (main.ts) is the idiom; negative indexing is a finding

  report(`M01 map: d0=${doubled[0]} d5=${doubled[5]}`);
  report(`M02 filter: e0=${evens[0]} e2=${evens[2]} n=${evensCount}`);
  report(`M03 reduce: total=${total} product=${product}`);
  report(`M04 find: found=${found.toFixed(0)} idx=${foundIdx} anyBig=${anyBig ? 'yes' : 'no'} allSmall=${allSmall ? 'yes' : 'no'}`);
  report(`M05 forEach: sum=${forEachSum}`);
  report(`M06 sort: words=${sortedWords.join(',')} len=${byLength.join(',')} desc=${descending.join(',')}`);
  report(`M07 pipeline: value=${pipeline}`);
  report(`M08 stack: pushed=${stack.join(',')} popped=${popped.toFixed(0)} firstOut=${firstOut.toFixed(0)} queue=${queue.join(',')}`);
  report(`M09 spread: n=${copy.length} last=${copy[copy.length - 1]}`);
}
