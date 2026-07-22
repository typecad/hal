import { ArduinoStrategy, splitStreamChain } from '@typecad/framework-arduino';
import type { ProgramIR, PlatformContext, HALOpIR, RuntimePolyfillIR, Diagnostic, DisplayHALOp, ResolvedDisplay, DisplayAdapterCode } from '@typecad/cuttlefish/api/shared';
import { resolveNativeDisplayOp } from '@typecad/cuttlefish/api/shared';
import { esp32Ili9341Adapter, esp32St7796Adapter, esp32Ssd1309Adapter } from './displays/index.js';
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
import { pulseShiftInitLines, pulseInitLines, shiftInitLines } from './lowering/pulse-shift.js';
import { wifiInitLines } from './lowering/wifi.js';
import { httpInitLines } from './lowering/http.js';

/** Read the IDF target ('esp32'|'esp32s3'|'esp32c3'|'esp32c6') from the
 *  platform context. Accepts either frameworkData.target (preferred) or
 *  frameworkData.buildTarget (what the cuttlefish CLI populates from the
 *  config's frameworkData.buildTarget field — see cli.ts:462). */
function targetFromContext(ctx?: PlatformContext): string | undefined {
  const fd = ctx?.frameworkData as Record<string, unknown> | undefined;
  return (fd?.target as string | undefined) ?? (fd?.buildTarget as string | undefined);
}

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
 */
export class Esp32Strategy extends ArduinoStrategy {
  // Deliberately no `override readonly id` — the parent narrows id to the
  // literal "arduino", and TS won't allow any redeclaration. The inherited
  // value is fine; consumers select frameworks by package name, not strategy id.

  // ── File-shape overrides (ESP-IDF project, not Arduino sketch) ─────────────
  override sourceExtension(isEntryFile: boolean, isNpmPackage: boolean): string {
    if (isNpmPackage) return 'cpp';
    if (isEntryFile) return 'cc';
    return 'h';
  }

  // ESP-IDF uses FreeRTOS — delay() yields; suppress blocking-delay-in-loop.
  isRtosTarget(): boolean {
    return true;
  }

  // No Arduino millis() in ESP-IDF; esp_timer.h is always included.
  override currentTimeMillis(): string {
    return '(unsigned long)(esp_timer_get_time() / 1000)';
  }

  override needsIostream(): boolean {
    return true;
  }

  override setupInitCode(_program: ProgramIR, _ctx?: PlatformContext): string[] {
    return [];
  }

  override symbolAliases(_program: ProgramIR, _ctx?: PlatformContext): Record<string, string> {
    return {};
  }

  // ESP-IDF has no Serial/Wire/SPI Arduino objects. Don't map peripheral
  // identifiers — HAL ops handle all peripheral access directly.
  override mapPeripheralIdentifier(_name: string): string | undefined {
    return undefined;
  }

  // Don't return AVR-specific pin types. ESP32 uses generic int for pins.
  override resolvePinType(_objectName: string, _fieldName: string): string | undefined {
    return undefined;
  }

  /** All ESP32 variants need IRAM_ATTR on ISR handlers (parent keys off FQBN arch). */
  override isrFunctionAttribute(): string {
    return 'IRAM_ATTR ';
  }

  override overrideBaseName(_originalBaseName: string, _outDirBaseName: string, isEntryFile: boolean, _isNpmPackage: boolean): string {
    return isEntryFile ? 'main' : _originalBaseName;
  }

  override generateHeaderFile(): boolean {
    return true;
  }

  override outputSubdirectory(_baseName: string): string {
    return 'main';
  }

