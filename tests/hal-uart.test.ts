// ---------------------------------------------------------------------------
// HAL UART/Serial Tests
//
// Tests for UART Arduino-compatible API
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('UART HAL - Arduino API Transpilation', () => {
  describe('Initialization', () => {
    it('transpiles UART0.begin() (maps to Serial)', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno/arduino';
        UART0.begin(9600);
      `, { target: 'arduino' });
      
      // UART0 maps to Serial on Arduino
      expect(result.cpp).toContain('Serial.begin(9600)');
    });

    it('transpiles UART0.end() (maps to Serial)', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno/arduino';
        UART0.begin(9600);
        UART0.end();
      `, { target: 'arduino' });
      
      // UART0.end() maps to Serial.end()
      expect(result.cpp).toContain('Serial.end()');
    });
  });

  describe('Read Operations', () => {
    it('transpiles available()', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno/arduino';
        UART0.begin(9600);
        const count = UART0.available();
      `, { target: 'arduino' });
      
      expect(result.cpp).toContain('Serial.available()');
    });

    it('transpiles read()', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno/arduino';
        UART0.begin(9600);
        const data = UART0.read();
      `, { target: 'arduino' });
      
      expect(result.cpp).toContain('Serial.read()');
    });

    it('transpiles peek()', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno/arduino';
        UART0.begin(9600);
        const data = UART0.peek();
      `, { target: 'arduino' });
      
      expect(result.cpp).toContain('Serial.peek()');
    });
  });

  describe('Write Operations', () => {
    it('transpiles write() with number', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno/arduino';
        UART0.begin(9600);
        UART0.write(65);
      `, { target: 'arduino' });
      
      expect(result.cpp).toContain('Serial.write(65)');
    });

    it('transpiles write() with string', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno/arduino';
        UART0.begin(9600);
        UART0.write("hello");
      `, { target: 'arduino' });
      
      expect(result.cpp).toContain('Serial.write');
    });
  });

  describe('Print Operations', () => {
    it('transpiles print()', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno/arduino';
        UART0.begin(9600);
        UART0.print("Hello");
      `, { target: 'arduino' });
      
      expect(result.cpp).toContain('Serial.print');
    });

    it('transpiles println()', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno/arduino';
        UART0.begin(9600);
        UART0.println("Hello");
      `, { target: 'arduino' });
      
      expect(result.cpp).toContain('Serial.println');
    });

    it('transpiles printf()', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno/arduino';
        UART0.begin(9600);
        UART0.printf("Value: %d", 42);
      `, { target: 'arduino' });
      
      expect(result.cpp).toContain('Serial.printf');
    });
  });

  describe('Buffer Control', () => {
    it('transpiles flush()', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno/arduino';
        UART0.begin(9600);
        UART0.flush();
      `, { target: 'arduino' });
      
      expect(result.cpp).toContain('Serial.flush()');
    });
  });
});

describe('UART HAL - Multiple Port Support', () => {
  it('uses Serial for UART0 on Arduino Uno (maps to Serial)', () => {
    const result = transpile(`
      import { UART0 } from '@typecode/board-arduino-uno/arduino';
      UART0.begin(9600);
    `, { target: 'arduino' });
    
    // UART0 maps to Serial on Arduino
    expect(result.cpp).toContain('Serial.begin(9600)');
  });
});

describe('UART HAL - Serial Console Integration', () => {
  it('auto-injects Serial.begin with platformContext', () => {
    const result = transpile(`
      console.log("Hello");
    `, { 
      target: 'arduino',
      platformContext: {
        console: { baudRate: 9600 }
      }
    });
    
    // Note: console.log maps to Serial.println with configured baud rate
    expect(result.cpp).toContain('Serial.begin(9600)');
    expect(result.cpp).toContain('Serial.println');
  });
});
