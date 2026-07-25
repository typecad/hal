import { describe, it, expect } from 'vitest';
import { Esp32Strategy } from '../../../packages/framework-esp32/src/strategy';

const strategy = new Esp32Strategy();

// The parent's profileDiagnostics walks program.functions[].statements
// (via collectUsedIdentifiers). Provide a minimal valid ProgramIR shape.
function fakeProgram(gpioSetModePins: Array<{ pin: number; mode: string }> = [], adcReadPins: number[] = []): any {
  // Embed gpio.set_mode + adc.read ops inside a function's statements so both
  // the parent's walker and our visit() reach them.
  const statements: any[] = [
    ...gpioSetModePins.map(({ pin, mode }) => ({
      kind: 'hal-op',
      operation: { operation: 'gpio.set_mode', pin, mode },
    })),
    ...adcReadPins.map((pin) => ({
      kind: 'hal-op',
      operation: { operation: 'adc.read', pin },
    })),
  ];
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

  it('flags EEPROM usage (not available on ESP-IDF) pointing to Preferences/NVS', () => {
    const ctx = { analysis: { usesEEPROM: true }, frameworkData: { target: 'esp32s3' } } as any;
    const diags = strategy.profileDiagnostics(fakeProgram(), ctx);
    const eeprom = diags.find((d) => d.code === 'esp32-eeprom-unavailable');
    expect(eeprom).toBeDefined();
    expect(eeprom!.severity).toBe('error');
    // The hint must steer users toward the lowered alternative.
    expect(eeprom!.hint).toMatch(/Preferences/i);
  });

  it('does NOT flag EEPROM when unused', () => {
    const ctx = { analysis: { usesEEPROM: false }, frameworkData: { target: 'esp32s3' } } as any;
    const diags = strategy.profileDiagnostics(fakeProgram(), ctx);
    expect(diags.some((d) => d.code === 'esp32-eeprom-unavailable')).toBe(false);
  });

  it('flags ADC2 pin read + WiFi (ADC2 conflicts with the WiFi radio)', () => {
    // GPIO4 is ADC2_CH0 on classic ESP32; WiFi is used → conflict.
    const ctx = { analysis: { usesWifi: true }, frameworkData: { target: 'esp32' } } as any;
    const diags = strategy.profileDiagnostics(fakeProgram([], [4]), ctx);
    const adc2 = diags.find((d) => d.code === 'esp32-adc2-wifi-conflict');
    expect(adc2).toBeDefined();
    expect(adc2!.severity).toBe('warning');
    // Hint must steer toward ADC1 pins (GPIO32-39 on classic ESP32).
    expect(adc2!.hint).toMatch(/ADC1/);
    expect(adc2!.hint).toMatch(/32/);
  });

  it('does NOT flag ADC1 pin read + WiFi (ADC1 is WiFi-safe)', () => {
    // GPIO32 is ADC1_CH4 on classic ESP32; WiFi is used but ADC1 is fine.
    const ctx = { analysis: { usesWifi: true }, frameworkData: { target: 'esp32' } } as any;
    const diags = strategy.profileDiagnostics(fakeProgram([], [32]), ctx);
    expect(diags.some((d) => d.code === 'esp32-adc2-wifi-conflict')).toBe(false);
  });

  it('does NOT flag ADC2 pin read when WiFi is unused', () => {
    // GPIO4 is ADC2, but no WiFi → no conflict (ADC2 works without WiFi).
    const ctx = { analysis: { usesWifi: false }, frameworkData: { target: 'esp32' } } as any;
    const diags = strategy.profileDiagnostics(fakeProgram([], [4]), ctx);
    expect(diags.some((d) => d.code === 'esp32-adc2-wifi-conflict')).toBe(false);
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

  // deep-sleep pin wakeup only works on RTC GPIO. ext0/ext1 (ESP32/S3) and the
  // gpio_wakeup variant (C3/C6) are both restricted to RTC-capable pins in deep
  // sleep, so a non-RTC pin must be flagged at compile time rather than failing
  // silently at runtime.
  function fakeProgramWithWakeupPin(pin: number): any {
    return {
      fileName: 'test.ts',
      functions: [{
        name: 'setup',
        statements: [{ kind: 'hal-op', operation: { operation: 'power.deep_sleep_pin', pin, level: 0 } }],
        parameters: [],
      }],
      imports: [],
      typeAliases: [],
    };
  }

  it('flags a non-RTC pin used for deep-sleep wakeup', () => {
    const ctx = { frameworkData: { target: 'esp32' } } as any;
    // GPIO 2 is not in ESP32's rtcOnly set ([32,33,34,35,36,37,38,39]).
    const diags = strategy.profileDiagnostics(fakeProgramWithWakeupPin(2), ctx);
    expect(diags.some((d) => d.code === 'esp32-wakeup-pin-not-rtc' && d.severity === 'error')).toBe(true);
  });

  it('does NOT flag an RTC pin used for deep-sleep wakeup', () => {
    const ctx = { frameworkData: { target: 'esp32' } } as any;
    // GPIO 33 is RTC-capable on classic ESP32.
    const diags = strategy.profileDiagnostics(fakeProgramWithWakeupPin(33), ctx);
    expect(diags.some((d) => d.code === 'esp32-wakeup-pin-not-rtc')).toBe(false);
  });
});

