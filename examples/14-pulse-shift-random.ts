// ---------------------------------------------------------------------------
// TypeCode example: Pulse, Shift, and Random utilities
// ---------------------------------------------------------------------------

import { D2, D3, D4, D5, A0, HIGH, LOW } from '@typecode';
import { Pulse, Shift, Random, MSBFIRST, LSBFIRST } from '@typecode';

// ===========================================================================
// Pulse measurement examples (pulseIn / pulseInLong)
// ===========================================================================

// Direct API - Arduino-compatible
const duration1 = Pulse.in(D2, HIGH);              // pulseIn(2, HIGH)
const duration2 = Pulse.in(D2, HIGH, 1000000);     // pulseIn(2, HIGH, 1000000)
const duration3 = Pulse.long(D2, LOW);             // pulseInLong(2, LOW)
const duration4 = Pulse.long(D2, LOW, 3000000);    // pulseInLong(2, LOW, 3000000)

// Fluent API
const duration5 = Pulse.on(D2).high();             // pulseIn(2, HIGH)
const duration6 = Pulse.on(D2).low();              // pulseIn(2, LOW)

// ===========================================================================
// Shift register examples (shiftIn / shiftOut)
// ===========================================================================

// Direct API - Arduino-compatible
const dataIn1 = Shift.in(D3, D4, MSBFIRST);        // shiftIn(3, 4, MSBFIRST)
const dataIn2 = Shift.in(D3, D4, LSBFIRST);        // shiftIn(3, 4, LSBFIRST)
Shift.out(D3, D4, MSBFIRST, 0xFF);                 // shiftOut(3, 4, MSBFIRST, 0xFF)
Shift.out(D3, D4, LSBFIRST, 0xAA);                 // shiftOut(3, 4, LSBFIRST, 0xAA)

// Fluent API
const dataIn3 = Shift.read(D3).clock(D4).msbFirst();  // shiftIn(3, 4, MSBFIRST)
const dataIn4 = Shift.read(D3).clock(D4).lsbFirst();  // shiftIn(3, 4, LSBFIRST)
Shift.write(D3, 0xFF).clock(D4).msbFirst();           // shiftOut(3, 4, MSBFIRST, 0xFF)
Shift.write(D3, 0xAA).clock(D4).lsbFirst();           // shiftOut(3, 4, LSBFIRST, 0xAA)

// ===========================================================================
// Random number examples (random / randomSeed)
// ===========================================================================

// Seed the random number generator
Random.seed(12345);                                // randomSeed(12345)
Random.seedWith(A0.read());                        // randomSeed(analogRead(A0))

// Direct API - Arduino-compatible
const r1 = Random.next(100);                       // random(100) - 0 to 99
const r2 = Random.next(10, 20);                    // random(10, 20) - 10 to 19

// Fluent API
const r3 = Random.upTo(255);                       // random(255) - 0 to 254
const r4 = Random.between(50, 150);                // random(50, 150) - 50 to 149
const r5 = Random.int();                           // random() - full range