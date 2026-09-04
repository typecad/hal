// ---------------------------------------------------------------------------
// HAL Operation IR — semantic hardware operations
//
// Each HALOpIR node represents a single hardware operation (GPIO write, I2C
// transfer, timing delay, etc.) that the framework strategy translates into
// framework-specific C++.
//
// The transpiler produces these nodes when resolving HAL method calls.
// Framework strategies (ZephyrStrategy, NativeStrategy, etc.) implement
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
  /**
   * Output-pin state tracking: set at the END of the file's IR build (see
   * markShadowUpdatingOps) when this pin has a tracked shadow read anywhere
   * in the file — the emitted write must also assign the shadow state
   * variable. Baked into the op at build time because emit never sees live
   * tracker state: every file's buildProgramIR resets the tracker, and all
   * files build before any emit runs.
   */
}

export interface GpioReadOp {
  operation: "gpio.read";
  port?: string;
  pin: number;
  /**
   * Output-pin state tracking: when set, this read is on a pin explicitly
   * configured as OUTPUT and must NOT lower to a hardware pin read (which is
   * not portable for direction-only outputs, e.g. Zephyr). 'high'/'low' fold
   * to a compile-time constant; 'shadow' lowers to the tracked state
   * variable that generated writes keep updated.
   */
}

export interface GpioToggleOp {
  operation: "gpio.toggle";
  port?: string;
  pin: number;
  /** Output-pin state tracking — same contract as GpioWriteOp.updatesShadow. */
}

// ---------------------------------------------------------------------------
// PWM — pulse-width modulation output
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// RMT — Remote Control Transceiver (addressable LEDs, IR, raw waveforms)
// ---------------------------------------------------------------------------
// Fields are flat scalars: the resolver collapses object literals to positional
// strings, so a nested `opts` object is not representable on a HALOpIR.
// bit0/bit1 timings are [hi, lo] tick pairs flattened to two fields each.












// ---------------------------------------------------------------------------
// ADC — analog-to-digital conversion
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DAC — digital-to-analog conversion
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Interrupts
// ---------------------------------------------------------------------------

