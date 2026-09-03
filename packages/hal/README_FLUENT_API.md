# Fluent API Guide

How to implement fluent, chainable APIs in the HAL that transpile to
efficient C++ — one C++ statement per link, no intermediate runtime
objects.

## 1. Simple chaining (the `this` pattern)

For methods that configure and return the same receiver, return `this`.
The resolver lowers each link as a call on the same instance — the chain
costs nothing at runtime.

```ts
// ble.ts (real) — every link emits its own op and returns this
export class BleChain {
  service(uuid: string): BleChain {
    bleAddService(uuid);
    return this;
  }

  char(uuid: string, type: BleValueType, perms: number): BleChain {
    bleAddChar(0, uuid, type, perms, 0);
    return this;
  }
}
```

User code reads declaratively:

```ts
BLE.service('6e400001-...')
  .char('6e400002-...', BleValueType.Uint8, BlePerm.Read | BlePerm.Write)
  .onWrite((v) => { /* … */ });
```

## 2. The `device()` factory (cross-class propagation)

When a chain must CROSS classes — a bus handing out a device handle — the
one shipped form is the `device()` factory: `I2CBus`/`SPIBus` propagate
their fields into the returned `I2CTarget`/`SPITarget` together with the
factory argument, so the fact-carrier arrives with the bus identity and the
address/chip-select already captured:

```ts
// i2c.ts (real) — the resolver special-cases this factory
export class I2CBus {
  private _bus: string;

  constructor(bus: string) {
    this._bus = bus;
  }

  device(address: number): I2CTarget {
    return new I2CTarget(this._bus, address);
  }
}
```

User code reads as one expression, and the sensor/device lowering receives
both facts as one op:

```ts
const sht3x = new Sensor(SENSOR.sensirion_sht3xd, I2C0.device(0x44));
```

There is deliberately no general "chain into an arbitrary intermediate
class" mechanism — the earlier `tone(440).for(500)`-style pattern was
removed with the legacy surface. If a new domain needs a cross-class chain,
extend the resolver the way `device()` does: one explicit, tested factory
path rather than name-matched magic.

`BLE`/`BleChain` (`ble.ts`) is the shipped reference implementation of the
`this` pattern; `packages/zephyr-esp32s3-rgb` is a library-level example
(`rgbLed.color('#…').brightness(32).show()` — buffered locally, one frame
push at `show()`).
