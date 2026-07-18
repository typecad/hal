import { ArduinoStrategy } from '@typecad/framework-arduino';
import type { ProgramIR, PlatformContext, HALOpIR } from '@typecad/cuttlefish/api/shared';
import { resolveEsp32Profile } from './profile.js';
import { lowerHalOp } from './lowering/index.js';
import { uartInitLines } from './lowering/uart.js';
import { i2cInitLines }  from './lowering/i2c.js';
import { spiInitLines }  from './lowering/spi.js';

const ARDUINO_UMBRELLA_HEADERS: ReadonlySet<string> = new Set([
  '<Arduino.h>',
  '<Wire.h>',
  '<SPI.h>',
  '<EEPROM.h>',
  '<Preferences.h>',
  '<HardwareSerial.h>',
]);

/**
 * Esp32Strategy — lowers TypeCAD HAL operation IR to native ESP-IDF driver
 * API calls. Subclasses ArduinoStrategy (mirroring NativeAVRStrategy on AVR)
 * and overrides only ESP32-specific emit behavior. The Toolchain export
 * (src/toolchain/index.ts) replaces the parent's arduino-cli toolchain
 * entirely with native idf.py.
 *
 * `id` stays as the inherited literal "arduino" — TypeScript variance rules
 * forbid re-declaring a readonly literal-narrowed property with a different
 * value in a subclass. The distinct identity of framework-esp32 is carried
 * by the package name (selected via the user's `framework` config field),
 * not by strategy.id. Same tradeoff framework-avr makes.
 *
 * See docs/superpowers/specs/2026-07-18-framework-esp32-design.md.
 */
export class Esp32Strategy extends ArduinoStrategy {
  // Deliberately no `override readonly id` — the parent narrows id to the
  // literal "arduino", and TS won't allow any redeclaration. The inherited
  // value is fine; consumers select frameworks by package name, not strategy id.

  override forcedIncludes(program: ProgramIR, ctx?: PlatformContext): string[] {
    resolveEsp32Profile(ctx?.frameworkData?.target as string | undefined);
    const a = (ctx as any)?.analysis;
    const uses = (f: string): boolean => (a ? !!a[f] : true);  // defensive default true

    const inc: string[] = [
      '<stdio.h>',
      '<string.h>',
      '"freertos/FreeRTOS.h"',
      '"freertos/task.h"',
      '"esp_log.h"',
      '"esp_system.h"',
      '"esp_timer.h"',
    ];
    if (uses('usesGPIO'))         inc.push('"driver/gpio.h"');
    if (uses('usesI2C'))          inc.push('"driver/i2c_master.h"');
    if (uses('usesSPI'))          inc.push('"driver/spi_master.h"');
    if (uses('usesUART'))         inc.push('"driver/uart.h"');
    if (uses('usesPWM'))          inc.push('"driver/ledc.h"');
    if (uses('usesADC'))          inc.push('"driver/adc.h"', '"driver/adc_oneshot.h"', '"esp_adc_cal.h"');
    if (uses('usesDAC'))          inc.push('"driver/dac.h"');
    if (uses('usesPower'))        inc.push('"esp_sleep.h"');
    if (uses('usesWdt'))          inc.push('"esp_task_wdt.h"');
    if (uses('usesInterrupts'))   inc.push('"esp_intr_alloc.h"');
    return inc;
  }

  // Note: no `override` — ArduinoStrategy does not declare filterRequiredIncludes
  // (it's optional on PlatformProfileStrategy). This is a fresh implementation.
  filterRequiredIncludes(includes: string[]): string[] {
    return includes.filter((h) => !ARDUINO_UMBRELLA_HEADERS.has(h));
  }

  override shimLines(program: ProgramIR, ctx?: PlatformContext): string[] {
    resolveEsp32Profile(ctx?.frameworkData?.target as string | undefined);
    const a = (ctx as any)?.analysis;
    const espInit: string[] = [];
    // Emit IDF driver init blocks for each peripheral the program actually uses.
    // Each block is bracketed with CUTTLEFISH_*_BEGIN/END so setup.ts can strip
    // the unused ones as a defensive backstop (matches framework-avr's pattern).
    if (a?.usesUART) espInit.push(...uartInitLines(0));
    if (a?.usesI2C)  espInit.push(...i2cInitLines(0));
    if (a?.usesSPI)  espInit.push(...spiInitLines(0));

    return [
      ...espInit,
      '// --- ESP32 IDF entrypoint: app_main + __tc_app_task ---',
      '// The cuttlefish synthesizer emits setup() and loop() (it keys off',
      '// entrypointFunctionName()="setup" and requiresLoopFunction()=true).',
      '// This trampoline spawns a FreeRTOS task that runs them, matching',
      '// Arduino\'s default task config (8192 stack, priority 1, tskNO_AFFINITY).',
      'extern void setup(void);',
      'extern void loop(void);',
      '',
      'static void __tc_app_task(void *arg) {',
      '    (void)arg;',
      '    setup();',
      '    for (;;) {',
      '        loop();',
      '    }',
      '}',
      '',
      'extern "C" void app_main(void) {',
      '    xTaskCreate(__tc_app_task, "tc_app", 8192, NULL, 1, NULL);',
      '}',
      '',
    ];
  }

  // Resolve a HAL op to native ESP-IDF C++. Delegates to lowerHalOp, which
  // dispatches by op.operation prefix and THROWS on unknown ops (no silent
  // fallback to Arduino lowering — that would defeat this framework's purpose).
  override resolveHALOperation(op: HALOpIR): { code?: string; expression?: string } | undefined {
    return lowerHalOp(op);
  }
}
