// ---------------------------------------------------------------------------
// Pulse, Shift, and Random utilities
// ---------------------------------------------------------------------------

import { D2, D3, D4, D5, A0 } from '@typecode';
import { Pulse, Shift, Random } from '@typecode';

// ===========================================================================
// Pulse measurement examples (pulseIn / pulseInLong)
// ===========================================================================

// Direct API
const duration1 = Pulse.in(D2, true);
const duration2 = Pulse.in(D2, true, 1000000);
const duration3 = Pulse.long(D2, false);
const duration4 = Pulse.long(D2, false, 3000000);

// Fluent API
const duration5 = Pulse.on(D2).high();
const duration6 = Pulse.on(D2).low();

// ===========================================================================
// Shift register examples (shiftIn / shiftOut)
// ===========================================================================

// Direct API
const dataIn1 = Shift.in(D3, D4, 'msb');
const dataIn2 = Shift.in(D3, D4, 'lsb');
Shift.out(D3, D4, 'msb', 0xFF);
Shift.out(D3, D4, 'lsb', 0xAA);

// Fluent API
const dataIn3 = Shift.read(D3).clock(D4).msbFirst();
const dataIn4 = Shift.read(D3).clock(D4).lsbFirst();
Shift.write(D3, 0xFF).clock(D4).msbFirst();
Shift.write(D3, 0xAA).clock(D4).lsbFirst();

// ===========================================================================
// Random number examples (random / randomSeed)
// ===========================================================================

// Seed the random number generator
Random.seed(12345);
Random.seed(A0.readAnalog());

// Direct API
const r1 = Random.next(100);                       // 0 to 99
const r2 = Random.next(10, 20);                    // 10 to 19

// Fluent API
const r3 = Random.upTo(255);                       // 0 to 254
const r4 = Random.between(50, 150);                // 50 to 149
const r5 = Random.int();                           // full range
