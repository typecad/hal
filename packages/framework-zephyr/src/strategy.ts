// ---------------------------------------------------------------------------
// ZephyrStrategy — Zephyr RTOS target
//
// Outputs C++ built with `west` (the Zephyr build tool). Programs use the
// Arduino-style setup()/loop() pair; a generated main() bridges them into
// Zephyr's standard C entry point and yields to the scheduler between loops.
//
// GPIO is lowered through devicetree specs (gpio_pin_*_dt) so an active-low
// LED's polarity is honored by the DT flags, not by the generated code. See
// src/lowering/gpio.ts.
//
// EMIT BOUNDARY: This file is a canonical entry point of the framework strategy
// surface (B) — its main()/shim bytes land in user firmware. The emitted bytes
// are covered by the TypeCAD Runtime Exception (see RUNTIME_EXCEPTION.md at the
// repository root) and are not subject to the license of this tool source.
// ---------------------------------------------------------------------------

import type {
  PlatformStrategy,
  ExpressionIR,
  ProgramIR,
  Diagnostic,
  PlatformContext,
  BoardConstants,
  RuntimePolyfillIR,
  StdLibSupport,
  AsyncRuntimeConfig,
  GraphicsCapacity,
  HALOpIR,
  DisplayHALOp,
} from '@typecad/cuttlefish/api/shared';
import { DEFAULT_STDLIB_SUPPORT } from '@typecad/cuttlefish/api/shared';
import { buildWorkerRuntimePolyfill } from '@typecad/cuttlefish/api/shared';
import { programUsesSafety } from '@typecad/cuttlefish/api';
import { chipForTarget, setActiveChip, getActiveChip } from './chips/index.js';
import { resolveChipFromBoard } from './chips/resolve.js';
import { emitGpioDevDispatcher } from './chips/controllers.js';
import { lowerHalOp } from './lowering/index.js';
import { buildZephyrWorkerBacking } from './lowering/worker-backing.js';
import { adcInitLines } from './lowering/adc.js';
import { pwmInitLines } from './lowering/pwm.js';
import { i2cInitLines } from './lowering/i2c.js';
import { spiInitLines } from './lowering/spi.js';
import { uartInitLines } from './lowering/uart.js';
import { interruptInitLines } from './lowering/interrupts.js';
import { wdtInitLines } from './lowering/wdt.js';
import { bleInitLines } from './lowering/ble.js';
import { wifiInitLines } from './lowering/wifi.js';
import { generateZephyrInitCode, generateZephyrBreakpointCode, generateZephyrLogpointCode } from './debug-codegen.js';
import { generateStaticAsyncRuntime } from '@typecad/cuttlefish/api/shared';
import { buildTimerPolyfill } from './async/timer-polyfill.js';
import { resolveZephyrDisplayOp, newDisplayState, type DisplayState } from './display/index.js';
import { buildDisplayRuntime } from './display/gfx.js';
import { ZEPHYR_DISPLAY_PROFILES } from './display/profiles.js';

export class ZephyrStrategy implements PlatformStrategy {
  readonly id = 'zephyr';

  // ── Profile resolution ──────────────────────────────────────────────────

  /**
   * Resolve + cache the active chip from the platform context. Called lazily
   * by the methods that need the descriptor (shimLines, resolveHALOperation
   * via lowerHalOp).
   *
   * Tries to derive the chip descriptor from the board/MCU package's zephyr
   * fields (via boardConstants) first. Falls back to the hardcoded
   * chipForTarget registry for boards that haven't shipped zephyr config yet.
   */
  private resolveChip(ctx?: PlatformContext, program?: ProgramIR) {
    // 1. Try board/MCU package constants (new path)
    const fromBoard = resolveChipFromBoard(program?.boardConstants);
    if (fromBoard) {
      setActiveChip(fromBoard);
      return fromBoard;
    }

    // 2. Fall back to frameworkData.buildTarget → hardcoded registry
    const fd = ctx?.frameworkData as Record<string, unknown> | undefined;
    const target =
      (fd?.target as string | undefined) ??
      (fd?.buildTarget as string | undefined);
    const chip = chipForTarget(target);
    setActiveChip(chip);
    return chip;
  }

  /**
   * Resolve the debug mode for the active target from the platform context.
   * Mirrors resolveChip's target extraction so shimLines/forcedIncludes can
   * gate the printf halt shim + console UART include to printf builds only
   * (gdb builds use VS Code native breakpoints + #line markers, so the
   * __tc_debug_wait_for_continue shim and its <zephyr/drivers/uart.h> include
   * are dead code there).
   */
  private resolveDebugMode(ctx?: PlatformContext): 'gdb' | 'printf' {
    const fd = ctx?.frameworkData as Record<string, unknown> | undefined;
    const target =
      (fd?.target as string | undefined) ??
      (fd?.buildTarget as string | undefined);
    return this.debugMode(target);
  }

