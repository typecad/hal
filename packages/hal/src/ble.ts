// ---------------------------------------------------------------------------
// BLE — the thin Zephyr-shaped GATT peripheral
//
// The advertised identity is a CONSTRUCTION fact: `new BLE('TempSensor')`.
// The GATT database is declared through service()/char() chains (each char's
// uuid/type/perms ride its add op — the sensor discipline), handlers attach
// with onRead/onWrite, and the verbs map 1:1 onto Zephyr's bt_* GATT surface:
//
//   start()   → register the deferred service table + bt_enable + advertise
//   stop()    → bt_le_adv_stop
//   linked()  → a central is connected
//   onConnect()/onDrop() → bt_conn callbacks
//   notify(i, v) → bt_gatt_notify on the declared characteristic i
//
// Ordering contract (same as the runtime shim's current_char keying):
// onRead/onWrite/notify bind to the char() they immediately follow in the
// chain. Declare handlers right where the characteristic is declared.
// ----------------------------------------------------------------------------

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

/** A well-known GATT characteristic entry in the catalog. */
export interface GattCharacteristicDef {
  readonly uuid: string;
  readonly type: BleValueType;
  readonly read?: boolean;
  readonly write?: boolean;
  readonly notify?: boolean;
}

/**
 * Standard GATT services/characteristics — uuid/type/perms reference data.
 * Pass the pieces explicitly to char():
 *   GATT.ENVIRONMENTAL.TEMPERATURE →
 *     char('2A6E', BleValueType.Int16, BlePerm.Read | BlePerm.Notify)
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
 * The GATT declaration chain returned by BLE.service()/BLE.char(). Each char()
 * appends a characteristic; onRead/onWrite/notify bind to the most recent one.
 */
export class BleChain {
  /** Begin a new service grouping; subsequent char() calls attach to it. */
  service(uuid: string): BleChain {
    bleAddService(uuid);
    return this;
  }

  /** Append a characteristic by uuid, value type, and permissions
   *  (`BlePerm.Read | BlePerm.Notify`). Returns this for chaining. */
  char(uuid: string, type: BleValueType, perms: number): BleChain {
    bleAddChar(0, uuid, type, perms, 0);
    return this;
  }

  /** Read handler for the most recently declared characteristic. */
  onRead(handler: () => CharValue): BleChain {
    bleOnRead(0, callback(handler));
    return this;
  }

  /** Write handler for the most recently declared characteristic. */
  onWrite(handler: (value: number) => void): BleChain {
    bleOnWrite(0, callback(handler));
    return this;
  }

}

/** A GATT peripheral (server): advertise a name, declare services and
 *  characteristics, and push updates to connected clients. Constructed
 *  with the advertised device name. */
export class BLE {
  private readonly _name: string;

  constructor(name: string) {
    this._name = name;
  }

  /** Begin a new service grouping; subsequent char() declarations attach
   *  to it. */
  service(uuid: string): BleChain {
    bleAddService(uuid);
    return new BleChain();
  }

  /** Append a characteristic under the default (Environmental Sensing)
   *  service — the common single-service case. */
  char(uuid: string, type: BleValueType, perms: number): BleChain {
    bleAddChar(0, uuid, type, perms, 0);
    return new BleChain();
  }

  /** Register the declared services, start the stack, and advertise the
   *  construction name. */
  start(): void {
    bleServerBegin(this._name);
    bleAdvertiseStart();
  }

  /** Stop advertising (connected clients and declared services stay). */
  stop(): void {
    bleAdvertiseStop();
  }

  /** True while a client is connected. */
  linked(): boolean {
    return bleIsConnected();
  }

  /** Number of connected clients (0 or 1 — one connection at a time). */
  clients(): number {
    return bleClientCount();
  }

  /** Fires when a client connects. */
  onConnect(handler: () => void): void {
    bleOnConnect(callback(handler));
  }

  /** Fires when the client disconnects. */
  onDrop(handler: () => void): void {
    bleOnDisconnect(callback(handler));
  }

  /** Push a value to clients subscribed to a characteristic. `index` is
   *  the characteristic's declaration order (0-based — the first char()
   *  is 0). */
  notify(index: number, value: number): void {
    bleNotify(index, value);
  }
}
