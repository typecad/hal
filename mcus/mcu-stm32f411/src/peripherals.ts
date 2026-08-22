// ---------------------------------------------------------------------------
// @typecad/mcu-stm32f411 — Hardware peripheral descriptions
// ARM Cortex-M4F @ 100 MHz. 3× I2C, 3× SPI usable on the F411C package
// (silicon has 5 — SPI4/SPI5 only route to PE/PF pins the 48-pin package
// does not bond), 3× USART, 1× ADC (12-bit), 5× timers (TIM1 advanced +
// TIM2–TIM5 general, 4 PWM channels each). USB OTG_FS. No wireless. No DAC.
//
// Default pins verified against hal_stm32's
// dts/st/f4/stm32f411c(c-e)ux-pinctrl.dtsi (the F411CEU6's package):
//   i2c1 SDA PB9 / SCL PB8, i2c2 SDA PB3 / SCL PB10, i2c3 SDA PB4 / SCL PA8
//   spi1 MOSI PA7 / MISO PA6 / SCK PA5 / NSS PA4,
//   spi2 MOSI PB15 / MISO PB14 / SCK PB13 / NSS PB12,
//   spi3 MOSI PB5 / MISO PB4 / SCK PB3 / NSS PA15
//   usart1 TX PA9 / RX PA10, usart2 TX PA2 / RX PA3, usart6 TX PA11 / RX PA12
// ---------------------------------------------------------------------------

import type {
  PeripheralInstance, ADCDefinition, PWMDefinition, TimerDefinition,
} from '@typecad/cuttlefish/api/schema';
import {
  I2CBus, SPIBus, SerialPort, i2cName, spiName, serialName, createHALInstances,
} from '@typecad/hal';

export const I2C_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { sda: 'PB9', scl: 'PB8' } },
  { instance: 1, defaultPins: { sda: 'PB3', scl: 'PB10' } },
  { instance: 2, defaultPins: { sda: 'PB4', scl: 'PA8' } },
] as const;

export const SPI_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { mosi: 'PA7', miso: 'PA6', sck: 'PA5', cs: 'PA4' } },
  { instance: 1, defaultPins: { mosi: 'PB15', miso: 'PB14', sck: 'PB13', cs: 'PB12' } },
  { instance: 2, defaultPins: { mosi: 'PB5', miso: 'PB4', sck: 'PB3', cs: 'PA15' } },
] as const;

export const UART_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { tx: 'PA9', rx: 'PA10' } },
  { instance: 1, defaultPins: { tx: 'PA2', rx: 'PA3' } },
  { instance: 2, defaultPins: { tx: 'PA11', rx: 'PA12' } },
] as const;

export const ADC_INSTANCES: readonly ADCDefinition[] = [
  // ADC1: 16 silicon channels, but only IN0–IN9 reach bonded pins on the
  // F411C package (PA0–PA7 → IN0–7, PB0/PB1 → IN8/9). IN10–IN15 route to
  // PC0–PC5 which the 48-pin package does not bond.
  { instance: 0, channels: 10, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
    referenceVoltages: { DEFAULT: 3.3 } },
] as const;

export const PWM_CAPABILITIES: PWMDefinition = {
  channels: 20, resolution: 16, maxFrequency: 50_000_000,
} as const;

export const TIMER_INSTANCES: readonly TimerDefinition[] = [
  // TIM1 is an advanced timer (complementary outputs); the schema's closest
  // category is 'general'.
  { instance: 0, type: 'general', bits: 16, features: ['interrupt'] },  // TIM1
  { instance: 1, type: 'general', bits: 32, features: ['interrupt'] },   // TIM2
  { instance: 2, type: 'general', bits: 16, features: ['interrupt'] },   // TIM3
  { instance: 3, type: 'general', bits: 16, features: ['interrupt'] },   // TIM4
  { instance: 4, type: 'general', bits: 16, features: ['interrupt'] },   // TIM5
] as const;

export const MCU_PERIPHERALS = {
  i2c: [...I2C_INSTANCES],
  spi: [...SPI_INSTANCES],
  uart: [...UART_INSTANCES],
  adc: [...ADC_INSTANCES],
  pwm: PWM_CAPABILITIES,
  timers: [...TIMER_INSTANCES],
} as const;

export const [I2C0, I2C1, I2C2] = createHALInstances(I2C_INSTANCES, i => new I2CBus(i2cName(i)));
export const [SPI0, SPI1, SPI2] = createHALInstances(SPI_INSTANCES, i => new SPIBus(spiName(i)));
export const [UART0, UART1, UART2] = createHALInstances(UART_INSTANCES, i => new SerialPort(serialName(i)));
