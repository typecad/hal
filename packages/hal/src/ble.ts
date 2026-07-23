import {
  bleServerBegin,
  bleAdvertiseStart,
  bleAdvertiseStop,
  bleAddService,
  bleAddChar,
  bleOnRead,
  bleOnWrite,
  bleOnConnect,
  bleOnDisconnect,
  bleNotify,
  bleIsConnected,
  bleClientCount,
  bleSetName,
  bleUntilConnected,
  bleUntilConnectedStart,
  bleSetTxPower,
  bleStatus,
} from './emit.js';
import { callback } from './callback.js';

/** Characteristic value encoding — drives both TS callback types and C++ marshalling. */
export enum BleValueType {
  Uint8 = 'uint8',
  Uint16 = 'uint16',
  Uint32 = 'uint32',
  Int8 = 'int8',
  Int16 = 'int16',
  Int32 = 'int32',
  Float32 = 'float32',
  Utf8 = 'utf8',
  Boolean = 'boolean',
  Bytes = 'bytes',
}

/** GATT characteristic permission flags. Combine with `|`. */
export enum BlePerm {
  Read = 1,
  Write = 2,
  Notify = 4,
}

/** BLE peripheral status (mirrored by the runtime shim). */
export enum BleStatus {
  Idle = 0,
  Initializing = 1,
  Advertising = 2,
  Connected = 3,
  Error = 4,
}

export enum BleAdvertisingMode {
  Connectable = 'connectable',
  NonConnectable = 'non_connectable',
}

/** A well-known GATT characteristic entry in the catalog. */
export interface GattCharacteristicDef {
  readonly uuid: string;
  readonly type: BleValueType;
  readonly read?: boolean;
  readonly write?: boolean;
  readonly notify?: boolean;
}

/**
 * Standard GATT services/characteristics. Autocomplete walks the hierarchy:
 *   GATT.ENVIRONMENTAL. -> TEMPERATURE, HUMIDITY, ...
 * Pass the .uuid, .type, and computed perms to BleServer.characteristic().
 */
export const GATT = {
  DEVICE_INFO: {
    MANUFACTURER_NAME: { uuid: '2A29', type: BleValueType.Utf8, read: true },
    MODEL_NUMBER: { uuid: '2A24', type: BleValueType.Utf8, read: true },
    FIRMWARE_REVISION: { uuid: '2A26', type: BleValueType.Utf8, read: true },
  },
  ENVIRONMENTAL: {
    TEMPERATURE: { uuid: '2A6E', type: BleValueType.Int16, read: true, notify: true },
    HUMIDITY: { uuid: '2A6F', type: BleValueType.Uint16, read: true, notify: true },
    PRESSURE: { uuid: '2A6D', type: BleValueType.Uint32, read: true, notify: true },
  },
  BATTERY: {
    LEVEL: { uuid: '2A19', type: BleValueType.Uint8, read: true, notify: true },
  },
} as const;

/** The value passed to/from callbacks — narrowed per characteristic by type. */
export type CharValue = number | string | boolean | Uint8Array;

/**
 * BLE GATT peripheral control, lowered to native ESP-IDF NimBLE
 * (`nimble_host` / `ble_gap` / `ble_gatts`) by framework-esp32.
 *
 * No `include()` calls here — NimBLE headers are framework-owned and added via
 * forcedIncludes when the program uses ble.* ops.
 *
 * Transpiler note: method bodies pass parameters directly into semantic calls
 * (no local consts / module counters) so the resolver can statically track every
 * argument. The characteristic index is carried through the chain via
 * `this._charCount` fieldValues, mirroring how HttpRequest carries _method/_url.
 */
export class BleClass {
  static readonly __instance_name = "Ble";

  /** Begin building a GATT server with the given advertised device name. */
  server(name: string): BleServer {
    bleSetName(name);
    return new BleServer(name, 0, 1);
  }

  /** Initialize NimBLE, register services, and start advertising. */
  begin(): void {
    bleServerBegin("TypeCAD");
    bleAdvertiseStart();
  }

  advertise(): void { bleAdvertiseStart(); }
  stopAdvertising(): void { bleAdvertiseStop(); }

  /** Blocking at top level; cooperatively awaitable inside async functions. */
  untilConnected(timeoutMs: number = 0): Promise<boolean> {
    bleUntilConnected(timeoutMs);
    return Promise.resolve(false);
  }

  untilConnectedStart(): void { bleUntilConnectedStart(); }
  isConnected(): boolean { return bleIsConnected(); }
  status(): BleStatus { return bleStatus() as BleStatus; }
  clientCount(): number { return bleClientCount(); }
  txPower(dbm: number): this { bleSetTxPower(dbm); return this; }
  notify(index: number, value: number): void { bleNotify(index, value); }
}

/**
 * Fluent GATT server builder. Returned by `Ble.server()`.
 *
 * Single-class fluent chain (like HttpRequest): characteristic() returns `this`,
 * so onRead/onWrite/onSubscribe chain directly. The _charCount field tracks
 * which characteristic slot the callbacks attach to.
 *
 * Field tracking (read by the transpiler resolver via ctor field assignment):
 *   _name      — advertised device name
 *   _charCount — current characteristic index (the last characteristic() target)
 *   _svcCount  — current service index
 */
export class BleServer {
  private _name: string;
  private _charCount: number;
  private _lastChar: number;
  private _svcCount: number;

  constructor(name: string, charCount: number, svcCount: number) {
    this._name = name;
    this._charCount = charCount;
    this._lastChar = charCount;
    this._svcCount = svcCount;
  }

  /** Add a characteristic by UUID, value type, and permissions.
   *  Combine permissions with `|`: `BlePerm.Read | BlePerm.Notify`.
   *  Returns this for chaining. */
  characteristic(uuid: string, type: BleValueType, perms: number): this {
    bleAddChar(this._charCount, uuid, type, perms, this._svcCount);
    return this;
  }

  /** Begin a new service grouping. Subsequent characteristics attach to it. */
  service(uuid: string): this {
    bleAddService(uuid);
    return this;
  }

  /** Register a read handler for the most recently added characteristic. */
  onRead(handler: () => CharValue): this {
    bleOnRead(this._lastChar, callback(handler));
    return this;
  }

  /** Register a write handler for the most recently added characteristic. */
  onWrite(handler: (value: number) => void): this {
    bleOnWrite(this._lastChar, callback(handler));
    return this;
  }

  /** Register a connect handler (called when a central connects). */
  onConnect(handler: () => void): this {
    bleOnConnect(callback(handler));
    return this;
  }

  /** Register a disconnect handler (called when a central disconnects). */
  onDisconnect(handler: () => void): this {
    bleOnDisconnect(callback(handler));
    return this;
  }

  /** Push a new value to subscribed clients on the most recently added characteristic. */
  notify(value: number): void {
    bleNotify(this._lastChar, value);
  }

  /** Initialize NimBLE, register services, and start advertising. */
  begin(): void {
    bleServerBegin(this._name);
    bleAdvertiseStart();
  }
}

export const Ble = new BleClass();
