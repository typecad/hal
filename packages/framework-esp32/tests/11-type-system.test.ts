import { describe, done } from '@typecad/expect';


describe("Buffer operations")
  .it("sequential byte writing")
  .expect(
    (() => {
      const buf = new Uint8Array(4);
      buf[0] = 0xFF;
      buf[1] = 0x0A;
      buf[2] = 0x1F;
      buf[3] = 0x00;
      return buf[1];
    })
  ).toBe(0x0A)
  .it("computed index access")
  .expect(
    (() => {
      const buf = new Uint8Array(8);
      const offset = 2;
      buf[offset + 1] = 0x42;
      return buf[3];
    })
  ).toBe(0x42)
  .it("buffer read and sum")
  .expect(
    (() => {
      const buf = new Uint8Array([0x10, 0x20, 0x30, 0x40]);
      let sum = 0;
      for (let i = 0; i < 4; i++) {
        sum += buf[i];
      }
      return sum;
    })
  ).toBe(0xA0)
  .it("multi-byte value packing into buffer")
  .expect(
    (() => {
      const buf = new Uint8Array(4);
      const value = 0x1234;
      buf[0] = (value >> 8) & 0xFF;
      buf[1] = value & 0xFF;
      return buf[0];
    })
  ).toBe(0x12)
  .it("buffer length in loop")
  .expect(
    (() => {
      const buf = new Uint8Array([5, 10, 15, 20, 25]);
      let count = 0;
      for (let i = 0; i < buf.length; i++) {
        count++;
      }
      return count;
    })
  ).toBe(5)
  .it("buffer element swap")
  .expect(
    (() => {
      const buf = new Uint8Array([1, 2, 3, 4]);
      const temp = buf[0];
      buf[0] = buf[3];
      buf[3] = temp;
      return buf[0] + buf[3];
    })
  ).toBe(5)



describe("Volatile variables")
  .it("volatile integer for ISR-shared state")
  .expect(
    (() => {
      let counter = volatile(0);
      counter++;
      counter++;
      counter++;
      return counter;
    })
  ).toBe(3)
  .it("volatile in loop condition")
  .expect(
    (() => {
      let done_flag = volatile(0);
      let iterations = 0;
      for (let i = 0; i < 10; i++) {
        iterations++;
        if (i === 4) {
          done_flag = 1;
        }
        if (done_flag) {
          break;
        }
      }
      return iterations;
    })
  ).toBe(5)
  .it("volatile typed array")
  .expect(
    (() => {
      const buf = volatile(new Uint8Array([10, 20, 30]));
      return buf[1];
    })
  ).toBe(20)
  .it("volatile buffer write and read")
  .expect(
    (() => {
      const reg = volatile(new Uint8Array([0, 0, 0]));
      reg[0] = 200;
      reg[1] = 55;
      return reg[0] + reg[1];
    })
  ).toBe(255)



type Point = { x: number; y: number };

describe("Type alias structs")
  .it("object type alias field access")
  .expect(
    (() => {
      const p: Point = { x: 3, y: 7 };
      return p.x + p.y;
    })
  ).toBe(10)
  .it("type alias struct modification")
  .expect(
    (() => {
      const p: Point = { x: 1, y: 2 };
      const q: Point = { x: p.x + 2, y: p.y + 3 };
      return q.x + q.y;
    })
  ).toBe(8)
  .it("multiple type alias structs")
  .expect(
    (() => {
      const p1: Point = { x: 1, y: 2 };
      const p2: Point = { x: 3, y: 4 };
      return p1.x + p1.y + p2.x + p2.y;
    })
  ).toBe(10)
  .it("type alias field arithmetic")
  .expect(
    (() => {
      const p: Point = { x: 5, y: 12 };
      return p.x * p.x + p.y * p.y;
    })
  ).toBe(169)