  override forcedIncludes(program: ProgramIR, ctx?: PlatformContext): string[] {
    resolveEsp32Profile(targetFromContext(ctx));
    const a = (ctx as any)?.analysis;
    const uses = (f: string): boolean => (a ? !!a[f] : true);

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
    if (uses('usesUart'))         inc.push('"driver/uart.h"');
    if (uses('usesPWM'))          inc.push('"driver/ledc.h"');
    if (uses('usesADC'))          inc.push('"driver/adc.h"', '"driver/adc_oneshot.h"', '"esp_adc_cal.h"');
    if (uses('usesDAC'))          inc.push('"driver/dac.h"');
    if (uses('usesPower'))        inc.push('"esp_sleep.h"', '"soc/rtc.h"');
    if (uses('usesWdt'))          inc.push('"esp_task_wdt.h"');
    if (uses('usesInterrupts'))   inc.push('"esp_intr_alloc.h"');
    if (uses('usesWifi')) {
      inc.push(
        '"esp_wifi.h"',
        '"esp_netif.h"',
        '"esp_event.h"',
        '"esp_mac.h"',
        '"nvs_flash.h"',
        '"nvs.h"',
        // esp_private/esp_task_wdt.h for esp_task_wdt_stop()/restart() around
        // the blocking WiFi wait loops. The user's app task is not WDT-
        // subscribed (only the IDLE tasks are), so esp_task_wdt_reset() is a
        // no-op for us — we have to pause the timer itself while the app task
        // blocks for up to 15 s on a connect. Without this, CPU0's IDLE task
        // can be starved by the prio-23 WiFi task during radio bring-up and
        // trip the WDT. Note: stop/restart live in the *private* header, not
        // the public esp_task_wdt.h (which only exposes reset/add/status).
        '"esp_private/esp_task_wdt.h"',
      );
    }
    if (uses('usesHttp')) {
      inc.push('"esp_http_client.h"', '"esp_crt_bundle.h"', '<stdlib.h>');
    }
    return inc;
  }

  filterRequiredIncludes(includes: string[]): string[] {
    return includes.filter((h) => !ARDUINO_UMBRELLA_HEADERS.has(h));
  }

