// ---------------------------------------------------------------------------
// @typecad/hal/sim — I2C bus simulation
// ---------------------------------------------------------------------------

import { I2CStatus } from '../contracts.js';
import type {
  II2CBus,
  II2CDeviceAccessor,
  ErrorPolicy,
  I2CAddress,
} from '../contracts.js';
import type { ISimI2CDevice } from '../types.js';

// ---------------------------------------------------------------------------
// SimI2CBus
// ---------------------------------------------------------------------------

/**
 * Simulated I2C bus for testing I2C communication.
 *
 * Tests register mock devices via `attachDevice()`. When program code reads
 * or writes to an address, the corresponding mock device handles the operation.
 */
export class SimI2CBus implements II2CBus {
  readonly busNumber: number;
  isEnabled: boolean = false;
  errorPolicy: ErrorPolicy = 'callback';

  private _devices: Map<I2CAddress, ISimI2CDevice> = new Map();
  private _speed: number = 100000;
  private _slaveAddress: I2CAddress | null = null;
  private _errorHandler: ((status: I2CStatus, address: I2CAddress, operation: 'read' | 'write') => void) | null = null;

  /** Track all operations for test assertions. */
  private _log: I2COperationLog[] = [];

  constructor(busNumber: number = 0) {
    this.busNumber = busNumber;
  }

  // --- II2CBus methods ---

  begin(address?: I2CAddress): this {
    if (address !== undefined) {
      this._slaveAddress = address;
    }
    this.isEnabled = true;
    return this;
  }

  beginSlave(address: I2CAddress): void {
    this._slaveAddress = address;
    this.isEnabled = true;
  }

  end(): void {
    // In simulation, ending the bus disables it without releasing mock devices.
    this.isEnabled = false;
  }

  setClock(hz: number): void {
    this._speed = hz;
  }

  device(address: I2CAddress): II2CDeviceAccessor {
    return createDeviceAccessor(this, address);
  }

  onError(handler: (status: I2CStatus, address: I2CAddress, operation: 'read' | 'write') => void): void {
    this._errorHandler = handler;
  }

  recover(): void {
    // No-op in simulation — the bus is always in a clean state.
  }

  // --- Simulation helpers ---

  /**
   * Attach a mock I2C device at the given address.
   */
  attachDevice(address: I2CAddress, device: ISimI2CDevice): void {
    this._devices.set(address, device);
  }

  /**
   * Remove a mock device.
   */
  detachDevice(address: I2CAddress): void {
    this._devices.delete(address);
  }

  /**
   * Get the operation log for test assertions.
   */
  getLog(): readonly I2COperationLog[] {
    return this._log;
  }

  /**
   * Clear the operation log.
   */
  clearLog(): void {
    this._log = [];
  }

  /**
   * Reset all state.
   */
  reset(): void {
    this._devices.clear();
    this._log = [];
    this._errorHandler = null;
    this.isEnabled = false;
    this._speed = 100000;
    this._slaveAddress = null;
  }

  // --- Internal ---

  /** @internal */
  _getDevice(address: I2CAddress): ISimI2CDevice | undefined {
    return this._devices.get(address);
  }

  /** @internal */
  _logOperation(op: I2COperationLog): void {
    this._log.push(op);
  }

  /** @internal */
  _fireError(status: I2CStatus, address: I2CAddress, operation: 'read' | 'write'): void {
    if (this._errorHandler) {
      this._errorHandler(status, address, operation);
    }
  }
}

// ---------------------------------------------------------------------------
// Operation log
// ---------------------------------------------------------------------------

export interface I2COperationLog {
  operation: 'read' | 'write';
  address: I2CAddress;
  register: number;
  data?: number[];
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Device accessor factory
// ---------------------------------------------------------------------------

function createDeviceAccessor(bus: SimI2CBus, address: I2CAddress): II2CDeviceAccessor {
  return {
    address,

    readByte(register: number): number {
      const device = bus._getDevice(address);
      const timestamp = Date.now();

      if (!device) {
        bus._logOperation({ operation: 'read', address, register, timestamp });
        bus._fireError(I2CStatus.NACK_ON_ADDRESS, address, 'read');
        return 0;
      }

      const data = device.read(register, 1);
      bus._logOperation({ operation: 'read', address, register, data, timestamp });
      return data[0] ?? 0;
    },

    readBytes(register: number, count: number): Uint8Array {
      const device = bus._getDevice(address);
      const timestamp = Date.now();

      if (!device) {
        bus._logOperation({ operation: 'read', address, register, timestamp });
        bus._fireError(I2CStatus.NACK_ON_ADDRESS, address, 'read');
        return new Uint8Array(0);
      }

      const data = device.read(register, count);
      bus._logOperation({ operation: 'read', address, register, data, timestamp });
      return new Uint8Array(data);
    },

    writeByte(register: number, value: number): void {
      const device = bus._getDevice(address);
      const timestamp = Date.now();

      if (!device) {
        bus._logOperation({ operation: 'write', address, register, data: [value], timestamp });
        bus._fireError(I2CStatus.NACK_ON_ADDRESS, address, 'write');
        return;
      }

      device.write(register, [value]);
      bus._logOperation({ operation: 'write', address, register, data: [value], timestamp });
    },

    writeBytes(register: number, data: Uint8Array | number[]): void {
      const device = bus._getDevice(address);
      const dataArray = Array.isArray(data) ? data : Array.from(data);
      const timestamp = Date.now();

      if (!device) {
        bus._logOperation({ operation: 'write', address, register, data: dataArray, timestamp });
        bus._fireError(I2CStatus.NACK_ON_ADDRESS, address, 'write');
        return;
      }

      device.write(register, dataArray);
      bus._logOperation({ operation: 'write', address, register, data: dataArray, timestamp });
    },
  };
}