  forcedIncludes(_program?: ProgramIR, ctx?: PlatformContext): string[] {
    const isPrintf = this.resolveDebugMode(ctx) === 'printf';
    // <zephyr/kernel.h> for k_msleep / k_uptime_get_32 / k_busy_wait / printk.
    // <zephyr/drivers/gpio.h> for the gpio_pin_*_dt / gpio_dt_spec API.
    // <cstdint> because DIRECT_CPP_TYPE_MAP passes int32_t/uint8_t through
    // verbatim and Zephyr's minimal C++ lib provides it.
    //
    // Driver headers are usage-gated on ctx.analysis.usesX (same flags
    // shimLines uses to emit the per-peripheral bus state), so an unused
    // peripheral doesn't pull in its header. When analysis is absent (e.g. a
    // capability query before a real build), the uses() helper defaults to
    // true so nothing is stripped — mirrors framework-esp32's forcedIncludes.
    const a = (ctx as any)?.analysis;
    const uses = (f: string): boolean => (a ? !!a[f] : true);
    const inc: string[] = ['<zephyr/kernel.h>', '<zephyr/drivers/gpio.h>', '<cstdio>', '<cstdint>'];
    if (uses('usesI2C')) inc.push('<zephyr/drivers/i2c.h>');
    if (uses('usesSPI')) inc.push('<zephyr/drivers/spi.h>');
    if (uses('usesUart')) inc.push('<zephyr/drivers/uart.h>');
    // uart.h is also needed by the printf-mode debug halt shim
    // (__tc_debug_wait_for_continue polls the console UART) even when the
    // program itself does not use the UART HAL. In gdb mode the shim is not
    // emitted, so skip the include there to avoid pulling in an unused header.
    if (isPrintf && !inc.includes('<zephyr/drivers/uart.h>')) inc.push('<zephyr/drivers/uart.h>');
    if (uses('usesADC')) inc.push('<zephyr/drivers/adc.h>');
    if (uses('usesPWM')) inc.push('<zephyr/drivers/pwm.h>');
    if (uses('usesWDT')) inc.push('<zephyr/drivers/watchdog.h>');
    if (uses('usesPower')) inc.push('<zephyr/pm/pm.h>', '<zephyr/pm/state.h>', '<zephyr/pm/policy.h>');
    if (uses('usesBle')) inc.push('<stdlib.h>', '<string.h>', '<zephyr/bluetooth/bluetooth.h>', '<zephyr/bluetooth/conn.h>', '<zephyr/bluetooth/gatt.h>', '<zephyr/bluetooth/uuid.h>');
    // Display: the analyzer's usesDisplay flag (set by display.* hal-ops) drives
    // this include. When ctx.analysis is absent (capability query), uses()
    // defaults to true so a real build never strips it.
    if (uses('usesDisplay')) inc.push('<zephyr/drivers/display.h>');
    if (uses('usesWifi')) inc.push(
      '<zephyr/net/net_mgmt.h>', '<zephyr/net/wifi_mgmt.h>',
      '<zephyr/net/net_if.h>', '<zephyr/net/net_ip.h>',
      '<zephyr/net/conn_mgr_connectivity.h>', '<zephyr/net/conn_mgr_monitor.h>',
    );
    // std::string — Zephyr has no umbrella header that transitively pulls in
    // <string> (unlike framework-arduino's <Arduino.h>), so a program that
    // lowers a std::string parameter/variable must request it explicitly. Uses
    // <string>, not <string.h>: the latter is the C flat-string header.
    if (uses('usesStdString')) inc.push('<string>');
    return inc;
  }

  symbolAliases(): Record<string, string> {
    return {};
  }


  /**
   * Detect async-runtime usage: a program needs the Promise/microtask runtime
   * if it declares an async function OR references an async-runtime symbol
   * (`__cuttlefish_async_`) — e.g. Async.sleep()/.then() called from a non-async
   * function. Mirrors Arduino's programUsesAsyncRuntime walk (that helper is
   * private to framework-arduino and not exported from cuttlefish, so we walk
   * here). The token appears in `raw` expr nodes and in `hal-expr`/`hal-op`
   * nodes whose resolved `raw` code references it.
   */
  private programUsesAsyncRuntime(program?: ProgramIR): boolean {
    if (!program) return false;
    const TOKEN = '__cuttlefish_async_';
    let found = false;
    const visit = (node: any): void => {
      if (found || !node || typeof node !== 'object') return;
      // raw expression node
      if (node.kind === 'raw' && typeof node.value === 'string' && node.value.includes(TOKEN)) {
        found = true; return;
      }
      // hal-expr / hal-op node whose operation is a raw op carrying code
      if (node.operation && typeof node.operation === 'object'
          && node.operation.operation === 'raw'
          && typeof node.operation.code === 'string'
          && node.operation.code.includes(TOKEN)) {
        found = true; return;
      }
      for (const v of Object.values(node)) {
        if (Array.isArray(v)) { for (const item of v) visit(item); }
        else if (v && typeof v === 'object') visit(v);
      }
    };
    visit(program);
    return found;
  }