  override shimLines(program: ProgramIR, ctx?: PlatformContext): string[] {
    resolveEsp32Profile(targetFromContext(ctx));
    const a = (ctx as any)?.analysis;
    const espInit: string[] = [];
    if (a?.usesUart) espInit.push(...uartInitLines(0));
    if (a?.usesI2C)  espInit.push(...i2cInitLines(0));
    if (a?.usesSPI)  espInit.push(...spiInitLines(0));
    if (a?.usesPWM)         espInit.push(...pwmInitLines());
    if (a?.usesADC)         espInit.push(...adcInitLines());
    if (a?.usesDAC)         espInit.push(...dacInitLines());
    if (a?.usesTone)        espInit.push(...toneInitLines());
    if (a?.usesInterrupts)  espInit.push(...interruptsInitLines());
    if (a?.usesPower)       espInit.push(...powerInitLines());
    if (a?.usesWdt)         espInit.push(...wdtInitLines());
    if (a?.usesPulse) espInit.push(...pulseInitLines());
    if (a?.usesShift) espInit.push(...shiftInitLines());
    if (a?.usesWifi)  espInit.push(...wifiInitLines());
    if (a?.usesHttp)  espInit.push(...httpInitLines());

    // After timer_methods polyfill (emitted before shimLines): hook delay() so
    // setInterval fires inside setup()'s blocking while+delay loops.
    // Prefer usedPolyfillHelpers — HAL setInterval lowers via rawCpp and may
    // not increment timerCallCount.
    const timerCoop: string[] = [];
    const usesTimerPolyfill =
      (a?.timerCallCount ?? 0) > 0 ||
      a?.usedPolyfillHelpers?.has?.('__tc_setInterval') ||
      a?.usedPolyfillHelpers?.has?.('__tc_setTimeout');
    if (usesTimerPolyfill) {
      timerCoop.push(
        'static void __tc_timer_coop_poll(void) { __tc_timer_runtime.run(); }',
        'struct __tc_TimerCoopInit {',
        '    __tc_TimerCoopInit() { __tc_coop_poll_hook = &__tc_timer_coop_poll; }',
        '};',
        'static __tc_TimerCoopInit __tc_timer_coop_init;',
        '',
      );
    }

    return [
      // __tc_str_ptr string helpers — Esp32Strategy inherits the parent's
      // `std::string` → `__tc_str_ptr` type normalization, so it must also
      // emit the struct definition. setup.ts strips the block when the
      // program analysis reports !usesStrPtr.
      ...this.strPtrShimLines(),
      // Cooperative delay for setInterval/setTimeout. Top-level `while (true)
      // { ...; delay(ms); }` lives in setup() and never returns to loop(),
      // where __tc_timer_runtime.run() is normally pumped. When timers are
      // used, __tc_TimerCoopInit (below) registers the poll hook.
      'static void (*__tc_coop_poll_hook)(void) = NULL;',
      'static inline void __tc_delay(uint32_t ms) {',
      '    if (__tc_coop_poll_hook == NULL) {',
      '        vTaskDelay(pdMS_TO_TICKS(ms == 0 ? 1 : ms));',
      '        return;',
      '    }',
      '    int64_t deadline = esp_timer_get_time() + (int64_t)ms * 1000;',
      '    do {',
      '        __tc_coop_poll_hook();',
      '        vTaskDelay(1);',
      '    } while (esp_timer_get_time() < deadline);',
      '}',
      '',
      ...espInit,
      ...timerCoop,
      '// --- ESP32 IDF entrypoint: app_main runs setup()/loop() directly ---',
      '// The cuttlefish synthesizer emits setup() and loop() (it keys off',
      '// entrypointFunctionName()="setup" and requiresLoopFunction()=true).',
      '//',
      '// Following the IDF-idiomatic pattern (see esp_http_client example:',      '// app_main blocks on example_connect() directly), app_main itself runs',
      '// setup() and the loop() forever. setup() typically blocks on WiFi',
      '// connect — exactly what main_task is designed for. Spawning a separate',
      '// task to host setup/loop was non-idiomatic and caused watchdog resets',
      '// under WiFi load: main_task sat idle while our prio-1 spawned task',
      '// competed with the prio-23 WiFi task for CPU0.',
      '//',
      '// Stack: CONFIG_ESP_MAIN_TASK_STACK_SIZE=16384 (set in sdkconfig.defaults)',
      '// — the IDF default of 3584 overflows on WiFi/HTTP paths (esp_wifi_connect,',
      '// TLS handshake, printf with response bodies).',
      'extern void setup(void);',
      'extern void loop(void);',
      '',
      'extern "C" void app_main(void) {',
      '    setup();',
      '    for (;;) {',
      '        loop();',
      '        // Yield to the IDLE task so the task watchdog does not fire when',
      '        // loop() is empty or runs without blocking. Costs ~1 ms/iteration.',
      '        vTaskDelay(1);',
      '    }',
      '}',
      '',
    ];
  }

  override resolveHALOperation(op: HALOpIR): { code?: string; expression?: string } | undefined {
    return lowerHalOp(op);
  }

  /**
   * Display HAL ops on ESP32 go through the adapter path (providesDisplayAdapter
   * → resolveDisplayAdapter → CuttlefishGFX + native spi_device_polling_transmit
   * / i2c_master_transmit primitives), but user code that emits display.* HAL
   * ops still needs to lower to calls into the adapter surface (display_init /
   * display_targetFillRect / etc.). The shared resolveNativeDisplayOp does
   * that lowering — the surface is identical across native adapters.
   *
   * Replacing ArduinoStrategy.resolveDisplayOp fixes the latent inheritance
   * bug where display.init lowered via __tc_display (a non-existent Adafruit
   * object on ESP-IDF).
   */
  override resolveDisplayOp(op: DisplayHALOp): { code?: string; expression?: string } | undefined {
    return resolveNativeDisplayOp(op);
  }

