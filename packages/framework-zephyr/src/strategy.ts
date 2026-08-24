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
  ResolvedDisplay,
  DisplayAdapterCode,
  DisplayProfile,
  TouchProfile,
  TouchAdapterCodegen,
} from '@typecad/cuttlefish/api/shared';
import { DEFAULT_STDLIB_SUPPORT } from '@typecad/cuttlefish/api/shared';
import { buildWorkerRuntimePolyfill } from '@typecad/cuttlefish/api/shared';
import { applyStringMethodRewrites } from '@typecad/cuttlefish/api/shared';
import { programUsesSafety } from '@typecad/cuttlefish/api';
import { entryHasUI } from '@typecad/cuttlefish/ui-hook';
import { chipForTarget, setActiveChip, getActiveChip } from './chips/index.js';
import { resolveChipFromBoard } from './chips/resolve.js';
import { emitGpioDevDispatcher } from './chips/controllers.js';
import type { ZephyrChipDescriptor } from './chips/types.js';

/**
 * Deep-walk the program IR and collect the HAL pin numbers the program
 * actually touches for a peripheral family ('adc' | 'pwm') — the same walk
 * profileDiagnostics does. Emit paths gate per-channel state on these sets
 * so nothing unused reaches the single generated TU (-Wunused-function
 * hygiene: every emitted function/variable is referenced). `undefined`
 * (no program — probe paths) means "no information": callers emit every
 * descriptor channel, preserving probe behavior.
 *
 * `pwm` also covers tone.* — the tone lowering drives the descriptor's
 * first PWM spec regardless of pin, so any tone op marks it used.
 */
function collectUsedPins(
  program: ProgramIR | undefined,
  kind: 'adc' | 'pwm',
  chip?: ZephyrChipDescriptor,
): Set<number> | undefined {
  if (!program) return undefined;
  const pins = new Set<number>();
  let usesTone = false;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    const op = n.operation;
    if (op && typeof op === 'object') {
      const o = op as Record<string, unknown>;
      const name = o.operation;
      const pin = o.pin;
      if (typeof name === 'string' && typeof pin === 'number') {
        if (kind === 'adc' && (name === 'adc.read' || name === 'adc.read_voltage')) pins.add(pin);
        if (kind === 'pwm' && name.startsWith('pwm.')) pins.add(pin);
      }
      if (kind === 'pwm' && typeof name === 'string' && name.startsWith('tone.')) usesTone = true;
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) { for (const item of v) visit(item); }
      else if (v && typeof v === 'object') visit(v);
    }
  };
  visit(program);
  if (kind === 'pwm' && usesTone) {
    const first = chip?.pwm?.specs[0];
    if (first) pins.add(first.pin);
  }
  return pins;
}
import { lowerHalOp } from './lowering/index.js';
import { buildZephyrWorkerBacking } from './lowering/worker-backing.js';
import { adcInitLines } from './lowering/adc.js';
import { pwmInitLines } from './lowering/pwm.js';
import { dacInitLines } from './lowering/dac.js';
import { fsInitLines } from './lowering/fs.js';
import { hwtimerInitLines } from './lowering/hwtimer.js';
import { i2cInitLines } from './lowering/i2c.js';
import { spiInitLines } from './lowering/spi.js';
import { uartInitLines } from './lowering/uart.js';
import { usbInitLines, usbdDeviceLines } from './lowering/usb.js';

/**
 * STM32F4 boot-time DBGMCU setup: set DBG_SLEEP|DBG_STOP|DBG_STANDBY
 * (DBGMCU_CR @ 0xE0042004, bits 0–2) so SWD stays attachable while the app
 * sleeps. RCC_APB1ENR (0x40023840) bit 18 clocks the DBGMCU first — F4 gates
 * register access behind it. Raw-register form (not the STM32 LL headers) so
 * the shim stays include-light; AUTOSAR-clean via reinterpret_cast.
 */
