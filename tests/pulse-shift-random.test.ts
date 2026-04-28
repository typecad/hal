import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Pulse utilities', () => {
  describe('Direct functions', () => {
    it('transpiles Pulse.in(pin, true) -> pulseIn(pin, HIGH)', async () => {
      const result = transpile(`
        import { D2, Pulse } from '@typehal/board-arduino-uno';
        const d = Pulse.in(D2, true);
      `, { target: 'arduino' });

      expect(result.cpp).toContain('pulseIn(2, HIGH)');
    });

    it('transpiles Pulse.in(pin, true, timeout)', async () => {
      const result = transpile(`
        import { D2, Pulse } from '@typehal/board-arduino-uno';
        const d = Pulse.in(D2, true, 1000000);
      `, { target: 'arduino' });

      expect(result.cpp).toContain('pulseIn(2, HIGH, 1000000)');
    });

    it('transpiles Pulse.long(pin, false) -> pulseInLong(pin, LOW)', async () => {
      const result = transpile(`
        import { D2, Pulse } from '@typehal/board-arduino-uno';
        const d = Pulse.long(D2, false);
      `, { target: 'arduino' });

      expect(result.cpp).toContain('pulseInLong(2, LOW)');
    });

    it('transpiles Pulse.in(pin, false) -> pulseIn(pin, LOW)', async () => {
      const result = transpile(`
        import { D2, Pulse } from '@typehal/board-arduino-uno';
        const d = Pulse.in(D2, false);
      `, { target: 'arduino' });

      expect(result.cpp).toContain('pulseIn(2, LOW)');
    });
  });
});
