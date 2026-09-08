// ---------------------------------------------------------------------------
// HAL compile-time semantic functions
//
// These functions are resolved to HALOpIR nodes by the transpiler's HAL
// resolver.  The framework strategy translates each operation into
// framework-specific C++ at code generation time.
//
// EMIT BOUNDARY: This file is a canonical entry point of the HAL lowering
// surface (A) — its C++ output lands in user programs. The emitted bytes are
// covered by the TypeCAD Runtime Exception (see RUNTIME_EXCEPTION.md at the
// repository root) and are not subject to the license of this tool source.
//
// Pin parameters accept both `number` (legacy framework pin number) and
// `string` (MCU port name like "PB5"). The transpiler resolves port names
// to framework pin numbers via the MCU package's pin mapping.
// ---------------------------------------------------------------------------

import type { SerialValue } from './types.js';

// ---------------------------------------------------------------------------
// GPIO — digital pin control
// ---------------------------------------------------------------------------

/** Set a digital pin HIGH or LOW. */
export function gpioWrite(pin: number | string, value: number | boolean): void {}
/** Read a digital pin. Returns HIGH (1) or LOW (0). */
export function gpioRead(pin: number | string): number { return 0; }
/** Toggle a digital pin. */
export function gpioToggle(pin: number | string): void {}
/** Thin GPIO (hal/gpio-pin.ts): configure with Zephyr flag tokens
 *  ("GPIO.OUTPUT | GPIO.PULL_UP"). The lowering maps token names to the
 *  GPIO_* macros; the emitted configure is guarded per pin (first use wins). */
export function gpioConfigure(pin: number | string, flags: number | string): void {}
/** GPIO.shiftOut/shiftIn: bit-banged shift via two pins (one op each). */
export function gpioShiftOut(dataPin: number | import('./gpio.js').Pin, clockPin: number | import('./gpio.js').Pin, value: number, msbFirst: boolean): void {}
export function gpioShiftIn(dataPin: number | import('./gpio.js').Pin, clockPin: number | import('./gpio.js').Pin, msbFirst: boolean): number { return 0; }

/** Thin GPIO read with FUSED guarded configure — one op, one statement-
 *  expression: correct in any expression position (if-conditions drop a
 *  method's leading side-effect ops, so get() must not rely on a separate
 *  configure op). */
export function gpioReadCfg(pin: number | string, flags: number | string): number { return 0; }

// ---------------------------------------------------------------------------
// PWM — pulse-width modulation
// ---------------------------------------------------------------------------

/** Thin PWM (hal/pwm-pin.ts): set pulse width in ns against the constructed
 *  period. The first use also applies the construction period
 *  (pwm_set_dt with an idle pulse), then pwm_set_pulse_dt. */
export function pwmSetPulse(pin: number | string, periodNs: number, pulseNs: number, controller: string = '', channel: number = -1): void {}
/** Thin PWM duty sugar: pulse = duty(0.0–1.0) × periodNs — one
 *  pwm_set_pulse_dt call, no 0–255 scaling. */
export function pwmSetDuty(pin: number | string, periodNs: number, duty: number, controller: string = '', channel: number = -1): void {}
/** Thin PWM: change the period at runtime (pwm_set_dt; the pulse resets to
 *  idle — Zephyr 4.4 has no period-only setter). */
export function pwmSetPeriod(pin: number | string, periodNs: number, controller: string = '', channel: number = -1): void {}

// ---------------------------------------------------------------------------
// ADC — analog-to-digital conversion
// ---------------------------------------------------------------------------

/** Thin ADC (hal/adc-pin.ts): raw read with construction-time gain/reference
 *  tokens ("ADC.GAIN_1_4" / "ADC.REF_INTERNAL"); empty strings
 *  mean "use the chip descriptor's defaults". */
export function adcReadRaw(pin: number | string, gain: number | string, reference: number | string, channel: number = -1, device: string = '', pinctrl: string = ''): number { return 0; }
/** Thin ADC: millivolts read (adc_raw_to_millivolts) with the same
 *  construction-time gain/reference tokens. */