  shimLines(program?: ProgramIR, ctx?: PlatformContext): string[] {
    const chip = this.resolveChip(ctx, program);
    const isPrintf = this.resolveDebugMode(ctx) === 'printf';
    const lines: string[] = [
      '// cuttlefish runtime shim. Wrapped in a single include guard so the',
      '// block is safe to emit into multiple headers and .cpp files within',
      '// one translation unit (a .cpp may #include several headers that each',
      '// carry the shim). The guard ensures the definitions are seen exactly',
      '// once per TU.',
      '#ifndef CUTTLEFISH_SHIM_DEFINED',
      '#define CUTTLEFISH_SHIM_DEFINED',
      '#ifndef CUTTLEFISH_UNDEFINED',
      '#define CUTTLEFISH_UNDEFINED 0',
      '#endif',
      'template<typename T> inline bool cuttlefish_is_nullish(const T& v) { return false; }',
      'inline bool cuttlefish_is_nullish(long long v) { return v == CUTTLEFISH_UNDEFINED; }',
      'inline bool cuttlefish_is_nullish(int v) { return v == CUTTLEFISH_UNDEFINED; }',
      'inline bool cuttlefish_is_nullish(double v) { return v == static_cast<double>(CUTTLEFISH_UNDEFINED); }',
      'inline bool cuttlefish_is_nullish(bool v) { return v == false; }',
      'template<typename T> inline bool cuttlefish_is_nullish(T* v) { return v == nullptr; }',
      'template<typename T> inline bool cuttlefish_exists(const T& v) { return !cuttlefish_is_nullish(v); }',
      'template<typename T, typename U> inline T cuttlefish_nullish(const T& a, U b) { return !cuttlefish_is_nullish(a) ? a : (T)b; }',
      // millis() backed by the Zephyr uptime counter. uint32_t return matches
      // the Arduino API the shared runtime expects (wraps every ~49.7 days).
      'inline unsigned long millis() { return static_cast<unsigned long>(k_uptime_get_32()); }',
      // Arduino-compat defines referenced by the shared runtime polyfills.
      '#ifndef HIGH', '#define HIGH 1', '#endif',
      '#ifndef LOW', '#define LOW 0', '#endif',
      '#ifndef PROGMEM', '#define PROGMEM', '#endif',
      'inline long map(long x, long in_min, long in_max, long out_min, long out_max) { return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min; }',
      'inline long constrain(long x, long a, long b) { return x < a ? a : (x > b ? b : x); }',
      // Test-runner console helpers: @typecad/expect's Zephyr shim calls these
      // for protocol output. Overloaded for string (const char*) and numeric
      // (double) so the same call site works for markers and test values.
      'inline void __tc_print(const char* s) { printf("%s", s); }',
      'inline void __tc_print(double v) { printf("%g", v); }',
      'inline void __tc_println(const char* s) { printf("%s\\n", s); }',
      'inline void __tc_println(double v) { printf("%g\\n", v); }',
    ];

    // Devicetree specs for every board-defined GPIO pin. Emitted unconditionally
    // (guarded by the include guard) so any of them is available whether or not
    // a given program uses it. Safe because every spec references a node that
    // exists in the active board's devicetree.
    for (const spec of chip.gpio.dtSpecs) {
      lines.push(
        `static const struct gpio_dt_spec __tc_dt_${spec.dtSpec} = GPIO_DT_SPEC_GET(DT_ALIAS(${spec.dtSpec}), gpios);`,
      );
    }

    // Per-peripheral bus state — gated on the same ctx.analysis.usesX flags as
    // forcedIncludes, so an unused peripheral emits no state (and its header is
    // not included). Mirrors framework-esp32's shimLines espInit block.
    const a = (ctx as any)?.analysis;
    const uses = (f: string): boolean => (a ? !!a[f] : true);
    if (uses('usesI2C') && chip.i2c) {
      for (let i = 0; i < chip.i2c.controllers.length; i++) lines.push(...i2cInitLines(chip, i));
    }
    if (uses('usesSPI') && chip.spi) {
      for (let i = 0; i < chip.spi.controllers.length; i++) lines.push(...spiInitLines(chip, i));
    }
    if (uses('usesUart') && chip.uart) {
      for (let i = 0; i < chip.uart.controllers.length; i++) lines.push(...uartInitLines(chip, i));
    }
    if (uses('usesADC') && chip.adc) lines.push(...adcInitLines(chip));
    if (uses('usesPWM') && chip.pwm) lines.push(...pwmInitLines(chip));
    if (uses('usesInterrupts')) lines.push(...interruptInitLines(chip));
    if (uses('usesWDT') && chip.wdt) lines.push(...wdtInitLines(chip));
    if (uses('usesBle')) lines.push(...bleInitLines());
    // Display runtime: gated on the analyzer's usesDisplay flag (set by
    // display.* hal-ops). Must emit here in the setup phase — resolveDisplayOp
    // (which seeds _displayState) runs later during op lowering, so we cannot
    // key off _displayState.initialized at shimLines time.
    if (uses('usesDisplay')) {
      const rt = buildDisplayRuntime(this._displayState.profile);
      lines.push(...rt.stateLines);
      lines.push(rt.fontTable);
      lines.push(rt.helpers);
    }
    if (uses('usesWifi')) lines.push(...wifiInitLines());

    lines.push('#endif // CUTTLEFISH_SHIM_DEFINED');

    // --- Debug-mode halt + per-breakpoint disable registry ---
    //
    // Printf mode only. In gdb mode the cuttlefish debug preprocessor is
    // skipped (core emits #line markers + VS Code native breakpoints instead),
    // so __tc_debug_wait_for_continue is never called — skip the shim and its
    // <zephyr/drivers/uart.h> dependency entirely (forcedIncludes mirrors this).
    //
    // The cuttlefish debug preprocessor injects __tc_debug_wait_for_continue(id)
    // calls at each breakpoint; without these definitions the emitted code
    // would not link.
    //
    // Zephyr's minimal libc has no getchar()/EOF, so the halt polls the console
    // UART directly via uart_poll_in on the system console device, yielding to
    // the scheduler with k_msleep between polls so an unattended breakpoint
    // does not starve the system. ENTER (or any non-'s' byte) = continue;
    // 's'/'S' = skip this breakpoint for the rest of the run (records the id).
    if (isPrintf) {
      lines.push(
        '#ifndef __TC_BP_DISABLED_DEFINED',
        '#define __TC_BP_DISABLED_DEFINED',
        'static bool __tc_bp_disabled[256] = {0};',
        'static inline bool __tc_bp_is_disabled(int id) { return id >= 0 && id < 256 && __tc_bp_disabled[id]; }',
        // Console input: poll the UART console device. DEVICE_DT_GET(DT_CHOSEN(zephyr_console))
        // resolves to the board's console (UART0 USB-CDC on the XIAO nRF52840).
        'static inline char __tc_debug_wait_for_continue(int id) {',
        '    const struct device* __con = DEVICE_DT_GET(DT_CHOSEN(zephyr_console));',
        '    unsigned char __c = 0;',
        "    while (uart_poll_in(__con, &__c) != 0) {",
        '        k_msleep(10);',
        '    }',
        "    // Drain the rest of the typed line so the next breakpoint waits fresh.",
        "    unsigned char __peek = 0;",
        "    while (uart_poll_in(__con, &__peek) == 0 && __peek != '\\n') { (void)0; }",
        "    if ((__c == 's') || (__c == 'S')) { if (id >= 0 && id < 256) __tc_bp_disabled[id] = true; }",
        '    return static_cast<char>(__c);',
        '}',
        '#endif // __TC_BP_DISABLED_DEFINED',
        '',
      );
    }

    // --- Zephyr entrypoint: main() runs setup()/loop() directly ---
    // The cuttlefish synthesizer emits setup() and loop() (it keys off
    // entrypointFunctionName()="setup" and requiresLoopFunction()=true). Zephyr
    // is a standard C main()-based RTOS, so main() bridges the two: it calls
    // setup() once, then loops loop() forever, yielding to the scheduler with
    // k_msleep(1) each iteration (cheap cooperative yield — matches the esp32
    // app_main pattern). Declared extern here because setup/loop live in a
    // separate translation unit when generateHeaderFile() splits them into the
    // header.
    lines.push(
      'extern void setup(void);',
      'extern void loop(void);',
      '',
      'int main(void) {',
      '    setup();',
      '    for (;;) {',
      '        loop();',
      '        k_msleep(1);',
      '    }',
      '    return 0;',
      '}',
    );

    // Safety shims: when the program uses @typecad/safety, provide __tc_gpio_read
    // / __tc_gpio_write backed by the raw controller (a best-effort read that
    // does not depend on a pin having a DT spec). __tc_delay_us uses k_busy_wait.
    //
    // The pin is a RUNTIME value here (safety's voter passes whatever pin it
    // was handed), so the controller cannot be baked in as a single DT_NODELABEL
    // on a multi-controller SoC (ESP32-S3: pins 0–31 → gpio0, 32–48 → gpio1).
    // Emit a tiny __tc_gpio_dev(pin) dispatcher that resolves the owning
    // controller's device per pin; single-controller SoCs collapse it to a
    // one-liner. Each DT_NODELABEL is still compile-time-resolved per branch, so
    // it is always statically valid.
    if (program && programUsesSafety(program)) {
      lines.push(...emitGpioDevDispatcher(chip));
      lines.push(
        'inline int __tc_gpio_read(uint32_t pin) { return gpio_pin_get_raw(__tc_gpio_dev(pin), pin); }',
        'inline void __tc_gpio_write(uint32_t pin, uint32_t value) { gpio_pin_set_raw(__tc_gpio_dev(pin), pin, value); }',
        '#ifndef __TC_DELAY_US_DEFINED',
        '#define __TC_DELAY_US_DEFINED',
        'inline void __tc_delay_us(uint32_t us) { k_busy_wait(us); }',
        '#endif',
      );
    }

    return lines;
  }

