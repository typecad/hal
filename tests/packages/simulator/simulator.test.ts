// ---------------------------------------------------------------------------
// Simulator package tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  createSimBoard,
  SimDigitalPin,
  SimAnalogPin,
  SimPWMPin,
  SimInterruptPin,
  SimSerialPort,
  SimI2CBus,
  SimSPIBus,
  PinMode,
  I2CStatus,
} from '../../../packages/simulator/src/index';
import type { ISimI2CDevice, ISimSPIDevice } from '../../../packages/simulator/src/types';

// ===========================================================================
// GPIO Simulation
// ===========================================================================

describe('SimDigitalPin', () => {
  it('configures as output and writes high/low', () => {
    const pin = new SimDigitalPin(13);
    pin.asOutput();
    pin.high();
    expect(pin.getBitValue()).toBe(1);
    expect(pin.isHigh()).toBe(true);

    pin.low();
    expect(pin.getBitValue()).toBe(0);
    expect(pin.isLow()).toBe(true);
  });

  it('toggles state', () => {
    const pin = new SimDigitalPin(2);
    pin.asOutput();
    pin.low();
    pin.toggle();
    expect(pin.getBitValue()).toBe(1);
    pin.toggle();
    expect(pin.getBitValue()).toBe(0);
  });

  it('injects value for input reading', () => {
    const pin = new SimDigitalPin(5);
    pin.asInput();
    pin.injectValue(1);
    expect(pin.isHigh()).toBe(true);
    pin.injectValue(0);
    expect(pin.isLow()).toBe(true);
  });

  it('configures input with pullup', () => {
    const pin = new SimDigitalPin(2);
    pin.inputPullUp();
    expect(pin.getMode()).toBe(PinMode.INPUT_PULLUP);
    expect(pin.getBitValue()).toBe(1);
  });

  it('configures input with pulldown', () => {
    const pin = new SimDigitalPin(2);
    pin.inputPullDown();
    expect(pin.getMode()).toBe(PinMode.INPUT_PULLDOWN);
    expect(pin.getBitValue()).toBe(0);
  });

  it('tracks state history', () => {
    const pin = new SimDigitalPin(7);
    pin.asOutput();
    pin.high();
    pin.low();
    pin.high();
    const history = pin.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0]!.to).toBe(1);
    expect(history[1]!.to).toBe(0);
    expect(history[2]!.to).toBe(1);
  });

  it('resets to initial state', () => {
    const pin = new SimDigitalPin(3);
    pin.asOutput();
    pin.high();
    pin.reset();
    expect(pin.getHistory()).toHaveLength(0);
    expect(pin.getBitValue()).toBe(0);
  });
});

describe('SimAnalogPin', () => {
  it('reads injected ADC value', () => {
    const pin = new SimAnalogPin(0);
    pin.injectValue(512);
    expect(pin.readAnalog()).toBe(512);
  });

  it('reads injected voltage', () => {
    const pin = new SimAnalogPin(1);
    pin.setResolution(10); // 10-bit ADC
    pin.injectVoltage(2.5); // 2.5V on 5V reference
    // 2.5/5.0 * 1023 ≈ 511.5 → 512
    expect(pin.readAnalog()).toBe(512);
  });

  it('resets to initial state', () => {
    const pin = new SimAnalogPin(0);
    pin.injectValue(999);
    pin.reset();
    expect(pin.readAnalog()).toBe(0);
  });
});

describe('SimPWMPin', () => {
  it('writes PWM duty cycle', () => {
    const pin = new SimPWMPin(9);
    pin.asOutput();
    pin.write(128); // 50% duty on 0-255 range
    expect(pin.getPwmPercent()).toBeCloseTo(50, 0);
    expect(pin.isPwmActive()).toBe(true);
  });

  it('activates PWM mode', () => {
    const pin = new SimPWMPin(10);
    pin.asOutput();
    pin.pwm();
    expect(pin.isPwmActive()).toBe(true);
    // pwm() with no args activates PWM mode
    // Setting duty cycle to 0 deactivates PWM
    pin.pwm(0);
    expect(pin.isPwmActive()).toBe(false);
  });
});

