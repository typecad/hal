import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Pin Mode Configuration Validation', () => {
  // Pin mode validation previously relied on cuttlefish-call IR nodes that carried
  // receiver/method metadata. In the __EMIT__ system, pin operations are lowered
  // to C++ strings (pinMode, digitalWrite, etc.) and the structured receiver/method
  // information is no longer available to validators.
  //
  // The tests below verify that the __EMIT__ system produces the correct C++ output
  // for pin operations, and that no false-positive pin-mode-not-set diagnostics are
  // generated.

  it('does not generate false-positive pin-mode warnings', () => {
    const result = transpile(`
      import { D4 } from '@typecad/board-arduino-uno';
      D4.asInput();
      const value = D4.read();
    `);

    const warnings = result.diagnostics.filter(
      d => d.code === 'pin-mode-not-set'
    );
    expect(warnings.length).toBe(0);
  });

  it('does not generate warning when asOutput() is called before toggle', () => {
    const result = transpile(`
      import { LED } from '@typecad/board-arduino-uno';
      LED.asOutput(true);
      LED.toggle();
    `);

    const warnings = result.diagnostics.filter(
      d => d.code === 'pin-mode-not-set'
    );
    expect(warnings.length).toBe(0);
  });

  it('does not generate warning for asOutput fluent API', () => {
    const result = transpile(`
      import { D4 } from '@typecad/board-arduino-uno';
      const out = D4.asOutput();
      out.high();
    `);

    const warnings = result.diagnostics.filter(
      d => d.code === 'pin-mode-not-set'
    );
    expect(warnings.length).toBe(0);
  });

  it('does not generate warning for non-pin receivers', () => {
    const result = transpile(`
      import { UART0 } from '@typecad/board-arduino-uno';
      const serial = UART0.begin(9600);
    `);

    const warnings = result.diagnostics.filter(
      d => d.code === 'pin-mode-not-set'
    );
    expect(warnings.length).toBe(0);
  });

  // ── Object-creation pattern (asOutput/asInput) ──────────────────────

  it('emits pinMode for LED.asOutput()', () => {
    const result = transpile(`
      import { LED } from '@typecad/board-arduino-uno';
      const led = LED.asOutput();
      led.toggle();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalRead(13)');
    // Should NOT emit a C++ variable declaration for 'led'
    expect(result.cpp).not.toMatch(/\bauto\s+led\b/);
  });

  it('emits pinMode for D3.asInput() and resolves alias for read()', () => {
    const result = transpile(`
      import { D3 } from '@typecad/board-arduino-uno';
      const d3in = D3.asInput();
      const value = d3in.read();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(3, INPUT)');
    expect(result.cpp).toContain('digitalRead(3)');
  });

  it('emits pinMode + digitalWrite for LED.asOutput() and high()', () => {
    const result = transpile(`
      import { LED, HIGH } from '@typecad/board-arduino-uno';
      const led = LED.asOutput();
      led.high();
      led.toggle();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, HIGH)');
  });

  it('no warning when using alias after asOutput()', () => {
    const result = transpile(`
      import { LED } from '@typecad/board-arduino-uno';
      const led = LED.asOutput();
      led.toggle();
    `);

    const warnings = result.diagnostics.filter(
      d => d.code === 'pin-mode-not-set'
    );
    expect(warnings.length).toBe(0);
  });

  it('no warning when using alias after asInput()', () => {
    const result = transpile(`
      import { D2 } from '@typecad/board-arduino-uno';
      const btn = D2.asInput();
      const pressed = btn.read();
    `);

    const warnings = result.diagnostics.filter(
      d => d.code === 'pin-mode-not-set'
    );
    expect(warnings.length).toBe(0);
  });

  it('resolves alias inside while loop', () => {
    const result = transpile(`
      import { LED, delay } from '@typecad/board-arduino-uno';
      const led = LED.asOutput();
      while (true) {
        led.toggle();
        delay(1000);
      }
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    // toggle emits a ternary expression, not !digitalRead
    expect(result.cpp).toContain('digitalRead(13)');
    const warnings = result.diagnostics.filter(
      d => d.code === 'pin-mode-not-set'
    );
    expect(warnings.length).toBe(0);
  });

  it('emits pinMode for D2.asInputPullUp()', () => {
    const result = transpile(`
      import { D2 } from '@typecad/board-arduino-uno';
      const btn = D2.asInputPullUp();
      const pressed = btn.read();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(2, INPUT_PULLUP)');
    expect(result.cpp).toContain('digitalRead(2)');
  });
});
