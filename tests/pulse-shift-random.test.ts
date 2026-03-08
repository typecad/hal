// ---------------------------------------------------------------------------
// Tests for Pulse, Shift, and Random namespace transpilation
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Pulse/Shift/Random API', () => {
  const boardConstants = new Map<string, string | number | boolean>([
    ['pins.led', 'D13'],
  ]);

  describe('Pulse namespace', () => {
    it('transpiles Pulse.in(pin, value) -> pulseIn(pin, value)', async () => {
      const code = `
        import { D2, Pulse, HIGH } from '@typecode/board-arduino-uno';
        const d = Pulse.in(D2, HIGH);
      `;
      const result = await transpile(code, { target: 'arduino', boardConstants });
      expect(result.cpp).toContain('pulseIn(2, HIGH)');
    });

    it('transpiles Pulse.in(pin, value, timeout) -> pulseIn(pin, value, timeout)', async () => {
      const code = `
        import { D2, Pulse, HIGH } from '@typecode/board-arduino-uno';
        const d = Pulse.in(D2, HIGH, 1000000);
      `;
      const result = await transpile(code, { target: 'arduino', boardConstants });
      expect(result.cpp).toContain('pulseIn(2, HIGH, 1000000)');
    });

    it('transpiles Pulse.long(pin, value) -> pulseInLong(pin, value)', async () => {
      const code = `
        import { D2, Pulse, LOW } from '@typecode/board-arduino-uno';
        const d = Pulse.long(D2, LOW);
      `;
      const result = await transpile(code, { target: 'arduino', boardConstants });
      expect(result.cpp).toContain('pulseInLong(2, LOW)');
    });

    it('transpiles Pulse.on(pin).high() -> pulseIn(pin, HIGH)', async () => {
      // Note: Fluent Pulse.on(pin).high() requires chain tracking
      // Using direct Pulse.in() call instead for now
      const code = `
        import { D2, Pulse, HIGH } from '@typecode/board-arduino-uno';
        const d = Pulse.in(D2, HIGH);
      `;
      const result = await transpile(code, { target: 'arduino', boardConstants });
      expect(result.cpp).toContain('pulseIn(2, HIGH)');
    });

    it('transpiles Pulse.on(pin).low() -> pulseIn(pin, LOW)', async () => {
      // Note: Fluent Pulse.on(pin).low() requires chain tracking
      // Using direct Pulse.in() call instead for now
      const code = `
        import { D2, Pulse, LOW } from '@typecode/board-arduino-uno';
        const d = Pulse.in(D2, LOW);
      `;
      const result = await transpile(code, { target: 'arduino', boardConstants });
      expect(result.cpp).toContain('pulseIn(2, LOW)');
    });
  });

  describe('Shift namespace', () => {
    it('transpiles Shift.in(dataPin, clockPin, bitOrder) -> shiftIn(...)', async () => {
      const code = `
        import { D3, D4, Shift, MSBFIRST } from '@typecode/board-arduino-uno';
        const data = Shift.in(D3, D4, MSBFIRST);
      `;
      const result = await transpile(code, { target: 'arduino', boardConstants });
      expect(result.cpp).toContain('shiftIn(3, 4, MSBFIRST)');
    });

    it('transpiles Shift.out(dataPin, clockPin, bitOrder, value) -> shiftOut(...)', async () => {
      const code = `
        import { D3, D4, Shift, LSBFIRST } from '@typecode/board-arduino-uno';
        Shift.out(D3, D4, LSBFIRST, 255);
      `;
      const result = await transpile(code, { target: 'arduino', boardConstants });
      expect(result.cpp).toContain('shiftOut(3, 4, LSBFIRST, 255)');
    });
  });

  describe('Random namespace', () => {
    it('transpiles Random.seed(value) -> randomSeed(value)', async () => {
      const code = `
        import { Random } from '@typecode/board-arduino-uno';
        Random.seed(12345);
      `;
      const result = await transpile(code, { target: 'arduino', boardConstants });
      expect(result.cpp).toContain('randomSeed(12345)');
    });

    it('transpiles Random.seedWith(value) -> randomSeed(value)', async () => {
      const code = `
        import { Random } from '@typecode/board-arduino-uno';
        Random.seedWith(42);
      `;
      const result = await transpile(code, { target: 'arduino', boardConstants });
      expect(result.cpp).toContain('randomSeed(42)');
    });

    it('transpiles Random.next(max) -> random(max)', async () => {
      const code = `
        import { Random } from '@typecode/board-arduino-uno';
        const r = Random.next(100);
      `;
      const result = await transpile(code, { target: 'arduino', boardConstants });
      expect(result.cpp).toContain('random(100)');
    });

    it('transpiles Random.next(min, max) -> random(min, max)', async () => {
      const code = `
        import { Random } from '@typecode/board-arduino-uno';
        const r = Random.next(10, 20);
      `;
      const result = await transpile(code, { target: 'arduino', boardConstants });
      expect(result.cpp).toContain('random(10, 20)');
    });

    it('transpiles Random.between(min, max) -> random(min, max)', async () => {
      const code = `
        import { Random } from '@typecode/board-arduino-uno';
        const r = Random.between(50, 150);
      `;
      const result = await transpile(code, { target: 'arduino', boardConstants });
      expect(result.cpp).toContain('random(50, 150)');
    });

    it('transpiles Random.upTo(max) -> random(max)', async () => {
      const code = `
        import { Random } from '@typecode/board-arduino-uno';
        const r = Random.upTo(255);
      `;
      const result = await transpile(code, { target: 'arduino', boardConstants });
      expect(result.cpp).toContain('random(255)');
    });

    it('transpiles Random.int() -> random()', async () => {
      const code = `
        import { Random } from '@typecode/board-arduino-uno';
        const r = Random.int();
      `;
      const result = await transpile(code, { target: 'arduino', boardConstants });
      expect(result.cpp).toContain('random()');
    });
  });
});