// ---------------------------------------------------------------------------
// HAL compile-time semantic functions
//
// These functions are resolved to HALOpIR nodes by the transpiler's HAL
// resolver.  The framework strategy translates each operation into
// framework-specific C++ at code generation time.
//
// Pin parameters accept both `number` (legacy framework pin number) and
// `string` (MCU port name like "PB5"). The transpiler resolves port names
// to framework pin numbers via the MCU package's pin mapping.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GPIO — digital pin control
// ---------------------------------------------------------------------------

/** Set a digital pin HIGH or LOW. */
export function gpioWrite(pin: number | string, value: number | boolean): void {}
/** Read a digital pin. Returns HIGH (1) or LOW (0). */
export function gpioRead(pin: number | string): number { return 0; }
/** Toggle a digital pin. */
export function gpioToggle(pin: number | string): void {}
/** Set pin mode: "output" | "input" | "input_pullup" | "input_pulldown". */
export function gpioSetMode(pin: number | string, mode: string): void {}

// ---------------------------------------------------------------------------
// PWM — pulse-width modulation
// ---------------------------------------------------------------------------

/** Write PWM duty cycle to a pin. */
export function pwmWrite(pin: number | string, duty: number): void {}

// ---------------------------------------------------------------------------
// ADC — analog-to-digital conversion
// ---------------------------------------------------------------------------

/** Read analog value from a pin. */
export function adcRead(pin: number | string): number { return 0; }
/** Read analog voltage from a pin (ADC value converted to voltage). */
export function adcReadVoltage(pin: number | string): number { return 0; }
/** Set the analog reference. */
export function adcSetReference(ref: string | number): void {}

// ---------------------------------------------------------------------------
// Interrupts
// ---------------------------------------------------------------------------

/** Attach an interrupt handler to a pin. */
export function interruptAttach(pin: number | string, handler: string, mode: string): void {}
/** Detach an interrupt from a pin. */
export function interruptDetach(pin: number | string): void {}

// ---------------------------------------------------------------------------
// Tone / audio output
// ---------------------------------------------------------------------------

/** Play a tone on a pin at the given frequency, optionally for a duration. */
export function tonePlay(pin: number | string, frequency: number, duration?: number): void {}
/** Stop tone playback on a pin. */
export function toneStop(pin: number | string): void {}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** Delay for the given number of milliseconds. */
export function delayMs(ms: number): void {}
/** Delay for the given number of microseconds. */
export function delayMicro(us: number): void {}
/** Get milliseconds since boot. */
export function getMillis(): number { return 0; }
/** Get microseconds since boot. */
export function getMicros(): number { return 0; }
/** Get free heap bytes. Architecture-aware: the strategy maps this to the right
 *  symbol per target (ESP.getFreeHeap() on ESP32, __heap_start trick on AVR). */
export function getFreeHeap(): number { return 0; }

// ---------------------------------------------------------------------------
// I2C — inter-integrated circuit bus
// ---------------------------------------------------------------------------

/** Initialize I2C bus (master mode if no address, slave mode with address). */
export function i2cBegin(bus: string, address?: number): void {}
/** Disable I2C bus. */
export function i2cEnd(bus: string): void {}
/** Set I2C bus clock speed. */
export function i2cSetClock(bus: string, hz: number): void {}
/** Begin I2C transmission to a slave address. */
export function i2cBeginTx(bus: string, address: number): void {}
/** Write data to I2C bus. */
export function i2cWrite(bus: string, data: string | number | number[] | Uint8Array): void {}
/** Write a byte buffer to I2C bus (expands array literals to per-byte writes). */
export function i2cWriteBuffer(bus: string, data: number[] | Uint8Array): void {}
/** End I2C transmission. Returns status. */
export function i2cEndTx(bus: string, stop: boolean): number { return 0; }
/** Request bytes from I2C slave. */
export function i2cRequestFrom(bus: string, address: number, quantity: number, stop?: boolean): number { return 0; }
/** Check if bytes are available from I2C. */
export function i2cAvailable(bus: string): number { return 0; }
/** Read a byte from I2C. */
export function i2cRead(bus: string): number { return 0; }
/**
 * Drain `count` bytes requested from the I2C bus into a caller-provided buffer.
 * Semantic primitive: lowers to the `i2c.read_buffer` HAL op. The `buffer`
 * argument is emitted as a placeholder (`__HAL_READ_BUF__`) that the var-init
 * transformer rewrites to the caller's own buffer variable, so bytes land in
 * the `uint8_t data[N]` declared in user scope — NOT an internal temp that
 * decays to a pointer on return. Keeps `data.length` / `data[i]` valid.
 */