  override providesDisplayAdapter(): boolean { return true; }

  override resolveDisplayAdapter(display: ResolvedDisplay): DisplayAdapterCode | undefined {
    switch (display.driver) {
      case "ili9341": return esp32Ili9341Adapter(display);
      case "st7796":  return esp32St7796Adapter(display);
      case "ssd1309": return esp32Ssd1309Adapter(display);
      case "ssd1680":
        // E-ink is intentionally not supported: the LUT-driven refresh cycle
        // + busy-pin handling adds significant complexity for a panel class
        // that's a marginal fit for the SPI TFT-focused runtime. Throw a
        // clear compile-time error instead of falling through to Adafruit.
        throw new Error(
          `display driver "ssd1680" (e-ink) is not supported on ESP32: ` +
          `the LUT-driven refresh cycle and busy-pin handling are out of scope ` +
          `for the native display layer. Use the Adafruit path (framework-arduino) ` +
          `for SSD1680 panels.`,
        );
      default: return undefined;  // defer to built-in Adafruit registry
    }
  }

  // Route console.log/info → printf, debug → printf without \n, warn/error → ESP_LOG*.
  override transformConsoleCall(method: string, renderedArgs: string, forHeader: boolean): string {
    const semi = forHeader ? '' : ';';
    const isBareLiteral = /^"[^"]*"$/.test(renderedArgs.trim());
    const isChain = !isBareLiteral && renderedArgs.includes('<<');
    const tag = '"tc"';
    const usesLogMacro = method === 'error' || method === 'warn';
    const levelTag = method === 'error' ? '[ERROR] ' : method === 'warn' ? '[WARN] ' : '';

    if (isChain) {
      const parts = splitStreamChain(renderedArgs);
      const calls = parts.map((p, i) => {
        const trimmed = p.trim();
        if (usesLogMacro) {
          const macroFn = method === 'error' ? `ESP_LOGE(${tag}` : `ESP_LOGW(${tag}`;
          const prefix = i === 0 ? levelTag : '';
          if (/^".*"$/.test(trimmed)) {
            const inner = trimmed.slice(1, -1);
            return `${macroFn}, "${prefix}${inner}")${semi}`;
          }
          return `${macroFn}, "${prefix}%s", ${trimmed})${semi}`;
        }
        return `printf(${trimmed})${semi}`;
      });
      return calls.join(' ');
    }

    if (usesLogMacro) {
      const macroFn = method === 'error' ? `ESP_LOGE(${tag}` : `ESP_LOGW(${tag}`;
      const trimmed = renderedArgs.trim();
      if (/^".*"$/.test(trimmed)) {
        const inner = trimmed.slice(1, -1);
        return `${macroFn}, "${levelTag}${inner}")${semi}`;
      }
      return `${macroFn}, "${levelTag}%s", ${renderedArgs})${semi}`;
    }

