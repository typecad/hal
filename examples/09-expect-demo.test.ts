// ---------------------------------------------------------------------------
// Example: Hardware test file for @typecad/expect
//
// This file demonstrates the full user-facing API.  It reads analog pin A0
// and asserts the value using vitest-style fluent chaining.
//
// Run with:
//   npx typehal-test --port COM4 examples/09-expect-demo.test.ts
//
// Or via npm script:
//   npm run test:hw -- --port COM4
// ---------------------------------------------------------------------------

import { describe, done } from '@typecad/expect';
import { A0, A1 } from '@typecad';

// ── Analog reads ──────────────────────────────────────────────────────────
describe("A0 analog read")
  .it("reads a value in valid ADC range")
    .expect(A0.readAnalog()).toBeWithinRange(0, 1023)
  .it("reads less than mid-scale when grounded")
    .expect(A0.readAnalog()).toBeLessThan(512);

// ── Multiple pins ─────────────────────────────────────────────────────────
describe("A1 analog read")
  .it("returns a non-negative value")
    .expect(A1.readAnalog()).toBeGreaterThanOrEqual(0)
  .it("is within 10-bit ADC range")
    .expect(A1.readAnalog()).toBeLessThanOrEqual(1023);

done();