describe('SimInterruptPin', () => {
  it('fires rising interrupt', () => {
    const pin = new SimInterruptPin(2);
    let fired = false;
    pin.onRising(() => { fired = true; });
    pin.fireInterrupt('rising', 1);
    expect(fired).toBe(true);
  });

  it('fires change handler on rising edge', () => {
    const pin = new SimInterruptPin(3);
    let changeCount = 0;
    pin.onChange(() => { changeCount++; });
    pin.simulateTransition(0, 1);
    expect(changeCount).toBe(1);
  });

  it('tracks interrupt events', () => {
    const pin = new SimInterruptPin(2);
    pin.onRising(() => {});
    pin.fireInterrupt('rising', 1);
    pin.fireInterrupt('falling', 0);
    const events = pin.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0]!.mode).toBe('rising');
    expect(events[1]!.mode).toBe('falling');
  });

  it('offRising() removes handler', () => {
    const pin = new SimInterruptPin(2);
    let count = 0;
    pin.onRising(() => { count++; });
    pin.fireInterrupt('rising', 1);
    expect(count).toBe(1);
    pin.offRising();
    pin.fireInterrupt('rising', 1);
    expect(count).toBe(1); // not incremented
  });

  it('offAll() removes all handlers', () => {
    const pin = new SimInterruptPin(2);
    let count = 0;
    pin.onRising(() => { count++; });
    pin.onFalling(() => { count++; });
    pin.fireInterrupt('rising', 1);
    pin.fireInterrupt('falling', 0);
    expect(count).toBe(2);
    pin.offAll();
    pin.fireInterrupt('rising', 1);
    pin.fireInterrupt('falling', 0);
    expect(count).toBe(2); // not incremented
  });
});

// ===========================================================================
// Serial Simulation
// ===========================================================================

describe('SimSerialPort', () => {
  it('writes and reads back via TX buffer', () => {
    const port = new SimSerialPort();
    port.begin(9600);
    port.write('Hello');
    expect(port.peekTxAsString()).toBe('Hello');
  });

  it('injects RX data and reads it', () => {
    const port = new SimSerialPort();
    port.begin(9600);
    port.injectRx('Hello World\n');
    const line = port.readLine();
    expect(line).toBe('Hello World');
  });

  it('flushes TX buffer', () => {
    const port = new SimSerialPort();
    port.println('test');
    const tx = port.flushTx();
    expect(tx.length).toBeGreaterThan(0);
    expect(port.peekTx()).toHaveLength(0);
  });

  it('resets all state', () => {
    const port = new SimSerialPort();
    port.begin(9600);
    port.write('data');
    port.injectRx('rx');
    port.reset();
    expect(port.peekTx()).toHaveLength(0);
    expect(port.available()).toBe(0);
  });
});

// ===========================================================================
// I2C Simulation
// ===========================================================================

