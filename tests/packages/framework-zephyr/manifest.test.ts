import { describe, expect, it } from 'vitest';
import { validateFrameworkWithCoverage } from '../cuttlefish/manifest-test-helpers.js';

// Zephyr: GPIO/PWM/ADC/I2C/SPI/UART/interrupts/tone/power/pulse/shift/WDT/BLE
// + timing are lowered; WiFi/HTTP/display/board unsupported. Zero strategic
// errors are tolerated; any error is a regression.
describe('framework-zephyr manifest', () => {
  it('matches its implementation with zero errors', async () => {
    const { result, coverageTable } = await validateFrameworkWithCoverage('@typecad/framework-zephyr');
    console.log(coverageTable);
    const dump = result.errors.map((e) => `[${e.code}] ${e.message}`).join('\n');
    expect(result.errors, dump).toEqual([]);
  });
});