export function i2cReadBuffer(bus: string, count: number, buffer: number[] | Uint8Array): void {}

// ---------------------------------------------------------------------------
// SPI — serial peripheral interface
// ---------------------------------------------------------------------------

/** Initialize SPI bus. */
export function spiBegin(bus: string): void {}
/** Disable SPI bus. */
export function spiEnd(bus: string): void {}
/** Transfer data on SPI bus. */
export function spiTransfer(bus: string, data: string | number | Uint8Array): number { return 0; }
/** Begin SPI transaction with settings. */
export function spiBeginTx(bus: string, settings: string | any): void {}
/** End SPI transaction. */
export function spiEndTx(bus: string): void {}
/** Set SPI chip-select pin LOW. */
export function spiCsLow(pin: number | string): void {}
/** Set SPI chip-select pin HIGH. */
export function spiCsHigh(pin: number | string): void {}
/**
 * Read `count` bytes from the SPI bus into a caller-provided buffer by clocking
 * dummy (0x00) transfers. Semantic primitive: lowers to the `spi.read_buffer`
 * HAL op (per-byte `bus.transfer(0)` read loop). The `buffer` placeholder is
 * rewritten to the caller's variable. Mirrors i2cReadBuffer. The caller is
 * responsible for asserting/de-asserting chip-select around it.
 */
export function spiReadBuffer(bus: string, count: number, buffer: number[] | Uint8Array): void {}
/** Set SPI data mode. */
export function spiSetMode(bus: string, mode: number): void {}
/** Set SPI bit order. */
export function spiSetBitOrder(bus: string, order: string): void {}

// ---------------------------------------------------------------------------
// UART — serial communication
// ---------------------------------------------------------------------------

/** Initialize serial port with baud rate. */
export function uartBegin(port: string, baud: number): void {}
/** Disable serial port. */
export function uartEnd(port: string): void {}
/** Print value to serial. */
export function uartPrint(port: string, value: any): void {}
/** Print value with newline to serial. */
export function uartPrintln(port: string, value: any): void {}
/** printf-style formatted print to serial. */
export function uartPrintf(port: string, format: any, args: any[]): void {}
/** Write raw data to serial. */
export function uartWrite(port: string, data: any): void {}
/** Read a byte from serial. */
export function uartRead(port: string): number { return 0; }
/** Peek at next byte from serial without consuming. */
export function uartPeek(port: string): number { return 0; }
/** Check if bytes are available from serial. */
export function uartAvailable(port: string): number { return 0; }
/** Flush serial output. */
export function uartFlush(port: string): void {}

// ---------------------------------------------------------------------------
// Pulse measurement
// ---------------------------------------------------------------------------

/** Measure pulse duration on a pin. */
export function pulseIn_(pin: number | string, value: number, timeout?: number): number { return 0; }
/** Measure long pulse using high-precision timer. */
export function pulseInLong_(pin: number | string, value: number): number { return 0; }

// ---------------------------------------------------------------------------
// Shift register
// ---------------------------------------------------------------------------

/** Shift a byte out to a pin. */
export function shiftOut_(dataPin: number | string, clockPin: number | string, bitOrder: number, value: number): void {}
/** Shift a byte in from a pin. */
export function shiftIn_(dataPin: number | string, clockPin: number | string, bitOrder: number): number { return 0; }

// ---------------------------------------------------------------------------
// Board constant resolution
// ---------------------------------------------------------------------------

/** Write a value to a DAC pin. */
export function dacWrite(pin: number | string, value: number): void {}

// ---------------------------------------------------------------------------
// Watchdog timer (WDT)
// ---------------------------------------------------------------------------

