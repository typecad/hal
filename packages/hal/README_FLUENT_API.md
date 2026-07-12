# Cuttlefish Fluent API Guide

This document explains how to implement fluent, chainable APIs in Cuttlefish that transpile to efficient C++.

## 1. Simple Chaining (The `this` Pattern)

For methods that simply configure a peripheral and return the original instance for further calls, simply return `this`.

### TypeScript (HAL)
```typescript
class SerialPort {
  begin(baud: number): this {
    emit(`Serial.begin(${baud});`);
    return this;
  }
}
```

### Usage
```typescript
Board.UART0.begin(115200).println("Hello");
```

---

## 2. Stateful Chaining (The Intermediate Pattern)

For complex operations that require multiple steps to form a single C++ command (e.g., `pin.tone(440).for(500)`), use an intermediate "Chain" class.

### How it Works
The Cuttlefish transpiler automatically propagates fields from a receiver to a returned instance if they share field names (e.g., `_pin`). This allows state to carry through the chain without complex transpiler logic.

### Implementation Steps

1. **Define an Intermediate Class**: Store the necessary state.
2. **Implement the Finalizer**: The last method in the chain emits the optimized C++ command.
3. **Update the Primary Class**: The initial method emits a default/overridable command and returns the chain instance.

### Example: Tone Chaining

#### 1. The Primary Class (`OutputPin`)
```typescript
class OutputPin {
  private _pin: number;
  private _lastFreq: number; // Carry state for the chain

  tone(frequency: number): ToneChain {
    this._lastFreq = frequency;
    emit(`tone(${this._pin}, ${frequency});`); // Default call
    return new ToneChain(this._pin, this._lastFreq);
  }
}
```

#### 2. The Intermediate Class (`ToneChain`)
```typescript
export class ToneChain {
  private _pin: number;
  private _lastFreq: number;

  constructor(pin: number, frequency: number) {
    this._pin = pin;
    this._lastFreq = frequency;
  }

  /** Emits the 3-argument 'overloaded' version of the command */
  for(duration: number): void {
    emit(`tone(${this._pin}, ${this._lastFreq}, ${duration});`);
  }
}
```

## Transpilation Logic
When the transpiler sees `led.tone(440).for(500)`:
1. It resolves `led.tone(440)` and identifies it returns `ToneChain`.
2. It propagates `_pin` and `_lastFreq` to the internal `ToneChain` instance.
3. It inlines the `.for()` call, which now has access to the previously captured frequency.

This pattern allows for high-level, expressive TypeScript APIs that collapse into direct, low-overhead C++ calls.