describe("Abstract classes")
  .it("abstract class with concrete subclass")
  .expect(
    (() => {
      abstract class AbsReader {
        abstract read(): number;
      }
      class ConReader extends AbsReader {
        read(): number {
          return 25;
        }
      }
      const s = new ConReader();
      return s.read();
    })
  ).toBe(25)
  .it("abstract class with field and subclass")
  .expect(
    (() => {
      abstract class AbsPeripheral {
        addr: number;
        constructor(a: number) {
          this.addr = a;
        }
        abstract getKind(): number;
      }
      class I2CDev extends AbsPeripheral {
        constructor(a: number) {
          super(a);
        }
        getKind(): number {
          return 1;
        }
      }
      const dev = new I2CDev(0x68);
      return dev.addr + dev.getKind();
    })
  ).toBe(0x69)
  .it("abstract class with multiple concrete subclasses")
  .expect(
    (() => {
      abstract class AbsPin {
        abstract getNum(): number;
      }
      class DigiPin extends AbsPin {
        n: number;
        constructor(n: number) {
          super();
          this.n = n;
        }
        getNum(): number {
          return this.n;
        }
      }
      class AnaPin extends AbsPin {
        n: number;
        constructor(n: number) {
          super();
          this.n = n + 100;
        }
        getNum(): number {
          return this.n;
        }
      }
      const d = new DigiPin(5);
      const a = new AnaPin(0);
      return d.getNum() + a.getNum();
    })
  ).toBe(105)



interface SensorLike {
  read(): number;
}

describe("Interfaces")
  .it("class implementing interface")
  .expect(
    (() => {
      class AnalogSensor implements SensorLike {
        pin: number;
        constructor(p: number) {
          this.pin = p;
        }
        read(): number {
          return this.pin * 10;
        }
      }
      const s = new AnalogSensor(3);
      return s.read();
    })
  ).toBe(30)
  .it("class with configure method")
  .expect(
    (() => {
      class SmartSensor implements SensorLike {
        setting: number;
        constructor() {
          this.setting = 1;
        }
        read(): number {
          return this.setting * 100;
        }
        configure(s: number): void {
          this.setting = s;
        }
      }
      const s = new SmartSensor();
      s.configure(5);
      return s.read();
    })
  ).toBe(500)
  .it("sensor reading via method")
  .expect(
    (() => {
      class Thermistor implements SensorLike {
        offset: number;
        constructor() {
          this.offset = 0;
        }
        read(): number {
          return 22 + this.offset;
        }
        setOffset(o: number): void {
          this.offset = o;
        }
      }
      const t = new Thermistor();
      t.setOffset(5);
      return t.read();
    })
  ).toBe(27)
  .it("named sensor with configure and read")
  .expect(
    (() => {
      class NamedSensor implements SensorLike {
        factor: number;
        constructor() {
          this.factor = 1;
        }
        read(): number {
          return 42 * this.factor;
        }
        setFactor(f: number): void {
          this.factor = f;
        }
      }
      const s = new NamedSensor();
      s.setFactor(2);
      return s.read();
    })
  ).toBe(84)



namespace SensorLib {
  export const BASE = 42;
  export const OFFSET = 8;
}

namespace MathUtils {
  export function twice(x: number): number {
    return x * 2;
  }
}

describe("Namespaced organization")
  .it("namespace constant access")
  .expect(
    (() => {
      return SensorLib.BASE + SensorLib.OFFSET;
    })
  ).toBe(50)
  .it("namespace function call")
  .expect(
    (() => {
      return MathUtils.twice(5);
    })
  ).toBe(10)
  .it("static class method as library")
  .expect(
    (() => {
      class AddrLib {
        static read(): number {
          return 0x68;
        }
      }
      return AddrLib.read();
    })
  ).toBe(0x68)
  .it("class instantiation in IIFE")
  .expect(
    (() => {
      class I2CBusDev {
        address: number;
        constructor(addr: number) {
          this.address = addr;
        }
        getAddress(): number {
          return this.address;
        }
      }
      const bus = new I2CBusDev(0x55);
      return bus.getAddress();
    })
  ).toBe(0x55)



