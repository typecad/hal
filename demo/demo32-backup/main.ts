// ---------------------------------------------------------------------------
// main.ts — Conway's Game of Life on a toroidal 2D grid
//                                  (cuttlefish demo #32).
//
// A mid-complexity, idiomatic TypeScript program built around one cellular
// automaton that steps a 2D grid of cells forward one generation at a time
// using the classic Conway rules:
//
//   1. A live cell with 2 or 3 live neighbors stays alive.
//   2. A live cell with fewer than 2 or more than 3 neighbors dies
//      (underpopulation / overpopulation).
//   3. A dead cell with exactly 3 live neighbors becomes alive (birth).
//
//   **`class Life`** owns TWO parallel `uint8_t[][]` grids — `cur` (the
//   current generation) and `nxt` (the buffer the next generation is written
//   into) — and swaps them after each `step()`. The grid is **toroidal**:
//   the neighbor scan wraps around the edges with modular arithmetic
//   (`(r + dr + rows) % rows`), so every cell has exactly eight neighbors.
//   Classic patterns (blinker, block, glider) are seeded from compact
//   `number[][]` shape literals stamped onto the grid at an offset.
//
// This is the **thirty-second** demo iteration. Like #15–#31 it is
// deliberately **readable** — real, everyday TypeScript — and is **not** a
// feature-exhaustion test. It deliberately picks a **different data shape**
// from #15–#31 (parallel arrays, Maps, struct arrays, tries, heaps, linked
// lists, union-finds, ciphers, interpreters, CRC/INI parsers, markdown
// flatteners, Roman-numeral converters):
//
//   • **a `uint8_t[][]` 2D nested-array FIELD on a class** — the genuinely
//     under-tested shape (SUPPORT_MATRIX §1.5 marks 2D arrays 🟡 "lowered but
//     uncommon on AVR"; no prior demo exercised them). The class owns TWO of
//     them and swaps them.
//   • **double-buffered `cur`/`nxt` swap** — `const tmp = this.cur;
//     this.cur = this.nxt; this.nxt = tmp;` reassigning a whole `T[][]`
//     field through a local alias.
//   • **a `number[][]` shape literal stamped onto the grid** — a small 2D
//     pattern literal iterated with a nested `for` loop and written through
//     `this.cur[r][c] = v` (2D index assignment through a class field).
//   • **a toroidal neighbor scan** — modular wraparound index arithmetic
//     inside a nested `for` over `dr`/`dc` in `[-1, 0, 1]`, reading
//     `this.cur[rr][cc]`.
//   • **a `const enum Cell` + numeric `switch`** driving the birth/survival
//     transition, reached via `switch (nextState)`.
//   • **a `render()` that builds a multi-line frame** by `parts.push`-ing
//     one string per grid row, each row a hand-built `'.'`/`'#'` run, then
//     `parts.join('\n')`.
//
// The previous iteration (#31, Roman numerals + English number words) is
// preserved in `demo31-backup/`.
//
// Idiomatic constraints honored up front (per SUPPORT_MATRIX / eslint rules):
// only `const enum`; no `any`; no typed-array fields/returns; no object
// spread; no `instanceof`; no `keyof`/conditional/mapped types; no
// `String.*`/`Number.*` statics (§5.4); no `delete` on non-Map collections;
// no comparing a `Map.get()` result to `undefined`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cell state + transition model.
// ---------------------------------------------------------------------------

// A cell is either Dead or Alive. `const enum` so the values inline to 0/1
// (matching the `uint8_t` storage and the `> 0` alive test).
const enum Cell {
  Dead = 0,
  Alive = 1,
}

// The result of applying the Conway rules to one cell: the cell's state in
// the NEXT generation. `const enum` again so the `switch` in `step()`
// lowers to integral comparisons.
const enum Transition {
  StayDead = 0,   // was dead, stays dead (not exactly 3 neighbors)
  Born = 1,       // was dead, exactly 3 neighbors → alive
  Survive = 2,    // was alive, 2 or 3 neighbors → stays alive
  Die = 3,        // was alive, <2 or >3 neighbors → dies
}