export function adcReadMv(pin: number | string, gain: number | string, reference: number | string, channel: number = -1, device: string = '', pinctrl: string = ''): number { return 0; }

// ---------------------------------------------------------------------------
// Interrupts
// ---------------------------------------------------------------------------

/** Thin GPIO interrupts (hal/gpio-pin.ts onInterrupt): attach with Zephyr
 *  INT_* tokens ("GPIO.INT_EDGE_FALLING") instead of mode strings. */
export function interruptAttachFlags(pin: number | string, handler: string, intFlags: number | string): void {}
/** Detach an interrupt from a pin. */
export function interruptDetach(pin: number | string): void {}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** Time.sleep — yielding sleep in milliseconds (Zephyr: k_msleep). */
export function timeSleep(ms: number): void {}
/** Time.now — milliseconds since boot as a double (Zephyr: k_uptime_get). */
export function timeNow(): number { return 0; }
/** Time.nowUs — microseconds since boot as a double, uptime-derived
 *  (k_uptime_get() * 1000) on every board — uniform, monotonic. */
export function timeNowUs(): number { return 0; }
/** Time.busyWaitUs — spin-wait the given microseconds, no yield (Zephyr: k_busy_wait). */
export function timeBusyWaitUs(us: number): void {}

// ---------------------------------------------------------------------------
// I2C — inter-integrated circuit bus
// ---------------------------------------------------------------------------

// Thin I2C device (hal/i2c-target.ts): Zephyr register verbs. `hz` (0 =
// leave the bus at its current speed) applies once via a guarded
// i2c_configure on first use.
export function i2cRegWrite(bus: string, address: number, hz: number, reg: number, value: number): void {}
export function i2cRegRead(bus: string, address: number, hz: number, reg: number): number { return 0; }
export function i2cRegUpdate(bus: string, address: number, hz: number, reg: number, mask: number, value: number): void {}
export function i2cDevWrite(bus: string, address: number, hz: number, data: number[] | Uint8Array): void {}

// ---------------------------------------------------------------------------
// SPI — serial peripheral interface
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// USB — CDC-ACM serial over the USB connector (device stack)
// ---------------------------------------------------------------------------

/** Enable the USB device + open the CDC serial port with a baud hint. */
export function usbBegin(port: string): void {}
/** Disable the CDC serial port. */
export function usbEnd(port: string): void {}
/** Print value to the USB serial port. */
export function usbPrint(port: string, value: SerialValue): void {}
/** Print value with newline to the USB serial port. */
export function usbPrintln(port: string, value: SerialValue): void {}
/** Read a byte from the USB serial port (-1 if none). */
export function usbRead(port: string): number { return 0; }
/** Check if bytes are available from the USB serial port. */
export function usbAvailable(port: string): number { return 0; }
/** True when the host has opened the port (DTR asserted). */
export function usbConnected(port: string): boolean { return false; }
/** Thin waitLinked(): bounded DTR poll in the shim. */
export function usbWaitReady(port: string, timeoutMs: number): boolean { return false; }

// ---------------------------------------------------------------------------
// Board constant resolution
// ---------------------------------------------------------------------------

/** Thin DAC (hal/dac-pin.ts): raw dac_write_value with a construction-time
 *  resolution (0 = the chip descriptor's channel resolution). */
export function dacWriteValue(pin: number | string, value: number, resolution: number): void {}

// ---------------------------------------------------------------------------
// Watchdog timer (WDT)
// ---------------------------------------------------------------------------

/** Disable the watchdog timer. */
export function wdtDisable(): void {}

/** Thin Watchdog (hal/watchdog.ts): arm with the construction timeout in ms
 *  (wdt_install_timeout + wdt_setup). */
export function wdtSetup(timeoutMs: number): void {}
/** Thin Watchdog: feed (wdt_feed). */
export function wdtFeed(): void {}

