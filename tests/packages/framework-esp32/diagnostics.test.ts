import { describe, it, expect } from 'vitest';
import { Esp32Strategy } from '../../../packages/framework-esp32/src/strategy';

const strategy = new Esp32Strategy();

// The parent's profileDiagnostics walks program.functions[].statements
// (via collectUsedIdentifiers). Provide a minimal valid ProgramIR shape.
function fakeProgram(gpioSetModePins: Array<{ pin: number; mode: string }> = []): any {
  // Embed gpio.set_mode ops inside a function's statements so both the parent's
  // walker and our visit() reach them.
  const statements = gpioSetModePins.map(({ pin, mode }) => ({
    kind: 'hal-op',
    operation: { operation: 'gpio.set_mode', pin, mode },
  }));
  return {
    fileName: 'test.ts',
    functions: [{ name: 'setup', statements, parameters: [] }],
    imports: [],
    typeAliases: [],
  };
}

describe('Esp32Strategy profileDiagnostics', () => {
  it('flags DAC usage on C3 (no DAC peripheral)', () => {
    const ctx = { analysis: { usesDAC: true }, frameworkData: { target: 'esp32c3' } } as any;
    const diags = strategy.profileDiagnostics(fakeProgram(), ctx);
    expect(diags.some((d) => d.code === 'esp32-dac-unavailable' && d.severity === 'error')).toBe(true);
  });

  it('flags DAC usage on C6', () => {
    const ctx = { analysis: { usesDAC: true }, frameworkData: { target: 'esp32c6' } } as any;
    const diags = strategy.profileDiagnostics(fakeProgram(), ctx);
    expect(diags.some((d) => d.code === 'esp32-dac-unavailable')).toBe(true);
  });

  it('does NOT flag DAC usage on classic ESP32', () => {
    const ctx = { analysis: { usesDAC: true }, frameworkData: { target: 'esp32' } } as any;
    const diags = strategy.profileDiagnostics(fakeProgram(), ctx);
    expect(diags.some((d) => d.code === 'esp32-dac-unavailable')).toBe(false);
  });

  it('flags DAC usage on S3 (no DAC peripheral)', () => {
    const ctx = { analysis: { usesDAC: true }, frameworkData: { target: 'esp32s3' } } as any;
    const diags = strategy.profileDiagnostics(fakeProgram(), ctx);
    expect(diags.some((d) => d.code === 'esp32-dac-unavailable')).toBe(true);
  });

  it('flags input-only pin (34) used as OUTPUT on classic ESP32', () => {
    const ctx = { frameworkData: { target: 'esp32' } } as any;
    const diags = strategy.profileDiagnostics(fakeProgram([{ pin: 34, mode: 'output' }]), ctx);
    expect(diags.some((d) => d.code === 'esp32-input-only-pin-as-output' && d.message.includes('34'))).toBe(true);
  });

  it('flags input-only pin 39 used as OUTPUT', () => {
    const ctx = { frameworkData: { target: 'esp32' } } as any;
    const diags = strategy.profileDiagnostics(fakeProgram([{ pin: 39, mode: 'output' }]), ctx);
    expect(diags.some((d) => d.code === 'esp32-input-only-pin-as-output')).toBe(true);
  });

  it('does NOT flag a normal output-capable pin', () => {
    const ctx = { frameworkData: { target: 'esp32' } } as any;
    const diags = strategy.profileDiagnostics(fakeProgram([{ pin: 2, mode: 'output' }]), ctx);
    expect(diags.some((d) => d.code === 'esp32-input-only-pin-as-output')).toBe(false);
  });

  it('does NOT flag input-only pin used as INPUT', () => {
    const ctx = { frameworkData: { target: 'esp32' } } as any;
    const diags = strategy.profileDiagnostics(fakeProgram([{ pin: 34, mode: 'input' }]), ctx);
    expect(diags.some((d) => d.code === 'esp32-input-only-pin-as-output')).toBe(false);
  });

  it('includes a hint for input-only pin errors', () => {
    const ctx = { frameworkData: { target: 'esp32' } } as any;
    const diags = strategy.profileDiagnostics(fakeProgram([{ pin: 34, mode: 'output' }]), ctx);
    const diag = diags.find((d) => d.code === 'esp32-input-only-pin-as-output');
    expect(diag?.hint).toBeDefined();
    expect(diag?.hint).toMatch(/INPUT_PULLUP|different pin/i);
  });

  it('does NOT warn about tone (lowered on LEDC_TIMER_1, no longer a stub)', () => {
    const ctx = { analysis: { usesTone: true }, frameworkData: { target: 'esp32' } } as any;
    const diags = strategy.profileDiagnostics(fakeProgram(), ctx);
    expect(diags.some((d) => d.code === 'esp32-tone-stub')).toBe(false);
  });

  it('warns when a strapping pin is used as OUTPUT', () => {
    const ctx = { frameworkData: { target: 'esp32' } } as any;
    const diags = strategy.profileDiagnostics(fakeProgram([{ pin: 0, mode: 'output' }]), ctx);
    expect(diags.some((d) => d.code === 'esp32-strapping-pin' && d.message.includes('0'))).toBe(true);
  });
});

