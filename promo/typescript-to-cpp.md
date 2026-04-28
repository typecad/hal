# Write TypeScript. Get C++.

[← Home](index.md)

TypeHAL is a transpiler — you write idiomatic TypeScript and it emits clean, human-readable C++ that compiles on AVR, ESP32, SAMD, and other embedded targets. No runtime. No heap. No STL.

---

## The promise: zero-cost abstractions

TypeScript constructs that have no meaningful C++ equivalent are erased or inlined at transpile time. You pay nothing for the abstractions you use to stay productive.

| TypeScript feature | C++ output |
|---|---|
| `const led = LED.asOutput()` | No variable emitted — alias erased |
| `Ref<T>` / `Owned<T>` / `MutRef<T>` | Fully erased phantom types |
| `async/await` | `await` stripped; body emits as normal function |
| Enums | `enum` or integer constants |
| Template literals | Stack `char[]` + `snprintf` |
| Destructuring | Flat variable declarations |
| Optional chaining `?.` | `typehal_exists` guard |
| Nullish coalescing `??` | `typehal_nullish` inline template helper |

---

## A complete sketch

```typescript
import { LED, delay } from '@typehal';

async function blink() {
  const led = LED.asOutput();

  while (true) {
    led.toggle();
    await delay(1000);
  }
}

blink();
```

Emits:

```cpp
void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, !digitalRead(13));
  delay(1000);
}
```

`LED.asOutput()` folds the `pinMode` call into `setup()` and erases the alias variable entirely. `async`/`await` strips cleanly — the function body is emitted as-is. No async runtime. No coroutine overhead.

---

## Classes with private fields

```typescript
class Button {
  private readonly debounceMs: number;
  private lastPress: number = 0;

  constructor(debounceMs: number) {
    this.debounceMs = debounceMs;
  }

  get isHeld(): boolean {
    return millis() - this.lastPress < this.debounceMs;
  }
}
```

Emits an idiomatic C++ `struct` with a `bool isHeld() const` accessor. Private fields become private members. Constructor becomes a matching C++ constructor.

---

## Enums

```typescript
enum Direction { Up = 0, Down = 1, Left = 2, Right = 3 }

const dir: Direction = Direction.Up;
```

Emits:

```cpp
enum Direction { Up = 0, Down = 1, Left = 2, Right = 3 };
Direction dir = Direction::Up;
```

---

## Template literals → snprintf

```typescript
import { UART0 } from '@typehal';
const serial = UART0.begin(9600);

const temp = 23;
const msg = `Temperature: ${temp}°C`;
serial.println(msg);
```

Emits a stack-allocated buffer with `snprintf` — no `String` class, no heap, no fragmentation:

```cpp
char msg[64];
snprintf(msg, sizeof(msg), "Temperature: %d\xC2\xB0""C", temp);
Serial.println(msg);
```

---

## Typed arrays

```typescript
const thresholds: Int16Array = [-50, 0, 100, 500];
```

Emits a C-style array — no `std::vector`, no dynamic allocation:

```cpp
int16_t thresholds[] = { -50, 0, 100, 500 };
```

Negative literals are compile-time-safe and stay as initializers. They don't get moved into `setup()`.

---

## Destructuring

```typescript
const config = { sda: 18, scl: 19, freq: 400000 };
const { sda, scl, freq } = config;
```

Emits:

```cpp
const int sda = 18;
const int scl = 19;
const int freq = 400000;
```

The object literal is emitted as a global; destructuring produces flat declarations.

---

## async/await

```typescript
async function readSensor(): number {
  const raw = await I2C0.device(0x76).readByte(0xFA);
  return raw / 100.0;
}
```

`await` is stripped at transpile time. The emitted function is a plain synchronous C++ function — exactly what you'd write by hand, with none of the TypeScript syntax ceremony:

```cpp
float readSensor() {
  int raw = I2C0_device_readByte(0x76, 0xFA);
  return raw / 100.0;
}
```

No coroutine headers. No RTOS. Just clean output.

---

## Dead code elimination

Tree-shaking is on by default. Only code reachable from your entry points (`setup`/`loop` or `main`) makes it into the output. The transpiler reports what was removed.

---

## Source maps

C++ compiler errors map back to your TypeScript source:

```bash
npx typehal map-error out/sketch/sketch.ino.thcppmap.json --line 42 --col 5
```

You see the `.ts` file, line, and column — not the generated C++.

---

[← Home](index.md) &nbsp;|&nbsp; [Hardware Safety →](hardware-safety.md)