function stm32f4DbgmcuLines(): string[] {
  return [
    '// CUTTLEFISH_STM32_DBGMCU_BEGIN',
    '#include <zephyr/init.h>',
    'static int __tc_stm32_dbgmcu_keep_swd_alive(void) {',
    '    volatile uint32_t* const rcc_apb1enr = reinterpret_cast<volatile uint32_t*>(0x40023840);',
    '    *rcc_apb1enr = *rcc_apb1enr | (1UL << 18);',
    '    volatile uint32_t* const dbgmcu_cr = reinterpret_cast<volatile uint32_t*>(0xE0042004);',
    '    *dbgmcu_cr = *dbgmcu_cr | 0x7u;',
    '    return 0;',
    '}',
    'SYS_INIT(__tc_stm32_dbgmcu_keep_swd_alive, PRE_KERNEL_1, 0);',
    '// CUTTLEFISH_STM32_DBGMCU_END',
  ];
}
import { interruptInitLines } from './lowering/interrupts.js';
import { wdtInitLines } from './lowering/wdt.js';
import { bleInitLines } from './lowering/ble.js';
import { wifiInitLines } from './lowering/wifi.js';
import { httpInitLines } from './lowering/http.js';
import { mqttInitLines } from './lowering/mqtt.js';
import { preferencesInitLines } from './lowering/preferences.js';
import { randomInitLines } from './lowering/random.js';
import { generateZephyrInitCode, generateZephyrBreakpointCode, generateZephyrLogpointCode } from './debug-codegen.js';
import { generateStaticAsyncRuntime } from '@typecad/cuttlefish/api/shared';
import { buildTimerPolyfill } from './async/timer-polyfill.js';
import { resolveZephyrDisplayOp, newDisplayState, type DisplayState } from './display/index.js';
import { buildDisplayRuntime } from './display/gfx.js';
import { ZEPHYR_DISPLAY_PROFILES, BUILT_IN_PROFILES } from './display/profiles.js';
import { zephyrDisplayAdapterGenerator } from './display/ui-adapter.js';
import { zephyrTouchAdapter } from './display/touch-adapter.js';

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
    // <zephyr/drivers/gpio.h> and <cstdint> stay unconditional: gpio.h is
    // cross-cutting (gpio/power/interrupt/spi/pulse lowerings + the DT-spec
    // machinery all reference its API, and no single usesX flag owns it), and
    // the fixed-width types come via <zephyr/kernel.h> regardless — DIRECT_CPP_TYPE_MAP
    // passes int32_t/uint8_t through verbatim.
    const inc: string[] = ['<zephyr/kernel.h>', '<zephyr/drivers/gpio.h>', '<cstdint>'];
    // <cstdio> backs the printf family only: __tc_print/__tc_println (emitted
    // solely when @typecad/expect's preprocessor injected them — tracked via
    // usedPolyfillHelpers), raw printf/snprintf in user code (usesCstdio), and
    // the fs/preferences/uart shims (their lowerings snprintf into buffers).
    // A program touching none of those needs no <cstdio>.
    const helpers = (a as { usedPolyfillHelpers?: Set<string> } | undefined)?.usedPolyfillHelpers;
    const needsCstdio = uses('usesCstdio') || uses('usesFS') || uses('usesPreferences')
      || uses('usesUart') || uses('usesUsb')
      || !!helpers?.has('__tc_print') || !!helpers?.has('__tc_println');
    if (needsCstdio) inc.push('<cstdio>');
    if (uses('usesI2C')) inc.push('<zephyr/drivers/i2c.h>');
    if (uses('usesSPI')) inc.push('<zephyr/drivers/spi.h>');
    if (uses('usesUart')) inc.push('<zephyr/drivers/uart.h>');
    // uart.h is also needed by the printf-mode debug halt shim
    // (__tc_debug_wait_for_continue polls the console UART) even when the
    // program itself does not use the UART HAL. In gdb mode the shim is not
    // emitted, so skip the include there to avoid pulling in an unused header.
    if (isPrintf && !inc.includes('<zephyr/drivers/uart.h>')) inc.push('<zephyr/drivers/uart.h>');
    // USB CDC serial: the class instance is a UART device (uart.h); the
    // device context macros + usbd_* API live in the next-stack header.
    if (uses('usesUsb')) {
      if (!inc.includes('<zephyr/drivers/uart.h>')) inc.push('<zephyr/drivers/uart.h>');
      inc.push('<zephyr/usb/usbd.h>');
    }
    if (uses('usesADC')) inc.push('<zephyr/drivers/adc.h>');
    if (uses('usesPWM')) inc.push('<zephyr/drivers/pwm.h>');
    if (uses('usesDAC')) inc.push('<zephyr/drivers/dac.h>');
    // Filesystem: littlefs on the storage partition. <cstring> backs the
    // shim's strlen; the storage/flash_map + fs/littlefs headers carry the
    // FIXED_PARTITION_ID macro + FS_LITTLEFS_DECLARE_DEFAULT_CONFIG the shim uses.
    if (uses('usesFS')) inc.push('<zephyr/fs/fs.h>', '<zephyr/fs/littlefs.h>', '<zephyr/storage/flash_map.h>', '<cstring>');
    // Hardware timers via the counter driver.
    if (uses('usesHwtimer')) inc.push('<zephyr/drivers/counter.h>');
    if (uses('usesWDT')) inc.push('<zephyr/drivers/watchdog.h>');
    if (uses('usesPower')) inc.push('<zephyr/pm/pm.h>', '<zephyr/pm/state.h>', '<zephyr/pm/policy.h>');
    // BLE: the bt_* GATT API + the flat-string headers the shim uses. <string>
    // is needed because a Utf8 (BleValueType.Utf8) read handler lowers to a
    // std::string-returning function (the string literal return type), and the
    // program-analysis usesStdString detector doesn't see types generated by
    // the BLE lowering layer — so without forcing <string> here, any BLE server
    // with a Utf8 characteristic fails to compile ('std::string does not name a
    // type'). <cstdlib>/<cstring> (not <stdlib.h>/<string.h>) back the shim's
    // strtol/strcmp/strncpy — the same AUTOSAR-compliant spelling the HTTP,
    // MQTT, and Preferences paths below already use.
    if (uses('usesBle')) inc.push('<cstdlib>', '<cstring>', '<string>', '<zephyr/bluetooth/bluetooth.h>', '<zephyr/bluetooth/conn.h>', '<zephyr/bluetooth/gatt.h>', '<zephyr/bluetooth/uuid.h>');
    // Display: the analyzer's usesDisplay flag (set by display.* hal-ops) drives
    // this include. When ctx.analysis is absent (capability query), uses()
    // defaults to true so a real build never strips it.
    if (uses('usesDisplay')) inc.push('<zephyr/drivers/display.h>');
    // Random: <zephyr/random/random.h> for sys_rand_get (the entropy tap that
    // seeds the __tc_rand_* xorshift32 PRNG). The shim block re-includes it, but
    // force it here too so a split-TU emit still has the symbol available.
    if (uses('usesRandom')) inc.push('<zephyr/random/random.h>');
    if (uses('usesWifi')) inc.push(
      '<zephyr/net/net_mgmt.h>', '<zephyr/net/wifi_mgmt.h>',
      '<zephyr/net/net_if.h>', '<zephyr/net/net_ip.h>',
      '<zephyr/net/conn_mgr_connectivity.h>', '<zephyr/net/conn_mgr_monitor.h>',
    );
    // HTTP/S client: Zephyr's http_client_req runs over a pre-connected socket,
    // so the shim pulls in the BSD socket + POSIX DNS surfaces alongside the
    // http client/parser headers. TLS sec tags need tls_credentials; <cstring>
    // /<cstdlib> back the shim's memcpy/strlen/new-nothrow usage (the core
    // shim only includes <cstdio>/<cstdint>).
    if (uses('usesHttp')) inc.push(
      '<zephyr/net/socket.h>', '<zephyr/net/http/client.h>',
      '<zephyr/net/http/parser.h>', '<zephyr/net/tls_credentials.h>',
      '<zephyr/posix/sys/socket.h>', '<cstring>', '<cstdlib>',
    );
    // MQTT client: <zephyr/net/mqtt.h> for mqtt_connect/publish/subscribe, plus
    // <zephyr/net/socket.h> for the zsock_* poll/getaddrinfo API the shim's poll
    // thread uses, and <zephyr/net/tls_credentials.h> for the mqtts:// path
    // (mqtt_sec_config). <cstring> backs the shim's memcpy/strlen.
    if (uses('usesMqtt')) inc.push(
      '<zephyr/net/mqtt.h>', '<zephyr/net/socket.h>',
      '<zephyr/net/tls_credentials.h>', '<cstring>',
    );
    // Preferences: Zephyr settings subsystem (ZMS backend) — settings_load/
    // settings_save_one/settings_delete + the SETTINGS_STATIC_HANDLER_DEFINE
    // macro. <cstring> backs the shim's memcpy/memmove/strncpy/strncmp (the
    // core shim only includes <cstdio>/<cstdint>). <errno.h> for ENOENT in h_get.
    if (uses('usesPreferences')) inc.push(
      '<zephyr/settings/settings.h>', '<cstring>', '<errno.h>',
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

  /** Pins referenced by gpio.* hal-ops in the program IR. lowerGpio routes a
   *  pin to its devicetree spec by pin NUMBER, so the structured hal-op pins
   *  are the authoritative signal for which __tc_dt_* specs are needed —
   *  regardless of when the final call text is rendered. */
  private collectGpioPinUsage(program?: ProgramIR): Set<number> {
    const pins = new Set<number>();
    if (!program) return pins;
    const visit = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.operation && typeof node.operation === 'object'
          && typeof node.operation.operation === 'string'
          && node.operation.operation.startsWith('gpio.')
          && typeof node.operation.pin === 'number') {
        pins.add(node.operation.pin);
      }
      for (const v of Object.values(node)) {
        if (Array.isArray(v)) { for (const item of v) visit(item); }
        else if (v && typeof v === 'object') visit(v);
      }
    };
    visit(program);
    return pins;
  }

  /** Run `re` (global) against every raw string in the IR — raw expression
   *  values plus raw hal-op codes — returning capture group 1 of each match
   *  (the full match when the regex has no group). This is how references the
   *  text scanners must see but that never appear as IR call nodes (e.g. a
   *  rawCpp() escape hatch naming `__tc_dt_sw0` directly) are discovered. */
  private collectRawMatches(program: ProgramIR | undefined, re: RegExp): Set<string> {
    const found = new Set<string>();
    if (!program) return found;
    const scan = (text: string): void => {
      for (const m of text.matchAll(re)) found.add(m[1] ?? m[0]);
    };
    const visit = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.kind === 'raw' && typeof node.value === 'string') scan(node.value);
      if (node.operation && typeof node.operation === 'object'
          && node.operation.operation === 'raw' && typeof node.operation.code === 'string') {
        scan(node.operation.code);
      }
      for (const v of Object.values(node)) {
        if (Array.isArray(v)) { for (const item of v) visit(item); }
        else if (v && typeof v === 'object') visit(v);
      }
    };
    visit(program);
    return found;
  }

  /** Whether the wiring-compat GPIO read surface (__tc_gpio_read definition,
   *  __tc_gpio_dev dispatcher, and the wiring_compat polyfill's digitalRead /
   *  HIGH / LOW macros) must be emitted. Consumers: user digitalRead() calls
   *  (usesDigitalRead), the @typecad/safety voter (calls __tc_gpio_read
   *  directly via lowered raw text), and the UI runtime header's
   *  unconditional digitalRead() poll (entryHasUI — build-global, so every TU
   *  in a UI build carries the macros). With no analysis present (capability
   *  query), default to emitting — same convention as the uses() helper. */
  private needsGpioReadShim(program?: ProgramIR, ctx?: PlatformContext): boolean {
    if (program && programUsesSafety(program)) return true;
    if (entryHasUI()) return true;
    const a = (ctx as any)?.analysis;
    return a ? !!a.usesDigitalRead : true;
  }

  shimLines(program?: ProgramIR, ctx?: PlatformContext): string[] {
    const chip = this.resolveChip(ctx, program);
    const isPrintf = this.resolveDebugMode(ctx) === 'printf';
    const a = (ctx as any)?.analysis;
    const uses = (f: string): boolean => (a ? !!a[f] : true);
    const helpers = (a as { usedPolyfillHelpers?: Set<string> } | undefined)?.usedPolyfillHelpers;

    // --- Core shim, gated item by item on actual use ------------------------
    // A minimal program (blink) uses none of these, and its output carries no
    // shim block at all. Everything up to the #endif composes into one guard
    // body; the guard itself is only stamped when the body is non-empty.
    const guardBody: string[] = [];
    // CUTTLEFISH_UNDEFINED: needed when the file references null/undefined
    // literals (usesNullish), emits nullish helper CALLS (usesNullishHelper),
    // or has async functions (the async state machine uses the macro for
    // default waitFor* timeouts — not visible to the nullish scanners).
    if (uses('usesNullish') || uses('usesNullishHelper') || uses('hasAsync')) {
      guardBody.push(
        '#ifndef CUTTLEFISH_UNDEFINED',
        '#define CUTTLEFISH_UNDEFINED 0',
        '#endif',
      );
    }
    // Nullish helpers: only when the file actually emits cuttlefish_nullish /
    // cuttlefish_exists CALLS (?? / ?. lowering). A file that only references
    // null/undefined literals needs just the macro above — the same
    // distinction the setup emitter's strip filter documents.
    if (uses('usesNullishHelper')) {
      guardBody.push(
        'template<typename T> inline bool cuttlefish_is_nullish(const T& v) { return false; }',
        'inline bool cuttlefish_is_nullish(long long v) { return v == CUTTLEFISH_UNDEFINED; }',
        'inline bool cuttlefish_is_nullish(int v) { return v == CUTTLEFISH_UNDEFINED; }',
        'inline bool cuttlefish_is_nullish(double v) { return v == static_cast<double>(CUTTLEFISH_UNDEFINED); }',
        'inline bool cuttlefish_is_nullish(bool v) { return v == false; }',
        'template<typename T> inline bool cuttlefish_is_nullish(T* v) { return v == nullptr; }',
        'template<typename T> inline bool cuttlefish_exists(const T& v) { return !cuttlefish_is_nullish(v); }',
        'template<typename T, typename U> inline T cuttlefish_nullish(const T& a, U b) { return !cuttlefish_is_nullish(a) ? a : (T)b; }',
      );
    }
    // millis() backed by the Zephyr uptime counter. uint32_t return matches
    // the Arduino API the shared runtime expects (wraps every ~49.7 days).
    // Kept when the program reads the clock itself — usesWallClock,
    // deliberately WITHOUT the delay() conflation usesMillis carries, because
    // Zephyr's delay lowers straight to k_msleep — or has a hidden poller:
    // async functions / the async runtime, the setInterval/setTimeout
    // scheduler, or a mounted UI's per-frame tick.
    if (uses('usesWallClock') || uses('hasAsync') || (!a || a.timerCallCount > 0)
        || this.programUsesAsyncRuntime(program) || entryHasUI()) {
      guardBody.push(
        'inline unsigned long millis() { return static_cast<unsigned long>(k_uptime_get_32()); }',
      );
    }
    // PROGMEM: only the (Arduino-oriented) UI runtime header can reference it.
    if (entryHasUI()) {
      guardBody.push(
        '#ifndef PROGMEM', '#define PROGMEM', '#endif',
      );
    }
    // map()/constrain() Arduino-API helpers — dead code unless called. The
    // setup emitter ORs entryHasUI() into usesConstrain before we see it (the
    // UI runtime's progress/range draw calls constrain).
    if (uses('usesMap')) {
      guardBody.push(
        'inline long map(long x, long in_min, long in_max, long out_min, long out_max) { return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min; }',
      );
    }
    if (uses('usesConstrain')) {
      guardBody.push(
        'inline long constrain(long x, long a, long b) { return x < a ? a : (x > b ? b : x); }',
      );
    }
    // Test-runner console helpers: @typecad/expect's Zephyr shim calls these
    // for protocol output. Overloaded for string (const char*) and numeric
    // (double) so the same call site works for markers and test values.
    // Emitted only when the expect preprocessor actually injected the calls
    // (tracked as usedPolyfillHelpers).
    if (!a || !!helpers?.has('__tc_print') || !!helpers?.has('__tc_println')) {
      guardBody.push(
        'inline void __tc_print(const char* s) { printf("%s", s); }',
        'inline void __tc_print(double v) { printf("%g", v); }',
        'inline void __tc_println(const char* s) { printf("%s\\n", s); }',
        'inline void __tc_println(double v) { printf("%g\\n", v); }',
      );
    }

    // Per-peripheral bus state — gated on the same ctx.analysis.usesX flags as
    // forcedIncludes, so an unused peripheral emits no state (and its header is
    // not included). Mirrors framework-esp32's shimLines espInit block.
    if (uses('usesI2C') && chip.i2c) {
      for (let i = 0; i < chip.i2c.controllers.length; i++) guardBody.push(...i2cInitLines(chip, i));
    }
    if (uses('usesSPI') && chip.spi) {
      for (let i = 0; i < chip.spi.controllers.length; i++) guardBody.push(...spiInitLines(chip, i));
    }
    if (uses('usesUart') && chip.uart) {
      for (let i = 0; i < chip.uart.controllers.length; i++) guardBody.push(...uartInitLines(chip, i));
    }
    if (uses('usesUsb') && chip.usb) {
      guardBody.push(...usbdDeviceLines(chip));
      for (let i = 0; i < chip.usb.cdcInstances; i++) guardBody.push(...usbInitLines(chip, i));
    }
    if (uses('usesADC') && chip.adc) guardBody.push(...adcInitLines(chip, collectUsedPins(program, 'adc')));
    if (uses('usesPWM') && chip.pwm) guardBody.push(...pwmInitLines(chip, collectUsedPins(program, 'pwm', chip)));
    if (uses('usesDAC') && chip.dac) guardBody.push(...dacInitLines(chip));
    if (uses('usesHwtimer') && chip.hwtimer) guardBody.push(...hwtimerInitLines(chip));
    if (uses('usesInterrupts')) guardBody.push(...interruptInitLines(chip));
    if (uses('usesWDT') && chip.wdt) guardBody.push(...wdtInitLines(chip));
    if (uses('usesBle')) guardBody.push(...bleInitLines());
    // Display runtime (rect/text renderer): the DIRECT-call display path (user
    // code calling screen.display.fillRect etc., no @typecad/ui). Emitted only
    // when the program uses display.* but is NOT a UI program — the UI display
    // adapter (emitted by cuttlefish's emitUIRuntime, solely under entryHasUI())
    // defines the same display_init symbol, so emitting both would collide.
    // `providesDisplayAdapter()` is a static capability (always true here) and
    // does NOT track whether the adapter is actually emitted for THIS build, so
    // the per-program UI signal (entryHasUI) is the correct gate. Without this,
    // a direct display.* program has no definition for display_init/
    // display_fill_rect/draw_rect/draw_text/flush (the gfx runtime was
    // previously dead code).
    if (uses('usesDisplay') && !entryHasUI()) {
      const rt = buildDisplayRuntime(this._displayState.profile);
      guardBody.push(...rt.stateLines);
      guardBody.push(rt.fontTable);
      guardBody.push(rt.helpers);
    }
    if (uses('usesWifi')) guardBody.push(...wifiInitLines());
    if (uses('usesHttp')) guardBody.push(...httpInitLines());
    if (uses('usesMqtt')) guardBody.push(...mqttInitLines());
    if (uses('usesPreferences')) guardBody.push(...preferencesInitLines());
    if (uses('usesFS')) guardBody.push(...fsInitLines());
    if (uses('usesRandom')) guardBody.push(...randomInitLines());
    // STM32F4: keep the core debug port alive across WFI sleep. The DBGMCU
    // gates PPB access while the core sleeps unless DBGMCU_CR DBG_SLEEP/
    // DBG_STOP/DBG_STANDBY are set — without them openocd cannot examine or
    // halt the running target ("Failed to read memory at 0xe000ed04", "AP
    // write error, reset will not halt"), and with no RST pad on boards like
    // the Black Pill the only recovery is the BOOT0 bootloader. Zephyr's
    // CONFIG_STM32_ENABLE_DEBUG_SLEEP_STOP sets only DBG_STOP on F4 (the
    // soc_config.c F1/L1 branch is the one that sets DBG_SLEEP), so the bits
    // are set here at boot, unconditionally for dev boards.
    // (soc is empty on board-resolved chips — the SoC name rides in the
    // qualified id's variant segment, e.g. 'blackpill_f411ce/stm32f411xe'.)
    if (chip.soc.startsWith('stm32f4') || /stm32f4\d*/.test(chip.id)) {
      guardBody.push(...stm32f4DbgmcuLines());
    }

    const lines: string[] = [];
    if (guardBody.length > 0) {
      lines.push(
        '// cuttlefish runtime shim. Wrapped in a single include guard so the',
        '// block is safe to emit into multiple headers and .cpp files within',
        '// one translation unit (a .cpp may #include several headers that each',
        '// carry the shim). The guard ensures the definitions are seen exactly',
        '// once per TU.',
        '#ifndef CUTTLEFISH_SHIM_DEFINED',
        '#define CUTTLEFISH_SHIM_DEFINED',
        ...guardBody,
        '#endif // CUTTLEFISH_SHIM_DEFINED',
      );
    }

    // Devicetree specs — one per board-defined GPIO pin, but ONLY for pins the
    // program actually addresses (lowerGpio routes by pin number, and the
    // structured gpio.* hal-op pins are visible here) plus aliases named
    // verbatim in raw code (rawCpp escape hatches). Emitted OUTSIDE the single
    // CUTTLEFISH_SHIM_DEFINED guard with a per-symbol guard: per-file pin sets
    // differ, and in a multi-header TU the first header's TU-wide guard would
    // otherwise hide the second header's specs. Without a program (capability
    // query), emit them all.
    const usedPins = this.collectGpioPinUsage(program);
    const dtTextRefs = this.collectRawMatches(program, /__tc_dt_([A-Za-z0-9_]+)/g);
    for (const spec of chip.gpio.dtSpecs) {
      if (program && !usedPins.has(spec.pin) && !dtTextRefs.has(spec.dtSpec)) continue;
      const guard = `__TC_DT_${spec.dtSpec.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}_SPEC`;
      lines.push(
        `#ifndef ${guard}`,
        `#define ${guard}`,
        `static const struct gpio_dt_spec __tc_dt_${spec.dtSpec} = GPIO_DT_SPEC_GET(DT_ALIAS(${spec.dtSpec}), gpios);`,
        `#endif // ${guard}`,
      );
    }

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

    // GPIO read shim: emitted only when something actually reads a pin at
    // runtime — user digitalRead() calls, the @typecad/safety voter (calls
    // __tc_gpio_read directly), or the UI runtime header's digitalRead() poll
    // (init-press-input.ts). A program that only writes/toggles GPIO needs
    // neither the dispatcher nor the reader.
    //
    // The signature is `int` to match wiring_compat's forward declaration —
    // a uint32_t definition alongside it would leave the declared int
    // overload undefined (int wins overload resolution for small integer
    // arguments).
    //
    // The pin is a RUNTIME value here (the UI pin-watch table and safety's
    // voter pass whatever pin they were handed), so the controller cannot be
    // baked in as a single DT_NODELABEL on a multi-controller SoC (ESP32-S3:
    // pins 0–31 → gpio0, 32–48 → gpio1). Emit a tiny __tc_gpio_dev(pin)
    // dispatcher that resolves the owning controller's device per pin;
    // single-controller SoCs collapse it to a one-liner. Each DT_NODELABEL is
    // still compile-time-resolved per branch, so it is always statically valid.
    if (this.needsGpioReadShim(program, ctx)) {
      lines.push(...emitGpioDevDispatcher(chip));
      lines.push(
        'inline int __tc_gpio_read(int pin) { return gpio_pin_get_raw(__tc_gpio_dev(static_cast<uint32_t>(pin)), __tc_gpio_pin(static_cast<uint32_t>(pin))); }',
      );
    }
    // __tc_gpio_write / __tc_delay_us are only referenced via @typecad/safety
    // lowering, so they stay gated on it.
    if (program && programUsesSafety(program)) {
      lines.push(
        'inline void __tc_gpio_write(uint32_t pin, uint32_t value) { gpio_pin_set_raw(__tc_gpio_dev(pin), __tc_gpio_pin(pin), value); }',
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
    const dacPins = new Set<number>();
    const hwtimerInstances = new Set<number>();
    let usesWifiOps = false;
    let usesHttpOps = false;
    let usesMqttOps = false;
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
          if (op.operation === 'dac.write' && typeof op.pin === 'number') {
            dacPins.add(op.pin);
          }
          if (typeof op.operation === 'string' && op.operation.startsWith('hwtimer.')) {
            const inst = typeof op.instance === 'number'
              ? op.instance
              : parseInt(String(op.instance), 10);
            if (!isNaN(inst)) hwtimerInstances.add(inst);
          }
          if (typeof op.operation === 'string' && op.operation.startsWith('wifi.')) {
            usesWifiOps = true;
          }
          if (typeof op.operation === 'string' && op.operation.startsWith('http.')) {
            usesHttpOps = true;
          }
          if (typeof op.operation === 'string' && op.operation.startsWith('mqtt.')) {
            usesMqttOps = true;
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

    // ── DAC pin validity ────────────────────────────────────────────────────
    // dac.write resolves a HAL pin to a channel via the chip descriptor's
    // dac.channels map. A pin not in that map lowers to a comment (silent
    // no-op), and a chip without a `dac` entry (nRF52840, ESP32-S3) has no DAC
    // at all. Flag either case so the user gets a clear message instead of a
    // pin that silently does nothing.
    if (dacPins.size > 0) {
      const dacChannels = new Set((chip.dac?.channels ?? []).map((c) => c.pin));
      for (const pin of dacPins) {
        if (!dacChannels.has(pin)) {
          diags.push({
            severity: 'error',
            code: 'zephyr-dac-pin-unavailable',
            message: `GPIO ${pin} is not a DAC channel on ${chip.id} and cannot be driven with dac.write.`,
            hint: dacChannels.size > 0
              ? `Use a DAC-capable pin. On ${chip.id}: ${[...dacChannels].sort((x, y) => x - y).join(', ')}.`
              : `${chip.id} has no DAC. Use an esp32_devkitc target (ESP32 DAC on GPIO25/26).`,
            source: program.fileName,
          });
        }
      }
    }

    // ── Hardware-timer instance validity ────────────────────────────────────
    // hwtimer.* resolves the instance index to a counter device via the chip
    // descriptor's hwtimer.controllers. A chip without that entry (or an
    // out-of-range instance) lowers to a comment — flag it so the user knows
    // the timer will never fire.
    if (hwtimerInstances.size > 0) {
      const controllerCount = chip.hwtimer?.controllers.length ?? 0;
      for (const inst of hwtimerInstances) {
        if (controllerCount === 0) {
          diags.push({
            severity: 'error',
            code: 'zephyr-hwtimer-unavailable',
            message: `Hardware timer instance ${inst} is used but ${chip.id} exposes no free counter device.`,
            hint: `${chip.id} declares no hwtimer.controllers. Use a target with a free counter (e.g. nRF RTC1).`,
            source: program.fileName,
          });
        } else if (inst < 0 || inst >= controllerCount) {
          diags.push({
            severity: 'error',
            code: 'zephyr-hwtimer-instance-out-of-range',
            message: `Hardware timer instance ${inst} is out of range on ${chip.id} (0..${controllerCount - 1}).`,
            source: program.fileName,
          });
        }
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

    // ── HTTP target validity ──────────────────────────────────────────────
    // HTTP needs a network transport. On Zephyr the only networked target is
    // the ESP32 (WiFi) — the nRF52840 has neither WiFi nor Ethernet wired in
    // its chip descriptor, so the shim's socket/connect calls would fail at
    // runtime. Flag http usage on a chip without a network radio so the user
    // gets a clear "use an ESP32 target" message instead of an opaque link or
    // runtime failure. (HTTP rides over WiFi here; an Ethernet target would
    // set wifi.supported via a different transport flag if/when added.)
    if (usesHttpOps && !chip.wifi?.supported) {
      diags.push({
        severity: 'error',
        code: 'zephyr-http-unavailable-on-target',
        message: `HTTP ops are used but ${chip.id} has no network stack available.`,
        hint: `Use an esp32s3_devkitc or esp32_devkitc target (HTTP needs a network transport; the ESP32 WiFi radio provides it).`,
        source: program.fileName,
      });
    }

    // ── MQTT target validity ─────────────────────────────────────────────
    // Same constraint as HTTP: MQTT needs a network transport to reach a broker.
    // Flag mqtt usage on a radioless chip so the user picks a networked target.
    if (usesMqttOps && !chip.wifi?.supported) {
      diags.push({
        severity: 'error',
        code: 'zephyr-mqtt-unavailable-on-target',
        message: `MQTT ops are used but ${chip.id} has no network stack available.`,
        hint: `Use an esp32s3_devkitc or esp32_devkitc target (MQTT needs a network transport; the ESP32 WiFi radio provides it).`,
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
    // String-method lowering is shared across targets (see string-method-
    // registry). Zephyr's strings are const char*, so the __tc_* helpers this
    // rewrites to (defined by the string_methods polyfill) take const char*.
    // includes/startsWith lower to inline strstr/strncmp (matching framework-
    // arduino); everything else → a __tc_* helper call.
    v = applyStringMethodRewrites(v, {
      wrapReceiverFor: new Set(['indexOf']),
      special: {
        includes: (recv, args) => `(strstr(${recv}, ${args[0]}) != NULL)`,
        startsWith: (recv, args) => `(strncmp(${recv}, ${args[0]}, strlen(${args[0]})) == 0)`,
      },
    });
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

  renderBoardDefinitionAccess(
    chain: string[],
    boardConstants?: BoardConstants,
  ): string | undefined {
    // Fold Board.definition.<path> / Pins.definition.<path> into the literal
    // board-constant value, mirroring framework-arduino. The renderer calls
    // this (expression-renderer.ts) with the populated boardConstants from the
    // loaded board/MCU package, so a known path resolves to its scalar value.
    // `board.resolve` HAL ops, by contrast, are constant-folded earlier at
    // IR-build time and never reach here; see lowering/board.ts.
    if (chain.length < 3) return undefined;
    if (chain[0] !== 'Board' && chain[0] !== 'Pins') return undefined;
    if (chain[1] !== 'definition') return undefined;
    if (!boardConstants) return undefined;
    const path = chain.slice(2).join('.');
    const val = boardConstants.get(path);
    return val !== undefined ? String(val) : undefined;
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

  // ── Interrupt safety ─────────────────────────────────────────────────────
  // Zephyr ISRs run above thread context: anything that sleeps (k_msleep),
  // pends, or takes a driver lock is illegal there (asserted by the kernel in
  // debug builds; corrupts scheduler state otherwise). The names below are the
  // IR-level callees cuttlefish's interrupt-analysis pass matches (the same
  // keys ArduinoStrategy uses; timing.delay/delay_microseconds hal-ops are
  // mapped back to the bare names by the analyzer itself).
  isrUnsafeOperations(): Map<string, { reason: string; severity: 'warning' | 'info' }> {
    return new Map<string, { reason: string; severity: 'warning' | 'info' }>([
      ['delay', {
        reason: 'delay() lowers to k_msleep(), which sleeps the calling thread — illegal in Zephyr interrupt context (submit a k_work item or arm a k_timer instead)',
        severity: 'warning',
      }],
      ['delayMicroseconds', {
        reason: 'delayMicroseconds() busy-waits the CPU for the full delay, stalling every lower-priority interrupt and the scheduler for its duration',
        severity: 'warning',
      }],
      ['console.log', {
        reason: 'console output lowers to printk(), which is ISR-legal but slow and lock-protected (CONFIG_PRINTK_SYNC) — it adds jitter to every interrupt behind it',
        severity: 'info',
      }],
      ['console.error', {
        reason: 'console output lowers to printk(), which is ISR-legal but slow and lock-protected (CONFIG_PRINTK_SYNC) — it adds jitter to every interrupt behind it',
        severity: 'info',
      }],
      ['console.warn', {
        reason: 'console output lowers to printk(), which is ISR-legal but slow and lock-protected (CONFIG_PRINTK_SYNC) — it adds jitter to every interrupt behind it',
        severity: 'info',
      }],
      ['I2C0', {
        reason: 'I2C transactions may sleep (driver locking + clock stretching) and are not callable from Zephyr interrupt context',
        severity: 'warning',
      }],
      ['I2C1', {
        reason: 'I2C transactions may sleep (driver locking + clock stretching) and are not callable from Zephyr interrupt context',
        severity: 'warning',
      }],
      ['SPI0', {
        reason: 'SPI transfers take driver locks and may wait on DMA completion — not safe in Zephyr interrupt context',
        severity: 'warning',
      }],
      ['SPI1', {
        reason: 'SPI transfers take driver locks and may wait on DMA completion — not safe in Zephyr interrupt context',
        severity: 'warning',
      }],
      ['UART0', {
        reason: 'UART output via uart_poll_out blocks until the TX FIFO has room — a full FIFO stalls the ISR',
        severity: 'info',
      }],
      ['UART1', {
        reason: 'UART output via uart_poll_out blocks until the TX FIFO has room — a full FIFO stalls the ISR',
        severity: 'info',
      }],
    ]);
  }

  ambientTypeDeclarations(): string[] {
    // Preferences is the only HAL surface the framework lowers that is used as
    // a bare global (the HAL Preferences class is exported, but the canonical
    // usage — and the hal/tests/14-preferences hardware suite — references it
    // as an unqualified `Preferences.*`). Declaring it ambient lets those
    // programs type-check and resolve to the preferences.* ops the lowering
    // in src/lowering/preferences.ts handles (ZMS-backed settings). Mirrors
    // framework-arduino's ambient Preferences declaration.
    return [
      "",
      "  // Persistent key/value store (ZMS-backed Zephyr settings — see",
      "  // src/lowering/preferences.ts). begin/end carry the namespace prefix;",
      "  // typed put/get round-trip through an in-RAM cache + settings_save_one.",
      "  const Preferences: {",
      "    begin(name: string, readOnly?: boolean): void;",
      "    end(): void;",
      "    clear(): void;",
      "    putInt(key: string, value: number): void;",
      "    getInt(key: string, defaultValue: number): number;",
      "    putUInt(key: string, value: number): void;",
      "    getUInt(key: string, defaultValue: number): number;",
      "    putBool(key: string, value: boolean): void;",
      "    getBool(key: string, defaultValue: boolean): boolean;",
      "    putFloat(key: string, value: number): void;",
      "    getFloat(key: string, defaultValue: number): number;",
      "    putString(key: string, value: string): void;",
      "    getString(key: string, defaultValue: string): string;",
      "    remove(key: string): void;",
      "  };",
    ];
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
  // Zephyr is a no-STL target (hasVector/hasString = false), so array/string
  // literals lower to __tc_StaticArray / const char* and string methods lower
  // to __tc_* helpers — both need STL-free definitions emitted here (there is
  // no shared-runtime fallback; the pipeline sources 100% of polyfills from
  // generateNativePolyfills). Mirrors framework-arduino's AVR polyfills.

  nativePolyfills(): Set<string> {
    // cuttlefish_halt: always (the runtime header may reference it).
    // string_methods / static_array: STL-free array + string helpers a no-STL
    //   target needs (mutated/struct array literals + any string method).
    // timer_methods: k_timer/k_work pool for setInterval/setTimeout (gated on
    //   timerCallCount at emit time in generateNativePolyfills).
    // async_runtime: heap-free static Promise/microtask runtime (no STL needed).
    return new Set<string>([
      'cuttlefish_halt', 'wiring_compat', 'string_methods', 'static_array',
      'timer_methods', 'async_runtime',
    ]);
  }

  generateNativePolyfills(program?: ProgramIR, ctx?: PlatformContext): RuntimePolyfillIR[] {
    // wiring_compat (digitalRead/HIGH/LOW macros + the __tc_gpio_read forward
    // declaration) is emitted only when something reads a pin: user
    // digitalRead() calls, the @typecad/safety voter, or the UI runtime
    // header's unconditional digitalRead() poll (init-press-input.ts — the
    // loop body is dead when no pin watchers are configured but must
    // compile). needsGpioReadShim defaults to true without analysis so
    // capability queries keep seeing it.
    const wiringCompat: RuntimePolyfillIR = {
      // Wiring-compatibility shims for symbols the UI runtime header
      // references unconditionally (e.g. init-press-input.ts polls pin
      // watchers via digitalRead/HIGH/LOW even when none are configured —
      // the loop body is dead but must compile). Zephyr lowers GPIO through
      // its __tc_gpio_* helpers (defined in shimLines); these macros route
      // the Wiring tokens to them.
      kind: 'polyfill',
      id: 'wiring_compat',
      domain: 'standard' as const,
      requiredIncludes: [],
      forwardDeclarations: [
        // Forward-declared so the digitalRead macro (below) can reference it
        // before the shim block defines the body. The shim emits the full
        // definition via gpio_pin_get_raw.
        'int __tc_gpio_read(int pin);',
      ],
      helperStructs: [],
      helperFunctions: [],
      shimMacros: [
        '#ifndef HIGH',
        '#define HIGH 1',
        '#endif',
        '#ifndef LOW',
        '#define LOW 0',
        '#endif',
        '#ifndef digitalRead',
        '#define digitalRead(pin) __tc_gpio_read(pin)',
        '#endif',
      ],
      dependencies: [],
    };
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
      ...(this.needsGpioReadShim(program, ctx) ? [wiringCompat] : []),
      {
        // STL-free string-method polyfills. String methods (.toUpperCase(),
        // .includes(), .substring(), …) lower at IR level to __tc_* helpers for
        // every target; this supplies their definitions. Minimal-libc friendly:
        // only <cstring> primitives (no <cctype> — case conversion is inline
        // ASCII so the polyfill is self-contained). Mirrors framework-arduino.
        kind: 'polyfill',
        id: 'string_methods',
        domain: 'embedded' as const,
        requiredIncludes: ['<cstring>'],
        forwardDeclarations: [],
        helperStructs: [],
        helperFunctions: [`
// TypeCAD string method polyfills (Zephyr, minimal-libc).
#ifndef CUTTLEFISH_STR_BUF_SIZE
#define CUTTLEFISH_STR_BUF_SIZE 64
#endif
bool __tc_endsWith(const char* s, const char* suffix) { int sl = strlen(s), tl = strlen(suffix); return sl >= tl && strcmp(s + sl - tl, suffix) == 0; }
const char* __tc_toUpperCase(const char* s) { static char buf[2][CUTTLEFISH_STR_BUF_SIZE]; static uint8_t slot = 0; slot ^= 1; char* b = buf[slot]; strncpy(b, s, CUTTLEFISH_STR_BUF_SIZE - 1); b[CUTTLEFISH_STR_BUF_SIZE - 1] = '\\0'; for (char* p = b; *p; p++) { if (*p >= 'a' && *p <= 'z') { *p = static_cast<char>(*p - 32); } } return b; }
const char* __tc_toLowerCase(const char* s) { static char buf[2][CUTTLEFISH_STR_BUF_SIZE]; static uint8_t slot = 0; slot ^= 1; char* b = buf[slot]; strncpy(b, s, CUTTLEFISH_STR_BUF_SIZE - 1); b[CUTTLEFISH_STR_BUF_SIZE - 1] = '\\0'; for (char* p = b; *p; p++) { if (*p >= 'A' && *p <= 'Z') { *p = static_cast<char>(*p + 32); } } return b; }
const char* __tc_trim(const char* s) { static char buf[2][CUTTLEFISH_STR_BUF_SIZE]; static uint8_t slot = 0; slot ^= 1; char* b = buf[slot]; while (*s == ' ' || *s == '\\t' || *s == '\\n' || *s == '\\r') s++; int len = strlen(s); while (len > 0 && (s[len-1] == ' ' || s[len-1] == '\\t' || s[len-1] == '\\n' || s[len-1] == '\\r')) len--; int cplen = len < CUTTLEFISH_STR_BUF_SIZE - 1 ? len : CUTTLEFISH_STR_BUF_SIZE - 1; strncpy(b, s, cplen); b[cplen] = '\\0'; return b; }
const char* __tc_substring2(const char* s, int start, int end) { static char buf[2][CUTTLEFISH_STR_BUF_SIZE]; static uint8_t slot = 0; slot ^= 1; char* b = buf[slot]; int slen = strlen(s); if (start < 0) start = 0; if (end > slen) end = slen; if (end < start) end = start; int len = end - start; if (len >= CUTTLEFISH_STR_BUF_SIZE) len = CUTTLEFISH_STR_BUF_SIZE - 1; strncpy(b, s + start, len); b[len] = '\\0'; return b; }
const char* __tc_substring1(const char* s, int start) { return __tc_substring2(s, start, strlen(s)); }
const char* __tc_slice2(const char* s, int start, int end) { return __tc_substring2(s, start, end); }
const char* __tc_slice1(const char* s, int start) { return __tc_substring2(s, start, strlen(s)); }
const char* __tc_replace(const char* s, const char* old, const char* repl) { static char buf[2][CUTTLEFISH_STR_BUF_SIZE]; static uint8_t slot = 0; slot ^= 1; char* b = buf[slot]; const char* pos = strstr(s, old); if (!pos) { strncpy(b, s, CUTTLEFISH_STR_BUF_SIZE - 1); b[CUTTLEFISH_STR_BUF_SIZE - 1] = '\\0'; return b; } int beforeLen = static_cast<int>(pos - s); int oldLen = static_cast<int>(strlen(old)); int replLen = static_cast<int>(strlen(repl)); if (beforeLen + replLen + static_cast<int>(strlen(pos + oldLen)) >= CUTTLEFISH_STR_BUF_SIZE) { strncpy(b, s, CUTTLEFISH_STR_BUF_SIZE - 1); b[CUTTLEFISH_STR_BUF_SIZE - 1] = '\\0'; return b; } memcpy(b, s, beforeLen); memcpy(b + beforeLen, repl, replLen); strcpy(b + beforeLen + replLen, pos + oldLen); return b; }
const char* __tc_charAt(const char* s, int idx) { static char buf[2][2]; static uint8_t slot = 0; slot ^= 1; buf[slot][0] = s[idx]; buf[slot][1] = '\\0'; return buf[slot]; }
int __tc_charCodeAt(const char* s, int idx) { return static_cast<int>(static_cast<unsigned char>(s[idx])); }
int __tc_indexOf(const char* s, const char* needle) { const char* p = strstr(s, needle); return p ? static_cast<int>(p - s) : -1; }
`],
        shimMacros: [],
        dependencies: [],
      },
      {
        // STL-free fixed-size array wrapper. Mutated/struct-element array
        // literals and array methods (.push/.pop/.map/.filter) lower to
        // __tc_StaticArray<T,N>; this supplies the template. Idempotent guard
        // so a redefinition is a no-op. Mirrors framework-arduino.
        kind: 'polyfill',
        id: 'static_array',
        domain: 'embedded' as const,
        requiredIncludes: [],
        forwardDeclarations: [],
        helperStructs: [],
        helperFunctions: [`
#ifndef __TC_STATIC_ARRAY_DEFINED
#define __TC_STATIC_ARRAY_DEFINED
template<typename T, int N>
struct __tc_StaticArray {
    T data[N];
    int _size;
    __tc_StaticArray() : _size(0) {}
    int length() const { return _size; }
    int size() const { return _size; }
    void push(T val) { if (_size < N) data[_size++] = val; }
    T pop() { return (_size > 0) ? data[--_size] : T(); }
    int indexOf(T val) const { for (int i = 0; i < _size; i++) if (data[i] == val) return i; return -1; }
    T& operator[](int i) { return data[i]; }
    const T& operator[](int i) const { return data[i]; }
    T* begin() { return &data[0]; }
    T* end() { return &data[_size]; }
    const T* begin() const { return &data[0]; }
    const T* end() const { return &data[_size]; }
};
#endif
`],
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
        // Polyfill definitions emit before shimLines, but the runtime's
        // timer bodies call millis() (defined in shimLines) — declare it
        // first so the polyfill compiles even for programs whose source
        // has no explicit timing call.
        forwardDeclarations: ['unsigned long millis();'],
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

  // ── Strategy-owned display/touch adapter seam ────────────────────────────
  // Zephyr owns its display + touch adapters: the UI display adapter bridges
  // the in-tree CuttlefishGFX class to the panel (per-controller init + wire
  // format, see src/display/ui-adapter.ts), and the touch adapters drive the
  // FT6336U (I2C capacitive) and XPT2046 (SPI resistive) controllers via
  // Zephyr's bus APIs (src/display/touch-adapter.ts). Both live in this
  // package so cuttlefish carries no Zephyr/Wiring-specific display or touch
  // knowledge. Mirrors ArduinoStrategy's provides*/resolve* pattern.

  providesDisplayAdapter(): boolean { return true; }

  resolveDisplayAdapter(display: ResolvedDisplay): DisplayAdapterCode | undefined {
    const code = zephyrDisplayAdapterGenerator(display);
    return code ?? undefined;
  }

  providesTouchAdapter(): boolean { return true; }

  resolveTouchAdapter(touch: TouchProfile): TouchAdapterCodegen | undefined {
    return zephyrTouchAdapter(touch);
  }

  // Named display-profile registry: maps config `profile` values (e.g.
  // "st7796-zephyr") to the shared DisplayProfile shape so transpile.ts can
  // resolve them per-framework. The Zephyr profiles are DT-binding descriptors;
  // BUILT_IN_PROFILES (display/profiles.ts) is the single DT-binding →
  // shared-shape mapping, shared with the preview's registry loader.
  getProfileRegistry(): Map<string, DisplayProfile> {
    return new Map(Object.entries(BUILT_IN_PROFILES));
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
    // The STM32 Black Pill ships a verified ST-Link probe method in its board
    // package (openocd runner over SWD, with the reset_config quirk for the
    // unwired SRST line), so F5 attaches natively out of the box.
    if (boardId.startsWith('blackpill_')) {
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