  profileDiagnostics(program?: ProgramIR, ctx?: PlatformContext): Diagnostic[] {
    if (!program) return [];
    const chip = this.resolveChip(ctx, program);
    const a = (ctx as any)?.analysis ?? {};
    const diags: Diagnostic[] = [];

    // Collect the pins the program uses for output config, ADC reads, and
    // interrupt attaches — deep-walking the IR the same way framework-esp32
    // does (its profileDiagnostics walks program to find gpio.set_mode /
    // power.deep_sleep_pin / adc.read nodes).
    const outputPins = new Set<number>();
    const adcReadPins = new Set<number>();
    const interruptPins = new Set<number>();
    let usesWifiOps = false;
    const visit = (node: any): void => {
      if (node && typeof node === 'object') {
        if (node.operation && typeof node.operation === 'object') {
          const op = node.operation;
          if (op.operation === 'gpio.set_mode'
              && typeof op.mode === 'string'
              && op.mode.toLowerCase() === 'output'
              && typeof op.pin === 'number') {
            outputPins.add(op.pin);
          }
          if ((op.operation === 'adc.read' || op.operation === 'adc.read_voltage')
              && typeof op.pin === 'number') {
            adcReadPins.add(op.pin);
          }
          if (op.operation === 'interrupt.attach' && typeof op.pin === 'number') {
            interruptPins.add(op.pin);
          }
          if (typeof op.operation === 'string' && op.operation.startsWith('wifi.')) {
            usesWifiOps = true;
          }
        }
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (Array.isArray(v)) v.forEach(visit);
          else if (typeof v === 'object' && v !== null) visit(v);
        }
      }
    };
    visit(program);

    // ── ADC pin validity ────────────────────────────────────────────────────
    // The SAADC lowering resolves a HAL pin to a channel via the chip
    // descriptor's adc.channels map. A pin not in that map resolves to -1,
    // which emits __tc_adc-1_setup() — an undefined symbol → link error. Flag
    // it at compile time with a clear message instead of an opaque link failure.
    const adcPins = new Set((chip.adc?.channels ?? []).map((c) => c.pin));
    for (const pin of adcReadPins) {
      if (!adcPins.has(pin)) {
        const valid = [...adcPins].sort((x, y) => x - y).join(', ');
        diags.push({
          severity: 'error',
          code: 'zephyr-adc-pin-unavailable',
          message: `GPIO ${pin} is not a SAADC channel on ${chip.id} and cannot be read with adc.read.`,
          hint: valid
            ? `Use an analog-capable pin. On ${chip.id} (SAADC): ${valid}.`
            : `This target has no ADC channels mapped in its chip descriptor.`,
          source: program.fileName,
        });
      }
    }

