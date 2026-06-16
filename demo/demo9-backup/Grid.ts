// ---------------------------------------------------------------------------
// Grid.ts — a 2D grid processor (2D arrays, do...while, labeled loops).
//
// SUPPORT_MATRIX tour for Demo #9 (untested slice):
//   §1.5  2D arrays `T[][]`
//   §2.2  `do...while` (already ✅ via #5/#6) + labeled continue/break
//   §2.5  labeled statement (general), empty statement `;`
//   §2.3  switch without default
// ---------------------------------------------------------------------------

// §1.5 — a 2D array type.
export type Grid2D = number[][];

// Build a rows×cols grid initialized to a fill value.
export function buildGrid(rows: int32_t, cols: int32_t, fill: double): Grid2D {
  const g: Grid2D = [];
  for (let r = 0; r < rows; r++) {
    const row: double[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(fill);
    }
    g.push(row);
  }
  return g;
}

// Sum every cell using labeled loops + labeled continue (skip cells < 0).
export function sumPositive(g: Grid2D): double {
  let total: double = 0;
outer:
  for (let r = 0; r < g.length; r++) {
    const row = g[r]!;
    for (let c = 0; c < row.length; c++) {
      const v = row[c]!;
      if (v < 0) {
        continue outer;
      }
      total += v;
    }
  }
  return total;
}

// §2.2 — do...while (count down to zero).
export function countdown(start: int32_t): int32_t {
  let n: int32_t = start;
  let steps: int32_t = 0;
  do {
    n = n - 1;
    steps = steps + 1;
  } while (n > 0);
  return steps;
}

// §2.5 — empty statement + standalone block (coverage, no semantic effect).
export function noopWithEmpty(): int32_t {
  ;
  {
    const inner: int32_t = 1;
  }
  return 1;
}
