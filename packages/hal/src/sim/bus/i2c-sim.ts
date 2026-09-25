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
import { SimI2CResponder } from './i2c-responder-sim.js';

// ---------------------------------------------------------------------------
// SimI2CBus
// ---------------------------------------------------------------------------

/**
 * Simulated I2C bus for testing I2C communication.
 *
 * Tests register mock devices via `attachDevice()` (the controller side —
 * program code talks TO the mock) or responders via `responder()` (the
 * target side — the program's own I2CResponder logic runs, and the bench
 * or a loopback `device()` call plays the controller). When program code
 * reads or writes to an address, the corresponding mock device handles the
 * operation.
 */
export class SimI2CBus implements II2CBus {
  readonly busNumber: number;
  isEnabled: boolean = false;
  errorPolicy: ErrorPolicy = 'callback';

  private _devices: Map<I2CAddress, ISimI2CDevice> = new Map();
  private _responders: Map<I2CAddress, SimI2CResponder> = new Map();
  private _speed: number = 100000;
  private _errorHandler: ((status: I2CStatus, address: I2CAddress, operation: 'read' | 'write') => void) | null = null;

  /** Track all operations for test assertions. */
  private _log: I2COperationLog[] = [];

  constructor(busNumber: number = 0) {
    this.busNumber = busNumber;
  }

  // --- II2CBus methods ---

  begin(): this {
    this.isEnabled = true;
    return this;
  }

  end(): void {
    // In simulation, ending the bus disables it without releasing mock devices.
    this.isEnabled = false;
  }

  setClock(hz: number): void {
    this._speed = hz;
  }

  device(address: I2CAddress): II2CDeviceAccessor {
    // A registered responder IS the device at its address — controller-side
    // accessors loop back through it (the CAN loopback discipline: the whole
    // bus, both roles, in one Node process).
    const responder = this._responders.get(address);
    if (responder !== undefined) {
      return createResponderAccessor(responder);
    }
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
    if (this._responders.has(address)) {
      throw new Error(
        `SimI2CBus: address 0x${address.toString(16)} is held by a responder — two devices cannot share an I2C address.`,
      );
    }
    this._devices.set(address, device);
  }

  /**
   * Remove a mock device.
   */
  detachDevice(address: I2CAddress): void {
    this._devices.delete(address);
  }

  /**
   * The board ANSWERING at `address` — the simulator's I2CResponder,
   * registered for loopback (`device(address)` routes to it) and operation
   * logging. The test bench drives it as the controller via
   * `masterWrite()` / `masterRead()`.
   */
  responder(address: I2CAddress, opts?: { rxBufferBytes?: number; txBufferBytes?: number }): SimI2CResponder {
    if (this._devices.has(address)) {
      throw new Error(
        `SimI2CBus: address 0x${address.toString(16)} is held by a mock device — two devices cannot share an I2C address.`,
      );
    }
    let responder = this._responders.get(address);
    if (responder === undefined) {
      responder = new SimI2CResponder(address, opts);
      responder._attach(this);
      this._responders.set(address, responder);
    }
    return responder;
  }

  /**
   * Remove a responder.
   */
  detachResponder(address: I2CAddress): void {
    this._responders.delete(address);
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
    this._responders.clear();
    this._log = [];
    this._errorHandler = null;
    this.isEnabled = false;
    this._speed = 100000;
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
// Responder loopback accessor — a controller-side accessor routed through a
// registered responder, so master-mode driver code exercises the responder's
// callbacks without any second process. Register semantics are the byte
// stream the responder actually sees: writeBytes(reg, data) delivers
// [reg, ...data] as one controller write; readBytes(reg, n) is one combined
// register-select transaction.
// ---------------------------------------------------------------------------

function createResponderAccessor(responder: SimI2CResponder): II2CDeviceAccessor {
  return {
    address: responder.address,

    readByte(register: number): number {
      return responder._transactionRead(register, 1)[0] ?? 0;
    },

    readBytes(register: number, count: number): Uint8Array {
      return new Uint8Array(responder._transactionRead(register, count));
    },

    writeByte(register: number, value: number): void {
      responder._transactionWrite(register, [value]);
    },

    writeBytes(register: number, data: Uint8Array | number[]): void {
      responder._transactionWrite(register, Array.from(data));
    },
  };
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