describe("Data lookup patterns")
  .it("array-based uniqueness check")
  .expect(
    (() => {
      const seen = new Uint8Array([42, 99, 0, 0]);
      let found = 0;
      for (let i = 0; i < 4; i++) {
        if (seen[i] === 42) {
          found = 1;
          break;
        }
      }
      return found;
    })
  ).toBe(1)
  .expect(
    (() => {
      const seen = new Uint8Array([42, 99, 0, 0]);
      let found = 0;
      for (let i = 0; i < 4; i++) {
        if (seen[i] === 100) {
          found = 1;
          break;
        }
      }
      return found;
    })
  ).toBe(0)
  .it("parallel arrays for key-value lookup")
  .expect(
    (() => {
      const keys = [10, 20, 30];
      const vals = [100, 200, 300];
      let result = 0;
      for (let i = 0; i < 3; i++) {
        if (keys[i] === 20) {
          result = vals[i];
          break;
        }
      }
      return result;
    })
  ).toBe(200)
  .it("array overwrite value")
  .expect(
    (() => {
      const keys = [10, 20, 30];
      const vals = [100, 200, 300];
      vals[1] = 250;
      let result = 0;
      for (let i = 0; i < 3; i++) {
        if (keys[i] === 20) {
          result = vals[i];
          break;
        }
      }
      return result;
    })
  ).toBe(250)
  .it("counting occurrences")
  .expect(
    (() => {
      const data = [5, 3, 5, 7, 5, 2];
      let count = 0;
      for (let i = 0; i < data.length; i++) {
        if (data[i] === 5) {
          count++;
        }
      }
      return count;
    })
  ).toBe(3)



describe("Error handling patterns")
  .it("error code return pattern")
  .expect(
    (() => {
      function readSensor(pin: number): number {
        if (pin < 0) {
          return -1;
        }
        return pin * 10;
      }
      const result = readSensor(3);
      return result;
    })
  ).toBe(30)
  .it("error code check on negative result")
  .expect(
    (() => {
      function readSensor(pin: number): number {
        if (pin < 0) {
          return -1;
        }
        return pin * 10;
      }
      const result = readSensor(-1);
      return result === -1 ? 0 : 1;
    })
  ).toBe(0)
  .it("success/fail status pattern")
  .expect(
    (() => {
      let cleanup = 0;
      let result = 0;
      const success = true;
      if (success) {
        result = 42;
      } else {
        result = 0;
      }
      cleanup = 1;
      return result + cleanup;
    })
  ).toBe(43)
  .it("validation with default fallback")
  .expect(
    (() => {
      function safeDivide(a: number, b: number): number {
        if (b === 0) {
          return 0;
        }
        return a / b;
      }
      return safeDivide(10, 2) + safeDivide(10, 0);
    })
  ).toBe(5)
  .it("status code chain")
  .expect(
    (() => {
      function init(): number { return 1; }
      function configure(): number { return 1; }
      function start(): number { return 1; }
      let status = 0;
      if (init() === 1) {
        if (configure() === 1) {
          if (start() === 1) {
            status = 3;
          }
        }
      }
      return status;
    })
  ).toBe(3)



describe("Generic-style patterns")
  .it("container class with get")
  .expect(
    (() => {
      class Box {
        value: number;
        constructor(v: number) {
          this.value = v;
        }
        get(): number {
          return this.value;
        }
      }
      const c = new Box(99);
      return c.get();
    })
  ).toBe(99)
  .it("container class with set and get")
  .expect(
    (() => {
      class Holder {
        val: number;
        constructor(v: number) {
          this.val = v;
        }
        get(): number {
          return this.val;
        }
        set(v: number): void {
          this.val = v;
        }
      }
      const h = new Holder(10);
      h.set(20);
      return h.get();
    })
  ).toBe(20)
  .it("generic identity function")
  .expect(
    (() => {
      function identity<T>(value: T): T {
        return value;
      }
      const result = identity(77);
      return result;
    })
  ).toBe(77)
  .it("generic clamp function")
  .expect(
    (() => {
      function clamp<T>(val: T, lo: T, hi: T): T {
        if (val < lo) return lo;
        if (val > hi) return hi;
        return val;
      }
      return clamp(200, 0, 100);
    })
  ).toBe(100)



