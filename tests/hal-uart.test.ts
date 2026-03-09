// ---------------------------------------------------------------------------
// HAL UART/Serial Tests
//
// Tests for UART fluent and Arduino-compatible APIs
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

describe('UART HAL - Fluent API Transpilation', () => {
  describe('Configuration', () => {
    it('transpiles fluent config chain with baudRate propagation', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno';
        UART0.config.baudRate(115200).begin();
      `, { target: 'arduino' });
      
      // Fluent chain: UART0.config.baudRate(115200).begin() -> Serial.begin(115200)
      expect(result.cpp).toContain('Serial.begin(115200)');
    });

    it('transpiles config with dataBits (requires IR chain tracking)', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno';
        UART0.config.baudRate(9600).dataBits(8).begin();
      `, { target: 'arduino' });
      
      // TODO: Full fluent chain tracking requires IR-level chain analysis
      expect(result.cpp).toContain('UART0.config.baudRate(9600).dataBits(8).begin()');
    });

    it('transpiles config with parity (requires IR chain tracking)', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno';
        UART0.config.baudRate(9600).parity(UARTParity.NONE).begin();
      `, { target: 'arduino' });
      
      // TODO: Full fluent chain tracking requires IR-level chain analysis
      expect(result.cpp).toContain('UART0.config.baudRate(9600).parity');
    });
  });

  describe('Fluent Write Operations', () => {
    it('transpiles write.line()', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno';
        UART0.config.baudRate(9600).begin();
        UART0.write.line("Hello World");
      `, { target: 'arduino' });
      
      // Fluent write.line() IS transpiled to Serial.println
      expect(result.cpp).toContain('Serial.println');
    });

    it('transpiles write.string()', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno';
        UART0.config.baudRate(9600).begin();
        UART0.write.string("Hello");
      `, { target: 'arduino' });
      
      // Fluent write.string() IS transpiled to Serial.print
      expect(result.cpp).toContain('Serial.print');
    });

    it('transpiles write.bytes()', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno';
        UART0.config.baudRate(9600).begin();
        UART0.write.bytes([0x01, 0x02, 0x03]);
      `, { target: 'arduino' });
      
      // Fluent write.bytes() IS transpiled to Serial.write
      expect(result.cpp).toContain('Serial.write');
    });
  });

  describe('Fluent Read Operations', () => {
    it('transpiles available() from fluent API', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno';
        UART0.config.baudRate(9600).begin();
        if (UART0.available() > 0) {
          const data = UART0.read.byte();
        }
      `, { target: 'arduino' });

      expect(result.cpp).toContain('Serial.available()');
    });

    it('transpiles read.line() (not yet implemented)', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno';
        UART0.config.baudRate(9600).begin();
        const line = UART0.read.line();
      `, { target: 'arduino' });
      
      // TODO: read.line() not yet transpiled to Serial calls
      expect(result.cpp).toContain('UART0.read.line');
    });

    it('transpiles read.bytes() (not yet implemented)', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno';
        UART0.config.baudRate(9600).begin();
        const data = UART0.read.bytes(10);
      `, { target: 'arduino' });
      
      // TODO: read.bytes() not yet transpiled to Serial calls
      expect(result.cpp).toContain('UART0.read.bytes');
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