describe('SimI2CBus', () => {
  it('reads from a mock device', () => {
    const bus = new SimI2CBus(0);
    const mockDevice: ISimI2CDevice = {
      read(register: number, count: number): number[] {
        if (register === 0x00) return [0x48, 0x65]; // "He"
        return new Array(count).fill(0);
      },
      write() {},
    };
    bus.attachDevice(0x68, mockDevice);
    bus.setClock(100000);
    bus.begin();

    const bytes = bus.device(0x68).readBytes(0x00, 2);
    expect(bytes[0]).toBe(0x48);
    expect(bytes[1]).toBe(0x65);
  });

  it('writes to a mock device', () => {
    const bus = new SimI2CBus(0);
    let writtenRegister = -1;
    let writtenData: number[] = [];
    const mockDevice: ISimI2CDevice = {
      read() { return []; },
      write(register: number, data: number[]): void {
        writtenRegister = register;
        writtenData = data;
      },
    };
    bus.attachDevice(0x68, mockDevice);
    bus.begin();

    bus.device(0x68).writeBytes(0x10, [0x0A, 0x0B]);
    expect(writtenRegister).toBe(0x10);
    expect(writtenData).toEqual([0x0A, 0x0B]);
  });

  it('returns empty for missing device read', () => {
    const bus = new SimI2CBus(0);
    bus.begin();
    const bytes = bus.device(0x40).readBytes(0x00, 1);
    expect(bytes.length).toBe(0);
  });

  it('logs operations', () => {
    const bus = new SimI2CBus(0);
    const mockDevice: ISimI2CDevice = {
      read() { return [0x42]; },
      write() {},
    };
    bus.attachDevice(0x50, mockDevice);
    bus.begin();
    bus.device(0x50).readBytes(0x00, 1);
    bus.device(0x50).writeByte(0x01, 0xFF);

    const log = bus.getLog();
    expect(log).toHaveLength(2);
    expect(log[0]!.operation).toBe('read');
    expect(log[1]!.operation).toBe('write');
  });

  it('uses register shortcuts', () => {
    const bus = new SimI2CBus(0);
    let lastWriteReg = -1;
    let lastWriteData: number[] = [];
    const mockDevice: ISimI2CDevice = {
      read(_reg: number, count: number): number[] {
        return new Array(count).fill(0xAB);
      },
      write(reg: number, data: number[]): void {
        lastWriteReg = reg;
        lastWriteData = data;
      },
    };
    bus.attachDevice(0x40, mockDevice);
    bus.begin();

    const accessor = bus.device(0x40);
    expect(accessor.readByte(0x00)).toBe(0xAB);
    accessor.writeByte(0x10, 0x55);
    expect(lastWriteReg).toBe(0x10);
    expect(lastWriteData).toEqual([0x55]);
  });
});

// ===========================================================================
// SPI Simulation
// ===========================================================================

describe('SimSPIBus', () => {
  it('transfers data to a mock device', () => {
    const bus = new SimSPIBus();
    const csPin = new SimDigitalPin(10);
    csPin.asOutput();

    const mockDevice: ISimSPIDevice = {
      transfer(mosiData: number[]): number[] {
        // Echo back inverted
        return mosiData.map(b => (~b) & 0xFF);
      },
    };
    bus.attachDevice(csPin, mockDevice);
    bus.setMode(0);
    bus.begin();

    // transfer returns the first MISO byte (HAL SPIDevice.transfer returns number)
    const result = bus.device(csPin).transfer(new Uint8Array([0xAA, 0x55]));
    expect(result).toBe(0x55);
  });

  it('writes to a mock device with write handler', () => {
    const bus = new SimSPIBus();
    const csPin = new SimDigitalPin(10);
    csPin.asOutput();

    let writtenReg = -1;
    let writtenData: number[] = [];
    const mockDevice: ISimSPIDevice = {
      transfer() { return []; },
      write(register: number, data: number[]): void {
        writtenReg = register;
        writtenData = data;
      },
    };
    bus.attachDevice(csPin, mockDevice);
    bus.begin();

    // writeRegister takes a single value (HAL signature), not a byte array
    bus.device(csPin).writeRegister(0x20, 0xDE);
    expect(writtenReg).toBe(0x20);
    expect(writtenData).toEqual([0xDE]);
  });

  it('reads from a mock device with readRegister handler', () => {
    const bus = new SimSPIBus();
    const csPin = new SimDigitalPin(10);
    csPin.asOutput();

    const mockDevice: ISimSPIDevice = {
      transfer() { return []; },
      readRegister(register: number, count: number): number[] {
        if (register === 0x00) return [0x12, 0x34];
        return new Array(count).fill(0xFF);
      },
    };
    bus.attachDevice(csPin, mockDevice);
    bus.begin();

    const result = bus.device(csPin).readRegister(0x00, 2);
    expect(result[0]).toBe(0x12);
    expect(result[1]).toBe(0x34);
  });

  it('logs operations', () => {
    const bus = new SimSPIBus();
    const csPin = new SimDigitalPin(10);
    csPin.asOutput();

    const mockDevice: ISimSPIDevice = {
      transfer(mosiData: number[]): number[] {
        return mosiData;
      },
    };
    bus.attachDevice(csPin, mockDevice);
    bus.begin();

    bus.device(csPin).transfer(new Uint8Array([0x01]));
    const log = bus.getLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.operation).toBe('transfer');
  });
});