describe("Type checking patterns")
  .it("enum-based type discrimination")
  .expect(
    (() => {
      const DEVICE_SENSOR = 0;
      const DEVICE_ACTUATOR = 1;
      const kind = DEVICE_SENSOR;
      return kind === DEVICE_SENSOR ? 1 : 0;
    })
  ).toBe(1)
  .it("type field discrimination")
  .expect(
    (() => {
      const DEVICE_SENSOR = 0;
      const DEVICE_ACTUATOR = 1;
      const device = { kind: DEVICE_ACTUATOR, value: 42 };
      return device.kind === DEVICE_SENSOR ? device.value : 0;
    })
  ).toBe(0)
  .it("class hierarchy with type field")
  .expect(
    (() => {
      class Dev {
        kind: number;
        constructor(k: number) {
          this.kind = k;
        }
        isSensor(): number {
          return this.kind === 0 ? 1 : 0;
        }
      }
      const d = new Dev(0);
      return d.isSensor();
    })
  ).toBe(1)



describe("Nested functions")
  .it("nested function declaration and call")
  .expect(
    (() => {
      function compute(x: number): number {
        function square(n: number): number {
          return n * n;
        }
        return square(x) + square(x + 1);
      }
      return compute(3);
    })
  ).toBe(25)
  .it("nested helper with multiple calls")
  .expect(
    (() => {
      function addThree(a: number, b: number, c: number): number {
        function add(x: number, y: number): number {
          return x + y;
        }
        return add(add(a, b), c);
      }
      return addThree(10, 20, 30);
    })
  ).toBe(60)
  .it("multiple nested functions")
  .expect(
    (() => {
      function process(value: number): number {
        function double(n: number): number {
          return n * 2;
        }
        function halve(n: number): number {
          return n / 2;
        }
        return double(halve(value));
      }
      return process(10);
    })
  ).toBe(10)



describe("Callback patterns")
  .it("function passed to helper")
  .expect(
    (() => {
      function multiply(a: number, b: number): number {
        return a * b;
      }
      return multiply(7, 3);
    })
  ).toBe(21)
  .it("function returning function result")
  .expect(
    (() => {
      function addTen(val: number): number {
        return val + 10;
      }
      return addTen(5);
    })
  ).toBe(15)
  .it("callback via arrow in map")
  .expect(
    (() => {
      const values = [1, 2, 3, 4];
      const doubled = values.map((v: number) => v * 2);
      return doubled[2];
    })
  ).toBe(6)
  .it("chained function calls")
  .expect(
    (() => {
      function square(n: number): number {
        return n * n;
      }
      function negate(n: number): number {
        return -n;
      }
      return negate(square(6));
    })
  ).toBe(-36)



// ---------------------------------------------------------------------------
// On-hardware tests for the five newly implemented embedded-relevant features:
// 1. Get/set accessors
// 2. forEach inline expansion
// 3. typeof operator (compile-time resolved)
// 4. Union types (std::variant for generic, nullable for Arduino)
// 5. export default (module-level, tested indirectly via import)
// ---------------------------------------------------------------------------

// -- Accessors --------------------------------------------------------------

