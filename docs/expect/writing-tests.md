# Writing Tests

How to write hardware tests using the TypeHAL expect framework.

## Test File Structure

Every test file follows this pattern:

```typescript
import { describe, done } from '@typehal/expect';
import { A0, D2 } from '@typehal';

// Test suites
describe("Suite name")
  .it("Test case 1")
    .expect(/* value */)./* matcher */
  .it("Test case 2")
    .expect(/* value */)./* matcher */
  .it("Test case 3")
    .expect(/* value */)./* matcher */;

// Must end with done()
done();
```

## describe / it

### describe(name: string): Suite

Opens a named test group. Returns a `Suite` that you chain `.it()` calls onto.

```typescript
describe("A0 analog read")
  .it("returns a value")
    .expect(A0.readAnalog()).toBeTruthy();
```

### suite.it(name: string): Suite

Opens a named test case within the current group. Returns the same `Suite` for further chaining.

```typescript
describe("GPIO pins")
  .it("D2 reads HIGH after write")
    .expect(D2.read()).toBe(HIGH)
  .it("D2 can toggle")
    .expect(D2.read()).toBe(LOW);
```

## expect

### expect(value: number): Expectation

Captures a hardware value to be asserted. The argument must be a TypeHAL hardware expression (e.g. `A0.readAnalog()`, `pin.read()`). The preprocessor hoists it to a local variable so it is evaluated exactly once.

```typescript
describe("Analog pins")
  .it("A0 reads valid value")
    .expect(A0.readAnalog()).toBeWithinRange(0, 1023);
```

### expectString(value: string): StringExpectation

Same as `expect`, for string-producing expressions.

```typescript
describe("Serial output")
  .it("contains expected text")
    .expectString(getMessage()).toContain("Hello");
```

## done

`done(): void`

Must be the **last statement** in every test file. Emits the `[TC:SUITE_END]` sentinel over serial and puts the firmware into an idle loop so the host runner knows collection is complete.

```typescript
describe("Final test")
  .it("always passes")
    .expect(1).toBe(1);

done(); // Required!
```

## Numeric Matchers

All numeric matchers return the parent `Suite`, so you can continue the chain with `.it()`.

| Matcher | Passes when |
|---------|-------------|
| `.toBe(n)` | `actual === n` |
| `.toBeGreaterThan(n)` | `actual > n` |
| `.toBeGreaterThanOrEqual(n)` | `actual >= n` |
| `.toBeLessThan(n)` | `actual < n` |
| `.toBeLessThanOrEqual(n)` | `actual <= n` |
| `.toBeCloseTo(n, precision)` | `\|actual − n\| < 10^(−precision)` |
| `.toBeWithinRange(min, max)` | `actual >= min && actual <= max` |
| `.toBeTruthy()` | `actual !== 0` |
| `.toBeFalsy()` | `actual === 0` |
| `.toNotBe(n)` | `actual !== n` |

### Examples

```typescript
describe("Numeric matchers")
  .it("toBe matches exact value")
    .expect(42).toBe(42)
  .it("toBeGreaterThan checks lower bound")
    .expect(10).toBeGreaterThan(5)
  .it("toBeLessThan checks upper bound")
    .expect(5).toBeLessThan(10)
  .it("toBeWithinRange checks inclusive range")
    .expect(A0.readAnalog()).toBeWithinRange(0, 1023)
  .it("toBeTruthy checks non-zero")
    .expect(A0.readAnalog()).toBeTruthy()
  .it("toBeFalsy checks zero")
    .expect(0).toBeFalsy()
  .it("toBeCloseTo checks floating point precision")
    .expect(3.14159).toBeCloseTo(3.14, 2);

done();
```

## String Matchers

| Matcher | Passes when |
|---------|-------------|
| `.toBe(s)` | `actual === s` |
| `.toContain(sub)` | `actual` contains `sub` |
| `.toHaveLength(n)` | `actual.length === n` |
| `.toNotBe(s)` | `actual !== s` |

### Examples

```typescript
describe("String matchers")
  .it("toBe matches exact string")
    .expectString("Hello").toBe("Hello")
  .it("toContain checks substring")
    .expectString("Hello World").toContain("World")
  .it("toHaveLength checks string length")
    .expectString("Hello").toHaveLength(5);

done();
```

## Multiple Suites

You can have multiple `describe` blocks in a single file:

```typescript
import { describe, done } from '@typehal/expect';
import { A0, A1, D2, D3 } from '@typehal';

describe("Analog inputs")
  .it("A0 reads valid range")
    .expect(A0.readAnalog()).toBeWithinRange(0, 1023)
  .it("A1 reads valid range")
    .expect(A1.readAnalog()).toBeWithinRange(0, 1023);

describe("Digital pins")
  .it("D2 can be read")
    .expect(D2.read()).toBeGreaterThanOrEqual(0)
  .it("D3 can be read")
    .expect(D3.read()).toBeGreaterThanOrEqual(0);

done();
```

## Hardware Expressions

The `.expect()` argument must be a hardware expression that produces a value:

```typescript
// Valid hardware expressions
.expect(A0.readAnalog())     // Analog read
.expect(D2.read())           // Digital read
.expect(pin.readValue())     // Custom pin method
.expect(sensor.getValue())   // Sensor method

// Invalid - will not work
.expect(localVariable)       // Plain variable
.expect(calculateValue())    // Non-hardware function
```

## Test Organization

### Per-Pin Tests

```typescript
describe("Pin A0")
  .it("reads valid ADC value")
    .expect(A0.readAnalog()).toBeWithinRange(0, 1023)
  .it("changes with input voltage")
    .expect(A0.readAnalog()).toBeGreaterThan(0);

describe("Pin A1")
  .it("reads valid ADC value")
    .expect(A1.readAnalog()).toBeWithinRange(0, 1023);

done();
```

### Per-Feature Tests

```typescript
describe("PWM output")
  .it("D9 can output PWM")
    .expect(D9.read()).toBeGreaterThanOrEqual(0)
  .it("D10 can output PWM")
    .expect(D10.read()).toBeGreaterThanOrEqual(0);

describe("Interrupt pins")
  .it("D2 supports interrupts")
    .expect(D2.read()).toBeGreaterThanOrEqual(0)
  .it("D3 supports interrupts")
    .expect(D3.read()).toBeGreaterThanOrEqual(0);

done();
```

## Best Practices

### 1. Test One Thing Per it()

```typescript
// Good: One assertion per test
.it("reads a valid range")
  .expect(A0.readAnalog()).toBeWithinRange(0, 1023)

// Avoid: Multiple assertions in one it()
// This is not supported - chain new .it() instead
```

### 2. Use Descriptive Names

```typescript
// Good
.it("reads less than mid-scale when grounded")
  .expect(A0.readAnalog()).toBeLessThan(512)

// Less clear
.it("works")
  .expect(A0.readAnalog()).toBeLessThan(512)
```

### 3. Order Tests Logically

```typescript
describe("I2C sensor")
  .it("can be initialized")
    .expect(sensor.begin()).toBe(1)
  .it("returns valid temperature")
    .expect(sensor.readTemp()).toBeWithinRange(-40, 125)
  .it("returns valid humidity")
    .expect(sensor.readHumidity()).toBeWithinRange(0, 100);

done();
```

### 4. Always Call done()

Without `done()`, the host runner will timeout waiting for the `[TC:SUITE_END]` sentinel.

```typescript
describe("My tests")
  .it("passes")
    .expect(1).toBe(1);

done(); // Never forget!