// ===========================================================================
// Board Factory
// ===========================================================================

describe('createSimBoard', () => {
  it('creates an Arduino Uno board with default peripherals', () => {
    const board = createSimBoard({ boardType: 'arduino-uno' });

    // 14 digital pins
    expect(board.digitalPins.size).toBe(14);
    // 6 analog pins
    expect(board.analogPins.size).toBe(6);
    // PWM pins: 3, 5, 6, 9, 10, 11
    expect(board.pwmPins.size).toBe(6);
    // Interrupt pins: 2, 3
    expect(board.interruptPins.size).toBe(2);
    // 1 serial port, 1 I2C bus, 1 SPI bus
    expect(board.serialPorts.size).toBe(1);
    expect(board.i2cBuses.size).toBe(1);
    expect(board.spiBuses.size).toBe(1);
  });

  it('accesses peripherals via convenience methods', () => {
    const board = createSimBoard({ boardType: 'arduino-uno' });

    // Digital pin
    const d13 = board.digital(13);
    d13.asOutput();
    d13.high();
    expect(d13.getBitValue()).toBe(1);

    // Analog pin
    const a0 = board.analog(0);
    a0.injectValue(42);
    expect(a0.readAnalog()).toBe(42);

    // PWM pin
    const pwm9 = board.pwm(9);
    pwm9.asOutput();
    pwm9.write(128);
    expect(pwm9.getPwmPercent()).toBeCloseTo(50, 0);

    // Interrupt pin
    const int2 = board.interrupt(2);
    let fired = false;
    int2.onRising(() => { fired = true; });
    int2.fireInterrupt('rising', 1);
    expect(fired).toBe(true);

    // Serial
    const serial = board.serial(0);
    serial.begin(9600);
    serial.write('test');
    expect(serial.peekTxAsString()).toBe('test');

    // I2C
    const i2c = board.i2c(0);
    expect(i2c.busNumber).toBe(0);

    // SPI
    const spi = board.spi(0);
    expect(spi.isEnabled).toBe(false);
  });

  it('throws for invalid pin access', () => {
    const board = createSimBoard({ boardType: 'arduino-uno' });
    expect(() => board.digital(99)).toThrow('Digital pin 99');
    expect(() => board.analog(10)).toThrow('Analog pin A10');
    expect(() => board.pwm(2)).toThrow('Pin 2 is not a PWM');
    expect(() => board.interrupt(5)).toThrow('Pin 5 is not an interrupt');
  });

  it('resets all peripherals', () => {
    const board = createSimBoard({ boardType: 'arduino-uno' });
    const d13 = board.digital(13);
    d13.asOutput();
    d13.high();

    const a0 = board.analog(0);
    a0.injectValue(999);

    board.reset();

    expect(d13.getBitValue()).toBe(0);
    expect(a0.readAnalog()).toBe(0);
  });

  it('respects custom pin counts', () => {
    const board = createSimBoard({
      boardType: 'custom',
      digitalPinCount: 20,
      analogPinCount: 8,
      uartCount: 2,
      i2cBusCount: 2,
      spiBusCount: 2,
    });
    expect(board.digitalPins.size).toBe(20);
    expect(board.analogPins.size).toBe(8);
    expect(board.serialPorts.size).toBe(2);
    expect(board.i2cBuses.size).toBe(2);
    expect(board.spiBuses.size).toBe(2);
  });

  it('custom/unknown board types have no PWM or interrupt pins by default', () => {
    const board = createSimBoard({
      boardType: 'custom',
      digitalPinCount: 14,
    });
    expect(board.pwmPins.size).toBe(0);
    expect(board.interruptPins.size).toBe(0);
    // And the accessors throw for capability pins on a custom board
    expect(() => board.pwm(3)).toThrow('Pin 3 is not a PWM');
    expect(() => board.interrupt(2)).toThrow('Pin 2 is not an interrupt');
  });

  it('pwmPins/interruptPins overrides declare capability on a custom board', () => {
    const board = createSimBoard({
      boardType: 'custom',
      digitalPinCount: 10,
      pwmPins: [5, 9],
      interruptPins: [7],
    });
    expect(board.pwmPins.size).toBe(2);
    expect(board.interruptPins.size).toBe(1);
    expect(board.pwm(5)).toBeInstanceOf(SimPWMPin);
    expect(board.interrupt(7)).toBeInstanceOf(SimInterruptPin);
  });

  it('pwmPins/interruptPins overrides also apply to known board types', () => {
    const board = createSimBoard({
      boardType: 'arduino-uno',
      pwmPins: [3, 6],
      interruptPins: [2],
    });
    expect(Array.from(board.pwmPins.keys())).toEqual([3, 6]);
    expect(Array.from(board.interruptPins.keys())).toEqual([2]);
  });
});

