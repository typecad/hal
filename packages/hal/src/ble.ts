import {
  bleServerBegin,
  bleAdvertiseStart,
  bleAdvertiseStop,
  bleAddService,
  bleAddChar,
  bleOnRead,
  bleOnWrite,
  bleOnSubscribe,
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
 * Type and permissions are pre-filled so the characteristic is fully defined.
 *
 * Custom UUIDs (16-bit or 128-bit) always work via the raw-string escape hatch
 * in BleServer.characteristic(uuid, opts).
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

/** Options for a raw-UUID characteristic (escape hatch). */
export interface BleCharOptions {
  type?: BleValueType;
  read?: boolean;
  write?: boolean;
  notify?: boolean;
}

/** The value passed to/from callbacks — narrowed per characteristic by type. */
export type CharValue = number | string | boolean | Uint8Array;

// ── Deferred-build state (transpile-time only; the facade runs once to emit ops) ──
let __ble_char_index = 0;
let __ble_svc_index = 0;
let __ble_device_name = 'TypeCAD';
let __ble_auto_advertise = true;
let __ble_dis_enabled = true;
let __ble_dis_opts: { manufacturer?: string; model?: string; firmware?: string } = {};

/**
 * BLE GATT peripheral control, lowered to native ESP-IDF NimBLE
 * (`nimble_host` / `ble_gap` / `ble_gatts`) by framework-esp32.
 *
 * No `include()` calls here — NimBLE headers are framework-owned and added via
 * forcedIncludes when the program uses ble.* ops (the WiFi lesson: HAL files
 * must not carry platform headers).
 */
export class BleClass {
  static readonly __instance_name = "Ble";

  /** Begin building a GATT server with the given advertised device name. */
  server(name: string): BleServer {
    __ble_device_name = name;
    bleSetName(name);
    return new BleServer();
  }

  /** Initialize NimBLE, register the deferred service graph, and (by default)
   *  start advertising. Auto-creates the Device Information service unless
   *  `.deviceInfo(false)` was called. */
  begin(): void {
    if (__ble_dis_enabled) {
      // Auto-create Device Information service (0x180A) at svc index 0.
      bleAddService('180A');
      this.__addDisChar('2A29', __ble_dis_opts.manufacturer ?? 'TypeCAD');
      this.__addDisChar('2A24', __ble_dis_opts.model ?? __ble_device_name);
      this.__addDisChar('2A26', __ble_dis_opts.firmware ?? '1.0.0');
      __ble_svc_index = 1; // user services start at index 1
    }
    bleServerBegin(__ble_device_name);
    if (__ble_auto_advertise) bleAdvertiseStart();
  }

  /** @internal Auto-add a Device Info static-read characteristic. */
  private __addDisChar(uuid: string, _value: string): void {
    const idx = __ble_char_index++;
    bleAddChar(idx, uuid, 'utf8', 1, 0); // DIS chars attach to svc index 0
  }

  /** Manually start advertising (when autoAdvertise(false)). */
  advertise(): void { bleAdvertiseStart(); }

  stopAdvertising(): void { bleAdvertiseStop(); }

  /** Blocking at top level; cooperatively awaitable inside async functions. */
  untilConnected(timeoutMs: number = 0): Promise<boolean> {
    bleUntilConnected(timeoutMs);
    return Promise.resolve(false);
  }

  untilConnectedStart(): void {
    bleUntilConnectedStart();
  }

  isConnected(): boolean { return bleIsConnected(); }

  status(): BleStatus { return bleStatus() as BleStatus; }

  clientCount(): number { return bleClientCount(); }

  /** Cap TX power in dBm. */
  txPower(dbm: number): this { bleSetTxPower(dbm); return this; }

  /** Toggle auto-advertise on begin(). Default true. */
  autoAdvertise(enabled: boolean): this { __ble_auto_advertise = enabled; return this; }

  /** Mark the server as non-connectable (beacon/advertiser-only). */
  connectable(_enabled: boolean): this { return this; }

  /** Disable the auto-created Device Information service. */
  deviceInfo(enabled: false): this;
  /** Override the auto-created Device Information service fields. */
  deviceInfo(opts: { manufacturer?: string; model?: string; firmware?: string }): this;
  deviceInfo(arg: boolean | { manufacturer?: string; model?: string; firmware?: string }): this {
    if (arg === false) {
      __ble_dis_enabled = false;
    } else {
      __ble_dis_opts = arg as { manufacturer?: string; model?: string; firmware?: string };
    }
    return this;
  }

  onConnect(handler: () => void): void {
    // Stored as a connect callback via the shim's on_connect slot.
    callback(handler);
  }

  onDisconnect(handler: () => void): void {
    callback(handler);
  }
}

/** Builder for a GATT server's service graph. Returned by `Ble.server()`. */
export class BleServer {
  /** Add a well-known characteristic (type/perms from the catalog entry). */
  characteristic(entry: GattCharacteristicDef): BleCharacteristic;
  /** Add a characteristic by raw UUID (16-bit or 128-bit). */
  characteristic(uuid: string, opts?: BleCharOptions): BleCharacteristic;
  characteristic(uuidOrEntry: string | GattCharacteristicDef, opts?: BleCharOptions): BleCharacteristic {
    const isEntry = typeof uuidOrEntry !== 'string';
    const uuid = isEntry ? uuidOrEntry.uuid : uuidOrEntry;
    const type = (isEntry ? uuidOrEntry.type : opts?.type) ?? BleValueType.Uint8;
    const read = (isEntry ? uuidOrEntry.read : opts?.read) ?? true;
    const write = (isEntry ? uuidOrEntry.write : opts?.write) ?? false;
    const notify = (isEntry ? uuidOrEntry.notify : opts?.notify) ?? false;
    let perms = 0;
    if (read) perms |= 1;
    if (write) perms |= 2;
    if (notify) perms |= 4;
    const idx = __ble_char_index++;
    const svc = __ble_svc_index;
    bleAddChar(idx, uuid, type, perms, svc);
    return new BleCharacteristic(idx);
  }

  /** Begin a new service grouping. Subsequent characteristics attach to it. */
  service(uuid: string): this {
    bleAddService(uuid);
    __ble_svc_index++;
    return this;
  }

  /** Flush: same as Ble.begin(). */
  begin(): void { Ble.begin(); }
}

/** A characteristic in the deferred service graph. Chain onRead/onWrite/onSubscribe. */
export class BleCharacteristic {
  constructor(private _index: number) {}

  /** Register a read handler. Return type follows the characteristic's type. */
  onRead(handler: () => CharValue): this {
    bleOnRead(this._index, callback(handler as () => void));
    return this;
  }

  /** Register a write handler. Param type follows the characteristic's type. */
  onWrite(handler: (value: CharValue) => void): this {
    bleOnWrite(this._index, callback(handler as (v: any) => void));
    return this;
  }

  /** Register a subscribe handler (called when a central enables/disables notify). */
  onSubscribe(handler: (enabled: boolean) => void): this {
    bleOnSubscribe(this._index, callback(handler as (e: boolean) => void));
    return this;
  }

  /** Push a new value to subscribed clients. */
  notify(value: CharValue): void {
    bleNotify(this._index, value as number);
  }
}

export const Ble = new BleClass();
