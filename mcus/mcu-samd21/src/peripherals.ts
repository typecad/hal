// ---------------------------------------------------------------------------
// @typecad/mcu-samd21 — Hardware peripheral descriptions
// ARM Cortex-M0+ @ 48 MHz. SERCOM: 6 instances (each muxable to UART/SPI/I2C
// on a pad set); the Nano 33 IoT board wires sercom1 (header SPI), sercom2
// (NINA SPI), sercom3 (NINA prog UART), sercom4 (header I2C), sercom5
// (header UART / console). 1× ADC (12-bit), TCC0–TCC3 + TC0–TC7 timers.
// USB device. No DAC. No crypto/TRNG exposed to user code.
//
// Default pins verified against Zephyr 4.3's
// boards/arduino/nano_33_iot/arduino_nano_33_iot-pinctrl.dtsi:
//   sercom1 (SPI)  MOSI PA16 / MISO PA19 / SCK PA17, CS PA21 (header D10)
//   sercom4 (I2C)  SDA PB8 / SCL PB9
//   sercom5 (UART) TX PB22 / RX PB23 (console @115200)
// ---------------------------------------------------------------------------

import type {
  PeripheralInstance, ADCDefinition, PWMDefinition, TimerDefinition,
} from '@typecad/cuttlefish/api/schema';
import {
  I2CBus, SPIBus, SerialPort, i2cName, spiName, serialName, createHALInstances,
} from '@typecad/hal';

export const I2C_INSTANCES: readonly PeripheralInstance[] = [
  // SERCOM4 — wired to the header A4/A5 pins (also the LSM6DS3 + ATECC608A
  // onboard sensors' bus on the Nano 33 IoT).
  { instance: 0, defaultPins: { sda: 'PB8', scl: 'PB9' } },
] as const;

export const SPI_INSTANCES: readonly PeripheralInstance[] = [
  // SERCOM1 — wired to the header D11/D12/D13 pins.
  { instance: 0, defaultPins: { mosi: 'PA16', miso: 'PA19', sck: 'PA17', cs: 'PA21' } },
] as const;

export const UART_INSTANCES: readonly PeripheralInstance[] = [
  // SERCOM5 — wired to the header D1/D0 pins; the Zephyr console.
  { instance: 0, defaultPins: { tx: 'PB22', rx: 'PB23' } },
] as const;

export const ADC_INSTANCES: readonly ADCDefinition[] = [
  // ADC: 12-bit. Seven inputs reach header pins on the Nano 33 IoT
  // (AIN0/2/3/10 on A0/A4/A5/A1, AIN17/18/19 on A6/A3/A2 — per the board
  // dts's adc_default pinctrl group). Reference: the sam0 driver maps
  // ADC_REF_VDD_1_2 to INTVCC0 (VDDANA/2 = 1.65 V @3.3 V) — see the board
  // package's zephyr.adc for the full-range caveat.
  { instance: 0, channels: 7, resolution: 12, referenceVoltage: 1.65, maxValue: 4095,
    referenceVoltages: { DEFAULT: 1.65 } },
] as const;

export const PWM_CAPABILITIES: PWMDefinition = {
  // tcc2 (the board-enabled PWM timer) runs from the 48 MHz GCLK with the
  // dts prescaler at 1024 → 46.875 kHz counter clock, 16-bit.
  channels: 4, resolution: 16, maxFrequency: 46_875,
} as const;

export const TIMER_INSTANCES: readonly TimerDefinition[] = [
  // SAMD21 timer pool: TCC0/TCC1 are 24-bit (schema allows 8/16/32/64 —
  // rounded to 32), TCC2/TCC3 and TC0–TC7 are 16-bit. The Nano 33 IoT
  // board enables tcc2 as its PWM timer.
  { instance: 0, type: 'general', bits: 32, features: ['interrupt'] },  // TCC0 (24-bit)
  { instance: 1, type: 'general', bits: 32, features: ['interrupt'] },  // TCC1 (24-bit)
  { instance: 2, type: 'general', bits: 16, features: ['interrupt'] },  // TCC2
  { instance: 3, type: 'general', bits: 16, features: ['interrupt'] },  // TCC3
] as const;

export const MCU_PERIPHERALS = {
  i2c: [...I2C_INSTANCES],
  spi: [...SPI_INSTANCES],
  uart: [...UART_INSTANCES],
  adc: [...ADC_INSTANCES],
  pwm: PWM_CAPABILITIES,
  timers: [...TIMER_INSTANCES],
} as const;

export const [I2C0] = createHALInstances(I2C_INSTANCES, i => new I2CBus(i2cName(i)));
export const [SPI0] = createHALInstances(SPI_INSTANCES, i => new SPIBus(spiName(i)));
export const [UART0] = createHALInstances(UART_INSTANCES, i => new SerialPort(serialName(i)));