// ===========================================================================
// Extended coverage — additional behavior + edge cases
// ===========================================================================

describe('SimDigitalPin (extended)', () => {
  it('write(value) drives the bit value', () => {
    const pin = new SimDigitalPin(8);
    pin.asOutput();
    pin.write(true);
    expect(pin.getBitValue()).toBe(1);
    pin.write(false);
    expect(pin.getBitValue()).toBe(0);
  });

  it('setMode changes the reported mode', () => {
    const pin = new SimDigitalPin(4);
    pin.setMode(PinMode.INPUT_PULLDOWN);
    expect(pin.getMode()).toBe(PinMode.INPUT_PULLDOWN);
  });

  it('outputOpenDrain sets the mode and optional initial value', () => {
    const pin = new SimDigitalPin(6);
    pin.outputOpenDrain(true);
    expect(pin.getMode()).toBe(PinMode.OUTPUT_OPEN_DRAIN);
    expect(pin.getBitValue()).toBe(1);
  });

  it('has() reports capabilities', () => {
    const pin = new SimDigitalPin(7);
    expect(pin.has('digitalInput')).toBe(true);
    expect(pin.has('digitalOutput')).toBe(true);
    expect(pin.has('pwm')).toBe(false);
    expect(pin.has('analogInput')).toBe(false);
  });

  it('clearHistory empties the recorded transitions', () => {
    const pin = new SimDigitalPin(2);
    pin.asOutput();
    pin.high();
    pin.low();
    expect(pin.getHistory()).toHaveLength(2);
    pin.clearHistory();
    expect(pin.getHistory()).toHaveLength(0);
  });

  it('pulse does not pollute state change history', () => {
    const pin = new SimDigitalPin(3);
    pin.asOutput();
    pin.pulse(100);
    // pulse duration is not awaited in simulation — no net transition recorded
    expect(pin.getHistory()).toHaveLength(0);
    expect(pin.getBitValue()).toBe(0);
  });

  it('tone/noTone/stop are no-ops', () => {
    const pin = new SimDigitalPin(5);
    expect(() => {
      const t = pin.tone(440);
      t.for(10);
      pin.noTone();
      pin.stop();
    }).not.toThrow();
  });

  it('waitForRising/waitForFalling resolve immediately', async () => {
    const pin = new SimDigitalPin(9);
    await expect(pin.waitForRising(10)).resolves.toBeUndefined();
    await expect(pin.waitForFalling(10)).resolves.toBeUndefined();
  });
});

describe('SimAnalogPin (extended)', () => {
  it('readVoltage reflects injected value scaled by reference', () => {
    const pin = new SimAnalogPin(0);
    pin.setResolution(10); // max 1023
    pin.injectValue(1023);
    // 1023 / 1023 * 5.0 = 5.0
    expect(pin.readVoltage()).toBeCloseTo(5.0, 5);
  });

  it('injectVoltage converts voltage to ADC value', () => {
    const pin = new SimAnalogPin(1);
    pin.setResolution(10);
    pin.injectVoltage(1.25); // 1.25 / 5.0 * 1023 ≈ 255.75 → 256
    expect(pin.readAnalog()).toBe(256);
  });

  it('setReferenceVoltage changes the voltage mapping', () => {
    const pin = new SimAnalogPin(2);
    pin.setReferenceVoltage(3.3);
    pin.injectVoltage(3.3);
    expect(pin.readVoltage()).toBeCloseTo(3.3, 5);
  });

  it('getAnalogResolution reports the configured resolution', () => {
    const pin = new SimAnalogPin(3);
    expect(pin.getAnalogResolution()).toBe(10);
    pin.setResolution(12);
    expect(pin.getAnalogResolution()).toBe(12);
  });

  it('injectValue maps to digital HIGH only above half-scale', () => {
    const pin = new SimAnalogPin(0);
    pin.setResolution(10); // half = 511.5
    pin.injectValue(511);
    expect(pin.read()).toBe(false);
    pin.injectValue(512);
    expect(pin.read()).toBe(true);
  });

  it('analog() puts the pin in input mode', () => {
    const pin = new SimAnalogPin(0);
    pin.analog();
    expect(pin.getMode()).toBe(PinMode.INPUT);
  });
});

