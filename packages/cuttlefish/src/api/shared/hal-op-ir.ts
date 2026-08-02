// ---------------------------------------------------------------------------
// HAL Operation IR — semantic hardware operations
//
// Each HALOpIR node represents a single hardware operation (GPIO write, I2C
// transfer, timing delay, etc.) that the framework strategy translates into
// framework-specific C++.
//
// The transpiler produces these nodes when resolving HAL method calls.
// Framework strategies (ArduinoStrategy, NativeAVRStrategy, etc.) implement
// resolveHALOperation() to map each operation to concrete C++ code.
//
// Pin-carrying operations include an optional `port` field for the MCU
// datasheet port name (e.g. "PB5"). When present, framework strategies
// should prefer the port name and look up the framework pin number via
// the MCU package's pin mapping. The `pin` field provides backward
// compatibility as a legacy framework pin number.
// ---------------------------------------------------------------------------

import type { DisplayHALOp } from "./display-op-ir.js";

// ---------------------------------------------------------------------------
// GPIO — digital pin control
// ---------------------------------------------------------------------------

export interface GpioWriteOp {
  operation: "gpio.write";
  /** MCU port name (e.g. "PB5") — canonical identity from datasheet */
  port?: string;
  /** Legacy framework pin number */
  pin: number;
  /** 0 = LOW, 1 = HIGH, or a runtime expression string (e.g. "state", "!state") */
  value: 0 | 1 | string;
}

export interface GpioReadOp {
  operation: "gpio.read";
  port?: string;
  pin: number;
}

export interface GpioToggleOp {
  operation: "gpio.toggle";
  port?: string;
  pin: number;
}

export interface GpioSetModeOp {
  operation: "gpio.set_mode";
  port?: string;
  pin: number;
  /** "output" | "input" | "input_pullup" | "input_pulldown" */
  mode: string;
}

// ---------------------------------------------------------------------------
// PWM — pulse-width modulation output
// ---------------------------------------------------------------------------

export interface PwmWriteOp {
  operation: "pwm.write";
  port?: string;
  pin: number;
  /** Duty cycle — numeric value or runtime expression string */
  duty: number | string;
}

export interface PwmGetFrequencyOp {
  operation: "pwm.get_frequency";
  port?: string;
  pin: number;
}

export interface PwmGetResolutionOp {
  operation: "pwm.get_resolution";
  port?: string;
  pin: number;
}

// ---------------------------------------------------------------------------
// RMT — Remote Control Transceiver (addressable LEDs, IR, raw waveforms)
// ---------------------------------------------------------------------------
// Fields are flat scalars: the resolver collapses object literals to positional
// strings, so a nested `opts` object is not representable on a HALOpIR.
// bit0/bit1 timings are [hi, lo] tick pairs flattened to two fields each.

export interface RmtTxInitOp {
  operation: "rmt.tx_init";
  port?: string;
  pin: number;
  resolutionHz: number | string;
  bit0Hi: number | string;
  bit0Lo: number | string;
  bit1Hi: number | string;
  bit1Lo: number | string;
  msbFirst?: boolean | string;
  queueDepth?: number | string;
}

export interface RmtTxWriteBytesOp {
  operation: "rmt.tx_write_bytes";
  port?: string;
  pin: number;
  /** Pre-rendered C array initializer body, e.g. "1, 2, 3" (positional; bytes arg is array-literal-rendered). */
  bytes: string;
}

export interface RmtTxWriteSymbolsOp {
  operation: "rmt.tx_write_symbols";
  port?: string;
  pin: number;
  /** Rendered rmt_symbol_word_t array body, one row per symbol. */
  symbols: string;
}

export interface RmtTxWaitDoneOp {
  operation: "rmt.tx_wait_done";
  port?: string;
  pin: number;
  timeoutMs?: number | string;
}

export interface RmtTxDeinitOp {
  operation: "rmt.tx_deinit";
  port?: string;
  pin: number;
}

export interface RmtRxInitOp {
  operation: "rmt.rx_init";
  port?: string;
  pin: number;
  resolutionHz: number | string;
}

export interface RmtRxOnReceivedOp {
  operation: "rmt.rx_on_received";
  port?: string;
  pin: number;
  /** User-declared C function name to call on receive. */
  handler: string;
}

export interface RmtRxStartOp {
  operation: "rmt.rx_start";
  port?: string;
  pin: number;
}

export interface RmtRxStopOp {
  operation: "rmt.rx_stop";
  port?: string;
  pin: number;
}

export interface RmtRxReadOp {
  operation: "rmt.rx_read";
  port?: string;
  pin: number;
  maxCount: number | string;
}

export interface RmtRxDeinitOp {
  operation: "rmt.rx_deinit";
  port?: string;
  pin: number;
}

// ---------------------------------------------------------------------------
// ADC — analog-to-digital conversion
// ---------------------------------------------------------------------------

export interface AdcReadOp {
  operation: "adc.read";
  port?: string;
  pin: number;
}

export interface AdcGetResolutionOp {
  operation: "adc.get_resolution";
}

export interface AdcSetReferenceOp {
  operation: "adc.set_reference";
  /** Reference constant name or numeric value */
  reference: string | number;
}

export interface AdcGetReferenceOp {
  operation: "adc.get_reference";
}

export interface AdcReadVoltageOp {
  operation: "adc.read_voltage";
  port?: string;
  pin: number;
  vRef?: number;
  maxValue?: number;
}

// ---------------------------------------------------------------------------
// DAC — digital-to-analog conversion
// ---------------------------------------------------------------------------

export interface DacWriteOp {
  operation: "dac.write";
  port?: string;
  pin: number;
  /** Output value — numeric or runtime expression string */
  value: number | string;
}

// ---------------------------------------------------------------------------
// Interrupts
// ---------------------------------------------------------------------------

export interface InterruptAttachOp {
  operation: "interrupt.attach";
  port?: string;
  pin: number;
  /** Resolved C++ callback function name */
  handler: string;
  /** "rising" | "falling" | "change" | "high" | "low" */
  mode: string;
}

export interface InterruptDetachOp {
  operation: "interrupt.detach";
  port?: string;
  pin: number;
}

// ---------------------------------------------------------------------------
// Tone / audio output
// ---------------------------------------------------------------------------

export interface TonePlayOp {
  operation: "tone.play";
  port?: string;
  pin: number;
  /** Frequency in Hz — numeric or runtime expression string */
  frequency: number | string;
  /** Optional duration in milliseconds — numeric or runtime expression string */
  duration?: number | string;
}