/** Thin Counter (hal/counter.ts): register the alarm handler. */
export function counterOnAlarm(instance: number, handler: string): void {}
/** Thin Counter: apply hz as the top value and start (counter_start). */
export function counterStart(instance: number, hz: number): void {}
/** Thin Counter: stop (counter_stop). */
export function counterStop(instance: number): void {}

// Thin SPI device (hal/spi-target.ts): the op carries the construction facts
// (cs pin, hz, mode) so the shim state block and overlay child node derive
// from op facts alone (the sensor discipline). `rx` is the caller's buffer
// identifier ('' = write-only).
export function spiTransceiveDt(bus: string, cs: number, hz: number, mode: number, tx: number[] | Uint8Array, rx: Uint8Array | number[]): void {}
export function spiWriteDt(bus: string, cs: number, hz: number, mode: number, tx: number[] | Uint8Array): void {}
/** SPITarget.readReg sugar: one-byte register read via spi_transceive_dt
 *  against an INTERNAL buffer — no caller array needed. */
export function spiReadReg(bus: string, cs: number, hz: number, mode: number, reg: number): number { return 0; }

// Thin UART (hal/uart-port.ts): TX is poll-based with the construction baud
// applied once (guarded uart_configure); RX is interrupt-backed into a
// construction-sized ring (armed on first receive call). `ring` sizes the
// shim's static buffer and rides every RX op (self-contained-op discipline).
export function uartPollWrite(port: string, baud: number, data: SerialValue): void {}
export function uartRxAvailable(port: string, ring: number): number { return 0; }
export function uartRxPeek(port: string, ring: number): number { return 0; }
export function uartRxRead(port: string, ring: number): number { return 0; }

// Thin Thread (hal/thread.ts): create + schedule (k_thread_create, K_NO_WAIT).
// The handler is the callback-registered entry function name.
export function threadStart(index: number, stackBytes: number, priority: number, handler: string): void {}
/** Thin Thread: block until exit (k_thread_join, K_FOREVER). */
export function threadJoin(index: number): void {}

/** Resolve a board definition path to a compile-time constant. */
export function boardResolve(path: string): any { return undefined as any; }

export function fsReadText(path: string): string { return ""; }
export function fsWriteText(path: string, content: string): void {}
export function fsExists(path: string): boolean { return false; }
export function fsRemove(path: string): boolean { return false; }
export function mqttConnect(brokerUri: string, clientId: string): boolean { return false; }
export function mqttOnMessage(handler: string): void {}
export function mqttSubscribe(topic: string): void {}
export function mqttPublish(topic: string, data: string): void {}
export function mqttConnected(): boolean { return false; }
export function mqttDisconnect(): void {}

// ---------------------------------------------------------------------------
// Preferences (NVS-backed key/value store)
// ---------------------------------------------------------------------------

export function preferencesClear(ns: string): void {}
export function preferencesRemove(ns: string, key: string): void {}
export function preferencesPutInt(ns: string, key: string, value: number): void {}
export function preferencesGetInt(ns: string, key: string, defaultValue: number): number { return 0; }
export function preferencesPutBool(ns: string, key: string, value: boolean): void {}
export function preferencesGetBool(ns: string, key: string, defaultValue: boolean): boolean { return false; }
export function preferencesPutFloat(ns: string, key: string, value: number): void {}
export function preferencesGetFloat(ns: string, key: string, defaultValue: number): number { return 0; }
export function preferencesPutString(ns: string, key: string, value: string): void {}
export function preferencesGetString(ns: string, key: string, defaultValue: string): string { return ""; }

export function wifiConnectStart(ssid: string, password?: string): void {}
/** Join with the station's construction facts (the thin WiFi.join). */
export function wifiJoin(ssid: string, psk: string | undefined, security: number, channel: number, band: number, timeoutMs: number, ps: number, ipAddr: string | undefined, gateway: string | undefined, netmask: string | undefined): boolean { return false; }
export function wifiDisconnect(): void {}
export function wifiIsConnected(): boolean { return false; }
export function wifiLocalIp(): string { return ""; }
export function wifiRssi(): number { return 0; }
export function wifiMac(): number { return 0; }
export function wifiOnEvent(event: string, handler: string): void {}
export function wifiApStart(ssid: string, password?: string, channel?: number, hidden?: boolean, maxClients?: number): boolean { return false; }
export function wifiApStop(): void {}
export function wifiScan(): number { return 0; }