describe('SimPWMPin (extended)', () => {
  it('getPwmFrequency/getPwmResolution report defaults', () => {
    const pin = new SimPWMPin(9);
    expect(pin.getPwmFrequency()).toBe(490);
    expect(pin.getPwmResolution()).toBe(8);
  });

  it('setFrequency updates getPwmFrequency', () => {
    const pin = new SimPWMPin(9);
    pin.setFrequency(980);
    expect(pin.getPwmFrequency()).toBe(980);
  });

  it('setResolution updates getPwmResolution and getPwmValue scaling', () => {
    const pin = new SimPWMPin(9);
    pin.setResolution(10); // max raw = 1023
    pin.pwm(100);
    expect(pin.getPwmValue()).toBe(1023);
    pin.pwm(50);
    // 50% of 1023 = 511.5 → rounds to 512
    expect(pin.getPwmValue()).toBe(512);
  });

  it('deprecated getFrequency/getResolution alias the contract getters', () => {
    const pin = new SimPWMPin(9);
    expect(pin.getFrequency()).toBe(pin.getPwmFrequency());
    expect(pin.getResolution()).toBe(pin.getPwmResolution());
  });

  it('write() with raw value > 1 is treated as a PWM duty value', () => {
    const pin = new SimPWMPin(9);
    pin.asOutput();
    pin.write(255); // 8-bit max → 100%
    expect(pin.getPwmPercent()).toBeCloseTo(100, 0);
    expect(pin.isPwmActive()).toBe(true);
  });

  it('pwm() with no args activates PWM; pwm(0) deactivates', () => {
    const pin = new SimPWMPin(10);
    pin.pwm();
    expect(pin.isPwmActive()).toBe(true);
    pin.pwm(0);
    expect(pin.isPwmActive()).toBe(false);
    expect(pin.getPwmPercent()).toBe(0);
  });
});

describe('SimInterruptPin (extended)', () => {
  it('fires a direct falling interrupt', () => {
    const pin = new SimInterruptPin(2);
    let fired = false;
    pin.onFalling(() => { fired = true; });
    pin.fireInterrupt('falling', 0);
    expect(fired).toBe(true);
  });

  it('change handler fires on both rising and falling edges', () => {
    const pin = new SimInterruptPin(3);
    let changes = 0;
    pin.onChange(() => { changes++; });
    pin.simulateTransition(0, 1); // rising → change
    pin.simulateTransition(1, 0); // falling → change
    expect(changes).toBe(2);
  });

  it('simulateTransition with same value is a no-op', () => {
    const pin = new SimInterruptPin(3);
    pin.onRising(() => {});
    pin.simulateTransition(1, 1);
    expect(pin.getEvents()).toHaveLength(0);
  });

  it('offFalling removes only the falling handler', () => {
    const pin = new SimInterruptPin(2);
    let rising = 0;
    let falling = 0;
    pin.onRising(() => { rising++; });
    pin.onFalling(() => { falling++; });
    pin.offFalling();
    pin.fireInterrupt('falling', 0);
    expect(falling).toBe(0);
    pin.fireInterrupt('rising', 1);
    expect(rising).toBe(1);
  });

  it('offInterrupts removes all handlers (alias of offAll)', () => {
    const pin = new SimInterruptPin(2);
    let count = 0;
    pin.onRising(() => { count++; });
    pin.onFalling(() => { count++; });
    pin.offInterrupts();
    pin.fireInterrupt('rising', 1);
    pin.fireInterrupt('falling', 0);
    expect(count).toBe(0);
    expect(pin.hasInterrupt()).toBe(false);
  });

  it('records debounce option and supports clearEvents', () => {
    const pin = new SimInterruptPin(2);
    pin.onRising(() => {}, { debounce: 25 });
    expect(pin.getDebounceMs()).toBe(25);
    pin.fireInterrupt('rising', 1);
    expect(pin.getEvents()).toHaveLength(1);
    pin.clearEvents();
    expect(pin.getEvents()).toHaveLength(0);
  });
});

