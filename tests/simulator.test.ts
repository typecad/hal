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
} from '../packages/simulator/src/index';
import type { ISimI2CDevice, ISimSPIDevice } from '../packages/simulator/src/types';

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
    const port = new SimSerialPort(0);
    port.begin(9600);
    port.write('Hello');
    expect(port.peekTxAsString()).toBe('Hello');
  });

  it('injects RX data and reads it', () => {
    const port = new SimSerialPort(0);
    port.begin(9600);
    port.injectRx('Hello World\n');
    const line = port.readLine();
    expect(line).toBe('Hello World');
  });

  it('reads exact byte count', () => {
    const port = new SimSerialPort(0);
    port.injectRx([0x01, 0x02, 0x03, 0x04, 0x05]);
    const bytes = port.readBytes(3);
    expect(bytes.length).toBe(3);
    expect(bytes[0]).toBe(0x01);
    expect(bytes[2]).toBe(0x03);
  });

  it('returns partial data when not enough bytes', () => {
    const port = new SimSerialPort(0);
    port.injectRx([0x01, 0x02]);
    const bytes = port.readBytes(5);
    expect(bytes.length).toBe(2);
  });

  it('flushes TX buffer', () => {
    const port = new SimSerialPort(0);
    port.println('test');
    const tx = port.flushTx();
    expect(tx.length).toBeGreaterThan(0);
    expect(port.peekTx()).toHaveLength(0);
  });

  it('triggers onReceive callback', () => {
    const port = new SimSerialPort(0);
    let received = 0;
    port.onReceive((n) => { received = n; });
    port.injectRx('abc');
    expect(received).toBe(3);
  });

  it('resets all state', () => {
    const port = new SimSerialPort(0);
    port.begin(9600);
    port.write('data');
    port.injectRx('rx');
    port.reset();
    expect(port.isEnabled).toBe(false);
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

    const result = bus.device(csPin).transfer(new Uint8Array([0xAA, 0x55]));
    expect(result[0]).toBe(0x55);
    expect(result[1]).toBe(0xAA);
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

    bus.device(csPin).writeRegister(0x20, new Uint8Array([0xDE, 0xAD]));
    expect(writtenReg).toBe(0x20);
    expect(writtenData).toEqual([0xDE, 0xAD]);
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
});