// Apply the Conway rules to one cell given its current liveness and its
// live-neighbor count. Returns the Transition the cell undergoes.
function ruleFor(alive: Cell, neighbors: int32_t): Transition {
  if (alive === Cell.Alive) {
    if (neighbors === 2 || neighbors === 3) {
      return Transition.Survive;
    }
    return Transition.Die;
  }
  // Dead cell: born iff exactly 3 neighbors.
  if (neighbors === 3) {
    return Transition.Born;
  }
  return Transition.StayDead;
}

// ---------------------------------------------------------------------------
// The grid. Owns two `uint8_t[][]` buffers and swaps them each step. The
// grid is toroidal (edges wrap), so every cell has exactly eight neighbors.
// ---------------------------------------------------------------------------

class Life {
  // The current generation. `uint8_t[][]` → `std::vector<std::vector<uint8_t>>`.
  cur: uint8_t[][];
  // The buffer the next generation is written into. Swapped with `cur` after
  // each `step()` so we never read and write the same grid in one pass.
  nxt: uint8_t[][];
  rows: int32_t;
  cols: int32_t;

  constructor(rows: int32_t, cols: int32_t) {
    this.rows = rows;
    this.cols = cols;
    this.cur = makeGrid(rows, cols);
    this.nxt = makeGrid(rows, cols);
  }

  // Toroidal (wraparound) live-neighbor count for the cell at (r, c). The
  // modular arithmetic `(r + dr + rows) % rows` maps a neighbor that walks
  // off one edge back onto the opposite edge, so every cell has exactly
  // eight neighbors regardless of position.
  liveNeighbors(r: int32_t, c: int32_t): int32_t {
    let count: int32_t = 0;
    for (let dr: int32_t = -1; dr <= 1; dr = dr + 1) {
      for (let dc: int32_t = -1; dc <= 1; dc = dc + 1) {
        // Skip the cell itself.
        if (dr === 0 && dc === 0) {
          continue;
        }
        const rr: int32_t = (r + dr + this.rows) % this.rows;
        const cc: int32_t = (c + dc + this.cols) % this.cols;
        if (this.cur[rr][cc] === Cell.Alive) {
          count = count + 1;
        }
      }
    }
    return count;
  }

  // Advance the simulation by one generation. Reads from `cur`, writes the
  // next generation into `nxt`, then swaps the two buffers.
  step(): void {
    for (let r: int32_t = 0; r < this.rows; r = r + 1) {
      for (let c: int32_t = 0; c < this.cols; c = c + 1) {
        const alive: Cell = this.cur[r][c] as Cell;
        const neighbors: int32_t = this.liveNeighbors(r, c);
        const transition: Transition = ruleFor(alive, neighbors);
        // The `switch` lowers to an if/else chain; each arm writes the next
        // generation's cell state into the `nxt` buffer.
        let next: Cell = Cell.Dead;
        switch (transition) {
          case Transition.Born:
          case Transition.Survive: {
            next = Cell.Alive;
            break;
          }
          case Transition.StayDead:
          case Transition.Die:
          default: {
            next = Cell.Dead;
            break;
          }
        }
        this.nxt[r][c] = next;
      }
    }
    // Swap the double buffers. `tmp` holds the old `cur`; `cur` becomes the
    // freshly-written `nxt`; `nxt` becomes the old `cur` (now free to be
    // overwritten next generation).
    const tmp: uint8_t[][] = this.cur;
    this.cur = this.nxt;
    this.nxt = tmp;
  }

  // Count the live cells in the current generation.
  population(): int32_t {
    let n: int32_t = 0;
    for (let r: int32_t = 0; r < this.rows; r = r + 1) {
      for (let c: int32_t = 0; c < this.cols; c = c + 1) {
        if (this.cur[r][c] === Cell.Alive) {
          n = n + 1;
        }
      }
    }
    return n;
  }