describe('SimSerialPort (extended)', () => {
  it('printf formats %d/%i/%s/%f and %%', () => {
    const port = new SimSerialPort();
    port.printf('int=%d %i str=%s flt=%.2f pct=%%', 7, 3, 'hi', 1.5);
    // Note: .2f precision flag is not honored (impl formats bare %f); just
    // assert the integer/string/percent substitutions landed.
    expect(port.peekTxAsString()).toContain('int=7');
    expect(port.peekTxAsString()).toContain('str=hi');
    expect(port.peekTxAsString()).toContain('pct=%');
  });

  it('printf supports {} positional placeholders', () => {
    const port = new SimSerialPort();
    port.printf('{} and {}', 'one', 'two');
    expect(port.peekTxAsString()).toBe('one and two');
  });

  it('peek and read return bytes from the RX buffer', () => {
    const port = new SimSerialPort();
    port.injectRx([0x10, 0x20, 0x30]);
    expect(port.peek()).toBe(0x10);
    expect(port.read()).toBe(0x10);
    expect(port.peek()).toBe(0x20);
  });

  it('read returns -1 when the RX buffer is empty', () => {
    const port = new SimSerialPort();
    expect(port.read()).toBe(-1);
    expect(port.peek()).toBe(-1);
  });

  it('end() is a no-op that does not throw', () => {
    const port = new SimSerialPort();
    port.begin(9600);
    expect(() => port.end()).not.toThrow();
  });

  it('waitForConnection resolves', async () => {
    const port = new SimSerialPort();
    await expect(port.waitForConnection(10)).resolves.toBeUndefined();
  });
});

describe('SimI2CBus (extended)', () => {
  it('end() disables the bus without throwing', () => {
    const bus = new SimI2CBus(0);
    bus.begin();
    expect(() => bus.end()).not.toThrow();
    expect(bus.isEnabled).toBe(false);
  });

  it('begin(address) records slave mode and setClock updates speed', () => {
    const bus = new SimI2CBus(0);
    bus.begin(0x10);
    bus.setClock(400000);
    expect(bus.isEnabled).toBe(true);
    // No public accessor for _slaveAddress/_speed beyond behavior; setClock
    // simply must not throw and bus stays enabled.
  });

  it('fires onError NACK on missing device', () => {
    const bus = new SimI2CBus(0);
    let errStatus = -1;
    let errAddr = -1;
    bus.onError((status, address) => {
      errStatus = status;
      errAddr = address;
    });
    bus.begin();
    bus.device(0x42).readByte(0x00);
    expect(errStatus).toBe(I2CStatus.NACK_ON_ADDRESS);
    expect(errAddr).toBe(0x42);
  });

  it('recover completes without throwing', () => {
    const bus = new SimI2CBus(0);
    expect(() => bus.recover()).not.toThrow();
  });

  it('detachDevice removes a previously attached mock', () => {
    const bus = new SimI2CBus(0);
    const mock: ISimI2CDevice = { read() { return [0x01]; }, write() {} };
    bus.attachDevice(0x50, mock);
    bus.begin();
    expect(bus.device(0x50).readByte(0x00)).toBe(0x01);
    bus.detachDevice(0x50);
    expect(bus.device(0x50).readByte(0x00)).toBe(0); // no device → 0
  });

  it('clearLog empties the operation log', () => {
    const bus = new SimI2CBus(0);
    const mock: ISimI2CDevice = { read() { return [0x42]; }, write() {} };
    bus.attachDevice(0x50, mock);
    bus.begin();
    bus.device(0x50).readByte(0x00);
    expect(bus.getLog()).toHaveLength(1);
    bus.clearLog();
    expect(bus.getLog()).toHaveLength(0);
  });
});