/** Enable the watchdog timer with the given timeout (string preset or number). */
export function wdtEnable(timeout: string | number): void {}

/** Reset (kick) the watchdog timer. */
export function wdtReset(): void {}

/** Disable the watchdog timer. */
export function wdtDisable(): void {}

/** Resolve a board definition path to a compile-time constant. */
export function boardResolve(path: string): any { return undefined as any; }

// ---------------------------------------------------------------------------
// Power — MCU power states and clock frequency
// ---------------------------------------------------------------------------

/** Enter deep sleep for the given duration (ms). Architecture-aware: the
 *  strategy emits the right call per target (esp_deep_sleep on ESP32, a
 *  not-supported comment elsewhere). */
export function powerDeepSleep(ms: number): void {}
/** Enter light sleep. Architecture-aware. */
export function powerLightSleep(): void {}
/** Set the CPU frequency (MHz). */
export function powerSetCpuFrequency(mhz: number): void {}
/** Enter deep sleep until `pin` reaches `level` (pin wakeup). Architecture-aware:
 *  ext0 on Xtensa (RTC pins), gpio-wakeup on RISC-V. */
export function powerDeepSleepPin(pin: number, level: number): void {}

// ---------------------------------------------------------------------------
// WiFi
// ---------------------------------------------------------------------------

export function wifiConnect(ssid: string, password?: string, timeoutMs?: number): boolean { return false; }
export function wifiConnectStart(ssid: string, password?: string): void {}
export function wifiDisconnect(): void {}
export function wifiStatus(): number { return 0; }
export function wifiIsConnected(): boolean { return false; }
export function wifiLocalIp(): string { return ""; }
export function wifiRssi(): number { return 0; }
export function wifiMac(): string { return ""; }
export function wifiSetHostname(name: string): void {}
export function wifiSetStaticIp(ip: string, gateway: string, subnet: string, dns?: string): void {}
export function wifiSetAutoReconnect(enabled: boolean): void {}
export function wifiSetPowerSave(mode: string): void {}
export function wifiSetTxPower(dbm: number): void {}
export function wifiOnEvent(event: string, handler: string): void {}
export function wifiApStart(ssid: string, password?: string, channel?: number, hidden?: boolean, maxClients?: number): boolean { return false; }
export function wifiApStop(): void {}
export function wifiApClientCount(): number { return 0; }
export function wifiApIp(): string { return ""; }
export function wifiApSetChannel(channel: number): void {}
export function wifiApSetHidden(hidden: boolean): void {}
export function wifiApSetMaxClients(maxClients: number): void {}
export function wifiScan(): number { return 0; }
export function wifiScanStart(): void {}
export function wifiScanCount(): number { return 0; }
export function wifiScanSsid(index: number): string { return ""; }
export function wifiScanRssi(index: number): number { return 0; }
export function wifiScanEncryption(index: number): number { return 0; }
export function wifiScanChannel(index: number): number { return 0; }
export function wifiSaveCredentials(ssid: string, password: string): void {}
export function wifiConnectSaved(timeoutMs?: number): boolean { return false; }
export function wifiClearCredentials(): void {}
export function wifiWaitConnected(timeoutMs?: number): boolean { return false; }
export function wifiWaitDisconnected(): void {}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

export function httpBegin(method: string, url: string): void {}
export function httpReset(): void {}
export function httpSetHeader(name: string, value: string): void {}
export function httpSetTimeout(ms: number): void {}
export function httpSetMaxBody(bytes: number): void {}
export function httpSetBody(data: string, json?: boolean): void {}
export function httpSetInsecure(): void {}
export function httpSetCaCert(pem: string): void {}
export function httpSend(): boolean { return false; }
export function httpSendStart(): void {}
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
export function bleNotify(index: number, value: number | string): void {}
export function bleIsConnected(): boolean { return false; }
export function bleClientCount(): number { return 0; }
export function bleSetName(name: string): void {}
export function bleUntilConnected(timeoutMs?: number): boolean { return false; }
export function bleUntilConnectedStart(): void {}
export function bleSetTxPower(dbm: number): void {}
export function bleStatus(): number { return 0; }

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
