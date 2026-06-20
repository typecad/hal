// ---------------------------------------------------------------------------
// main.ts — enum stress test (cuttlefish, Arduino AVR)
//
// Maximal enum showcase. Findings A (string-enum var type) and B (enum const
// file scope) are fixed. Finding C (`as` cast for enum↔int) is partially
// fixed — enum→enum casts work; enum-param→int remains the §1.7 🟡 gap
// (requires interprocedural type resolution). Worked around below.
// ---------------------------------------------------------------------------

import { LED } from '@typecad/board-arduino-uno';

// ── 1. Numeric const enum ──────────────────────────────────────────────────
const enum Mode { Idle, Run, Stop, Error }
const currentMode: Mode = Mode.Run;

// ── 2. Enum with explicit gaps ─────────────────────────────────────────────
const enum Code {
  Ok = 0,
  NotFound = 404,
  ServerError = 500,
  Timeout = 408,
}

// ── 3. String enum ─────────────────────────────────────────────────────────
const enum Color { Red = "red", Green = "green", Blue = "blue" }
const currentColor: string = Color.Green;

// ── 4. Enum as array index ─────────────────────────────────────────────────
const PRIORITY: int32_t[] = [10, 20, 30, 40];

function priorityForMode(m: Mode): int32_t {
  return PRIORITY[m];
}

// ── 5. Enum relational comparison ──────────────────────────────────────────
function isHighPriority(c: Code): boolean {
  return c >= Code.ServerError;
}

// ── 6. Enum in switch ──────────────────────────────────────────────────────
function describeMode(m: Mode): string {
  switch (m) {
    case Mode.Idle: return 'idle';
    case Mode.Run: return 'running';
    case Mode.Stop: return 'stopped';
    case Mode.Error: return 'error';
    default: return 'unknown';
  }
}

// ── 7. String enum comparison and concat ───────────────────────────────────
function isPrimary(c: string): boolean {
  return c === Color.Red;
}

function colorName(c: string): string {
  return 'color: ' + c;
}

// ── 8. Enum↔integral storage boundary (Finding C: `as Mode` works) ─────────
function packMode(m: Mode): int32_t {
  return m;
}

function unpackMode(n: int32_t): Mode {
  return n as Mode;
}

// ── 9. Enum in arithmetic (Finding C: enum→int cast via member access) ─────
function nextMode(m: Mode): Mode {
  // enum→int via member access on an identifier is detected; the `as int32_t`
  // produces static_cast. Then +1, then `as Mode` back.
  return ((m as int32_t) + 1) as Mode;
}

// ── 10. Enum with bitwise flags ────────────────────────────────────────────
const enum Flags { None = 0, A = 1, B = 2, C = 4, All = 7 }

function hasFlag(flags: int32_t, f: Flags): boolean {
  return (flags & (f as int32_t)) !== 0;
}

// ── 11. Enum member access ─────────────────────────────────────────────────
function defaultCode(): int32_t {
  return Code.Ok;
}

// ── Driver ─────────────────────────────────────────────────────────────────
const led = LED.asOutput();

function main(): void {
  console.log('--- enum stress test ---');
  console.log('mode=' + currentMode);
  console.log('code=' + Code.NotFound);
  console.log(colorName(currentColor));
  console.log('isPrimary=' + (isPrimary(Color.Red) ? 'yes' : 'no'));
  console.log('prio=' + priorityForMode(Mode.Run));
  console.log('highPrio=' + (isHighPriority(Code.ServerError) ? 'yes' : 'no'));
  console.log(describeMode(Mode.Error));
  const packed: int32_t = packMode(Mode.Stop);
  const unpacked: Mode = unpackMode(packed);
  console.log('packed=' + packed + ' unpacked=' + unpacked);
  const nm: Mode = nextMode(Mode.Run);
  console.log('next=' + nm);
  console.log('hasA=' + (hasFlag(Flags.A | Flags.C, Flags.A) ? 'yes' : 'no'));
  console.log('default=' + defaultCode());
  led.high();
  console.log('done');
}

main();