    // ── Interrupt pin validity ──────────────────────────────────────────────
    // interrupt.attach only wires a real callback for pins listed in the chip
    // descriptor's gpio.interruptPins (the lowering needs a DT spec to build
    // the gpio_callback struct at init). An attach on an unlisted pin emits
    // only a comment — silent no-op. Flag it so the user knows the handler
    // will never fire.
    const intPins = new Set((chip.gpio.interruptPins ?? []).map((p) => p.pin));
    for (const pin of interruptPins) {
      if (!intPins.has(pin)) {
        diags.push({
          severity: 'error',
          code: 'zephyr-interrupt-pin-unavailable',
          message: `GPIO ${pin} has no interrupt DT spec on ${chip.id}; interrupt.attach is a no-op.`,
          hint: intPins.size > 0
            ? `Add the pin to the chip descriptor's gpio.interruptPins, or use an interrupt-capable pin: ${[...intPins].sort((x, y) => x - y).join(', ')}.`
            : `This target declares no interrupt pins in its chip descriptor; interrupts are not available.`,
          source: program.fileName,
        });
      }
    }

    // ── WiFi target validity ────────────────────────────────────────────────
    // WiFi ops require a chip with a WiFi radio. The ESP32-S3 descriptor sets
    // wifi.supported; the XIAO nRF52840 omits it (no radio). Flag wifi usage on
    // a radioless chip so the user gets a clear "use an ESP32 target" message
    // instead of an opaque link/DT failure.
    if (usesWifiOps && !chip.wifi?.supported) {
      diags.push({
        severity: 'error',
        code: 'zephyr-wifi-unavailable-on-target',
        message: `WiFi ops are used but ${chip.id} has no WiFi radio.`,
        hint: `Use an esp32s3_devkitc or esp32_devkitc target (Espressif ESP32 variants have a 2.4GHz WiFi radio).`,
        source: program.fileName,
      });
    }

    // ── Unused-analysis: surface a hint that this is a no-analysis probe ────
    // (intentionally minimal — esp32 has richer rules around strapping/RTC pins;
    // nRF52840 has fewer silicon foot-guns, so the rules above are the material
    // ones. Extend as constraints are identified.)

