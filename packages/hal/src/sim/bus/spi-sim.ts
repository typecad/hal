// ---------------------------------------------------------------------------
// @typecad/hal/sim — SPI bus simulation
// ---------------------------------------------------------------------------

import { SPIStatus } from '../contracts.js';
import type {
  ISPIBus,
  ISPIDevice,
  BasePin,
  ErrorPolicy,
  SPIMode,
  SPIBitOrder,
  SPISettings,
} from '../contracts.js';
import type { ISimSPIDevice } from '../types.js';

// ---------------------------------------------------------------------------
// SimSPIBus
// ---------------------------------------------------------------------------

/**
 * Simulated SPI bus for testing SPI communication.
 *
 * Tests register mock devices via `attachDevice()`. When program code performs
 * transfers, the corresponding mock device handles the operation.
 */
export class SimSPIBus implements ISPIBus {
  isEnabled: boolean = false;
  errorPolicy: ErrorPolicy = 'callback';

  private _frequency: number = 4000000;
  private _mode: SPIMode = 0;
  private _bitOrder: SPIBitOrder = 'msb';
  private _devices: Map<string, ISimSPIDevice> = new Map();
  private _inTransaction: boolean = false;

  /** Track all operations for test assertions. */
  private _log: SPIOperationLog[] = [];

  // --- ISPIBus methods ---

  begin(): this {
    this.isEnabled = true;
    return this;
  }

  end(): void {
    // In simulation, ending the bus disables it without releasing mock devices.
    this.isEnabled = false;
  }

  setMode(mode: SPIMode): void {
    this._mode = mode;
  }

  setBitOrder(order: SPIBitOrder): void {
    this._bitOrder = order;
  }

  setFrequency(hz: number): void {
    this._frequency = hz;
  }

  beginTransaction(_settings: SPISettings): void {
    this._inTransaction = true;
  }

  endTransaction(): void {
    this._inTransaction = false;
  }

  transfer(data: number | Uint8Array): Uint8Array {
    const mosiData = typeof data === 'number' ? [data] : Array.from(data);
    const timestamp = Date.now();

    // Bus-level transfer (no CS pin) — log but no device interaction
    this._log.push({ operation: 'transfer', data: mosiData, timestamp });
    return new Uint8Array(mosiData.length);
  }

  write(data: number | Uint8Array): void {
    const mosiData = typeof data === 'number' ? [data] : Array.from(data);
    const timestamp = Date.now();
    this._log.push({ operation: 'write', data: mosiData, timestamp });
  }

  write16(value: number): void {
    const msb = (value >> 8) & 0xFF;
    const lsb = value & 0xFF;
    this.write(new Uint8Array([msb, lsb]));
  }

  device(chipSelect: BasePin): ISPIDevice {
    return new SimSPIDevice(this, chipSelect);
  }

  // --- Simulation helpers ---

  /**
   * Attach a mock SPI device for the given chip-select pin.
   */
  attachDevice(csPin: BasePin, device: ISimSPIDevice): void {
    this._devices.set(String(csPin.number), device);
  }

  /**
   * Remove a mock device.
   */
  detachDevice(csPin: BasePin): void {
    this._devices.delete(String(csPin.number));
  }

  /**
   * Get the operation log for test assertions.
   */
  getLog(): readonly SPIOperationLog[] {
    return this._log;
  }

  /**
   * Clear the operation log.
   */
  clearLog(): void {
    this._log = [];
  }

  onError(_handler: (status: SPIStatus, operation: 'transfer' | 'read' | 'write') => void): void {
    // No-op in simulator
  }

  /**
   * Reset all state.
   */
  reset(): void {
    this._devices.clear();
    this._log = [];
    this.isEnabled = false;
    this._inTransaction = false;
    this._frequency = 4000000;
    this._mode = 0;
    this._bitOrder = 'msb';
  }

  // --- Internal ---

  /** @internal */
  _getDevice(csKey: string): ISimSPIDevice | undefined {
    return this._devices.get(csKey);
  }

  /** @internal */
  _logOperation(op: SPIOperationLog): void {
    this._log.push(op);
  }
}

// ---------------------------------------------------------------------------
// SimSPIDevice — implements ISPIDevice (HAL SPIDevice is the source of truth)
// ---------------------------------------------------------------------------

class SimSPIDevice implements ISPIDevice {
  private readonly _simBus: SimSPIBus;
  private readonly _cs: number;

  constructor(bus: SimSPIBus, chipSelect: BasePin) {
    this._simBus = bus;
    this._cs = chipSelect.number;
  }

  transfer(data: number | Uint8Array): number {
    const csKey = String(this._cs);
    const mosiData = typeof data === 'number' ? [data] : Array.from(data);
    const timestamp = Date.now();
    const device = this._simBus._getDevice(csKey);

    if (!device) {
      this._simBus._logOperation({ operation: 'transfer', data: mosiData, timestamp });
      return 0;
    }

    const misoData = device.transfer(mosiData);
    this._simBus._logOperation({ operation: 'transfer', data: mosiData, response: misoData, timestamp });
    // HAL SPIDevice.transfer returns a single number (the MISO byte).
    return misoData[0] ?? 0;
  }

  write(data: number | Uint8Array): void {
    const csKey = String(this._cs);
    const dataArray = typeof data === 'number' ? [data] : Array.from(data);
    const timestamp = Date.now();
    const device = this._simBus._getDevice(csKey);

    if (!device) {
      this._simBus._logOperation({ operation: 'write', data: dataArray, timestamp });
      return;
    }

    if (device.write) {
      // Write without register — use register 0 as placeholder
      device.write(0, dataArray);
    } else {
      device.transfer(dataArray);
    }
    this._simBus._logOperation({ operation: 'write', data: dataArray, timestamp });
  }

  writeRegister(register: number, value: number): void {
    const csKey = String(this._cs);
    const timestamp = Date.now();
    const device = this._simBus._getDevice(csKey);

    if (!device) {
      this._simBus._logOperation({ operation: 'write', register, data: [value], timestamp });
      return;
    }

    if (device.write) {
      device.write(register, [value]);
    } else {
      device.transfer([register, value]);
    }
    this._simBus._logOperation({ operation: 'write', register, data: [value], timestamp });
  }

  readRegister(register: number, count: number): Uint8Array {
    const csKey = String(this._cs);
    const timestamp = Date.now();
    const device = this._simBus._getDevice(csKey);

    if (!device) {
      this._simBus._logOperation({ operation: 'read', register, count, timestamp });
      return new Uint8Array(0);
    }

    const data = device.readRegister
      ? device.readRegister(register, count)
      : device.transfer([register, ...new Array(count).fill(0)]).slice(1);
    this._simBus._logOperation({ operation: 'read', register, count, data, timestamp });
    return new Uint8Array(data);
  }
}

// ---------------------------------------------------------------------------
// Operation log
// ---------------------------------------------------------------------------

export interface SPIOperationLog {
  operation: 'write' | 'transfer' | 'read';
  register?: number;
  count?: number;
  data?: number[];
  response?: number[];
  timestamp: number;
}