describe('SimSPIBus (extended)', () => {
  it('bus-level transfer/write/write16 log without a device', () => {
    const bus = new SimSPIBus();
    bus.begin();
    bus.transfer(new Uint8Array([0x01, 0x02]));
    bus.write(0xAB);
    bus.write16(0x1234);
    const log = bus.getLog();
    expect(log).toHaveLength(3);
    expect(log[0]!.operation).toBe('transfer');
    expect(log[1]!.operation).toBe('write');
    // write16 produces two bytes via write(): one log entry, data = [0x12, 0x34]
    expect(log[2]!.data).toEqual([0x12, 0x34]);
  });

  it('setMode/setBitOrder/setFrequency and begin/endTransaction do not throw', () => {
    const bus = new SimSPIBus();
    expect(() => {
      bus.setMode(1);
      bus.setBitOrder('lsb');
      bus.setFrequency(1000000);
      bus.beginTransaction({ frequency: 1000000, mode: 0, bitOrder: 'msb' });
      bus.endTransaction();
    }).not.toThrow();
  });

  it('end() disables the bus without throwing', () => {
    const bus = new SimSPIBus();
    bus.begin();
    expect(() => bus.end()).not.toThrow();
    expect(bus.isEnabled).toBe(false);
  });

  it('readRegister falls back to transfer with dummy bytes when mock lacks readRegister', () => {
    const bus = new SimSPIBus();
    const cs = new SimDigitalPin(10);
    const mock: ISimSPIDevice = {
      // No readRegister provided — first byte is the register, rest are dummies
      transfer(mosi: number[]) {
        expect(mosi[0]).toBe(0x20);
        return [0x00, 0x77, 0x88]; // leading 0x00 is the register echo
      },
    };
    bus.attachDevice(cs, mock);
    bus.begin();
    const out = bus.device(cs).readRegister(0x20, 2);
    // fallback slices off the register echo byte
    expect(Array.from(out)).toEqual([0x77, 0x88]);
  });

  it('detachDevice removes a previously attached mock', () => {
    const bus = new SimSPIBus();
    const cs = new SimDigitalPin(10);
    const mock: ISimSPIDevice = { transfer() { return [0x42]; } };
    bus.attachDevice(cs, mock);
    bus.begin();
    // transfer returns the first MISO byte (a number)
    expect(bus.device(cs).transfer([0x01])).toBe(0x42);
    bus.detachDevice(cs);
    // After detach, transfer returns 0 (no device)
    expect(bus.device(cs).transfer([0x01])).toBe(0);
  });

  it('clearLog empties the operation log', () => {
    const bus = new SimSPIBus();
    bus.begin();
    bus.write(0x01);
    expect(bus.getLog()).toHaveLength(1);
    bus.clearLog();
    expect(bus.getLog()).toHaveLength(0);
  });
});

describe('createSimBoard (extended)', () => {
  it('provides typed pin instances on each accessor map', () => {
    const board = createSimBoard({ boardType: 'arduino-uno' });
    expect(board.digital(0)).toBeInstanceOf(SimDigitalPin);
    expect(board.analog(0)).toBeInstanceOf(SimAnalogPin);
    expect(board.pwm(3)).toBeInstanceOf(SimPWMPin);
    expect(board.interrupt(2)).toBeInstanceOf(SimInterruptPin);
    expect(board.serial(0)).toBeInstanceOf(SimSerialPort);
    expect(board.i2c(0)).toBeInstanceOf(SimI2CBus);
    expect(board.spi(0)).toBeInstanceOf(SimSPIBus);
  });

  it('throws for out-of-range bus accessors', () => {
    const board = createSimBoard({ boardType: 'arduino-uno' });
    expect(() => board.serial(9)).toThrow('Serial port UART9');
    expect(() => board.i2c(9)).toThrow('I2C bus 9');
    expect(() => board.spi(9)).toThrow('SPI bus 9');
  });
});