    return diags;
  }

  /**
   * `loop` is forward-declared `extern` by the main() bridge shim
   * (extern void loop(void); → int main(void) {...}), so emitting a
   * `static void loop()` definition redeclares it with conflicting linkage,
   * which GCC rejects. Exclude it from the static forward-declaration path
   * — mirrors how ArduinoStrategy excludes `loop` (the Arduino core forward-
   * declares it extern). `setup` is already handled because it equals
   * entrypointFunctionName().
   */
  forwardDeclarationExclusions(): string[] {
    return ['loop'];
  }

  // ── File shape ──────────────────────────────────────────────────────────

  sourceExtension(): string {
    return 'cpp';
  }

  entrypointFunctionName(): string {
    return 'setup';
  }

  requiresLoopFunction(): boolean {
    return true;
  }

  overrideBaseName(
    originalBaseName: string,
    outDirBaseName: string,
    isEntryFile: boolean,
    isNpmPackage: boolean,
  ): string {
    // npm packages are library-style — don't rename. Entry files (non-npm) take
    // the out-dir name (mirrors Arduino's .ino-must-match-dir rule). Everything
    // else passes through. (The manifest's entrypoint.overrideBaseName field is
    // dead — never read in src/ — so this method is the sole name source.)
    if (isNpmPackage) return originalBaseName;
    if (isEntryFile) return outDirBaseName;
    return originalBaseName;
  }

  effectiveEmitMode(requestedMode: string, _isNpmPackage: boolean): string {
    // Zephyr always emits .cpp (no .ino equivalent to force away from), so this
    // is passthrough regardless of npm/app. The 2-param shape matches the
    // interface and Arduino; behavior is identical across branches.
    return requestedMode;
  }

  // ── Type normalisation ──────────────────────────────────────────────────

  normalizeCppType(typeName: string): string {
    if (typeName === 'auto') return 'auto';
    if (typeName === 'std::string') return 'const char*';
    return typeName;
  }

  defaultNumericType(compliance?: { isBanned(ruleId: string): boolean }): string {
    // Zephyr favors fixed-width types. Under AUTOSAR compliance (A3-9-1) emit
    // int32_t; otherwise the standard 'int'.
    return compliance?.isBanned('A3-9-1') ? 'int32_t' : 'int';
  }

  mapReturnType(functionName: string, returnType: string): string {
    if (functionName === 'main') return 'int';
    if (functionName === 'setup' || functionName === 'loop') return 'void';
    return this.normalizeCppType(returnType);
  }

  isStringLikeType(cppType: string): boolean {
    return cppType === 'std::string' || cppType === 'const char*' || cppType === 'char*';
  }

  isPointerType(cppType: string): boolean {
    return cppType.endsWith('*');
  }

  mapFunctionName(originalName: string): string {
    if (originalName === '__cuttlefish_entrypoint__') return 'main';
    return originalName;
  }

  // ── Expression rendering ────────────────────────────────────────────────

  normalizeRawExpression(value: string): string {
    let prev = '';
    let v = value;
    while (prev !== v) {
      prev = v;
      v = v.replace(/\bundefined\b/g, 'CUTTLEFISH_UNDEFINED');
      v = v.replace(/\bnull\b/g, 'CUTTLEFISH_UNDEFINED');
    }
    return v;
  }

  nullValue(): string {
    return 'CUTTLEFISH_UNDEFINED';
  }

  wrapStringConcat(): string | undefined {
    return undefined;
  }

  wrapStringObject(value: string): string {
    return `std::to_string(${value})`;
  }

  useSnprintfForStrings(): boolean {
    return true;
  }

  renameEnumMember(_enumName: string, memberName: string): string {
    return memberName;
  }

  private _largeEnumNames = new Set<string>();

  setLargeEnumNames(names: ReadonlySet<string>): void {
    this._largeEnumNames = new Set(names);
  }

  enumCastType(_enumName: string): string | undefined {
    return undefined;
  }

  renderBoardDefinitionAccess(): string | undefined {
    return undefined;
  }

  // ── Statement rendering ─────────────────────────────────────────────────

  promotesArrayLiteralsToStaticArray(): boolean {
    // No std::vector in the minimal C++ lib — promote array literals to the
    // StaticArray wrapper (the embedded/generic default).
    return true;
  }

  renderThrow(_valueExpr: string): string {
    // Zephyr minimal config disables C++ exceptions (CONFIG_CPP_EXCEPTIONS=n).
    // A throw becomes an infinite halt loop instead of a real throw.
    return 'for (;;) { k_msleep(1000); }';
  }

  isConsoleCall(callee: string): boolean {
    return callee.startsWith('console.');
  }

  transformConsoleCall(method: string, renderedArgs: string, forHeader: boolean): string {
    const semi = forHeader ? '' : ';';
    const empty = !renderedArgs || renderedArgs.trim() === '';
    const tag = method === 'error' ? '[ERROR] ' : method === 'warn' ? '[WARN] ' : '';
    if (empty) return `printk("%s\\n", "${tag}")${semi}`;
    const parts = renderedArgs.split(' << ');
    if (parts.length === 1) {
      return `printk("%s%s\\n", "${tag}", (${renderedArgs}))${semi}`;
    }
    const fmt = '%s' + '%s'.repeat(parts.length) + '\\n';
    const args = [`"${tag}"`, ...parts].join(', ');
    return `printk("${fmt}", ${args})${semi}`;
  }

  transformConsoleExpression(_method: string, _renderedArgs: string): string | undefined {
    return undefined;
  }

  objectFieldInitializer(): string | undefined {
    return undefined;
  }

  overrideClassFieldType(_fieldName: string, normalizedType: string): string {
    return normalizedType;
  }

  // ── Name guards ─────────────────────────────────────────────────────────

  reservedNames(): ReadonlySet<string> {
    return new Set<string>();
  }

  passthroughMacroNames(): ReadonlySet<string> {
    return new Set<string>();
  }

  apiReservedEnumNames(): ReadonlySet<string> {
    return new Set<string>();
  }

  apiReservedEnumGuard(): string {
    return '';
  }

  ambientTypeDeclarations(): string[] {
    return [];
  }

  // ── Includes ────────────────────────────────────────────────────────────

  needsIostream(): boolean {
    return false;
  }

  needsStdString(): boolean {
    // Zephyr's minimal C++ lib has no <string>. Set false so the transpiler
    // does not emit std::string-dependent code (e.g. the string-method
    // polyfills). A program that needs it must enable a full STL.
    return false;
  }

  needsStdVector(): boolean {
    // No <vector> in the minimal C++ lib.
    return false;
  }

  needsStdExcept(): boolean {
    return false;
  }

  needsStdFunction(): boolean {
    // No <functional> in the minimal C++ lib.
    return false;
  }

  mathHeader(): string {
    // <math.h> is the schema-permitted value (the manifest enum allows none |
    // <math.h> | <Arduino.h>). Zephyr's toolchain provides it; the C++ <cmath>
    // names are available via it as well.
    return '<math.h>';
  }

  cstringHeader(): string {
    return '<cstring>';
  }

  needsVectorOverload(): boolean {
    return true;
  }

  needsLargeEnumUnderlying(): boolean {
    return false;
  }

  // ── Struct field handling ───────────────────────────────────────────────

  renameStructField(fieldName: string): string {
    return fieldName;
  }

  structFieldInitializer(): string | undefined {
    return undefined;
  }

  // ── Async ───────────────────────────────────────────────────────────────
  // Hybrid: timers are native (k_timer + k_work, see src/async/timer-polyfill.ts);
  // Promises use the heap-free static runtime (generateStaticAsyncRuntime), pumped
  // cooperatively in loop() via cuttlefish_pump_microtasks(). There is no
  // __tc_timer_runtime.run() poll — native timers fire from their own expiry path.

  getAsyncRuntimeConfig(): AsyncRuntimeConfig {
    return {
      queueCapacity: 64,
      scheduler: 'microtask',
      waitForPinEdge: 'stub',
      hasPromiseRuntime: true,
      hasTimers: true,
      // Static (heap-free) runtime — no STL headers required.
      requiredIncludes: [],
    };
  }

  asyncLoopInjection(taskVarNames: string[], config: AsyncRuntimeConfig): string[];
  asyncLoopInjection(taskVarNames: string[], hasPromiseRuntime: boolean, hasTimers: boolean): string[];
  asyncLoopInjection(
    taskVarNames: string[],
    configOrBool: AsyncRuntimeConfig | boolean,
    _hasTimers?: boolean,
  ): string[] {
    const cfg =
      typeof configOrBool === 'boolean'
        ? { hasPromiseRuntime: configOrBool, hasTimers: _hasTimers ?? false }
        : configOrBool;
    // Drive every async state-machine task once per loop() iteration. The task
    // globals auto-start on their first .run() (constructor sets STATE_0, which
    // runs unconditionally), so this is both the start and the per-frame advance.
    // The state machine no-ops in its terminal/cyclic state, so unconditional
    // .run() is correct (mirrors framework-arduino). No isComplete() gating.
    const lines: string[] = [];
    if (cfg.hasPromiseRuntime) {
      lines.push('cuttlefish_pump_microtasks();');
    }
    for (const n of taskVarNames) {
      lines.push(`${n}.run();`);
    }
    // NOTE: no __tc_timer_runtime.run() — Zephyr timers are native k_timer
    // (timer-polyfill.ts), not a cooperative poll.
    return lines;
  }

  asyncDriverFunctionName(): string {
    return 'loop';
  }

  // ── Type aliases ────────────────────────────────────────────────────────

  shouldSkipTypeAlias(): boolean {
    return false;
  }

  // ── Diagnostics ─────────────────────────────────────────────────────────

  emitDiagnostics(): Diagnostic[] {
    return [];
  }

  currentTimeMillis(): string {
    return 'millis()';
  }

  // ── Build configuration ──────────────────────────────────────────────────

  asyncQueueCapacity(): number {
    return 64;
  }

  outputSubdirectory(_baseName: string): string {
    // Zephyr convention: application sources live under src/.
    return 'src';
  }

  generateHeaderFile(): boolean {
    return true;
  }

  enumApiGuard(_enumName: string): { open: string; close: string } | undefined {
    return undefined;
  }

  getStdLibSupport(_architecture?: string): StdLibSupport {
    // Zephyr's minimal C++ support (lib/cpp/minimal) provides only <cstddef>,
    // <cstdint>, <new>. No <vector>, <string>, <iostream>, <functional>, no
    // exceptions, no RTTI. The blink MVP uses only GPIO + kernel timing, so
    // none of those are needed. Array/string literals are not promoted to the
    // STL containers; a future program needing them must enable a full STL
    // and update these flags.
    return {
      hasVector: false,
      hasString: false,
      hasIostream: false,
      hasExceptions: false,
      hasRTTI: false,
      recommendedArrayImpl: 'static_array',
      recommendedStringImpl: 'static_string',
    };
  }

  // ── Polyfills ───────────────────────────────────────────────────────────
  // No native polyfills for the MVP — the shared runtime's string/array
  // polyfills are pulled in when a program uses them. cuttlefish_halt is the
  // one symbol the runtime header may reference; supply it as a halt loop.

  nativePolyfills(): Set<string> {
    // cuttlefish_halt: always (the runtime header may reference it).
    // timer_methods: k_timer/k_work pool for setInterval/setTimeout (gated on
    //   timerCallCount at emit time in generateNativePolyfills).
    // async_runtime: heap-free static Promise/microtask runtime (no STL needed).
    return new Set<string>(['cuttlefish_halt', 'timer_methods', 'async_runtime']);
  }

  generateNativePolyfills(program?: ProgramIR, ctx?: PlatformContext): RuntimePolyfillIR[] {
    const polyfills: RuntimePolyfillIR[] = [
      {
        kind: 'polyfill',
        id: 'cuttlefish_halt',
        domain: 'standard' as const,
        requiredIncludes: [],
        forwardDeclarations: [],
        helperStructs: [],
        helperFunctions: [
          '[[noreturn]] inline void cuttlefish_halt() { for (;;) { k_msleep(1000); } }',
        ],
        shimMacros: [],
        dependencies: [],
      },
    ];

    // Worker-offload runtime (Phase 1). Emitted only when the program uses
    // worker.* ops, backed by the Zephyr primitives in worker-backing.ts
    // (k_work system workqueue + k_sem for the completion barrier).
    const usesWorker = !!((ctx as any)?.analysis?.usesWorker);
    if (program && usesWorker) {
      const workerPoly = buildWorkerRuntimePolyfill(program, this, buildZephyrWorkerBacking(), { poolSize: 4 });
      if (workerPoly) polyfills.push(workerPoly);
    }

    // timer_methods — k_timer/k_work pool. Gated on observed timer call count;
    // a program with no setInterval/setTimeout emits nothing.
    const analysis = (ctx as { analysis?: { timerCallCount?: number } } | undefined)?.analysis;
    const timerCallCount = analysis?.timerCallCount ?? 0;
    if (timerCallCount > 0) {
      polyfills.push(buildTimerPolyfill(timerCallCount));
    }

    // async_runtime — heap-free static Promise/microtask runtime. Emitted when
    // the program declares an async function OR references an async-runtime
    // symbol (Async.sleep/.then from a non-async fn). The static path requires
    // no STL headers, so it is safe under Zephyr's minimal C++ lib.
    const usesAsync = !!program
      && (program.functions.some((fn: any) => fn && fn.isAsync) || this.programUsesAsyncRuntime(program));
    if (usesAsync) {
      polyfills.push({
        kind: 'polyfill',
        id: 'async_runtime',
        domain: 'embedded',
        requiredIncludes: [],
        forwardDeclarations: [],
        helperStructs: [generateStaticAsyncRuntime(8, this.getAsyncRuntimeConfig().waitForPinEdge)],
        helperFunctions: [],
        shimMacros: [],
        dependencies: [],
        hasPromiseRuntime: true,
      } as RuntimePolyfillIR);
    }
    return polyfills;
  }

  // ── HAL ──────────────────────────────────────────────────────────────────

  resolveHALOperation(op: HALOpIR): { code?: string; expression?: string } | undefined {
    return lowerHalOp(op);
  }

  modelsGpio(): boolean {
    return true;
  }

  // ── Atomic HAL primitives ─────────────────────────────────────────────────
  // Zephyr lowers GPIO through devicetree specs and its own __tc_gpio_* helpers
  // (defined in shimLines via gpio_pin_get_raw / gpio_pin_set_raw). Cuttlefish
  // asks these instead of emitting Wiring tokens by name. The async polling
  // path is gated to 'stub' on Zephyr (waitForPinEdge), so delayMs is unlikely
  // to be called here, but a busy-wait form is provided for completeness.
  readDigitalPin(pin: string): string {
    return `__tc_gpio_read(${pin})`;
  }
  readAnalogPin(pin: string): string {
    // Zephyr ADC is lowered through its own shim; this stub keeps cuttlefish
    // from emitting a Wiring analogRead token. Update if a __tc_adc_read helper
    // is introduced.
    return `/* adc lowering via zephyr shim */ 0`;
  }
  writeDigitalPin(pin: string, val: string): string {
    return `__tc_gpio_write(${pin}, ${val})`;
  }
  setPinMode(_pin: string, _mode: string): string {
    // Zephyr configures pin direction via devicetree, not a runtime pinMode.
    return `/* pin mode configured via devicetree */`;
  }
  delayMs(ms: string): string {
    return `k_msleep(${ms})`;
  }
  delayMicroseconds(us: string): string {
    return `__tc_delay_us(${us})`;
  }
  halCallNames(): ReadonlySet<string> {
    // Zephyr's HAL surface uses __tc_ prefixed helpers + the Zephyr API.
    return new Set<string>([
      "__tc_gpio_read", "__tc_gpio_write", "__tc_delay_us",
      "gpio_pin_get_raw", "gpio_pin_set_raw", "k_msleep", "k_busy_wait",
    ]);
  }
  isHalCall(name: string): boolean {
    return this.halCallNames().has(name);
  }
  analogReadCallNames(): ReadonlySet<string> {
    return new Set<string>();
  }

  // ── RTOS ─────────────────────────────────────────────────────────────────

  isRtosTarget(): boolean {
    // Zephyr is a preemptive RTOS — delay()/k_msleep inside loop() is the
    // expected cooperative yield, not an anti-pattern to warn about.
    return true;
  }

  // ── Worker offload backing (Phase 1) ─────────────────────────────────────
  // Delegates to the Zephyr backing (worker-backing.ts): k_work system
  // workqueue + k_sem for completion. k_sem provides the kernel memory barrier
  // the dual-core contract requires (the worker runs on a workqueue thread).
  private _workerBacking = buildZephyrWorkerBacking();

  // Display state (mirrors Arduino's _displayCtx). Seeded on display.init; the
  // validator-probe path seeds the default profile lazily.
  private _displayState: DisplayState = newDisplayState();

  workerSpawnLines(handleId: number, trampolineName: string, waiterExpr: string): string[] | undefined {
    return this._workerBacking.spawnLines(handleId, trampolineName, waiterExpr);
  }
  workerSignalDoneExpr(handleId: number): string | undefined {
    return this._workerBacking.signalDoneExpr(handleId);
  }
  workerIsDoneExpr(handleId: number): string | undefined {
    return this._workerBacking.isDoneExpr(handleId);
  }

  // ── Graphics ──────────────────────────────────────────────────────────────
  // Generic <zephyr/drivers/display.h> + ported GFX primitives (see src/display/).
  // resolveDisplayOp delegates to resolveZephyrDisplayOp with the per-build
  // DisplayState; the GFX runtime (device handle + line buffer + helpers) is
  // emitted into shimLines when usesDisplay.

  resolveDisplayOp(op: DisplayHALOp): { code?: string; expression?: string } | undefined {
    return resolveZephyrDisplayOp(op, this._displayState);
  }

  supportedDisplayDrivers(): ReadonlySet<string> {
    return new Set<string>(Object.keys(ZEPHYR_DISPLAY_PROFILES));
  }

  colorFormat(): 'rgb565' | 'rgb666' | 'rgb888' | 'mono' {
    return 'rgb565';
  }

  graphicsCapacity(): GraphicsCapacity {
    return {
      maxNodes: 256,
      maxBindings: 64,
      maxActiveTransitions: 32,
      nodeStorage: 'flash',
    };
  }

  // ── Debug ─────────────────────────────────────────────────────────────────
  // Zephyr's minimal C++ config has no <iostream>, so the GenericStrategy
  // std::cout fallback the debug preprocessor uses by default would NOT
  // compile. Override the debug surface to route through printk (always
  // available, no CONFIG_CONSOLE dependency) and the __tc_debug_wait_for_continue
  // halt emitted in shimLines. See src/debug-codegen.ts.
  //
  // Target-selective: targets with a debug probe get native GDB source-level
  // debugging (core emits #line markers + skips printf instrumentation); the
  // rest fall back to the printk instrumentation path. The ESP32-S3 has a
  // built-in USB-JTAG (single-cable GDB via OpenOCD) so it selects 'gdb'.
  // The XIAO nRF52840 needs its J-Link wired up; its GDB path is a follow-on,
  // so it stays on printf for now.

  debugMode(target?: string): 'gdb' | 'printf' {
    // `target` is the Zephyr board id (optionally with a /qualifier suffix,
    // e.g. 'esp32s3_devkitc/esp32s3/procpu'). Match on the bare board id.
    const boardId = (target ?? '').split('/')[0];
    if (boardId === 'esp32s3_devkitc' || boardId.startsWith('esp32s3')) {
      return 'gdb';
    }
    // The plain ESP32 (esp32_devkitc) intentionally stays on 'printf': unlike
    // the S3 it has NO built-in USB-JTAG, so gdb needs an external ESP-PROG
    // probe + a different OpenOCD cfg/toolchain dir (deferred). Falls through.
    return 'printf';
  }

  generateDebugInitCode(): string[] {
    return generateZephyrInitCode();
  }

  generateDebugBreakpointCode(params: {
    fileName: string; lineNum: number; originalLine: string;
    variables: Array<{ name: string; isFunction?: boolean; cppType?: 'bool'|'int'|'long'|'float'|'string'|'unknown' }>;
    normalizedCondition?: string;
    breakpointId?: number;
  }): string[] {
    return generateZephyrBreakpointCode(
      params.fileName, params.lineNum, params.originalLine,
      params.variables, params.normalizedCondition, params.breakpointId,
    );
  }

  generateDebugLogpointCode(params: {
    fileName: string; lineNum: number;
    parts: Array<{ type: 'text' | 'variable'; value: string }>;
    variables: Array<{ name: string; isFunction?: boolean }>;
  }): string[] {
    return generateZephyrLogpointCode(params.fileName, params.lineNum, params.parts, params.variables);
  }
}
