import { ArduinoStrategy } from '@typecad/framework-arduino';
import type { ProgramIR, PlatformContext, HALOpIR, RuntimePolyfillIR, Diagnostic } from '@typecad/cuttlefish/api/shared';
import { resolveEsp32Profile } from './profile.js';
import { lowerHalOp } from './lowering/index.js';
import { uartInitLines } from './lowering/uart.js';
import { i2cInitLines }  from './lowering/i2c.js';
import { spiInitLines }  from './lowering/spi.js';
import { pwmInitLines }  from './lowering/pwm.js';
import { adcInitLines }  from './lowering/adc.js';
import { dacInitLines }  from './lowering/dac.js';
import { toneInitLines } from './lowering/tone.js';
import { interruptsInitLines } from './lowering/interrupts.js';
import { powerInitLines } from './lowering/power.js';
import { wdtInitLines }   from './lowering/wdt.js';
import { pulseShiftInitLines } from './lowering/pulse-shift.js';

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
    if (a?.usesPWM)         espInit.push(...pwmInitLines());
    if (a?.usesADC)         espInit.push(...adcInitLines());
    if (a?.usesDAC)         espInit.push(...dacInitLines());
    if (a?.usesTone)        espInit.push(...toneInitLines());
    if (a?.usesInterrupts)  espInit.push(...interruptsInitLines());
    if (a?.usesPower)       espInit.push(...powerInitLines());
    if (a?.usesWdt)         espInit.push(...wdtInitLines());
    if (a?.usesPulse || a?.usesShift) espInit.push(...pulseShiftInitLines());

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

  // Route console.log/info → printf, debug/warn/error → ESP_LOG[DWE].
  // Signature matches ArduinoStrategy.transformConsoleCall: renderedArgs is a
  // single pre-rendered string (possibly a `<<` chain), not an array.
  override transformConsoleCall(method: string, renderedArgs: string, forHeader: boolean): string {
    const semi = forHeader ? '' : ';';
    // Strip a wrapping String(...) if present (the parent adds it for Arduino).
    const isBareLiteral = /^"[^"]*"$/.test(renderedArgs.trim());
    const isChain = !isBareLiteral && renderedArgs.includes('<<');
    // For ESP-IDF we use printf/ESP_LOG* which take a format string + args,
    // not a stream chain. Split chains the way Arduino does, then format each
    // part as a separate printf call.
    const tag = '"tc"';
    let prefix = '';
    switch (method) {
      case 'error': prefix = `ESP_LOGE(${tag}, "[ERROR] ")${semi} `; break;
      case 'warn':  prefix = `ESP_LOGW(${tag}, "[WARN] ")${semi} `;  break;
      case 'info':  prefix = `ESP_LOGI(${tag}, "[INFO] ")${semi} `;  break;
      case 'debug': prefix = `ESP_LOGD(${tag}, "[DEBUG] ")${semi} `; break;
      default: break;
    }

    // Choose output fn: ESP_LOG* for warn/error/debug/info, printf for log.
    const usesLogMacro = method === 'error' || method === 'warn' || method === 'debug' || method === 'info';
    const outFn = usesLogMacro
      ? (method === 'error' ? `ESP_LOGE(${tag}` : method === 'warn' ? `ESP_LOGW(${tag}` : method === 'info' ? `ESP_LOGI(${tag}` : `ESP_LOGD(${tag}`)
      : 'printf(';

    // Bare string literal → emit directly as the format string (we assume the
    // caller passed a string literal with no interpolation; non-literal args
    // are emitted as-is which works for %s/%d-compatible expressions).
    if (isChain) {
      // Split "a" << b << c — for v1, just concat by issuing separate calls.
      // (Loses one-line guarantee; v1.1 should build a single format string.)
      const parts = splitStreamChain(renderedArgs);
      const calls = parts.map((p) => {
        const trimmed = p.trim();
        return `${outFn}, ${trimmed})${semi}`;
      });
      return prefix + calls.join(' ');
    }
    return `${prefix}${outFn}, ${renderedArgs})${semi}`;
  }

  // Override cuttlefish_halt to use esp_system_abort (IDF-native fatal) instead
  // of the parent's Serial.println + infinite loop. Inherits the rest of the
  // parent's polyfills (string_methods, timer_methods, async_runtime) unchanged.
  override generateNativePolyfills(program: ProgramIR, ctx?: PlatformContext): RuntimePolyfillIR[] {
    const base = super.generateNativePolyfills(program, ctx);
    return base.map((p) => {
      if (p.id === 'cuttlefish_halt') {
        return {
          ...p,
          domain: 'esp32',
          helperFunctions: [
            `#ifndef cuttlefish_halt
#define cuttlefish_halt(msg) esp_system_abort(msg)
#endif`,
          ],
        };
      }
      return p;
    });
  }

  // Variant-specific sanity checks at transpile time. Catches impossible
  // configs (DAC on C3/C6, input-only pins as OUTPUT) before they reach the
  // linker. Spec §6.
  //
  // Does NOT call super.profileDiagnostics() — the parent's diagnostics walk
  // Arduino-specific IR shape (collectUsedIdentifiers over program.functions
  // with assumptions about FQBN-derived arch). Our checks are independent and
  // operate on the raw program tree + analysis flags.
  override profileDiagnostics(program: ProgramIR, ctx?: PlatformContext): Diagnostic[] {
    const diags: Diagnostic[] = [];
    const chip = resolveEsp32Profile(ctx?.frameworkData?.target as string | undefined);
    const a = (ctx as any)?.analysis ?? {};

    // DAC on a chip without DAC (C3/C6)
    if (a.usesDAC && chip.lacks.includes('dac')) {
      diags.push({
        severity: 'error',
        code: 'esp32-dac-unavailable',
        message: `${chip.id} has no DAC peripheral. DAC output is only available on ESP32 (classic) and ESP32-S3.`,
        source: program.fileName,
      });
    }

    // Walk program IR for OUTPUT-mode pins and check against inputOnly list.
    // (Classic ESP32 pins 34-39 are input-only; cannot be OUTPUT.)
    const outputPins = new Set<number>();
    const visit = (node: any): void => {
      if (node && typeof node === 'object') {
        if (node.operation && typeof node.operation === 'object'
            && node.operation.operation === 'gpio.set_mode'
            && node.operation.mode === 'output') {
          outputPins.add(node.operation.pin);
        }
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (Array.isArray(v)) v.forEach(visit);
          else if (typeof v === 'object' && v !== null) visit(v);
        }
      }
    };
    visit(program);
    for (const pin of outputPins) {
      if (chip.gpio.inputOnly.includes(pin)) {
        diags.push({
          severity: 'error',
          code: 'esp32-input-only-pin-as-output',
          message: `GPIO ${pin} is input-only on ${chip.id} and cannot be configured as OUTPUT.`,
          hint: 'Use a different pin for output, or change the mode to INPUT/INPUT_PULLUP.',
          source: program.fileName,
        });
      }
    }

    return diags;
  }

  // Ambient type declarations appended to the generated cuttlefish-env.d.ts.
  // Fresh ESP-IDF-appropriate set (parent's declares Arduino's Serial/EEPROM-
  // flavored bits which don't apply here). Spec §7.5.
  override ambientTypeDeclarations(): string[] {
    return [
      '',
      '  // framework-esp32 ambient types:',
      '  // - Timing: lowered via __tc_Timing (esp_timer_get_time, vTaskDelay).',
      '  // - WDT: lowered via __tc_WDT (esp_task_wdt_*).',
      '  // - Preferences: TS type retained; runtime lowering deferred to v1.1.',
      '  //   v1 emits a transpile-time diagnostic if Preferences is used.',
      '  // - EEPROM: not lowered (use Preferences / NVS instead).',
      '  const Timing: {',
      '    millis(): number;',
      '    micros(): number;',
      '    delay(ms: number): void;',
      '    delayMicroseconds(us: number): void;',
      '    freeHeap(): number;',
      '  };',
      '',
      '  const WDT: {',
      '    enable(): void;',
      '    reset(): void;',
      '    disable(): void;',
      '  };',
      '',
      '  // Preferences: v1.1 — lowering pending (NVS / nvs_flash.h).',
      '  // const Preferences: { ... };',
      '',
    ];
  }
}

// Minimal `<<`-chain splitter — mirrors the parent's splitStreamChain helper.
// Walks the string respecting double-quoted string literals, splitting on top-
// level `<<` (not inside a string). Returns the parts (may be empty strings).
function splitStreamChain(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === '\\' && i + 1 < s.length) { cur += s[i + 1]; i++; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (depth === 0 && c === '<' && s[i + 1] === '<') {
      parts.push(cur);
      cur = '';
      i++;  // skip second <
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts;
}
