// ---------------------------------------------------------------------------
// main.ts — enum stress test (cuttlefish, Arduino AVR)
//
// No end-state goal. A maximal showcase hammering the enum surface
// (SUPPORT_MATRIX §1.7) — all claimed ✅/🟡 — to find where the claims break.
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
const currentColor: Color = Color.Green;

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
function isPrimary(c: Color): boolean {
  return c === Color.Red;
}

function colorName(c: Color): string {
  return 'color: ' + c;
}

// ── 8. Enum passed to a non-enum param (the 🟡 gap) ────────────────────────
function toInt(n: int32_t): int32_t {
  return n * 2;
}

function doubleCode(c: Code): int32_t {
  return toInt(c as int32_t);
}

// ── 9. Enum↔integral storage boundary ──────────────────────────────────────
function packMode(m: Mode): int32_t {
  return m;
}

function unpackMode(n: int32_t): Mode {
  return n as Mode;
}

// ── 10. Enum in arithmetic ─────────────────────────────────────────────────
function nextMode(m: Mode): Mode {
  return ((m as int32_t) + 1) as Mode;
}

// ── 11. Enum with bitwise flags ────────────────────────────────────────────
const enum Flags { None = 0, A = 1, B = 2, C = 4, All = 7 }

function hasFlag(flags: int32_t, f: Flags): boolean {
  return (flags & (f as int32_t)) !== 0;
}

// ── 12. Enum member access ─────────────────────────────────────────────────
function defaultCode(): int32_t {
  return Code.Ok;
}

// ── Driver ─────────────────────────────────────────────────────────────────
const led = LED.asOutput();

function main(): void {
  console.log('--- enum stress test ---');
  console.log('mode=' + (currentMode as int32_t));
  console.log('code=' + (Code.NotFound as int32_t));
  console.log(colorName(currentColor));
  console.log('isPrimary=' + (isPrimary(Color.Red) ? 'yes' : 'no'));
  console.log('prio=' + priorityForMode(Mode.Run));
  console.log('highPrio=' + (isHighPriority(Code.ServerError) ? 'yes' : 'no'));
  console.log(describeMode(Mode.Error));
  console.log('doubled=' + doubleCode(Code.Timeout));
  const packed: int32_t = packMode(Mode.Stop);
  const unpacked: Mode = unpackMode(packed);
  console.log('packed=' + packed + ' unpacked=' + (unpacked as int32_t));
  const nm: Mode = nextMode(Mode.Run);
  console.log('next=' + (nm as int32_t));
  console.log('hasA=' + (hasFlag(Flags.A | Flags.C, Flags.A) ? 'yes' : 'no'));
  console.log('default=' + defaultCode());
  led.high();
  console.log('done');
}

main();