export interface ToneStopOp {
  operation: "tone.stop";
  port?: string;
  pin: number;
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export interface TimingDelayOp {
  operation: "timing.delay";
  ms: number;
}

export interface TimingDelayMicrosecondsOp {
  operation: "timing.delay_microseconds";
  us: number;
}

export interface TimingMillisOp {
  operation: "timing.millis";
}

export interface TimingMicrosOp {
  operation: "timing.micros";
}

export interface TimingFreeHeapOp {
  operation: "timing.free_heap";
}

export interface TimingSetIntervalOp {
  operation: "timing.set_interval";
  /** Resolved C++ callback function name */
  handler: string;
  timeout: number;
}

export interface TimingSetTimeoutOp {
  operation: "timing.set_timeout";
  /** Resolved C++ callback function name */
  handler: string;
  timeout: number;
}

export interface TimingClearIntervalOp {
  operation: "timing.clear_interval";
  id: number;
}

export interface TimingClearTimeoutOp {
  operation: "timing.clear_timeout";
  id: number;
}

// ---------------------------------------------------------------------------
// Power — MCU power states and clock frequency
// ---------------------------------------------------------------------------

export interface PowerDeepSleepOp {
  operation: "power.deep_sleep";
  ms: number;
}

export interface PowerLightSleepOp {
  operation: "power.light_sleep";
}

export interface PowerSetCpuFrequencyOp {
  operation: "power.set_cpu_frequency";
  mhz: number;
}

export interface PowerDeepSleepPinOp {
  operation: "power.deep_sleep_pin";
  pin: number;
  level: number;
}

// ---------------------------------------------------------------------------
// I2C — inter-integrated circuit bus
// ---------------------------------------------------------------------------

export interface I2cBeginOp {
  operation: "i2c.begin";
  bus: string;
  /** Slave address (only for slave mode) — numeric or runtime expression string */
  address?: number | string;
}

export interface I2cEndOp {
  operation: "i2c.end";
  bus: string;
}

export interface I2cSetClockOp {
  operation: "i2c.set_clock";
  bus: string;
  /** Clock speed in Hz — numeric or runtime expression string */
  hz: number | string;
}

export interface I2cBeginTransmissionOp {
  operation: "i2c.begin_transmission";
  bus: string;
  /** Slave address — numeric or runtime expression string */
  address: number | string;
}

export interface I2cWriteOp {
  operation: "i2c.write";
  bus: string;
  /** Resolved C++ expression for the data to write */
  data: string;
}

export interface I2cWriteBytesOp {
  operation: "i2c.write_bytes";
  bus: string;
  /** Individual byte values — numeric literals or runtime expressions */
  bytes: (number | string)[];
}

export interface I2cWriteBufferOp {
  operation: "i2c.write_buffer";
  bus: string;
  /** C array / buffer variable name */
  data: string;
}

export interface I2cReadBufferOp {
  operation: "i2c.read_buffer";
  bus: string;
  count: number | string;
  /** Buffer variable name, or "__DISCARD__" to read-and-drop */
  buffer: string;
}

export interface I2cEndTransmissionOp {
  operation: "i2c.end_transmission";
  bus: string;
  stop: boolean;
}

export interface I2cRequestFromOp {
  operation: "i2c.request_from";
  bus: string;
  /** Slave address — numeric or runtime expression string */
  address: number | string;
  /** Number of bytes — numeric or runtime expression string */
  quantity: number | string;
  stop: boolean;
}

export interface I2cAvailableOp {
  operation: "i2c.available";
  bus: string;
}

export interface I2cReadOp {
  operation: "i2c.read";
  bus: string;
}

export interface I2cRecoverOp {
  operation: "i2c.recover";
  bus: string;
}

// ---------------------------------------------------------------------------
// SPI — serial peripheral interface bus
// ---------------------------------------------------------------------------

export interface SpiBeginOp {
  operation: "spi.begin";
  bus: string;
}

export interface SpiEndOp {
  operation: "spi.end";
  bus: string;
}

export interface SpiTransferOp {
  operation: "spi.transfer";
  bus: string;
  /** Resolved C++ expression for data to transfer */
  data: string;
}

export interface SpibeginTransactionOp {
  operation: "spi.begin_transaction";
  bus: string;
  /** Resolved C++ SPISettings expression */
  settings: string;
}

export interface SpiEndTransactionOp {
  operation: "spi.end_transaction";
  bus: string;
}


export interface SpiSetModeOp {
  operation: "spi.set_mode";
  bus: string;
  /** SPI mode (0-3) — numeric or runtime expression string */
  mode: number | string;
}

export interface SpiSetBitOrderOp {
  operation: "spi.set_bit_order";
  bus: string;
  /** "lsb" | "msb" */
  order: string;
}

export interface SpiCsLowOp {
  operation: "spi.cs_low";
  port?: string;
  pin: number;
}

export interface SpiCsHighOp {
  operation: "spi.cs_high";
  port?: string;
  pin: number;
}

export interface SpiReadBufferOp {
  operation: "spi.read_buffer";
  bus: string;
  /** Number of bytes — numeric or runtime expression string */
  count: number | string;
  /** Buffer variable name, "__HAL_READ_BUF__" placeholder (rewritten to the
   *  caller's variable by the variable-init transformer), or "__DISCARD__" */
  buffer: string;
}

// ---------------------------------------------------------------------------
// UART — universal asynchronous receiver-transmitter (serial)
// ---------------------------------------------------------------------------

export interface UartBeginOp {
  operation: "uart.begin";
  port: string;
  /** Baud rate — numeric or runtime expression string */
  baud: number | string;
}

export interface UartEndOp {
  operation: "uart.end";
  port: string;
}

export interface UartPrintOp {
  operation: "uart.print";
  port: string;
  /** Resolved C++ expression to print */
  value: string;
}

export interface UartPrintlnOp {
  operation: "uart.println";
  port: string;
  /** Resolved C++ expression to print */
  value: string;
}

export interface UartPrintfOp {
  operation: "uart.printf";
  port: string;
  /** printf format string */
  format: string;
  /** Resolved C++ argument expressions */
  args: string[];
}

export interface UartWriteOp {
  operation: "uart.write";
  port: string;
  /** Resolved C++ expression for data */
  data: string;
}

export interface UartReadOp {
  operation: "uart.read";
  port: string;
}

export interface UartPeekOp {
  operation: "uart.peek";
  port: string;
}

export interface UartAvailableOp {
  operation: "uart.available";
  port: string;
}

export interface UartFlushOp {
  operation: "uart.flush";
  port: string;
}

// ---------------------------------------------------------------------------
// Pulse measurement
// ---------------------------------------------------------------------------

export interface PulseInOp {
  operation: "pulse.in";
  port?: string;
  pin: number;
  /** 0 = LOW, 1 = HIGH */
  value: 0 | 1;
  /** Optional timeout in microseconds */
  timeout?: number;
}

export interface PulseInLongOp {
  operation: "pulse.in_long";
  port?: string;
  pin: number;
  /** 0 = LOW, 1 = HIGH */
  value: 0 | 1;
}

// ---------------------------------------------------------------------------
// Shift register
// ---------------------------------------------------------------------------

export interface ShiftOutOp {
  operation: "shift.out";
  dataPin: number;
  clockPin: number;
  /** "lsb" | "msb" */
  bitOrder: string;
  value: number;
}

export interface ShiftInOp {
  operation: "shift.in";
  dataPin: number;
  clockPin: number;
  /** "lsb" | "msb" */
  bitOrder: string;
}

// ---------------------------------------------------------------------------
// Board constant resolution
// ---------------------------------------------------------------------------

export interface BoardResolveOp {
  operation: "board.resolve";
  /** Dot-separated path into the board definition (e.g. "peripherals.pwm.resolution") */
  path: string;
}

// ---------------------------------------------------------------------------
// Watchdog timer (WDT)
// ---------------------------------------------------------------------------

export interface WdtEnableOp {
  operation: "wdt.enable";
  /** Timeout — a duration string ("250ms"), a WDTO_* constant name, or a number */
  timeout: string | number;
}

export interface WdtResetOp {
  operation: "wdt.reset";
}

export interface WdtDisableOp {
  operation: "wdt.disable";
}

// ---------------------------------------------------------------------------
// Snprintf — formatted string output
// ---------------------------------------------------------------------------

export interface SnprintfEmitOp {
  operation: "snprintf.emit";
  /** Temporary buffer variable name */
  bufferName: string;
  /** printf-style format string */
  format: string;
  /** Resolved C++ argument expressions */
  args: string[];
}

// ---------------------------------------------------------------------------
// WiFi
// ---------------------------------------------------------------------------

export interface WifiConnectOp {
  operation: "wifi.connect";
  ssid: string;
  password?: string;
  timeoutMs: number | string;
  blocking: boolean;
}

export interface WifiConnectStartOp {
  operation: "wifi.connect_start";
  ssid: string;
  password?: string;
}

export interface WifiDisconnectOp {
  operation: "wifi.disconnect";
}

export interface WifiStatusOp {
  operation: "wifi.status";
}

export interface WifiIsConnectedOp {
  operation: "wifi.is_connected";
}

export interface WifiLocalIpOp {
  operation: "wifi.local_ip";
}

export interface WifiRssiOp {
  operation: "wifi.rssi";
}

export interface WifiMacOp {
  operation: "wifi.mac";
}

export interface WifiSetHostnameOp {
  operation: "wifi.set_hostname";
  name: string;
}

export interface WifiSetStaticIpOp {
  operation: "wifi.set_static_ip";
  ip: string;
  gateway: string;
  subnet: string;
  dns?: string;
}

export interface WifiSetAutoReconnectOp {
  operation: "wifi.set_auto_reconnect";
  enabled: boolean | string;
}

export interface WifiSetPowerSaveOp {
  operation: "wifi.set_power_save";
  mode: string;
}

export interface WifiSetTxPowerOp {
  operation: "wifi.set_tx_power";
  dbm: number | string;
}

export interface WifiOnEventOp {
  operation: "wifi.on_event";
  event: "connect" | "disconnect" | string;
  handler: string;
}

export interface WifiApStartOp {
  operation: "wifi.ap_start";
  ssid: string;
  password?: string;
  channel?: number | string;
  hidden?: boolean | string;
  maxClients?: number | string;
}

export interface WifiApStopOp {
  operation: "wifi.ap_stop";
}

export interface WifiApClientCountOp {
  operation: "wifi.ap_client_count";
}

export interface WifiApIpOp {
  operation: "wifi.ap_ip";
}

export interface WifiApSetChannelOp {
  operation: "wifi.ap_set_channel";
  channel: number | string;
}

export interface WifiApSetHiddenOp {
  operation: "wifi.ap_set_hidden";
  hidden: boolean | string;
}

export interface WifiApSetMaxClientsOp {
  operation: "wifi.ap_set_max_clients";
  maxClients: number | string;
}

export interface WifiScanOp {
  operation: "wifi.scan";
}

export interface WifiScanStartOp {
  operation: "wifi.scan_start";
}

/** Poll predicate paired with wifi.scan_start — true when scan results are ready. */
export interface WifiScanDoneOp {
  operation: "wifi.scan_done";
}

export interface WifiScanCountOp {
  operation: "wifi.scan_count";
}

export interface WifiScanSsidOp {
  operation: "wifi.scan_ssid";
  index: number | string;
}

export interface WifiScanRssiOp {
  operation: "wifi.scan_rssi";
  index: number | string;
}

export interface WifiScanEncryptionOp {
  operation: "wifi.scan_encryption";
  index: number | string;
}

export interface WifiScanChannelOp {
  operation: "wifi.scan_channel";
  index: number | string;
}

export interface WifiSaveCredentialsOp {
  operation: "wifi.save_credentials";
  ssid: string;
  password: string;
}

export interface WifiConnectSavedOp {
  operation: "wifi.connect_saved";
  timeoutMs: number | string;
}

export interface WifiClearCredentialsOp {
  operation: "wifi.clear_credentials";
}

export interface WifiWaitConnectedOp {
  operation: "wifi.wait_connected";
  timeoutMs: number | string;
}

export interface WifiWaitDisconnectedOp {
  operation: "wifi.wait_disconnected";
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

export interface HttpBeginOp {
  operation: "http.begin";
  method: string;
  url: string;
}

export interface HttpResetOp {
  operation: "http.reset";
}

export interface HttpSetHeaderOp {
  operation: "http.set_header";
  name: string;
  value: string;
}

export interface HttpSetTimeoutOp {
  operation: "http.set_timeout";
  ms: number | string;
}

export interface HttpSetMaxBodyOp {
  operation: "http.set_max_body";
  bytes: number | string;
}

export interface HttpSetBodyOp {
  operation: "http.set_body";
  data: string;
  json?: boolean;
}

export interface HttpSetInsecureOp {
  operation: "http.set_insecure";
}

export interface HttpSetCaCertOp {
  operation: "http.set_ca_cert";
  pem: string;
}

export interface HttpSendOp {
  operation: "http.send";
  blocking: boolean;
}

export interface HttpSendStartOp {
  operation: "http.send_start";
}

/** Poll predicate paired with http.send_start — true when the response is in. */
export interface HttpDoneOp {
  operation: "http.done";
}

// ---------------------------------------------------------------------------
// Worker offload (generalized request-in / poll-out over a worker pool).
//
// These ops model the isolated-worker pattern: a pure/compute function is
// submitted to a per-framework worker backend (ESP32: FreeRTOS task; Zephyr:
// k_work workqueue) and its completion is polled. The worker receives its
// inputs by value and exposes its outputs only through an opaque handle, so
// the program-facing API stays single-threaded cooperative — no mutex/
// semaphore is added to the IR. The worker-isolation analyzer (see
// worker-analysis.ts) statically forbids shared mutable state (globals get
// volatile promotion + warning; bus access inside a worker is a hard error
// because take()/release() is runtime-unimplemented).
//
// `handleId` selects a fixed worker slot (the runtime ships a small pool, e.g.
// 4 slots). `fnRef` is the C++ symbol of the submitted function (signature
// `void(void*)`). `argRef` is an optional opaque argument expression passed
// through verbatim (worker-owned; the worker must not alias app globals).
// ---------------------------------------------------------------------------

/** Submit `fnRef(argRef)` to worker slot `handleId`; returns immediately. */
export interface WorkerSubmitOp {
  operation: "worker.submit";
  /** Fixed worker slot index (0..poolSize-1). */
  handleId: number;
  /** C++ symbol of the function to run: `void fn(void* arg)`. */
  fnRef: string;
  /** Optional argument expression (passed through verbatim). */
  argRef?: string;
}

/** Poll predicate paired with worker.submit — true once the worker finished. */
export interface WorkerDoneOp {
  operation: "worker.done";
  /** Worker slot index, matching the worker.submit it polls. */
  handleId: number;
}

export interface HttpStatusOp {
  operation: "http.status";
}

export interface HttpOkOp {
  operation: "http.ok";
}

export interface HttpBodyOp {
  operation: "http.body";
}

export interface HttpContentLengthOp {
  operation: "http.content_length";
}

export interface HttpResponseHeaderOp {
  operation: "http.response_header";
  name: string;
}

// ---------------------------------------------------------------------------
// BLE (NimBLE GATT peripheral)
// ---------------------------------------------------------------------------

export interface BleServerBeginOp {
  operation: "ble.server_begin";
  name: string;
}

export interface BleAdvertiseStartOp {
  operation: "ble.advertise_start";
}

export interface BleAdvertiseStopOp {
  operation: "ble.advertise_stop";
}

export interface BleAddServiceOp {
  operation: "ble.add_service";
  uuid: string;
}

export interface BleAddCharOp {
  operation: "ble.add_char";
  index: number | string;
  uuid: string;
  type: string;
  perms: number | string;   // bitmask: READ=1, WRITE=2, NOTIFY=4
  svcIndex?: number | string;
}

export interface BleOnReadOp {
  operation: "ble.on_read";
  index: number | string;
  handler: string;
}

export interface BleOnWriteOp {
  operation: "ble.on_write";
  index: number | string;
  handler: string;
}

export interface BleOnConnectOp {
  operation: "ble.on_connect";
  handler: string;
}

export interface BleOnDisconnectOp {
  operation: "ble.on_disconnect";
  handler: string;
}

export interface BleNotifyOp {
  operation: "ble.notify";
  index: number | string;
  value: number | string;
}

export interface BleIsConnectedOp {
  operation: "ble.is_connected";
}

export interface BleClientCountOp {
  operation: "ble.client_count";
}

export interface BleSetNameOp {
  operation: "ble.set_name";
  name: string;
}

export interface BleUntilConnectedOp {
  operation: "ble.until_connected";
  timeoutMs: number | string;
  blocking: boolean;
}

export interface BleUntilConnectedStartOp {
  operation: "ble.until_connected_start";
}

export interface BleSetTxPowerOp {
  operation: "ble.set_tx_power";
  dbm: number | string;
}

export interface BleStatusOp {
  operation: "ble.status";
}

// ---------------------------------------------------------------------------
// Preferences (NVS-backed persistent key/value store)
// ---------------------------------------------------------------------------

export interface PreferencesBeginOp {
  operation: "preferences.begin";
  namespace: string;
  readOnly: boolean;
}

export interface PreferencesEndOp {
  operation: "preferences.end";
}

export interface PreferencesClearOp {
  operation: "preferences.clear";
}

export interface PreferencesRemoveOp {
  operation: "preferences.remove";
  key: string;
}

export interface PreferencesPutIntOp {
  operation: "preferences.put_int";
  key: string;
  value: number | string;
}

export interface PreferencesGetIntOp {
  operation: "preferences.get_int";
  key: string;
  defaultValue: number | string;
}

export interface PreferencesPutUIntOp {
  operation: "preferences.put_uint";
  key: string;
  value: number | string;
}

export interface PreferencesGetUIntOp {
  operation: "preferences.get_uint";
  key: string;
  defaultValue: number | string;
}

export interface PreferencesPutBoolOp {
  operation: "preferences.put_bool";
  key: string;
  value: boolean;
}

export interface PreferencesGetBoolOp {
  operation: "preferences.get_bool";
  key: string;
  defaultValue: boolean;
}

export interface PreferencesPutFloatOp {
  operation: "preferences.put_float";
  key: string;
  value: number | string;
}

export interface PreferencesGetFloatOp {
  operation: "preferences.get_float";
  key: string;
  defaultValue: number | string;
}

export interface PreferencesPutStringOp {
  operation: "preferences.put_string";
  key: string;
  value: string;
}

export interface PreferencesGetStringOp {
  operation: "preferences.get_string";
  key: string;
  defaultValue: string;
}

// ---------------------------------------------------------------------------
// Random — random number generation
// ---------------------------------------------------------------------------
// Frameworks lower these to their platform's PRNG: Arduino `random()`/
// `randomSeed()` (core), ESP-IDF `esp_random()` (hardware RNG seeded by RF
// noise). The op carries the min/max as runtime expression strings so
// variable arguments resolve correctly.

export interface RandomIntOp {
  operation: "random.int";
}

export interface RandomRangeOp {
  operation: "random.range";
  /** Inclusive lower bound — numeric or runtime expression string */
  min: number | string;
  /** Inclusive upper bound — numeric or runtime expression string */
  max: number | string;
}

export interface RandomSeedOp {
  operation: "random.seed";
  /** Seed value — numeric or runtime expression string */
  seed: number | string;
}

// ---------------------------------------------------------------------------
// FS — filesystem (SD card / flash filesystem)
// ---------------------------------------------------------------------------
// Frameworks lower these to their platform's filesystem. The HAL surface is a
// high-level string-oriented API (readText/writeText); frameworks back it with
// their native VFS + partition layout (ESP-IDF: esp_vfs_fat_sdmmc_mount for SD
// cards; Arduino: SD.h / LittleFS). The runtime shim owns the open/read/write/
// close dance and returns heap strings for readText (caller-owned, must not be
// freed by the caller on Arduino-ESP32 where String manages its own heap).

export interface FsBeginOp {
  operation: "fs.begin";
}

export interface FsReadTextOp {
  operation: "fs.read_text";
  /** C string expression for the path */
  path: string;
}

export interface FsWriteTextOp {
  operation: "fs.write_text";
  /** C string expression for the path */
  path: string;
  /** C string expression for the content */
  content: string;
}

export interface FsExistsOp {
  operation: "fs.exists";
  /** C string expression for the path */
  path: string;
}

export interface FsRemoveOp {
  operation: "fs.remove";
  /** C string expression for the path */
  path: string;
}

// ---------------------------------------------------------------------------
// mDNS — service discovery (esp_mdns)
// ---------------------------------------------------------------------------

export interface MdnsStartOp {
  operation: "mdns.start";
  /** C string expression for the host name */
  hostname: string;
}

export interface MdnsSetHostnameOp {
  operation: "mdns.set_hostname";
  /** C string expression for the host name */
  name: string;
}

export interface MdnsAddServiceOp {
  operation: "mdns.add_service";
  /** C string expression for the service instance name */
  instance: string;
  /** C string expression for the protocol ("_tcp" / "_udp") */
  proto: string;
  /** Port number — numeric or runtime expression string */
  port: number | string;
}

export interface MdnsAnnounceOp {
  operation: "mdns.announce";
}

export interface MdnsStopOp {
  operation: "mdns.stop";
}

// ---------------------------------------------------------------------------
// MQTT — pub/sub client (esp_mqtt)
// ---------------------------------------------------------------------------

export interface MqttConnectOp {
  operation: "mqtt.connect";
  /** C string expression for the broker URI ("mqtt://..." / "mqtts://...") */
  brokerUri: string;
  /** C string expression for the client id */
  clientId: string;
}

export interface MqttOnMessageOp {
  operation: "mqtt.on_message";
  /** Resolved C++ callback function name (topic, payload) */
  handler: string;
}

export interface MqttSubscribeOp {
  operation: "mqtt.subscribe";
  /** C string expression for the topic filter */
  topic: string;
}

export interface MqttPublishOp {
  operation: "mqtt.publish";
  /** C string expression for the topic */
  topic: string;
  /** C string expression for the payload */
  data: string;
}

export interface MqttConnectedOp {
  operation: "mqtt.connected";
}

export interface MqttDisconnectOp {
  operation: "mqtt.disconnect";
}

// ---------------------------------------------------------------------------
// OTA — over-the-air firmware update (esp_https_ota)
// ---------------------------------------------------------------------------

export interface OtaFromUrlOp {
  operation: "ota.from_url";
  /** C string expression for the HTTPS firmware URL */
  url: string;
}

export interface OtaBeginOp {
  operation: "ota.begin";
}

export interface OtaWriteOp {
  operation: "ota.write";
  /** C expression for the chunk data (buffer/pointer) */
  chunk: string;
}

export interface OtaApplyOp {
  operation: "ota.apply";
}

// ---------------------------------------------------------------------------
// Temperature — on-chip die temperature sensor
// ---------------------------------------------------------------------------

export interface TempReadOp {
  operation: "temp.read";
}

// ---------------------------------------------------------------------------
// Hardware timer — GPTimer / TIM (high-precision periodic interrupts)
// ---------------------------------------------------------------------------

export interface HwtimerSetFrequencyOp {
  operation: "hwtimer.set_frequency";
  /** Timer instance index */
  instance: number | string;
  /** Frequency in Hz */
  hz: number | string;
}

export interface HwtimerOnOverflowOp {
  operation: "hwtimer.on_overflow";
  /** Timer instance index */
  instance: number | string;
  /** Resolved C++ callback function name */
  handler: string;
}

export interface HwtimerStartOp {
  operation: "hwtimer.start";
  /** Timer instance index */
  instance: number | string;
}

export interface HwtimerStopOp {
  operation: "hwtimer.stop";
  /** Timer instance index */
  instance: number | string;
}

// ---------------------------------------------------------------------------
// Capacitive touch pins — ESP32 on-chip capacitive sensing
// ---------------------------------------------------------------------------

export interface CapacitiveReadOp {
  operation: "capacitive.read";
  port?: string;
  /** Touch-capable GPIO pin number */
  pin: number;
}

// ---------------------------------------------------------------------------
// I2S — Inter-IC Sound / digital audio (ESP32 I2S peripheral)
// ---------------------------------------------------------------------------
// NOTE: the op surface below is declared so the manifest can record this
// peripheral as unsupported on every framework (see each framework manifest's
// hal.i2s block). No framework lowers these ops yet; the resolver returns
// undefined for all of them. When a framework implements I2S, it declares the
// ops 'supported' and adds a lowering — no manifest-schema or validator change
// is needed because the category is already recognized.

export interface I2sInitOp {
  operation: "i2s.init";
  /** Sample rate in Hz */
  sampleRate: number | string;
  /** Number of channels (1 = mono, 2 = stereo) */
  channels?: number | string;
  /** Bits per sample (8, 16, 24, 32) */
  bitsPerSample?: number | string;
}
export interface I2sWriteOp {
  operation: "i2s.write";
  /** C expression for the sample buffer */
  data: string;
  /** Number of bytes to write */
  length: number | string;
}
export interface I2sReadOp {
  operation: "i2s.read";
  /** Buffer variable name */
  buffer: string;
  /** Number of bytes to read */
  length: number | string;
}

// ---------------------------------------------------------------------------
// TWAI — Controller Area Network (ESP32 CAN, marketed as TWAI)
// ---------------------------------------------------------------------------

export interface TwaiInitOp {
  operation: "twai.init";
  /** Baud rate in bits per second */
  baudrate: number | string;
  /** TX GPIO pin number */
  txPin: number;
  /** RX GPIO pin number */
  rxPin: number;
}
export interface TwaiSendOp {
  operation: "twai.send";
  /** CAN identifier */
  id: number | string;
  /** C expression for the payload bytes */
  data: string;
  /** Number of payload bytes (0-8) */
  length: number | string;
}
export interface TwaiReceiveOp {
  operation: "twai.receive";
  /** Buffer variable name */
  buffer: string;
}

// ---------------------------------------------------------------------------
// USB — USB OTG / USB-Serial-JTAG (ESP32-S3 OTG; C3/C6 USB-Serial-JTAG)
// ---------------------------------------------------------------------------

export interface UsbInitOp {
  operation: "usb.init";
  /** Device descriptor name or C expression (framework-specific) */
  descriptor?: string;
}
export interface UsbWriteOp {
  operation: "usb.write";
  /** Endpoint index (0 for control/default) */
  endpoint: number | string;
  /** C expression for the data buffer */
  data: string;
  /** Number of bytes */
  length: number | string;
}
export interface UsbReadOp {
  operation: "usb.read";
  /** Endpoint index */
  endpoint: number | string;
  /** Buffer variable name */
  buffer: string;
  /** Max bytes to read */
  length: number | string;
}

// ---------------------------------------------------------------------------
// Ethernet — Ethernet MAC (ESP32 internal EMAC + external PHY)
// ---------------------------------------------------------------------------

export interface EthInitOp {
  operation: "eth.init";
  /** PHY address (0-31) */
  phyAddress: number | string;
  /** MDC GPIO pin */
  mdcPin: number;
  /** MDIO GPIO pin */
  mdioPin: number;
}
export interface EthStartOp {
  operation: "eth.start";
}
export interface EthIsLinkedOp {
  operation: "eth.is_linked";
}

// ---------------------------------------------------------------------------
// ESPNOW — ESP-exclusive peer-to-peer wireless protocol
// ---------------------------------------------------------------------------

export interface EspnowInitOp {
  operation: "espnow.init";
}
export interface EspnowAddPeerOp {
  operation: "espnow.add_peer";
  /** Peer MAC address as a C expression (e.g. an array initializer) */
  mac: string;
}
export interface EspnowSendOp {
  operation: "espnow.send";
  /** Peer MAC address C expression, or NULL for broadcast */
  mac: string;
  /** C expression for the payload */
  data: string;
  /** Number of bytes */
  length: number | string;
}
export interface EspnowOnReceiveOp {
  operation: "espnow.on_receive";
  /** Resolved C++ callback function name */
  handler: string;
}

// ---------------------------------------------------------------------------
// Crypto — hardware crypto acceleration (AES/SHA/HMAC/RSA/ECC via mbedtls)
// ---------------------------------------------------------------------------

export interface CryptoAesEncryptOp {
  operation: "crypto.aes_encrypt";
  /** C expression for the key buffer */
  key: string;
  /** C expression for the plaintext buffer */
  input: string;
  /** Output buffer variable name */
  output: string;
  /** Number of bytes (must be a multiple of 16) */
  length: number | string;
}
export interface CryptoSha256Op {
  operation: "crypto.sha256";
  /** C expression for the input buffer */
  input: string;
  /** Number of bytes */
  length: number | string;
  /** Output buffer variable name (32 bytes) */
  output: string;
}
export interface CryptoHmacOp {
  operation: "crypto.hmac";
  /** Key C expression */
  key: string;
  /** Message C expression */
  message: string;
  /** Message length in bytes */
  length: number | string;
  /** Output buffer variable name */
  output: string;
}

// ---------------------------------------------------------------------------
// PCNT — pulse counter peripheral (hardware event counting)
// ---------------------------------------------------------------------------

export interface PcntInitOp {
  operation: "pcnt.init";
  /** PCNT unit index */
  unit: number | string;
  /** Pulse input GPIO pin */
  pulsePin: number;
  /** Optional control/filter GPIO pin */
  ctrlPin?: number;
}
export interface PcntCountOp {
  operation: "pcnt.count";
  /** PCNT unit index */
  unit: number | string;
}
export interface PcntClearOp {
  operation: "pcnt.clear";
  /** PCNT unit index */
  unit: number | string;
}

// ---------------------------------------------------------------------------
// MCPWM — motor control PWM (distinct from the LEDC general-purpose PWM)
// ---------------------------------------------------------------------------

export interface McpwmInitOp {
  operation: "mcpwm.init";
  /** MCPWM unit index */
  unit: number | string;
  /** PWM frequency in Hz */
  frequency: number | string;
}
export interface McpwmSetDutyOp {
  operation: "mcpwm.set_duty";
  /** MCPWM unit index */
  unit: number | string;
  /** Operator/timer index */
  operator: number | string;
  /** Duty cycle percentage (0.0 - 100.0) */
  duty: number | string;
}
export interface McpwmStartOp {
  operation: "mcpwm.start";
  /** MCPWM unit index */
  unit: number | string;
}

// ---------------------------------------------------------------------------
// Raw C++ passthrough — escape hatch for unsupported operations
// ---------------------------------------------------------------------------

export interface RawCppOp {
  operation: "raw";
  /** Raw C++ code string (framework-agnostic, use sparingly) */
  code: string;
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

/**
 * HAL Operation IR — a discriminated union of all supported hardware
 * operations. Each node carries a semantic `operation` tag and typed
 * arguments. Framework strategies translate these into concrete C++.
 */
export type HALOpIR =
  // GPIO
  | GpioWriteOp
  | GpioReadOp
  | GpioToggleOp
  | GpioSetModeOp
  // PWM
  | PwmWriteOp
  | PwmGetFrequencyOp
  | PwmGetResolutionOp
  // RMT
  | RmtTxInitOp
  | RmtTxWriteBytesOp
  | RmtTxWriteSymbolsOp
  | RmtTxWaitDoneOp
  | RmtTxDeinitOp
  | RmtRxInitOp
  | RmtRxOnReceivedOp
  | RmtRxStartOp
  | RmtRxStopOp
  | RmtRxReadOp
  | RmtRxDeinitOp
  // ADC
  | AdcReadOp
  | AdcGetResolutionOp
  | AdcSetReferenceOp
  | AdcGetReferenceOp
  | AdcReadVoltageOp
  // DAC
  | DacWriteOp
  // Interrupts
  | InterruptAttachOp
  | InterruptDetachOp
  // Tone
  | TonePlayOp
  | ToneStopOp
  // Timing
  | TimingDelayOp
  | TimingDelayMicrosecondsOp
  | TimingMillisOp
  | TimingMicrosOp
  | TimingFreeHeapOp
  | TimingSetIntervalOp
  | TimingSetTimeoutOp
  | TimingClearIntervalOp
  | TimingClearTimeoutOp
  // Power
  | PowerDeepSleepOp
  | PowerLightSleepOp
  | PowerSetCpuFrequencyOp
  | PowerDeepSleepPinOp
  // I2C
  | I2cBeginOp
  | I2cEndOp
  | I2cSetClockOp
  | I2cBeginTransmissionOp
  | I2cWriteOp
  | I2cWriteBytesOp
  | I2cWriteBufferOp
  | I2cReadBufferOp
  | I2cEndTransmissionOp
  | I2cRequestFromOp
  | I2cAvailableOp
  | I2cReadOp
  | I2cRecoverOp
  // SPI
  | SpiBeginOp
  | SpiEndOp
  | SpiTransferOp
  | SpibeginTransactionOp
  | SpiEndTransactionOp
  | SpiSetModeOp
  | SpiSetBitOrderOp
  | SpiCsLowOp
  | SpiCsHighOp
  | SpiReadBufferOp
  // UART
  | UartBeginOp
  | UartEndOp
  | UartPrintOp
  | UartPrintlnOp
  | UartPrintfOp
  | UartWriteOp
  | UartReadOp
  | UartPeekOp
  | UartAvailableOp
  | UartFlushOp
  // Pulse
  | PulseInOp
  | PulseInLongOp
  // Shift
  | ShiftOutOp
  | ShiftInOp
  // Board
  | BoardResolveOp
  // Watchdog timer
  | WdtEnableOp
  | WdtResetOp
  | WdtDisableOp
  // Snprintf
  | SnprintfEmitOp
  // WiFi
  | WifiConnectOp
  | WifiConnectStartOp
  | WifiDisconnectOp
  | WifiStatusOp
  | WifiIsConnectedOp
  | WifiLocalIpOp
  | WifiRssiOp
  | WifiMacOp
  | WifiSetHostnameOp
  | WifiSetStaticIpOp
  | WifiSetAutoReconnectOp
  | WifiSetPowerSaveOp
  | WifiSetTxPowerOp
  | WifiOnEventOp
  | WifiApStartOp
  | WifiApStopOp
  | WifiApClientCountOp
  | WifiApIpOp
  | WifiApSetChannelOp
  | WifiApSetHiddenOp
  | WifiApSetMaxClientsOp
  | WifiScanOp
  | WifiScanStartOp
  | WifiScanDoneOp
  | WifiScanCountOp
  | WifiScanSsidOp
  | WifiScanRssiOp
  | WifiScanEncryptionOp
  | WifiScanChannelOp
  | WifiSaveCredentialsOp
  | WifiConnectSavedOp
  | WifiClearCredentialsOp
  | WifiWaitConnectedOp
  | WifiWaitDisconnectedOp
  // HTTP
  | HttpBeginOp
  | HttpResetOp
  | HttpSetHeaderOp
  | HttpSetTimeoutOp
  | HttpSetMaxBodyOp
  | HttpSetBodyOp
  | HttpSetInsecureOp
  | HttpSetCaCertOp
  | HttpSendOp
  | HttpSendStartOp
  | HttpDoneOp
  | WorkerSubmitOp
  | WorkerDoneOp
  | HttpStatusOp
  | HttpOkOp
  | HttpBodyOp
  | HttpContentLengthOp
  | HttpResponseHeaderOp
  // BLE (NimBLE GATT peripheral)
  | BleServerBeginOp
  | BleAdvertiseStartOp
  | BleAdvertiseStopOp
  | BleAddServiceOp
  | BleAddCharOp
  | BleOnReadOp
  | BleOnWriteOp
  | BleOnConnectOp
  | BleOnDisconnectOp
  | BleNotifyOp
  | BleIsConnectedOp
  | BleClientCountOp
  | BleSetNameOp
  | BleUntilConnectedOp
  | BleUntilConnectedStartOp
  | BleSetTxPowerOp
  | BleStatusOp
  // Preferences (NVS)
  | PreferencesBeginOp
  | PreferencesEndOp
  | PreferencesClearOp
  | PreferencesRemoveOp
  | PreferencesPutIntOp
  | PreferencesGetIntOp
  | PreferencesPutUIntOp
  | PreferencesGetUIntOp
  | PreferencesPutBoolOp
  | PreferencesGetBoolOp
  | PreferencesPutFloatOp
  | PreferencesGetFloatOp
  | PreferencesPutStringOp
  | PreferencesGetStringOp
  // Random
  | RandomIntOp
  | RandomRangeOp
  | RandomSeedOp
  // FS (filesystem)
  | FsBeginOp
  | FsReadTextOp
  | FsWriteTextOp
  | FsExistsOp
  | FsRemoveOp
  // mDNS
  | MdnsStartOp
  | MdnsSetHostnameOp
  | MdnsAddServiceOp
  | MdnsAnnounceOp
  | MdnsStopOp
  // MQTT
  | MqttConnectOp
  | MqttOnMessageOp
  | MqttSubscribeOp
  | MqttPublishOp
  | MqttConnectedOp
  | MqttDisconnectOp
  // OTA
  | OtaFromUrlOp
  | OtaBeginOp
  | OtaWriteOp
  | OtaApplyOp
  // Temperature
  | TempReadOp
  // Hardware timer
  | HwtimerSetFrequencyOp
  | HwtimerOnOverflowOp
  | HwtimerStartOp
  | HwtimerStopOp
  // Capacitive touch pins
  | CapacitiveReadOp
  // I2S / digital audio (unimplemented surface)
  | I2sInitOp
  | I2sWriteOp
  | I2sReadOp
  // TWAI / CAN (unimplemented surface)
  | TwaiInitOp
  | TwaiSendOp
  | TwaiReceiveOp
  // USB OTG / USB-Serial-JTAG (unimplemented surface)
  | UsbInitOp
  | UsbWriteOp
  | UsbReadOp
  // Ethernet MAC (unimplemented surface)
  | EthInitOp
  | EthStartOp
  | EthIsLinkedOp
  // ESPNOW (unimplemented surface)
  | EspnowInitOp
  | EspnowAddPeerOp
  | EspnowSendOp
  | EspnowOnReceiveOp
  // Hardware crypto (unimplemented surface)
  | CryptoAesEncryptOp
  | CryptoSha256Op
  | CryptoHmacOp
  // Pulse counter (unimplemented surface)
  | PcntInitOp
  | PcntCountOp
  | PcntClearOp
  // Motor control PWM (unimplemented surface)
  | McpwmInitOp
  | McpwmSetDutyOp
  | McpwmStartOp
  // Raw passthrough
  | RawCppOp
  // Display / graphics
  | DisplayHALOp;

/**
 * Helper type: extracts the operation string from a HALOpIR variant.
 * Useful for type-safe switch statements in framework strategies.
 */
export type HALOperationKind = HALOpIR["operation"];

/**
 * Runtime registry of every HAL operation discriminator, parallel to
 * {@link DISPLAY_OPERATION_KINDS}. Lets tests and the manifest validator
 * enumerate HAL op kinds without parsing types (which are erased at runtime).
 * Keep in sync with {@link HALOpIR} above.
 *
 * Note: `display.*` ops are NOT listed here — they live in
 * {@link DISPLAY_OPERATION_KINDS} in `display-op-ir.ts`. The manifest
 * validator imports both and unions them when probing display ops.
 */
export const HAL_OPERATION_KINDS = [
  // GPIO
  'gpio.write', 'gpio.read', 'gpio.toggle', 'gpio.set_mode',
  // PWM
  'pwm.write', 'pwm.get_frequency', 'pwm.get_resolution',
  // RMT
  'rmt.tx_init', 'rmt.tx_write_bytes', 'rmt.tx_write_symbols',
  'rmt.tx_wait_done', 'rmt.tx_deinit',
  'rmt.rx_init', 'rmt.rx_on_received', 'rmt.rx_start',
  'rmt.rx_stop', 'rmt.rx_read', 'rmt.rx_deinit',
  // ADC
  'adc.read', 'adc.get_resolution', 'adc.set_reference',
  'adc.get_reference', 'adc.read_voltage',
  // DAC
  'dac.write',
  // Interrupts
  'interrupt.attach', 'interrupt.detach',
  // Tone
  'tone.play', 'tone.stop',
  // Timing
  'timing.delay', 'timing.delay_microseconds', 'timing.millis',
  'timing.micros', 'timing.free_heap', 'timing.set_interval',
  'timing.set_timeout', 'timing.clear_interval', 'timing.clear_timeout',
  // Power
  'power.deep_sleep', 'power.light_sleep', 'power.set_cpu_frequency', 'power.deep_sleep_pin',
  // I2C
  'i2c.begin', 'i2c.end', 'i2c.set_clock', 'i2c.begin_transmission',
  'i2c.write', 'i2c.write_bytes', 'i2c.write_buffer', 'i2c.read_buffer',
  'i2c.end_transmission', 'i2c.request_from', 'i2c.available', 'i2c.read',
  'i2c.recover',
  // SPI
  'spi.begin', 'spi.end', 'spi.transfer', 'spi.begin_transaction',
  'spi.end_transaction', 'spi.set_mode', 'spi.set_bit_order',
  'spi.cs_low', 'spi.cs_high', 'spi.read_buffer',
  // UART
  'uart.begin', 'uart.end', 'uart.print', 'uart.println', 'uart.printf',
  'uart.write', 'uart.read', 'uart.peek', 'uart.available', 'uart.flush',
  // Pulse
  'pulse.in', 'pulse.in_long',
  // Shift
  'shift.out', 'shift.in',
  // Board
  'board.resolve',
  // Watchdog timer
  'wdt.enable', 'wdt.reset', 'wdt.disable',
  // Snprintf
  'snprintf.emit',
  // WiFi
  'wifi.connect', 'wifi.connect_start', 'wifi.disconnect', 'wifi.status',
  'wifi.is_connected', 'wifi.local_ip', 'wifi.rssi', 'wifi.mac',
  'wifi.set_hostname', 'wifi.set_static_ip', 'wifi.set_auto_reconnect',
  'wifi.set_power_save', 'wifi.set_tx_power', 'wifi.on_event',
  'wifi.ap_start', 'wifi.ap_stop', 'wifi.ap_client_count', 'wifi.ap_ip',
  'wifi.ap_set_channel', 'wifi.ap_set_hidden', 'wifi.ap_set_max_clients',
  'wifi.scan', 'wifi.scan_start', 'wifi.scan_done', 'wifi.scan_count',
  'wifi.scan_ssid', 'wifi.scan_rssi', 'wifi.scan_encryption',
  'wifi.scan_channel', 'wifi.save_credentials', 'wifi.connect_saved',
  'wifi.clear_credentials', 'wifi.wait_connected', 'wifi.wait_disconnected',
  // HTTP
  'http.begin', 'http.reset', 'http.set_header', 'http.set_timeout',
  'http.set_max_body', 'http.set_body', 'http.set_insecure',
  'http.set_ca_cert', 'http.send', 'http.send_start', 'http.done',
  'http.status', 'http.ok', 'http.body', 'http.content_length',
  'http.response_header',
  // Worker offload (generalized request-in / poll-out over a worker pool)
  'worker.submit', 'worker.done',
  // BLE (NimBLE GATT peripheral)
  'ble.server_begin', 'ble.advertise_start', 'ble.advertise_stop',
  'ble.add_service', 'ble.add_char',
  'ble.on_read', 'ble.on_write', 'ble.on_connect', 'ble.on_disconnect', 'ble.notify',
  'ble.is_connected', 'ble.client_count', 'ble.set_name',
  'ble.until_connected', 'ble.until_connected_start',
  'ble.set_tx_power', 'ble.status',
  // Preferences (NVS)
  'preferences.begin', 'preferences.end', 'preferences.clear', 'preferences.remove',
  'preferences.put_int', 'preferences.get_int',
  'preferences.put_uint', 'preferences.get_uint',
  'preferences.put_bool', 'preferences.get_bool',
  'preferences.put_float', 'preferences.get_float',
  'preferences.put_string', 'preferences.get_string',
  // Random
  'random.int', 'random.range', 'random.seed',
  // FS (filesystem)
  'fs.begin', 'fs.read_text', 'fs.write_text', 'fs.exists', 'fs.remove',
  // mDNS
  'mdns.start', 'mdns.set_hostname', 'mdns.add_service', 'mdns.announce', 'mdns.stop',
  // MQTT
  'mqtt.connect', 'mqtt.on_message', 'mqtt.subscribe', 'mqtt.publish', 'mqtt.connected', 'mqtt.disconnect',
  // OTA
  'ota.from_url', 'ota.begin', 'ota.write', 'ota.apply',
  // Temperature
  'temp.read',
  // Hardware timer
  'hwtimer.set_frequency', 'hwtimer.on_overflow', 'hwtimer.start', 'hwtimer.stop',
  // Capacitive touch pins
  'capacitive.read',
  // I2S / digital audio (unimplemented — declared unsupported by all frameworks)
  'i2s.init', 'i2s.write', 'i2s.read',
  // TWAI / CAN (unimplemented)
  'twai.init', 'twai.send', 'twai.receive',
  // USB OTG / USB-Serial-JTAG (unimplemented)
  'usb.init', 'usb.write', 'usb.read',
  // Ethernet MAC (unimplemented)
  'eth.init', 'eth.start', 'eth.is_linked',
  // ESPNOW (unimplemented)
  'espnow.init', 'espnow.add_peer', 'espnow.send', 'espnow.on_receive',
  // Hardware crypto (unimplemented)
  'crypto.aes_encrypt', 'crypto.sha256', 'crypto.hmac',
  // Pulse counter (unimplemented)
  'pcnt.init', 'pcnt.count', 'pcnt.clear',
  // Motor control PWM (unimplemented)
  'mcpwm.init', 'mcpwm.set_duty', 'mcpwm.start',
  // Raw passthrough
  'raw',
] as const;

// Compile-time exhaustiveness check: every HAL_OPERATION_KINDS entry must
// be a valid HALOpIR["operation"]. If you add an op to the const but not the
// union (or vice versa), this assignment fails to type-check.
const _halOpKindsExhaustive: HALOperationKind[] = [...HAL_OPERATION_KINDS];