    const appendNewline = method !== 'debug';
    const trimmed = renderedArgs.trim();
    if (/^".*"$/.test(trimmed)) {
      const inner = trimmed.slice(1, -1);
      return `printf("${inner}${appendNewline ? '\\n' : ''}")${semi}`;
    }
    // Known string arguments need %s, not %g: const char*-returning runtime
    // shims (wifi/http) and template-literal snprintf buffers (__cuttlefish_str_N).
    if (/^__tc_(wifi_(local_ip|mac|ap_ip|scan_ssid)|http_(body|response_header))\s*\(/.test(trimmed)
        || /^__cuttlefish_str_\d+$/.test(trimmed)) {
      return `printf("%s${appendNewline ? '\\n' : ''}", ${renderedArgs})${semi}`;
    }
    // int/bool-returning wifi/http shims need %d (%g with an int is UB).
    if (/^__tc_(wifi_(rssi|scan(_count|_rssi|_channel|_encryption)?|ap_client_count|is_connected|connect|connect_saved|ap_start)|http_(status|ok|done|send))\s*\(/.test(trimmed)) {
      return `printf("%d${appendNewline ? '\\n' : ''}", ${renderedArgs})${semi}`;
    }
    // long-returning content-length shim.
    if (/^__tc_http_content_length\s*\(/.test(trimmed)) {
      return `printf("%ld${appendNewline ? '\\n' : ''}", ${renderedArgs})${semi}`;
    }
    return `printf("%g${appendNewline ? '\\n' : ''}", ${renderedArgs})${semi}`;
  }

  override generateNativePolyfills(program: ProgramIR, ctx?: PlatformContext): RuntimePolyfillIR[] {
    const base = super.generateNativePolyfills(program, ctx);
    const mapped = base.map((p) => {
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
      // Shared Promise runtime (from framework-arduino) calls Arduino millis() /
      // digitalRead / HIGH / LOW / RISING. Provide IDF-backed stand-ins so the
      // same polyfill compiles under ESP-IDF. Keep waitForPinEdge — it works
      // once these symbols exist.
      if (p.id === 'async_runtime') {
        return {
          ...p,
          domain: 'esp32',
          requiredIncludes: [
            ...p.requiredIncludes,
            '"esp_timer.h"',
            '"driver/gpio.h"',
          ],
        };
      }
      return p;
    });

    if (mapped.some((p) => p.id === 'async_runtime' || p.id === 'timer_methods')) {
      // Must precede async_runtime / timer_methods so millis() exists before
      // Promise helpers and __tc_TimerRuntime that call it. timer_methods alone
      // (setInterval without async/await) previously omitted this shim and
      // failed with "'millis' was not declared in this scope".
      mapped.unshift({
        kind: 'polyfill',
        id: 'esp32_arduino_compat',
        domain: 'esp32',
        requiredIncludes: ['"esp_timer.h"', '"driver/gpio.h"'],
        forwardDeclarations: [],
        helperStructs: [],
        helperFunctions: [
          `// Arduino-compat symbols for shared polyfills (ESP-IDF).
// Suppress multichar warnings: the runtime header's touch-keyboard code
// uses multi-character constants like 'OK' and 'ABC' as int-sized key
// labels (GCC extension). -Werror=multichar would flag these.
#pragma GCC diagnostic ignored "-Wmultichar"
// Suppress missing-field-initializers: the runtime header's static tables
// (UITransition, UINode, etc.) use designated initializers that don't name
// every field. C++ (unlike C) warns on this under -Werror.
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"
#ifndef HIGH
#define HIGH 1
#endif
#ifndef LOW
#define LOW 0
#endif
#ifndef RISING
#define RISING 0x01
#endif
#ifndef FALLING
#define FALLING 0x02
#endif
static inline unsigned long millis() {
    return (unsigned long)(esp_timer_get_time() / 1000);
}
static inline int digitalRead(int pin) {
    return (int)gpio_get_level((gpio_num_t)pin);
}
// Arduino core math helpers — referenced by runtime header code (touch
// keyboard's range-clamping in touch-keyboard-fwd.ts). On Arduino these are
// macros in Arduino.h; ESP-IDF has no equivalent so we define them as macros
// here (matching Arduino's exact shape, so type deduction matches call sites
// like constrain(int16_t, int, int)).
#ifndef constrain
#define constrain(amt, low, high) ((amt) < (low) ? (low) : ((amt) > (high) ? (high) : (amt)))
#endif
#ifndef map
#define map(x, in_min, in_max, out_min, out_max) ((x) - (in_min)) * ((out_max) - (out_min)) / ((in_max) - (in_min)) + (out_min)
#endif
// PROGMEM + pgm_read_* — AVR flash-memory macros. On ESP32 all memory is
// uniform (no Harvard architecture), so PROGMEM is a no-op and pgm_read
// is a simple dereference. Font tables emitted by the runtime header use
// these (e.g. __ui_font_N_alpha[] PROGMEM).
#ifndef PROGMEM
#define PROGMEM
#endif
#ifndef pgm_read_byte
#define pgm_read_byte(addr) (*(const uint8_t*)(addr))
#endif
#ifndef pgm_read_word
#define pgm_read_word(addr) (*(const uint16_t*)(addr))
#endif
`,
        ],
        shimMacros: [],
        dependencies: [],
      });
    }
    return mapped;
  }

  override profileDiagnostics(program: ProgramIR, ctx?: PlatformContext): Diagnostic[] {
    const diags: Diagnostic[] = [];
    const chip = resolveEsp32Profile(targetFromContext(ctx));
    const a = (ctx as any)?.analysis ?? {};

    if (a.usesDAC && chip.lacks.includes('dac')) {
      diags.push({
        severity: 'error',
        code: 'esp32-dac-unavailable',
        message: `${chip.id} has no DAC peripheral. DAC output is only available on classic ESP32 (GPIO 25/26).`,
        source: program.fileName,
      });
    }

    if (a.usesTone) {
      diags.push({
        severity: 'warning',
        code: 'esp32-tone-stub',
        message: `tone.* is a no-op stub on framework-esp32 v1 (LEDC channel sharing with PWM is deferred).`,
        hint: 'Use pwm.write with a fixed frequency, or rawCpp() for a dedicated LEDC tone channel.',
        source: program.fileName,
      });
    }

    const outputPins = new Set<number>();
    const visit = (node: any): void => {
      if (node && typeof node === 'object') {
        if (node.operation && typeof node.operation === 'object'
            && node.operation.operation === 'gpio.set_mode'
            && typeof node.operation.mode === 'string'
            && node.operation.mode.toLowerCase() === 'output') {
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
      if (chip.gpio.strapping.includes(pin)) {
        diags.push({
          severity: 'warning',
          code: 'esp32-strapping-pin',
          message: `GPIO ${pin} is a strapping pin on ${chip.id}; driving it as OUTPUT can affect boot mode.`,
          hint: 'Prefer a non-strapping pin for outputs that toggle during reset/boot.',
          source: program.fileName,
        });
      }
    }

    return diags;
  }

  override ambientTypeDeclarations(): string[] {
    return [
      '',
      '  // framework-esp32 ambient types:',
      '  // - Timing: lowered via __tc_Timing (esp_timer_get_time, vTaskDelay).',
      '  // - WDT: lowered via __tc_WDT (esp_task_wdt_*).',
      '  // - Preferences: TS type retained; runtime lowering deferred to v1.1.',
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
      '    enable(timeout?: number | string): void;',
      '    reset(): void;',
      '    disable(): void;',
      '  };',
      '',
      '  // Preferences: v1.1 — lowering pending (NVS / nvs_flash.h).',
      '  // Type is declared so user code type-checks; transpile emits a diagnostic.',
      '  const Preferences: {',
      '    begin(name: string, readOnly?: boolean): boolean;',
      '    putInt(key: string, value: number): boolean;',
      '    getInt(key: string, defaultValue?: number): number;',
      '    putString(key: string, value: string): boolean;',
      '    getString(key: string, defaultValue?: string): string;',
      '    putBool(key: string, value: boolean): boolean;',
      '    getBool(key: string, defaultValue?: boolean): boolean;',
      '    remove(key: string): boolean;',
      '    clear(): boolean;',
      '    end(): void;',
      '  };',
      '',
      '  // EEPROM: not lowered on ESP-IDF (use Preferences / NVS instead).',
      '  // Type is declared so user code type-checks; transpile emits a diagnostic.',
      '  const EEPROM: {',
      '    write(address: number, value: number): void;',
      '    read(address: number): number;',
      '    update(address: number, value: number): void;',
      '    length(): number;',
      '  };',
      '',
    ];
  }
}
