// ---------------------------------------------------------------------------
// HAL UART/Serial Tests
//
// Tests for UART Arduino-compatible API
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { expectCppContains, transpileArduino } from '../../setup';

describe('UART HAL - Arduino API Transpilation', () => {
  describe('Initialization', () => {
    it('transpiles UART0.begin() (maps to Serial)', () => {
      const result = transpileArduino(`
        import { UART0 } from '@typecad/framework-arduino/arduino';
        UART0.begin(9600);
      `);
      
      expectCppContains(result, ['Serial.begin(9600)']);
    });

    it('transpiles UART0.end() (maps to Serial)', () => {
      const result = transpileArduino(`
        import { UART0 } from '@typecad/framework-arduino/arduino';
        UART0.begin(9600);
        UART0.end();
      `);
      
      expectCppContains(result, ['Serial.end()']);
    });
  });

  describe('Read Operations', () => {
    it('transpiles available()', () => {
      const result = transpileArduino(`
        import { UART0 } from '@typecad/framework-arduino/arduino';
        UART0.begin(9600);
        const count = UART0.available();
      `);
      
      expectCppContains(result, ['Serial.available()']);
    });

    it('transpiles read()', () => {
      const result = transpileArduino(`
        import { UART0 } from '@typecad/framework-arduino/arduino';
        UART0.begin(9600);
        const data = UART0.read();
      `);
      
      expectCppContains(result, ['Serial.read()']);
    });

    it('transpiles peek()', () => {
      const result = transpileArduino(`
        import { UART0 } from '@typecad/framework-arduino/arduino';
        UART0.begin(9600);
        const data = UART0.peek();
      `);
      
      expectCppContains(result, ['Serial.peek()']);
    });
  });

  describe('Write Operations', () => {
    it('transpiles write() with number', () => {
      const result = transpileArduino(`
        import { UART0 } from '@typecad/framework-arduino/arduino';
        UART0.begin(9600);
        UART0.write(65);
      `);
      
      expectCppContains(result, ['Serial.write(65)']);
    });

    it('transpiles write() with string', () => {
      const result = transpileArduino(`
        import { UART0 } from '@typecad/framework-arduino/arduino';
        UART0.begin(9600);
        UART0.write("hello");
      `);
      
      expectCppContains(result, ['Serial.write("hello")']);
    });
  });

  describe('Print Operations', () => {
    it('transpiles print()', () => {
      const result = transpileArduino(`
        import { UART0 } from '@typecad/framework-arduino/arduino';
        UART0.begin(9600);
        UART0.print("Hello");
      `);
      
      expectCppContains(result, ['Serial.print("Hello")']);
    });

    it('transpiles println()', () => {
      const result = transpileArduino(`
        import { UART0 } from '@typecad/framework-arduino/arduino';
        UART0.begin(9600);
        UART0.println("Hello");
      `);
      
      expectCppContains(result, ['Serial.println("Hello")']);
    });

    it('preserves UART aliases across later println calls', () => {
      const result = transpileArduino(`
        import { UART0 } from '@typecad/framework-arduino/arduino';
        const serial = UART0.begin(115200);
        serial.println(` + "`value=${1}`" + `);
      `);

      expect(result.cpp).toContain('Serial.begin(115200);');
      expect(result.cpp).toContain('Serial.println(');
      expect(result.cpp).not.toContain('const int serial = Serial.begin(115200);');
      expect(result.cpp).not.toContain('serial.println(');
    });
  });

  describe('Buffer Control', () => {
    it('transpiles flush()', () => {
      const result = transpileArduino(`
        import { UART0 } from '@typecad/framework-arduino/arduino';
        UART0.begin(9600);
        UART0.flush();
      `);
      
      expectCppContains(result, ['Serial.flush()']);
    });
  });
});

describe('UART HAL - Multiple Port Support', () => {
  it('lowers the high-level UART API to Serial calls on Arduino Uno', () => {
    const result = transpileArduino(`
      import { UART0 } from '@typecad/framework-arduino/arduino';
      UART0.begin(9600);
    `);
    
    expectCppContains(result, ['Serial.begin(9600)']);
    expect(result.cpp).not.toContain('UART0.begin');
  });
});

describe('UART HAL - Serial Console Integration', () => {
  it('auto-injects Serial.begin with platformContext', () => {
    const result = transpileArduino(`
      console.log("Hello");
    `, { 
      platformContext: {
        console: { baudRate: 9600 }
      }
    });
    
    expectCppContains(result, ['Serial.begin(9600)', 'Serial.println']);
  });
});
