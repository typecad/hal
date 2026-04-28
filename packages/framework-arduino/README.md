# @typehal/framework-arduino

Arduino framework strategy for TypeHAL code generation.

## Overview

`@typehal/framework-arduino` implements the Arduino-compatible code generation strategy used by TypeHAL. It emits Arduino-style C++ calls such as `pinMode()`, `digitalWrite()`, and `Serial` operations, and provides helper utilities for Arduino CLI metadata, library discovery, and runtime polyfills.

## Quick start

Add the package to your `typehal.config.ts`:

```ts
import type { TypehalConfig } from '@typehal/core';

const config: TypehalConfig = {
  target: 'avr',
  board: '@typehal/board-arduino-uno',
  framework: '@typehal/framework-arduino',
  fqbn: 'arduino:avr:uno',
  output: { framework: 'arduino', optimize: 'size' },
};

export default config;
```

Then run the CLI:

```bash
npx typehal src/main.ts --compile --upload --port COM4
```

## How to use

### Framework strategy

When `framework` is set to `@typehal/framework-arduino`, TypeHAL generates code compatible with the Arduino runtime and Arduino CLI toolchain.

### Key exports

This package exposes the main Arduino strategy and helpers for advanced workflows:

- `ArduinoStrategy`
- `FrameworkStrategy` (alias for `ArduinoStrategy`)
- `compileArduinoSketch`
- `uploadArduinoSketch`
- `monitorArduinoSketch`
- `loadArduinoCliMetadata`
- `getInstalledLibraries`
- `generateArduinoLibDecl`
- `buildArduinoClassNameMap`
- `arduinoAsyncPolyfill`
- `generateStdStringPolyfill`

### Arduino library support

The package can discover installed Arduino libraries and generate TypeScript declaration stubs for library imports. This is useful when using third-party Arduino libraries from TypeScript firmware.

### Serial and console polyfills

`@typehal/framework-arduino` includes helpers for detecting `Serial.begin()` usage and injecting Arduino console support automatically when needed.

---

## AVR safety features

The following features are automatically applied when targeting AVR (Arduino Uno, Mega, etc.) or ESP32.

### Panic handler — `typehal_halt`

TypeScript `throw` statements compile to a `typehal_halt("PANIC")` macro call instead of a bare `for(;;){}` loop. The macro prints the message over Serial (using `F()` for flash storage) then halts:

```cpp
#ifndef typehal_halt
#define typehal_halt(msg) do { Serial.println(F(msg)); for (;;) {} } while (0)
#endif
```

### Flash-storage string literals — `F()`

Bare string literals passed to `console.log` / `console.error` / `console.warn` are automatically wrapped in the Arduino `F()` macro so they reside in program flash rather than precious SRAM:

```ts
// TypeScript
console.log("Hello AVR");
console.error("bad state");
```

```cpp
// Generated C++
Serial.println(F("Hello AVR"));
Serial.print(F("[ERROR] ")); Serial.println(F("bad state"));
```

Variable expressions are passed through without wrapping.

### C-stdlib string predicates (no `String` heap allocation)

`.includes()`, `.startsWith()`, and `.endsWith()` on `const char*` values are lowered to C standard-library calls instead of constructing Arduino `String` objects:

| TypeScript               | Generated C++                             |
|--------------------------|-------------------------------------------|
| `s.includes(sub)`        | `(strstr(s, sub) != NULL)`                |
| `s.startsWith(prefix)`   | `(strncmp(s, prefix, strlen(prefix)) == 0)` |
| `s.endsWith(suffix)`     | `__tc_endsWith(s, suffix)`                |

### Configurable string buffer size — `TYPEHAL_STR_BUF_SIZE`

String-method polyfills (`.toUpperCase()`, `.toLowerCase()`, `.trim()`, `.replace()`, etc.) use a stack-allocated buffer whose size is controlled by a compile-time macro. Override it in your sketch or build flags:

```cpp
#define TYPEHAL_STR_BUF_SIZE 128  // default is 64
```

### Heap-allocation validator

On AVR targets, `new ClassName(args)` in variable declarations produces a compile-time `heap-allocation-avr` error diagnostic. AVR has only 2 KB of SRAM and no heap manager — use stack or global objects instead:

```ts
// ❌ Error on AVR:
const sensor = new BME280(0x76);

// ✅ Correct — stack/global allocation:
let sensor: BME280;   // emits: BME280 sensor;
```

### `IRAM_ATTR` for ESP32 ISR functions

On ESP32 targets, functions registered as interrupt service routines (ISR callbacks) are automatically prefixed with `IRAM_ATTR` to ensure they run from fast internal RAM:

```cpp
// Generated on ESP32:
IRAM_ATTR void myButton_isr_0();
IRAM_ATTR void myButton_isr_0() { ... }
```

---

## New namespaces

### `Timing` — timing utilities

| TypeHAL                      | Generated C++                  |
|-------------------------------|--------------------------------|
| `Timing.millis()`             | `millis()`                     |
| `Timing.micros()`             | `micros()`                     |
| `Timing.delay(ms)`            | `delay(ms)`                    |
| `Timing.delayMicroseconds(us)`| `delayMicroseconds(us)`        |

```ts
const t0 = Timing.millis();
Timing.delay(500);
const elapsed = Timing.millis() - t0;
```

### `EEPROM` — non-volatile storage

Requires `<EEPROM.h>` (included automatically by the board framework).

| TypeHAL                      | Generated C++                  |
|-------------------------------|--------------------------------|
| `EEPROM.read(addr)`           | `EEPROM.read(addr)`            |
| `EEPROM.write(addr, val)`     | `EEPROM.write(addr, val)`      |
| `EEPROM.update(addr, val)`    | `EEPROM.update(addr, val)`     |
| `EEPROM.length()`             | `EEPROM.length()`              |
| `EEPROM.get(addr, ref)`       | `EEPROM.get(addr, ref)`        |
| `EEPROM.put(addr, ref)`       | `EEPROM.put(addr, ref)`        |

`EEPROM.update()` is preferred over `EEPROM.write()` when the value may not have changed — it skips the write cycle and extends EEPROM lifetime.

### `WDT` — watchdog timer

Controls the AVR hardware watchdog. Requires `<avr/wdt.h>`.

| TypeHAL                      | Generated C++                    |
|-------------------------------|----------------------------------|
| `WDT.enable('2s')`            | `wdt_enable(WDTO_2S)`            |
| `WDT.reset()`                 | `wdt_reset()`                    |
| `WDT.disable()`               | `wdt_disable()`                  |

Supported timeout strings: `'15ms'`, `'30ms'`, `'60ms'`, `'120ms'`, `'250ms'`, `'500ms'`, `'1s'`, `'2s'`, `'4s'`, `'8s'`. Calling `WDT.enable()` without an argument defaults to `WDTO_2S`.

```ts
WDT.enable('1s');   // reset within 1 second or the board reboots

function loop(): void {
  WDT.reset();      // pet the watchdog each loop iteration
  doWork();
}
```

