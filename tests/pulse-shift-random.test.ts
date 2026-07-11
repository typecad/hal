import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Pulse utilities', () => {
  describe('Free functions', () => {
    it('transpiles pulseIn(pin, HIGH) -> pulseIn(pin, HIGH)', () => {
      const result = transpile(`
        import { D2, HIGH } from '@typecad/board-arduino-uno';
        const d = pulseIn(2, HIGH);
      `, { target: 'arduino' });

      expect(result.cpp).toContain('pulseIn(2, HIGH)');
    });

    it('transpiles pulseIn(pin, HIGH, timeout) with optional timeout', () => {
      const result = transpile(`
        import { D2, HIGH } from '@typecad/board-arduino-uno';
        const d = pulseIn(2, HIGH, 1000000);
      `, { target: 'arduino' });

      expect(result.cpp).toContain('pulseIn(2, HIGH, 1000000)');
    });

    it('transpiles pulseInLong(pin, LOW) -> pulseInLong(pin, LOW)', () => {
      const result = transpile(`
        import { D2, LOW } from '@typecad/board-arduino-uno';
        const d = pulseInLong(2, LOW);
      `, { target: 'arduino' });

      expect(result.cpp).toContain('pulseInLong(2, LOW)');
    });
  });

  describe('Pulse class', () => {
    it('transpiles Pulse.long(pin, value) -> pulseInLong(pin, value)', () => {
      // Pulse.long is the real static method (not Pulse.in, which does not exist).
      const result = transpile(`
        import { D2, Pulse } from '@typecad/board-arduino-uno';
        const d = Pulse.long(D2, 0);
      `, { target: 'arduino' });

      expect(result.cpp).toContain('pulseInLong(2, 0)');
    });

    it('transpiles Pulse.on(pin).high() -> Pulse::on(pin).high()', () => {
      const result = transpile(`
        import { D2, Pulse } from '@typecad/board-arduino-uno';
        const d = Pulse.on(D2).high();
      `, { target: 'arduino' });

      expect(result.cpp).toContain('Pulse::on(2).high()');
    });

    it('transpiles Pulse.on(pin).low() -> Pulse::on(pin).low()', () => {
      const result = transpile(`
        import { D2, Pulse } from '@typecad/board-arduino-uno';
        const d = Pulse.on(D2).low();
      `, { target: 'arduino' });

      expect(result.cpp).toContain('Pulse::on(2).low()');
    });

    it('transpiles Pulse.on(pin).timeout(us).high() with timeout', () => {
      const result = transpile(`
        import { D2, Pulse } from '@typecad/board-arduino-uno';
        const d = Pulse.on(D2).timeout(5000).high();
      `, { target: 'arduino' });

      expect(result.cpp).toContain('Pulse::on(2).timeout(5000).high()');
    });
  });
});