describe("Getter accessors")
  .it("getter returns field value")
  .expect(
    (() => {
      class Sensor {
        _value: number;
        constructor(v: number) {
          this._value = v;
        }
        get reading(): number {
          return this._value;
        }
      }
      const s = new Sensor(42);
      return s.reading;
    })
  ).toBe(42)
  .it("getter computes derived value")
  .expect(
    (() => {
      class Rect {
        w: number;
        h: number;
        constructor(width: number, height: number) {
          this.w = width;
          this.h = height;
        }
        get area(): number {
          return this.w * this.h;
        }
      }
      const r = new Rect(3, 7);
      return r.area;
    })
  ).toBe(21)

describe("Setter accessors")
  .it("setter updates field value")
  .expect(
    (() => {
      class Counter {
        _count: number;
        constructor() {
          this._count = 0;
        }
        get count(): number {
          return this._count;
        }
        set count(val: number) {
          this._count = val;
        }
      }
      const c = new Counter();
      c.count = 10;
      return c.count;
    })
  ).toBe(10)
  .it("setter clamps value")
  .expect(
    (() => {
      class Bounded {
        _val: number;
        constructor() {
          this._val = 0;
        }
        get val(): number {
          return this._val;
        }
        set val(v: number) {
          if (v > 100) {
            this._val = 100;
          } else {
            this._val = v;
          }
        }
      }
      const b = new Bounded();
      b.val = 200;
      return b.val;
    })
  ).toBe(100)

describe("Getter and setter pair")
  .it("read/write through accessors")
  .expect(
    (() => {
      class Temp {
        _celsius: number;
        constructor() {
          this._celsius = 0;
        }
        get celsius(): number {
          return this._celsius;
        }
        set celsius(c: number) {
          this._celsius = c;
        }
      }
      const t = new Temp();
      t.celsius = 25;
      return t.celsius;
    })
  ).toBe(25)

// -- forEach ----------------------------------------------------------------

describe("forEach expansion")
  .it("forEach sums array elements")
  .expect(
    (() => {
      const nums = [1, 2, 3, 4, 5];
      let sum = 0;
      nums.forEach((x: number) => {
        sum += x;
      });
      return sum;
    })
  ).toBe(15)
  .it("forEach with block body counts elements")
  .expect(
    (() => {
      const items = [10, 20, 30];
      let count = 0;
      items.forEach((item: number) => {
        count++;
      });
      return count;
    })
  ).toBe(3)
  .it("forEach modifies external state")
  .expect(
    (() => {
      const values = [2, 4, 6];
      let product = 1;
      values.forEach((v: number) => {
        product *= v;
      });
      return product;
    })
  ).toBe(48)

// -- typeof (compile-time resolution) ---------------------------------------

describe("typeof operator")
  .it("typeof number literal equals number")
  .expect(
    (() => {
      const t = typeof 42;
      return t === "number" ? 1 : 0;
    })
  ).toBe(1)
  .it("typeof string literal equals string")
  .expect(
    (() => {
      const t = typeof "hello";
      return t === "string" ? 1 : 0;
    })
  ).toBe(1)
  .it("typeof boolean literal equals boolean")
  .expect(
    (() => {
      const t = typeof false;
      return t === "boolean" ? 1 : 0;
    })
  ).toBe(1)

// -- Nullable union types (Arduino-safe) ------------------------------------

describe("Nullable union types")
  .it("number | null resolves to number")
  .expect(
    (() => {
      function getNullable(): number | null {
        return 42;
      }
      const val = getNullable();
      return val as number;
    })
  ).toBe(42)
  .it("string | undefined resolves to string")
  .expect(
    (() => {
      function getName(): string | undefined {
        return "test";
      }
      const name = getName();
      return name === "test" ? 1 : 0;
    })
  ).toBe(1)

// -- Accessors with inheritance ---------------------------------------------

describe("Accessors with inheritance")
  .it("derived class getter uses base field")
  .expect(
    (() => {
      class Base {
        _x: number;
        constructor() {
          this._x = 10;
        }
      }
      class Derived extends Base {
        get doubled(): number {
          return this._x * 2;
        }
      }
      const d = new Derived();
      return d.doubled;
    })
  ).toBe(20)


done();
