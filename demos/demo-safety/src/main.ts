// Demo: @typecad/safety — all safety mechanisms + ASIL-gated ISO 26262 checks.
//
// This demo exercises every feature of the safety package:
//
//   1. safe.read(button)     — verified GPIO read: 2-of-3 vote + mode check
//   2. safe.write(led, v)    — write-then-readback verification
//   3. SafeVariable<int32_t> — SEU-resistant TMR storage (3 replicas + inversion)
//   4. SafeInt<int32_t>      — chainable bounds-checked arithmetic with sticky fault
//   5. @asilD / @asilC       — per-function ASIL level gates Part B rule enforcement
//
// ASIL decorators on functions:
//   @asilD engageBrake   — recursion + heap + loops all enforced
//   @asilC readSensor    — recursion + loops enforced (heap exempt)
//   (none) logStatus     — QM, no checks
//
// Wiring (Arduino Uno):
//   • D13 — onboard LED (safe.write target + SafeInt blink indicator)
//   • D2  — button to GND (safe.read source; held HIGH by pull-up)
//
// Open the serial monitor at 115200 baud to follow along.

import { delay } from '@typecad/hal';
import {
  SafeInt,
  SafeVariable,
  safe,
  SafetyFaultCategory,
  SafetyFaultCode,
  SafetyStatus,
} from '@typecad/safety';
import { D2, D13 } from '@typecad/board';

const button = D2.asInputPullUp();
const led = D13.asOutput();

// ── SafeVariable: SEU-resistant TMR storage ─────────────────────────────────
const pressCount: SafeVariable<int32_t> = SafeVariable(0);
const flt: SafeVariable<float> = SafeVariable(1.23);

// ── SafeInt: chainable bounds-checked counter ───────────────────────────────
const counter: SafeInt<int32_t> = SafeInt(0);

let phase: int32_t = 0;

function setup(): void {
  console.log("@typecad/safety demo ready");
  console.log("Phase A = safe.read/write + SafeVariable + ASIL");
  console.log("Phase B = SafeInt overflow detection");
}

// ── @asilC: readSensor — recursion + unbounded-loop checks enforced ─────────
// This function is checked at ASIL C level. If it contained a recursive call
// or a while(true) loop, the build would produce an ISO 26262 diagnostic.

// @asilC
function readSensor(): int32_t {
  // safe.read returns SafeReadResult with multi-bit SEU-resistant status.
  const r = safe.read(button);
  if (r.status === SafetyStatus.Ok) {
    return r.value;
  }
  console.log("readSensor: read failed");
  while(true){console.log("weeee!");}
  return 0;
}

// ── @asilD: engageBrake — recursion + heap + loops all enforced ─────────────
// This function is checked at the highest safety level. Any dynamic allocation
// (new/malloc) or recursion here would abort the build.

// @asilD
function engageBrake(value: int32_t): void {
  safe.write(led, value);
  // safe.write verifies: (1) pin mode is OUTPUT, (2) write succeeded,
  // (3) readback matches expected value. Returns SafetyStatus.
  if (value !== 0) {
    led.write(true); delay(60); led.write(false); delay(60);
  }
}

// ── QM (no decorator): logStatus — no ISO 26262 checks ──────────────────────
// This function is quality-managed. The transpiler does not enforce any
// safety rules on it. It could contain recursion or malloc without error.

function logStatus(msg: string): void {
  console.log(msg);
  if (flt.valid()) {
    console.log("  float TMR healthy:", flt.get());
  } else {
    console.log("  float TMR corruption detected — resetting");
    flt.set(1.23);
  }
}

// ── Phase A: verified GPIO read/write + TMR storage + ASIL enforcement ──────

function phaseA(): void {
  logStatus("[A] safe.read + safe.write + SafeVariable");

  const value = readSensor();
  engageBrake(value);

  // SafeVariable: TMR vote on press count
  if (pressCount.valid()) {
    const current: int32_t = pressCount.get();
    pressCount.set(current + 1);
    if ((current + 1) % 10 === 0) {
      console.log("  press count:", current + 1, "(TMR verified)");
    }
  } else {
    console.log("  RAM corruption in pressCount — resetting");
    pressCount.set(0);
  }

  delay(500);
}

// ── Phase B: SafeInt overflow detection ─────────────────────────────────────

function phaseB(): void {
  const seed: int32_t = 2147483640;
  counter.reset(seed);
  console.log("[B] SafeInt overflow — seed =", seed, "chaining .add(1)");

  const steps: int32_t = 12;
  for (let i: int32_t = 0; i < steps; i = i + 1) {
    counter.add(1);
    if (counter.hasFault()) {
      console.log("[B] step", i + 1, "-> OVERFLOW — sticky fault, value =", counter.get());
      break;
    }
    led.write(true); delay(60); led.write(false); delay(60);
  }

  if (counter.hasFault()) {
    console.log("[B] overflow detected — hasFault() = true, resetting");
    led.write(true); delay(700); led.write(false); delay(300);
    counter.reset(0);
  }
}

function loop(): void {
  if (phase === 0) {
    phaseA();
  } else {
    phaseB();
  }
  phase = (phase + 1) % 2;
}
