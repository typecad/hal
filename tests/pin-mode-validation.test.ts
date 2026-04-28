import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Pin Mode Configuration Validation', () => {
  it('generates warning when read() called without mode set', () => {
    const result = transpile(`
      import { D4 } from '@typehal/board-arduino-uno';
      const value = D4.read();
    `);

    const warnings = result.diagnostics.filter(
      d => d.code === 'pin-mode-not-set'
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].message).toContain('D4');
    expect(warnings[0].severity).toBe('warning');
  });

  it('generates info when high() called without mode set', () => {
    const result = transpile(`
      import { D4 } from '@typehal/board-arduino-uno';
      D4.high();
    `);

    const infos = result.diagnostics.filter(
      d => d.code === 'pin-mode-not-set'
    );
    expect(infos.length).toBeGreaterThan(0);
    expect(infos[0].severity).toBe('info');
  });

  it('does not generate warning when mode is set before read', () => {
    const result = transpile(`
      import { D4 } from '@typehal/board-arduino-uno';
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
      import { LED } from '@typehal/board-arduino-uno';
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
      import { D4 } from '@typehal/board-arduino-uno';
      const out = D4.asOutput();
      out.high();
    `);

    const warnings = result.diagnostics.filter(
      d => d.code === 'pin-mode-not-set'
    );
    expect(warnings.length).toBe(0);
  });

  it('generates warning for isHigh() without mode set', () => {
    const result = transpile(`
      import { D2 } from '@typehal/board-arduino-uno';
      const pressed = D2.isHigh();
    `);

    const warnings = result.diagnostics.filter(
      d => d.code === 'pin-mode-not-set'
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].severity).toBe('warning');
  });

  it('generates info for toggle() without mode set', () => {
    const result = transpile(`
      import { LED } from '@typehal/board-arduino-uno';
      LED.toggle();
    `);

    const infos = result.diagnostics.filter(
      d => d.code === 'pin-mode-not-set'
    );
    expect(infos.length).toBeGreaterThan(0);
    expect(infos[0].severity).toBe('info');
  });

  it('does not generate warning for non-pin receivers', () => {
    const result = transpile(`
      import { UART0 } from '@typehal/board-arduino-uno';
      const serial = UART0.begin(9600);
    `);

    const warnings = result.diagnostics.filter(
      d => d.code === 'pin-mode-not-set'
    );
    expect(warnings.length).toBe(0);
  });

  it('generates info for toggle() inside while loop without mode set', () => {
    const result = transpile(`
      import { LED } from '@typehal/board-arduino-uno';
      while (true) {
        LED.toggle();
      }
    `);

    const infos = result.diagnostics.filter(
      d => d.code === 'pin-mode-not-set'
    );
    expect(infos.length).toBeGreaterThan(0);
    expect(infos[0].severity).toBe('info');
  });

  it('generates warning for read() inside template literal without mode set', () => {
    const result = transpile(`
      import { D3, UART0 } from '@typehal/board-arduino-uno';
      const uart = UART0.begin(9600);
      uart.println(\`d3: \${D3.read()}\`);
    `);

    const warnings = result.diagnostics.filter(
      d => d.code === 'pin-mode-not-set'
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].severity).toBe('warning');
  });

  // ── Object-creation pattern (asOutput/asInput) ──────────────────────

  it('emits pinMode for LED.asOutput()', () => {
    const result = transpile(`
      import { LED } from '@typehal/board-arduino-uno';
      const led = LED.asOutput();
      led.toggle();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, !digitalRead(13))');
    // Should NOT emit a C++ variable declaration for 'led'
    expect(result.cpp).not.toMatch(/\bauto\s+led\b/);
  });

  it('emits pinMode for D3.asInput() and resolves alias for read()', () => {
    const result = transpile(`
      import { D3 } from '@typehal/board-arduino-uno';
      const d3in = D3.asInput();
      const value = d3in.read();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(3, INPUT)');
    expect(result.cpp).toContain('digitalRead(3)');
  });

  it('emits pinMode + digitalWrite for LED.asOutput(HIGH)', () => {
    const result = transpile(`
      import { LED, HIGH } from '@typehal/board-arduino-uno';
      const led = LED.asOutput(HIGH);
      led.toggle();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, HIGH)');
  });

  it('no warning when using alias after asOutput()', () => {
    const result = transpile(`
      import { LED } from '@typehal/board-arduino-uno';
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
      import { D2 } from '@typehal/board-arduino-uno';
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
      import { LED, delay } from '@typehal/board-arduino-uno';
      const led = LED.asOutput();
      while (true) {
        led.toggle();
        delay(1000);
      }
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, !digitalRead(13))');
    const warnings = result.diagnostics.filter(
      d => d.code === 'pin-mode-not-set'
    );
    expect(warnings.length).toBe(0);
  });

  it('emits pinMode for D2.asInputPullUp()', () => {
    const result = transpile(`
      import { D2 } from '@typehal/board-arduino-uno';
      const btn = D2.asInputPullUp();
      const pressed = btn.read();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(2, INPUT_PULLUP)');
    expect(result.cpp).toContain('digitalRead(2)');
  });
});
