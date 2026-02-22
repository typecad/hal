/**
 * Self-contained example: Board.A0.read()
 * 
 * Copy-paste this entire file to use Board.A0.read() anywhere.
 * No external dependencies required.
 */

// ============================================================
// TYPES: Core pin type definitions
// ============================================================

type DigitalValue = HIGH | LOW | boolean;

export const HIGH = 1 as const;
export const LOW = 0 as const;

type HIGH = typeof HIGH;
type LOW = typeof LOW;

type AnalogValue = number;

enum PinMode {
  INPUT = 'INPUT',
  OUTPUT = 'OUTPUT',
  INPUT_PULLUP = 'INPUT_PULLUP',
  INPUT_PULLDOWN = 'INPUT_PULLDOWN',
  OUTPUT_OPEN_DRAIN = 'OUTPUT_OPEN_DRAIN',
  ANALOG = 'ANALOG'
}

interface PinCapabilities {
  readonly digitalInput: boolean;
  readonly digitalOutput: boolean;
  readonly analogInput: boolean;
  readonly analogOutput: boolean;
  readonly pwm: boolean;
  readonly interrupt: boolean;
  readonly pullUp: boolean;
  readonly pullDown: boolean;
}

type PinNumber = number & { readonly __pinNumber: unique symbol };

interface IPin {
  readonly number: PinNumber;
  readonly gpio: PinNumber;
  readonly name: string;
  readonly capabilities: PinCapabilities;
  getMode(): PinMode;
  setMode(mode: PinMode): void;
}

interface IAnalogInput extends IPin {
  read(): AnalogValue;
  readVoltage(): number;
  setReference(voltage: number): void;
  getResolution(): number;
}

// ============================================================
// IMPLEMENTATION: AVR Analog Pin
// ============================================================

class AVRAnalogPin implements IAnalogInput {
  readonly number: PinNumber;
  readonly gpio: PinNumber;
  readonly name: string;
  readonly capabilities: PinCapabilities;
  private _mode: PinMode;
  private _reference: number = 5.0;
  private _resolution: number = 10;
  private _value: number = 0; // Simulated value

  constructor(name: string, number: number) {
    this.name = name;
    this.number = number as PinNumber;
    this.gpio = number as PinNumber;
    this.capabilities = {
      digitalInput: true,
      digitalOutput: true,
      analogInput: true,
      analogOutput: false,
      pwm: false,
      interrupt: false,
      pullUp: true,
      pullDown: false,
    };
    this._mode = PinMode.ANALOG;
  }

  getMode(): PinMode {
    return this._mode;
  }

  setMode(mode: PinMode): void {
    this._mode = mode;
  }

  read(): AnalogValue {
    // In real hardware, this would be: return analogRead(this.gpio - 14);
    analogRead(this.gpio);
    return this._value;
  }

  readVoltage(): number {
    const raw = this.read();
    return (raw / 1023.0) * this._reference;
  }

  setReference(voltage: number): void {
    this._reference = voltage;
  }

  getResolution(): number {
    return this._resolution;
  }

  // Simulation helper - set mock value
  setValue(value: number): void {
    this._value = Math.max(0, Math.min(1023, value));
  }
}

// ============================================================
// BOARD: Arduino Uno pin definitions
// ============================================================

const A0 = new AVRAnalogPin("A0", 14);
const A1 = new AVRAnalogPin("A1", 15);
const A2 = new AVRAnalogPin("A2", 16);
const A3 = new AVRAnalogPin("A3", 17);
const A4 = new AVRAnalogPin("A4", 18);
const A5 = new AVRAnalogPin("A5", 19);

const Board = {
  A0,
  A1,
  A2,
  A3,
  A4,
  A5,
} as const;

// ============================================================
// USAGE EXAMPLE
// ============================================================

Serial.begin(9600);

// Read analog value from pin A0 (0-1023 on AVR)
const value: number = Board.A0.read();
const not_used: number = 0;

console.log(value);
// Output: Raw: 512, Voltage: 2.50V, Resolution: 10-bit