export function wifiScanCount(): number { return 0; }
export function wifiScanSsid(index: number): string { return ""; }
export function wifiScanRssi(index: number): number { return 0; }
export function wifiScanEncryption(index: number): string { return ""; }
export function wifiScanChannel(index: number): number { return 0; }

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

export function httpBegin(method: string, url: string): void {}
export function httpSetHeader(name: string, value: string): void {}
export function httpSetTimeout(ms: number): void {}
export function httpSetMaxBody(bytes: number): void {}
export function httpSetBody(data: string, json?: boolean): void {}
export function httpSetInsecure(insecure: boolean): void {}
export function httpSetCaCert(pem: string): void {}
export function httpSend(): boolean { return false; }
export function httpStatus(): number { return 0; }
export function httpOk(): boolean { return false; }
export function httpBody(): string { return ""; }
export function httpContentLength(): number { return 0; }
export function httpResponseHeader(name: string): string { return ""; }

// ---------------------------------------------------------------------------
// BLE (NimBLE GATT peripheral)
// ---------------------------------------------------------------------------

export function bleServerBegin(name: string): void {}
export function bleAdvertiseStart(): void {}
export function bleAdvertiseStop(): void {}
export function bleAddService(uuid: string): void {}
export function bleAddChar(index: number, uuid: string, type: string, perms: number, svcIndex: number): void {}
export function bleOnRead(index: number, handler: string): void {}
export function bleOnWrite(index: number, handler: string): void {}
export function bleOnConnect(handler: string): void {}
export function bleOnDisconnect(handler: string): void {}
export function bleNotify(index: number, value: number): void {}
export function bleIsConnected(): boolean { return false; }
export function bleClientCount(): number { return 0; }

// ---------------------------------------------------------------------------
// Raw C++ escape hatch
// ---------------------------------------------------------------------------

/** Emit raw C++ code (escape hatch for unsupported operations). */
export function rawCpp(code: string): void {}

/**
 * Emit raw C++ in expression context. Use when an IDF macro or constructor
 * must produce a value (e.g. `WIFI_INIT_CONFIG_DEFAULT()` expands to a struct
 * initializer; there's no TS-side way to construct it). The type parameter
 * is purely a TS hint — the transpiler doesn't check it; it just emits the
 * raw text in expression position.
 *
 *   const cfg = rawCpp<wifi_init_config_t>('WIFI_INIT_CONFIG_DEFAULT()');
 *
 * lowers to:
 *
 *   wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
 */
export function rawCppExpr<T>(code: string): T {
  return undefined as unknown as T;
}

// ---------------------------------------------------------------------------
// Sensors — DT-bound peripheral parts (generic catalog)
//
// The part identity is a catalog token (SENSOR.<underscored-compatible> from
// sensor-catalog.generated.ts); the bus/address come from the I2CTarget the
// Sensor class was constructed with. Zephyr's uniform sensor API backs these —
// one code shape for every part in the catalog.
// ---------------------------------------------------------------------------

/** Fetch a fresh sample from a DT-bound sensor part. Args: part token, bus
 *  name, bus port (I2C address or SPI CS pin), bus kind ('i2c' | 'spi'),
 *  SPI clock Hz, SPI mode 0-3, alert pin (-1 = none). */
export function sensorFetch(part: string, bus: string, port: number, kind: string, spiHz: number, spiMode: number, alertPin: number): void {}
/** Read one channel (a SENSOR_CHAN_* suffix, see CHAN) from the fetched sample.
 *  Returns the value as a double (Zephyr's sensor_value val1 + val2/1e6).
 *  Carries the same construction facts as sensorFetch so either op alone
 *  yields a complete device. */
export function sensorGet(part: string, bus: string, port: number, kind: string, spiHz: number, spiMode: number, alertPin: number, chan: string): number { return 0; }