  // Stamp a compact `number[][]` pattern onto the grid at offset (topRow,
  // leftCol). A `1` in the pattern sets the cell alive; a `0` leaves it as
  // is. The pattern is a 2D literal iterated with a nested `for` loop.
  stamp(topRow: int32_t, leftCol: int32_t, pattern: number[][]): void {
    for (let r: int32_t = 0; r < pattern.length; r = r + 1) {
      const row: number[] = pattern[r];
      for (let c: int32_t = 0; c < row.length; c = c + 1) {
        if (row[c] === 1) {
          const rr: int32_t = topRow + r;
          const cc: int32_t = leftCol + c;
          this.cur[rr][cc] = Cell.Alive;
        }
      }
    }
  }

  // Render the current generation as a multi-line frame of '.' (dead) and
  // '#' (alive) characters. Builds one string per grid row and joins them
  // with '\n'.
  render(): string {
    const parts: string[] = [];
    for (let r: int32_t = 0; r < this.rows; r = r + 1) {
      let line: string = '';
      for (let c: int32_t = 0; c < this.cols; c = c + 1) {
        if (this.cur[r][c] === Cell.Alive) {
          line = line + '#';
        } else {
          line = line + '.';
        }
      }
      parts.push(line);
    }
    return parts.join('\n');
  }
}

// Build a fresh `rows × cols` grid of dead cells. A module-scope free
// function called from the `Life` constructor (exercises a free function
// reached from a class ctor).
function makeGrid(rows: int32_t, cols: int32_t): uint8_t[][] {
  const grid: uint8_t[][] = [];
  for (let r: int32_t = 0; r < rows; r = r + 1) {
    const row: uint8_t[] = [];
    for (let c: int32_t = 0; c < cols; c = c + 1) {
      row.push(Cell.Dead);
    }
    grid.push(row);
  }
  return grid;
}

// ---------------------------------------------------------------------------
// Classic Game-of-Life patterns as compact `number[][]` shape literals.
// Each `1` is a live cell. These are the canonical "still lifes",
// "oscillators", and "spaceships" from Conway's original 1970 article.
// ---------------------------------------------------------------------------

// Block — a 2×2 still life (never changes).
const BLOCK: number[][] = [
  [1, 1],
  [1, 1],
];

// Blinker — a 3×1 oscillator (period 2: horizontal ↔ vertical).
const BLINKER: number[][] = [
  [1, 1, 1],
];

// Glider — a 3×3 spaceship that moves one cell diagonally every 4 generations.
const GLIDER: number[][] = [
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 1],
];

// ---------------------------------------------------------------------------
// Driver. Seed a grid with a block, a blinker, and a glider, then step it a
// handful of generations and print the population + the rendered frame at a
// few checkpoints so the periodic motion is visible.
// ---------------------------------------------------------------------------

// The grid dimensions. 6 rows × 7 cols is big enough to hold the three
// seeded patterns with room for the glider to move, small enough that the
// rendered frame reads on one screen.
const ROWS: int32_t = 6;
const COLS: int32_t = 7;
// How many generations to step.
const GENERATIONS: int32_t = 4;

function main(): void {
  console.log('--- Conway Game of Life demo ---');

  const life: Life = new Life(ROWS, COLS);

  // Seed the three patterns at non-overlapping offsets.
  life.stamp(0, 0, BLOCK);     // top-left still life
  life.stamp(1, 4, BLINKER);   // mid-row oscillator
  life.stamp(3, 0, GLIDER);    // lower-left glider

  console.log(`[seed] population = ${life.population()}`);

  // Step and report each generation. The grid is small enough that the three
  // seeded patterns interact within a few steps (the toroidal wrap brings the
  // glider's leading edge back into the blinker's neighborhood), so the total
  // population is NOT constant — it drifts as the patterns collide and settle.
  // The reference JavaScript implementation produces the identical sequence
  // (12, 11, 10, 13, 6), which is the correctness check.
  for (let gen: int32_t = 0; gen < GENERATIONS; gen = gen + 1) {
    life.step();
    const pop: int32_t = life.population();
    console.log(`[gen ${gen + 1}] population = ${pop}`);
    // Render the frame at the first and last generation so the motion
    // (blinker flipping, glider crawling, collisions) is visible.
    if (gen === 0 || gen === GENERATIONS - 1) {
      console.log(`[frame ${gen + 1}]`);
      console.log(life.render());
    }
  }

  console.log('done');
}

main();