export interface InterruptDetachOp {
  operation: "interrupt.detach";
  port?: string;
  pin: number;
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

// Time.* — the TS-flavored timing surface (Time.sleep/now/nowUs/busyWaitUs).
// Distinct ops from the Arduino-named forms above so each framework can
// declare them independently (framework-arduino is frozen on the legacy ops).

export interface TimingSleepOp {
  operation: "timing.sleep";
  ms: number;
}

export interface TimingNowOp {
  operation: "timing.now";
}

export interface TimingNowUsOp {
  operation: "timing.now_us";
}

export interface TimingBusyWaitUsOp {
  operation: "timing.busy_wait_us";
  us: number;
}

// ---------------------------------------------------------------------------
// Thin Zephyr-shaped peripherals (GPIO/PWM/ADC/DAC/Watchdog/
// Counter — hal/gpio-pin.ts and siblings). Construction facts ride the ops
// (the sensor discipline: ops are self-contained so shim lines and overlay
// generation derive from op facts alone). Flag/gain/reference arguments are
// token TEXT (e.g. "GPIO.OUTPUT | GPIO.PULL_UP", "ADC.GAIN_1_4") —
// the lowerings map token names to the C macros.
// ---------------------------------------------------------------------------

export interface GpioConfigureOp {
  operation: "gpio.configure";
  pin: number;
  /** Flag token text: "GPIO.OUTPUT | GPIO.PULL_UP" */
  flags: string;
}

export interface GpioReadCfgOp {
  operation: "gpio.read_cfg";
  pin: number;
  /** Flag token text — the guarded configure is fused into the read. */
  flags: string;
}

export interface GpioShiftOutOp {
  operation: "gpio.shift_out";
  dataPin: number;
  clockPin: number;
  value: number | string;
  msbFirst: boolean;
}

export interface GpioShiftInOp {
  operation: "gpio.shift_in";
  dataPin: number;
  clockPin: number;
  msbFirst: boolean;
}

export interface InterruptAttachFlagsOp {
  operation: "interrupt.attach_flags";
  pin: number;
  /** Resolved C++ callback function name */
  handler: string;
  /** INT flag token text: "GPIO.INT_EDGE_FALLING" */
  intFlags: string;
}

/** Inline routing overrides shared by the pwm.set_* ops (construction
 *  opts, the escape hatch): DT controller nodelabel + channel. */
export interface PwmRoutingOverride {
  controllerOverride?: string;
  channelOverride?: number;
}

export interface PwmSetPulseOp extends PwmRoutingOverride {
  operation: "pwm.set_pulse";
  pin: number;
  /** Construction period in ns */
  periodNs: number | string;
  pulseNs: number | string;
}

export interface PwmSetDutyOp extends PwmRoutingOverride {
  operation: "pwm.set_duty";
  pin: number;
  /** Construction period in ns */
  periodNs: number | string;
  /** Duty fraction 0.0–1.0 */
  duty: number | string;
}

export interface PwmSetPeriodOp extends PwmRoutingOverride {
  operation: "pwm.set_period";
  pin: number;
  periodNs: number | string;
}

export interface AdcReadRawOp {
  operation: "adc.read_raw";
  pin: number;
  /** Gain token text ("ADC.GAIN_1_4"); '' = descriptor default */
  gain?: string;
  /** Reference token text ("ADC.REF_INTERNAL"); '' = descriptor default */
  reference?: string;
  /** Inline routing overrides (construction opts, the escape hatch): the
   *  user vouches for a pin the facts layer does not cover. -1/'' = absent. */
  channelOverride?: number;
  deviceOverride?: string;
  pinctrlOverride?: string;
}

export interface AdcReadMvOp {
  operation: "adc.read_mv";
  pin: number;
  gain?: string;
  reference?: string;
  channelOverride?: number;
  deviceOverride?: string;
  pinctrlOverride?: string;
}

export interface DacWriteValueOp {
  operation: "dac.write_value";
  pin: number;
  value: number | string;
  /** Construction resolution in bits; 0 = descriptor channel default */
  resolution: number;
}

export interface WdtSetupOp {
  operation: "wdt.setup";
  /** Construction timeout in milliseconds */
  timeoutMs: number;
}

export interface WdtFeedOp {
  operation: "wdt.feed";
}

export interface CounterOnAlarmOp {
  operation: "counter.on_alarm";
  instance: number;
  /** Resolved C++ callback function name */
  handler: string;
}

export interface CounterStartOp {
  operation: "counter.start";
  instance: number;
  /** Construction alarm frequency in Hz — realized as the top value */
  hz: number;
}

export interface CounterStopOp {
  operation: "counter.stop";
  instance: number;
}

// ── Tier-2 thin buses (I2CTarget/SPITarget/UART — hal/i2c-target.ts,
// spi-target.ts, uart-port.ts). Construction facts ride the ops; `bus`/
// `port` carry the instance string ("I2C0"/"UART1"); the SPI ops carry the
// cs pin + hz + mode so the shim state block and overlay child node derive
// from op facts alone (the sensor discipline). ──

export interface I2cRegWriteOp {
  operation: "i2c.reg_write";
  bus: string;
  address: number;
  /** Bus speed applied once at first use; 0 = leave as configured */
  hz: number;
  reg: number | string;
  value: number | string;
}

export interface I2cRegReadOp {
  operation: "i2c.reg_read";
  bus: string;
  address: number;
  hz: number;
  reg: number | string;
}

export interface I2cRegUpdateOp {
  operation: "i2c.reg_update";
  bus: string;
  address: number;
  hz: number;
  reg: number | string;
  mask: number | string;
  value: number | string;
}

export interface I2cDevWriteOp {
  operation: "i2c.dev_write";
  bus: string;
  address: number;
  hz: number;
  /** Byte values — numeric literals or runtime expressions */
  bytes: (number | string)[];
}

export interface SpiTransceiveOp {
  operation: "spi.transceive";
  bus: string;
  cs: number;
  hz: number;
  mode: number;
  tx: (number | string)[];
  /** Caller's buffer identifier ('' = write-only) */
  rx: string;
}

export interface SpiDevWriteOp {
  operation: "spi.dev_write";
  bus: string;
  cs: number;
  hz: number;
  mode: number;
  tx: (number | string)[];
}

export interface SpiRegReadOp {
  operation: "spi.reg_read";
  bus: string;
  cs: number;
  hz: number;
  mode: number;
  reg: number | string;
}

export interface UartPollWriteOp {
  operation: "uart.poll_write";
  port: string;
  baud: number;
  data: string;
}

export interface UartRxArmOp {
  operation: "uart.rx_arm";
  port: string;
  /** Ring size in bytes (sizes the shim's static buffer). */
  ring: number;
}

export interface UartRxAvailableOp {
  operation: "uart.rx_available";
  port: string;
  ring: number;
}

export interface UartRxPeekOp {
  operation: "uart.rx_peek";
  port: string;
  ring: number;
}

export interface UartRxReadOp {
  operation: "uart.rx_read";
  port: string;
  ring: number;
}

export interface ThreadStartOp {
  operation: "thread.start";
  /** Thread identity slot (0, 1, 2, …) */
  instance: number;
  /** Stack size in bytes (construction fact — sizes the K_THREAD_STACK) */
  stackBytes: number;
  /** Zephyr priority (negative = cooperative; default 5 = preemptive below main) */
  priority: number;
  /** Resolved C++ entry function name (callback-registered) */
  handler: string;
}

export interface ThreadJoinOp {
  operation: "thread.join";
  instance: number;
}

// ---------------------------------------------------------------------------
// I2C — inter-integrated circuit bus
// ---------------------------------------------------------------------------

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


// ---------------------------------------------------------------------------
// UART — universal asynchronous receiver-transmitter (serial)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pulse measurement
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Shift register
// ---------------------------------------------------------------------------

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

export interface WifiJoinOp {
  operation: "wifi.join";
  ssid: string;
  /** Pre-shared key; absent for open networks. */
  psk?: string;
  /** Security token value (WiFi.OPEN/WPA2/WPA3/WPA2_WPA3) — the lowering
   *  maps it to the Zephyr wifi_security_type enum. */
  security?: number;
  /** 0 = any. */
  channel?: number;
  /** Band token value (WiFi.BAND_2_4 / BAND_5). */
  band?: number;
  /** join()'s bounded-wait deadline. */
  timeoutMs?: number;
  /** Nonzero = WiFi.PS_OFF — disable the radio's modem sleep. */
  ps?: number;
  /** Static IPv4 facts — applied instead of DHCP when present. */
  ipAddr?: string;
  gateway?: string;
  netmask?: string;
}

export interface WifiConnectStartOp {
  operation: "wifi.connect_start";
  ssid: string;
  password?: string;
}

export interface WifiDisconnectOp {
  operation: "wifi.disconnect";
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

export interface WifiScanOp {
  operation: "wifi.scan";
}

/** Async split partner of wifi.scan — kicks the scan without waiting; pair
 *  with the wifi.scan_done poll predicate (netWaitInfo). Emitted
 *  synthetically by the async tier, not by a TS-facing HAL method. */
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

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

export interface HttpBeginOp {
  operation: "http.begin";
  method: string;
  url: string;
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
  /** False is a no-op (the op always emits from send(); the lowering elides). */
  insecure: boolean;
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

// ---------------------------------------------------------------------------
// Preferences (NVS-backed persistent key/value store)
// ---------------------------------------------------------------------------

export interface PreferencesClearOp {
  operation: "preferences.clear";
  /** Namespace — the settings subtree prefix tc/<ns>/. */
  ns: string;
}

export interface PreferencesRemoveOp {
  operation: "preferences.remove";
  /** Namespace — the settings subtree prefix tc/<ns>/. */
  ns: string;
  key: string;
}

export interface PreferencesPutIntOp {
  operation: "preferences.put_int";
  /** Namespace — the settings subtree prefix tc/<ns>/. */
  ns: string;
  key: string;
  value: number | string;
}

export interface PreferencesGetIntOp {
  operation: "preferences.get_int";
  /** Namespace — the settings subtree prefix tc/<ns>/. */
  ns: string;
  key: string;
  defaultValue: number | string;
}

export interface PreferencesPutBoolOp {
  operation: "preferences.put_bool";
  /** Namespace — the settings subtree prefix tc/<ns>/. */
  ns: string;
  key: string;
  value: boolean;
}

export interface PreferencesGetBoolOp {
  operation: "preferences.get_bool";
  /** Namespace — the settings subtree prefix tc/<ns>/. */
  ns: string;
  key: string;
  defaultValue: boolean;
}

export interface PreferencesPutFloatOp {
  operation: "preferences.put_float";
  /** Namespace — the settings subtree prefix tc/<ns>/. */
  ns: string;
  key: string;
  value: number | string;
}

export interface PreferencesGetFloatOp {
  operation: "preferences.get_float";
  /** Namespace — the settings subtree prefix tc/<ns>/. */
  ns: string;
  key: string;
  defaultValue: number | string;
}

export interface PreferencesPutStringOp {
  operation: "preferences.put_string";
  /** Namespace — the settings subtree prefix tc/<ns>/. */
  ns: string;
  key: string;
  value: string;
}

export interface PreferencesGetStringOp {
  operation: "preferences.get_string";
  /** Namespace — the settings subtree prefix tc/<ns>/. */
  ns: string;
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

// ---------------------------------------------------------------------------
// Temperature — on-chip die temperature sensor
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sensors — DT-bound peripheral parts (generic catalog, hal/sensor.ts)
// ---------------------------------------------------------------------------

export interface SensorFetchOp {
  operation: "sensor.fetch";
  /** Catalog token — an underscored Zephyr compatible ('SENSOR.sensirion_sht3xd'
   *  or the bare 'sensirion_sht3xd'); the lowering resolves it against the
   *  generated catalog for the DT compatible string. */
  part: string;
  /** Bus name as carried by the HAL ('I2C1' / its alias 'Wire1'). */
  bus: string;
  /** Bus port: 7-bit I2C address, or the SPI chip-select pin number. */
  port: number | string;
  /** 'i2c' | 'spi' — which DT child shape the overlay emits. */
  busKind: string;
  /** SPI clock Hz (0 = the 1 MHz default). */
  spiHz: number | string;
  /** SPI mode 0-3. */
  spiMode: number | string;
  /** Alert GPIO (-1 = none). */
  alertPin: number | string;
}

export interface SensorGetOp {
  operation: "sensor.get";
  /** Catalog token — see SensorFetchOp.part. */
  part: string;
  /** Bus name — see SensorFetchOp.bus. */
  bus: string;
  /** Bus port — see SensorFetchOp.port. */
  port: number | string;
  /** 'i2c' | 'spi' — see SensorFetchOp.busKind. */
  busKind: string;
  /** SPI clock Hz — see SensorFetchOp.spiHz. */
  spiHz: number | string;
  /** SPI mode — see SensorFetchOp.spiMode. */
  spiMode: number | string;
  /** Alert GPIO — see SensorFetchOp.alertPin. */
  alertPin: number | string;
  /** Channel name — a SENSOR_CHAN_* suffix, possibly 'CHAN.'-prefixed
   *  (the property-access text of a CHAN.<name> argument). */
  chan: string;
}

// ---------------------------------------------------------------------------
// Hardware timer — GPTimer / TIM (high-precision periodic interrupts)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Capacitive touch pins — ESP32 on-chip capacitive sensing
// ---------------------------------------------------------------------------

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
// USB — USB device CDC-ACM serial port (Zephyr "next" USB device stack)
//
// Class-level, serial-shaped surface: a CDC-ACM instance is a serial pipe
// over the USB connector, not raw endpoints. Composition (controller +
// class instances) is devicetree's job; the app only enables the device and
// reads/writes the CDC UART device. The `port` identifies the instance
// ("USB0" → 0), mirroring `uart.*`'s `port`.
// ---------------------------------------------------------------------------

export interface UsbBeginOp {
  operation: "usb.begin";
  /** Port identifier, e.g. "USB0" (instance 0) */
  port: string;
}

export interface UsbWaitReadyOp {
  operation: "usb.wait_ready";
  port: string;
  /** Bounded DTR poll in the shim; 0 = wait forever. */
  timeoutMs: number;
}
export interface UsbEndOp {
  operation: "usb.end";
  port: string;
}
export interface UsbPrintOp {
  operation: "usb.print";
  port: string;
  value: string;
}
export interface UsbPrintlnOp {
  operation: "usb.println";
  port: string;
  value: string;
}
export interface UsbReadOp {
  operation: "usb.read";
  port: string;
}
export interface UsbAvailableOp {
  operation: "usb.available";
  port: string;
}
export interface UsbConnectedOp {
  operation: "usb.connected";
  /** Port identifier; resolves to a boolean expression (host opened the port) */
  port: string;
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


// ---------------------------------------------------------------------------
// Crypto — hardware crypto acceleration (AES/SHA/HMAC/RSA/ECC via mbedtls)
// ---------------------------------------------------------------------------

export interface CryptoSha256Op {
  operation: "crypto.sha256";
  /** C expression for the input buffer */
  input: string;
  /** Number of bytes */
  length: number | string;
  /** Output buffer variable name (32 bytes) */
  output: string;
}

// ---------------------------------------------------------------------------
// PCNT — pulse counter peripheral (hardware event counting)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// MCPWM — motor control PWM (distinct from the LEDC general-purpose PWM)
// ---------------------------------------------------------------------------


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
  // PWM
  // RMT
  // ADC
  // DAC
  // Interrupts
  | InterruptDetachOp
  // Timing
  | TimingSleepOp
  | TimingNowOp
  | TimingNowUsOp
  | TimingBusyWaitUsOp
  | GpioConfigureOp
  | GpioReadCfgOp
  | GpioShiftOutOp
  | GpioShiftInOp
  | InterruptAttachFlagsOp
  | PwmSetPulseOp
  | PwmSetDutyOp
  | PwmSetPeriodOp
  | AdcReadRawOp
  | AdcReadMvOp
  | DacWriteValueOp
  | WdtSetupOp
  | WdtFeedOp
  | CounterOnAlarmOp
  | CounterStartOp
  | CounterStopOp
  | I2cRegWriteOp
  | I2cRegReadOp
  | I2cRegUpdateOp
  | I2cDevWriteOp
  | SpiTransceiveOp
  | SpiDevWriteOp
  | SpiRegReadOp
  | UartPollWriteOp
  | UartRxArmOp
  | UartRxAvailableOp
  | UartRxPeekOp
  | UartRxReadOp
  | ThreadStartOp
  | ThreadJoinOp
  // I2C
  | I2cReadOp
  | I2cRecoverOp
  // SPI
  // UART
  // Pulse
  // Shift
  // Board
  | BoardResolveOp
  // Watchdog timer
  | WdtDisableOp
  // Snprintf
  | SnprintfEmitOp
  // WiFi
  | WifiJoinOp
  | WifiConnectStartOp
  | WifiDisconnectOp
  | WifiIsConnectedOp
  | WifiLocalIpOp
  | WifiRssiOp
  | WifiMacOp
  | WifiOnEventOp
  | WifiApStartOp
  | WifiApStopOp
  | WifiScanOp
  | WifiScanStartOp
  | WifiScanDoneOp
  | WifiScanCountOp
  | WifiScanSsidOp
  | WifiScanRssiOp
  | WifiScanEncryptionOp
  | WifiScanChannelOp
  // HTTP
  | HttpBeginOp
  | HttpSetHeaderOp
  | HttpSetTimeoutOp
  | HttpSetMaxBodyOp
  | HttpSetBodyOp
  | HttpSetInsecureOp
  | HttpSetCaCertOp
  | HttpSendOp
  | HttpSendStartOp
  | HttpDoneOp
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
  // Preferences (NVS)
  | PreferencesClearOp
  | PreferencesRemoveOp
  | PreferencesPutIntOp
  | PreferencesGetIntOp
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
  | FsReadTextOp
  | FsWriteTextOp
  | FsExistsOp
  | FsRemoveOp
  // MQTT
  | MqttConnectOp
  | MqttOnMessageOp
  | MqttSubscribeOp
  | MqttPublishOp
  | MqttConnectedOp
  | MqttDisconnectOp
  | SensorFetchOp
  | SensorGetOp
  // Hardware timer
  // I2S / digital audio (unimplemented surface)
  | I2sInitOp
  | I2sWriteOp
  | I2sReadOp
  // TWAI / CAN (unimplemented surface)
  | TwaiInitOp
  | TwaiSendOp
  | TwaiReceiveOp
  // USB CDC-ACM serial (class-level surface)
  | UsbBeginOp
  | UsbEndOp
  | UsbPrintOp
  | UsbPrintlnOp
  | UsbWaitReadyOp
  | UsbReadOp
  | UsbAvailableOp
  | UsbConnectedOp
  // Ethernet MAC (unimplemented surface)
  | EthInitOp
  | EthStartOp
  | EthIsLinkedOp
  // ESPNOW (unimplemented surface)
  // Hardware crypto (unimplemented surface)
  | CryptoSha256Op
  // Pulse counter (unimplemented surface)
  // Motor control PWM (unimplemented surface)
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
  'gpio.write', 'gpio.read', 'gpio.toggle',
  // PWM
  // RMT
  // ADC
  // DAC
  // Interrupts
  'interrupt.attach_flags', 'interrupt.detach',
  // Timing (legacy Arduino-named ops removed; timers keep JS names)
    'timing.sleep', 'timing.now', 'timing.now_us', 'timing.busy_wait_us',
  // Thin Zephyr-shaped peripherals
  'gpio.configure', 'gpio.read_cfg', 'gpio.shift_out', 'gpio.shift_in',
  'pwm.set_pulse', 'pwm.set_duty', 'pwm.set_period',
  'adc.read_raw', 'adc.read_mv',
  'dac.write_value',
  'wdt.setup', 'wdt.feed',
  'counter.on_alarm', 'counter.start', 'counter.stop',
  // Tier-2 thin buses
  'i2c.reg_write', 'i2c.reg_read', 'i2c.reg_update', 'i2c.dev_write',
  'spi.transceive', 'spi.dev_write', 'spi.reg_read',
  'uart.poll_write', 'uart.rx_arm', 'uart.rx_available', 'uart.rx_peek', 'uart.rx_read',
  'thread.start', 'thread.join',
  // Pulse
  // Shift
  // Board
  'board.resolve',
  // Watchdog timer
  'wdt.disable',
  // Snprintf
  'snprintf.emit',
  // WiFi
  'wifi.join', 'wifi.connect_start', 'wifi.disconnect',
  'wifi.is_connected', 'wifi.local_ip', 'wifi.rssi', 'wifi.mac',
  'wifi.on_event',
  'wifi.ap_start', 'wifi.ap_stop',
  'wifi.scan', 'wifi.scan_start', 'wifi.scan_done', 'wifi.scan_count',
  'wifi.scan_ssid', 'wifi.scan_rssi', 'wifi.scan_encryption',
  'wifi.scan_channel',
  // HTTP
  'http.begin', 'http.set_header', 'http.set_timeout',
  'http.set_max_body', 'http.set_body', 'http.set_insecure',
  'http.set_ca_cert', 'http.send', 'http.send_start', 'http.done',
  'http.status', 'http.ok', 'http.body', 'http.content_length',
  'http.response_header',
  // BLE (NimBLE GATT peripheral)
  'ble.server_begin', 'ble.advertise_start', 'ble.advertise_stop',
  'ble.add_service', 'ble.add_char',
  'ble.on_read', 'ble.on_write', 'ble.on_connect', 'ble.on_disconnect', 'ble.notify',
  'ble.is_connected', 'ble.client_count',
  // Preferences (NVS)
  'preferences.clear', 'preferences.remove',
  'preferences.put_int', 'preferences.get_int',
  'preferences.put_bool', 'preferences.get_bool',
  'preferences.put_float', 'preferences.get_float',
  'preferences.put_string', 'preferences.get_string',
  // Random
  'random.int', 'random.range', 'random.seed',
  // FS (filesystem)
  'fs.read_text', 'fs.write_text', 'fs.exists', 'fs.remove',
  // MQTT
  'mqtt.connect', 'mqtt.on_message', 'mqtt.subscribe', 'mqtt.publish', 'mqtt.connected', 'mqtt.disconnect',
  'sensor.fetch',
  'sensor.get',
  // Hardware timer
  // I2S / digital audio (unimplemented — declared unsupported by all frameworks)
  'i2s.init', 'i2s.write', 'i2s.read',
  // TWAI / CAN (unimplemented)
  'twai.init', 'twai.send', 'twai.receive',
  // USB CDC-ACM serial port
  'usb.begin', 'usb.wait_ready', 'usb.end', 'usb.print', 'usb.println',
  'usb.read', 'usb.available', 'usb.connected',
  // Ethernet MAC (unimplemented)
  'eth.init', 'eth.start', 'eth.is_linked',
  // ESPNOW (unimplemented)
  // Hardware crypto (unimplemented)
  // Pulse counter (unimplemented)
  // Motor control PWM (unimplemented)
  // Raw passthrough
  'raw',
] as const;

// Compile-time exhaustiveness check: every HAL_OPERATION_KINDS entry must
// be a valid HALOpIR["operation"]. If you add an op to the const but not the
// union (or vice versa), this assignment fails to type-check.
const _halOpKindsExhaustive: HALOperationKind[] = [...HAL_OPERATION_KINDS];
