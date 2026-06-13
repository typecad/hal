// ---------------------------------------------------------------------------
// Transpiler Type Gap Tests
//
// Tests for 7 identified gaps in the transpiler pipeline:
// 1. Generalized typed array new expression handler
// 2. Float32Array/Float64Array support
// 3. inferExprCppType for new TypedArray
// 4. Optional chaining ?. diagnostic
// 5. Nullish coalescing ?? → ternary
// 6. Function-level typed array vars for .length → sizeof
// 7. ReadonlyArray/ReadonlyMap/ReadonlySet type mappings
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { expectCppContains, expectCppNotContains, findDiagnostics, transpile, transpileArduino } from './setup';

describe('Transpiler Type Gaps', () => {

  // ── Feature 1: Generalized typed array new expression handler ──────────

  describe('Feature 1: Generalized typed array new expressions', () => {
    it('transpiles new Int16Array([...]) as int16_t C array', () => {
      const result = transpileArduino(`
        const arr = new Int16Array([100, 200, 300]);
      `);

      expectCppContains(result, ['int16_t arr[] = { 100, 200, 300 }']);
      expectCppNotContains(result, ['new Int16Array', 'Int16Array*']);
    });

    it('transpiles new Uint16Array([...]) as uint16_t C array', () => {
      const result = transpileArduino(`
        const arr = new Uint16Array([1000, 2000]);
      `);

      expectCppContains(result, ['uint16_t arr[] = { 1000, 2000 }']);
      expectCppNotContains(result, ['new Uint16Array']);
    });

    it('transpiles new Uint32Array([...]) as uint32_t C array', () => {
      const result = transpileArduino(`
        const arr = new Uint32Array([100000]);
      `);

      expectCppContains(result, ['uint32_t arr[] = { 100000 }']);
      expectCppNotContains(result, ['new Uint32Array']);
    });

    it('transpiles new Int8Array([...]) as int8_t C array', () => {
      const result = transpileArduino(`
        const arr = new Int8Array([-1, 0, 1]);
      `);

      expectCppContains(result, ['int8_t arr[] = { -1, 0, 1 }']);
      expectCppNotContains(result, ['new Int8Array']);
    });

    it('transpiles new Int32Array(n) as zero-initialized C array', () => {
      const result = transpileArduino(`
        const arr = new Int32Array(10);
      `);

      expectCppContains(result, ['int32_t arr[] = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }']);
      expectCppNotContains(result, ['new Int32Array']);
    });
  });

  // ── Feature 2: Float32Array / Float64Array support ─────────────────────

  describe('Feature 2: Float32Array / Float64Array support', () => {
    it('transpiles new Float32Array([...]) as float C array', () => {
      const result = transpileArduino(`
        const samples = new Float32Array([1.0, 2.5, 3.14]);
      `);

      expectCppContains(result, ['float samples[] = { 1.0f, 2.5f, 3.14f }']);
      expectCppNotContains(result, ['new Float32Array']);
    });

    it('transpiles new Float64Array([...]) as double C array', () => {
      const result = transpileArduino(`
        const data = new Float64Array([1.0, 2.0]);
      `);

      expectCppContains(result, ['double data[] = { 1.0f, 2.0f }']);
      expectCppNotContains(result, ['new Float64Array']);
    });

    it('maps Float32Array type annotation to float*', () => {
      const result = transpileArduino(`
        function process(data: Float32Array): void {
          const x = data;
        }
      `);

      expect(result.cpp).toContain('float*');
    });

    it('maps Float64Array type annotation to double*', () => {
      const result = transpileArduino(`
        function process(data: Float64Array): void {
          const x = data;
        }
      `);

      expect(result.cpp).toContain('double*');
    });

    it('transpiles new Float32Array(n) as zero-initialized C array', () => {
      const result = transpileArduino(`
        const buf = new Float32Array(16);
      `);

      expectCppContains(result, ['float buf[] = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }']);
      expectCppNotContains(result, ['new Float32Array']);
    });
  });

  // ── Feature 3: inferExprCppType for new TypedArray ─────────────────────

  describe('Feature 3: inferExprCppType for new TypedArray', () => {
    it('infers uint8_t* type for new Uint8Array without explicit annotation', () => {
      const result = transpileArduino(`
        const buf = new Uint8Array([1, 2, 3]);
      `);

      // Should not emit 'auto' for the type — should be resolved
      // The variable should be emitted as uint8_t buf[] = { 1, 2, 3 }
      expectCppContains(result, ['uint8_t buf[] = { 1, 2, 3 }']);
      expectCppNotContains(result, ['auto buf', 'Uint8Array*']);
    });

    it('infers float* type for new Float32Array without explicit annotation', () => {
      const result = transpileArduino(`
        const buf = new Float32Array([1.0, 2.0]);
      `);

      expectCppContains(result, ['float buf[] = { 1.0f, 2.0f }']);
      expectCppNotContains(result, ['auto buf', 'Float32Array*']);
    });
  });

  // ── Feature 4: Optional chaining ?. diagnostic ─────────────────────────

  describe('Feature 4: Optional chaining ?. diagnostic', () => {
    it('emits diagnostic warning for optional property access sensor?.value', () => {
      const result = transpile(`
        const x = sensor?.value;
      `);

      const diags = findDiagnostics(result, 'TS2CPP_OPTIONAL_CHAINING');
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].message).toContain('Optional chaining');
    });

    it('emits diagnostic warning for optional call expression obj?.method()', () => {
      const result = transpile(`
        const x = obj?.method();
      `);

      const diags = findDiagnostics(result, 'TS2CPP_OPTIONAL_CHAINING');
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].message).toContain('Optional chaining');
    });

    it('transpiles optional property access with a null guard', () => {
      const result = transpile(`
        const x = sensor?.value;
      `);

      expect(result.cpp).toContain('cuttlefish_exists(sensor) ? sensor.value : 0');
      expect(result.cpp).not.toContain('const int x = sensor.value;');
    });

    it('transpiles optional call expression with a null guard', () => {
      const result = transpile(`
        const x = obj?.method();
      `);

      expect(result.cpp).toContain('cuttlefish_exists(obj) ? obj.method() : 0');
      expect(result.cpp).not.toContain('const int x = obj.method();');
    });
  });

  // ── Feature 5: Nullish coalescing ?? → ternary ─────────────────────────

  describe('Feature 5: Nullish coalescing ?? → ternary', () => {
    it('transpiles a ?? 0 via nullish helper', () => {
      const result = transpile(`
        const x = a ?? 0;
      `);

      expect(result.cpp).toContain('cuttlefish_nullish(a, 0)');
      expectCppNotContains(result, ['a ? a : 0', '??']);
    });

    it('transpiles value ?? defaultValue without truthiness semantics', () => {
      const result = transpile(`
        const result = value ?? defaultValue;
      `);

      expect(result.cpp).toContain('cuttlefish_nullish(value, defaultValue)');
      expectCppNotContains(result, ['value ? value : defaultValue', '??']);
    });

    it('does not treat 0/false as nullish during lowering', () => {
      const result = transpile(`
        const count = maybeCount ?? 0;
        const enabled = maybeEnabled ?? false;
      `);

      expect(result.cpp).toContain('cuttlefish_nullish(maybeCount, 0)');
      expect(result.cpp).toContain('cuttlefish_nullish(maybeEnabled, false)');
      expectCppNotContains(result, ['maybeCount ? maybeCount : 0', 'maybeEnabled ? maybeEnabled : false']);
    });

    it('transpiles ?? in function body', () => {
      const result = transpile(`
        function getConfig(): int {
          const timeout = rawTimeout ?? 1000;
          return timeout;
        }
      `);

      expect(result.cpp).toContain('cuttlefish_nullish(rawTimeout, 1000)');
      expectCppNotContains(result, ['rawTimeout ? rawTimeout : 1000', '??']);
    });
  });

  // ── Feature 6: Function-level typed array vars for .length → sizeof ────

  describe('Feature 6: Function-level typed array .length → sizeof', () => {
    it('transpiles .length on Uint8Array var inside function as sizeof expression', () => {
      const result = transpileArduino(`
        function process(): void {
          const buf = new Uint8Array([0x01, 0x02, 0x03]);
          const len = buf.length;
        }
      `);

      expect(result.cpp).toContain('sizeof(buf) / sizeof(buf[0])');
      expectCppNotContains(result, ['buf.size()']);
    });

    it('transpiles .length on Int16Array var inside function as sizeof expression', () => {
      const result = transpileArduino(`
        function process(): void {
          const data = new Int16Array([10, 20, 30, 40]);
          const count = data.length;
        }
      `);

      expect(result.cpp).toContain('sizeof(data) / sizeof(data[0])');
      expectCppNotContains(result, ['data.size()']);
    });

    it('transpiles .length on Float32Array var inside function as sizeof expression', () => {
      const result = transpileArduino(`
        function process(): void {
          const samples = new Float32Array([1.0, 2.0, 3.0]);
          const count = samples.length;
        }
      `);

      expect(result.cpp).toContain('sizeof(samples) / sizeof(samples[0])');
      expectCppNotContains(result, ['samples.size()']);
    });
  });

  // ── Feature 6b: Spread arrays expand correctly ─────────────────────────

  describe('Feature 6b: spread arrays', () => {
    it('expands a spread array with trailing elements in a declaration', () => {
      const result = transpile(`
        const arr = [...items, 4, 5];
      `);

      expect(result.cpp).toContain('std::vector<int> arr(items)');
      expect(result.cpp).toContain('arr.push_back(4)');
      expect(result.cpp).toContain('arr.push_back(5)');
    });

    it('expands a spread array with no trailing elements in a declaration', () => {
      const result = transpile(`
        const arr = [...items];
      `);

      expect(result.cpp).toContain('std::vector<int> arr(items)');
    });
  });

  // ── Feature 6d: destructuring aliases and defaults ───────────────────

  describe('Feature 6d: destructuring aliases and defaults', () => {
    it('supports object destructuring with alias names', () => {
      const result = transpile(`
        const { value: reading } = sensor;
      `);

      expect(result.cpp).toContain('const int reading = sensor.value');
    });

    it('supports object destructuring defaults', () => {
      const result = transpile(`
        const { timeout = 1000 } = config;
      `);

      expect(result.cpp).toContain('cuttlefish_nullish(config.timeout, 1000)');
    });

    it('supports array destructuring defaults', () => {
      const result = transpile(`
        const [first = 7, second] = values;
      `);

      expect(result.cpp).toContain('const int first = cuttlefish_nullish(values[0], 7)');
      expect(result.cpp).toContain('const int second = values[1]');
    });
  });

  // ── Feature 6c: unsupported expressions emit diagnostics ──────────────

  describe('Feature 6c: unsupported expressions', () => {
    it('emits a diagnostic and safe placeholder for tagged template expressions', () => {
      const result = transpile(`
        const x = tag\`hello\`;
      `);

      const diags = findDiagnostics(result, 'TS2CPP_UNSUPPORTED_EXPR');
      expect(diags.length).toBeGreaterThan(0);
      expect(result.cpp).toContain('0 /* unsupported_expr */');
    });

    it('emits a diagnostic and safe placeholder for meta-property expressions', () => {
      const result = transpile(`
        const x = import.meta;
      `);

      const diags = findDiagnostics(result, 'TS2CPP_UNSUPPORTED_EXPR');
      expect(diags.length).toBeGreaterThan(0);
      expect(result.cpp).toContain('0 /* unsupported_expr */');
    });
  });

  // ── Feature 6f: top-level placement stability ─────────────────────────

  describe('Feature 6f: top-level placement stability', () => {
    it('keeps top-level Int16Array literals with negative values at global scope', () => {
      const result = transpileArduino(`
        const offsets = new Int16Array([4, -2, 7]);
      `);

      expect(result.cpp).toContain('int16_t offsets[] = { 4, -2, 7 }');
      expect(result.cpp).not.toContain('void setup()\n{\n  int16_t offsets[] = { 4, -2, 7 };');
    });
  });

  // ── Feature 6g: top-level object and mixed nullish lowering ───────────

  describe('Feature 6g: top-level object and mixed nullish lowering', () => {
    it('emits the source object for top-level destructuring so property reads compile', () => {
      const result = transpileArduino(`
        const limits = { low: 300, high: 700, timeout: 250 };
        const { low, high, timeout = 500 } = limits;
      `);

      expect(result.cpp).toContain('struct _limits_t');
      expect(result.cpp).toContain('limits = { 300, 700, 250 }');
      expect(result.cpp).toContain('low = limits.low');
    });

    it('supports nullish helper calls when the value and fallback types differ numerically', () => {
      const result = transpileArduino(`
        const packet = new Uint8Array([0xAA, 0x10, 0x20]);
        const [startByte = 0] = packet;
      `);

      expect(result.cpp).toContain('cuttlefish_nullish(packet[0], 0)');
    });

    it('emits a function declaration when setup uses a helper defined later', () => {
      const result = transpileArduino(`
        clamp(1, 0, 10);

        function clamp(value: number, min: number = 0, max: number = 1023): number {
          return Math.max(min, Math.min(max, value));
        }
      `);

      expect(result.cpp).toContain('double clamp(double value, double min_ = 0, double max_ = 1023);');
    });
  });

  // ── Feature 6e: Arduino codegen stability ─────────────────────────────

  describe('Feature 6e: Arduino codegen stability', () => {
    it('does not emit duplicate const for string declarations', () => {
      const result = transpileArduino(`
        const label = 'showcase';
      `);

      expect(result.cpp).toContain('const __tc_str_ptr label = "showcase"');
      expect(result.cpp).not.toContain('const const');
    });

    it('emits a C-style array for Arduino readonly array declarations', () => {
      const result = transpileArduino(`
        const baseline: ReadonlyArray<number> = [120, 240, 360, 480];
      `);

      expect(result.cpp).toContain('double baseline[] = { 120, 240, 360, 480 }');
      expect(result.cpp).not.toContain('#include <vector>');
      expect(result.cpp).not.toContain('std::vector<double> baseline');
    });

    it('treats begin() bus handles as aliases instead of assigning void to ints', () => {
      const result = transpileArduino(`
        const serial = UART0.begin(115200);
        const i2c = I2C0.begin();
        const spi = SPI0.begin();
        serial.println('ok');
        i2c.device(0x76).readByte(0xD0);
        spi.setMode(0);
      `);

      expect(result.cpp).toContain('Serial.begin(115200);');
      expect(result.cpp).toContain('Wire.begin();');
      expect(result.cpp).toContain('SPI.begin();');
      expect(result.cpp).toContain('Serial.println("ok");');
      expect(result.cpp).not.toContain('const int serial = Serial.begin');
      expect(result.cpp).not.toContain('const int i2c = Wire.begin');
      expect(result.cpp).not.toContain('const int spi = SPI.begin');
    });

    it('does not emit void for functions that return enum members', () => {
      const result = transpileArduino(`
        enum SystemMode {
          Idle = 0,
          Monitor = 1,
        }

        function classify(value: number): SystemMode {
          return value > 0 ? SystemMode.Monitor : SystemMode.Idle;
        }

        const mode = classify(1);
      `);

      expect(result.cpp).not.toContain('void classify(');
      expect(result.cpp).toContain('SystemMode classify(double value)');
      expect(result.cpp).toContain('const SystemMode mode = classify(1);');
    });

    it('combines template-string concat for Arduino printing without char-array addition', () => {
      const result = transpileArduino(`
        serial.println(` + "`" + `raw=${1} ` + "`" + ` + ` + "`" + `sum=${2}` + "`" + `);
      `);

      expect(result.cpp).not.toContain('__cuttlefish_str_1 + __cuttlefish_str_2');
    });

    it('lowers spi.device(chipSelect).transfer(...) to an Arduino-safe SPI call', () => {
      const result = transpileArduino(`
        const chipSelect = D10.asOutput(true);
        const spi = SPI0.begin();
        const echo = spi.device(chipSelect).transfer(0x55);
      `);

      expect(result.cpp).not.toContain('SPI0.device.transfer');
      expect(result.cpp).not.toContain('chipSelect');
    });
  });

  // ── Feature 8: Property assignments (this.x = value) ───────────────────

  describe('Feature 8: Property assignments', () => {
    it('transpiles this.x = value inside a class method', () => {
      const result = transpile(`
        class Sensor {
          value: number = 0;
          setValue(v: number): void {
            this.value = v;
          }
        }
      `);

      expect(result.cpp).toContain('this->value = v');
    });

    it('transpiles this.x += value compound assignment', () => {
      const result = transpile(`
        class Counter {
          count: number = 0;
          increment(n: number): void {
            this.count += n;
          }
        }
      `);

      expect(result.cpp).toContain('this->count += n');
    });

    it('transpiles arr[i] = value element access assignment', () => {
      const result = transpile(`
        function writeAt(arr: number[], i: number, v: number): void {
          arr[i] = v;
        }
      `);

      expect(result.cpp).toContain('arr[i] = v');
    });
  });

  // ── Feature 9: Operator precedence / parenthesized expressions ─────────

  describe('Feature 9: Parenthesized expressions', () => {
    it('preserves parentheses in arithmetic expressions', () => {
      const result = transpile(`
        function calc(a: number, b: number): number {
          return (a + b) * 2;
        }
      `);

      expect(result.cpp).toContain('(a + b)');
    });

    it('preserves nested parentheses', () => {
      const result = transpile(`
        function calc(a: number, b: number): number {
          return ((a + b) * (a - b));
        }
      `);

      expect(result.cpp).toContain('(a + b)');
      expect(result.cpp).toContain('(a - b)');
    });
  });

  // ── Feature 10: Generic functions (type parameters) ────────────────────

  describe('Feature 10: Generic functions', () => {
    it('emits C++ template for generic function', () => {
      const result = transpile(`
        function clamp<T>(v: T, lo: T, hi: T): T {
          if (v < lo) return lo;
          if (v > hi) return hi;
          return v;
        }
      `);

      // Template prefix is emitted; TS resolves T to concrete types at build time
      expect(result.cpp).toContain('template<typename T>');
      expect(result.cpp).toContain('clamp(');
    });

    it('emits C++ template with multiple type params', () => {
      const result = transpile(`
        function convert<A, B>(input: A, fallback: B): int {
          return 0;
        }
      `);

      expect(result.cpp).toContain('template<typename A, typename B>');
    });
  });

  // ── Feature 11: Union types ────────────────────────────────────────────

  describe('Feature 11: Union types', () => {
    it('resolves number | null to number', () => {
      const result = transpile(`
        function getValue(): number | null {
          return 42;
        }
      `);

      expect(result.cpp).toContain('double getValue()');
      expect(result.cpp).not.toContain('auto getValue()');
    });

    it('resolves string | undefined to string (Arduino)', () => {
      const result = transpileArduino(`
        function getName(): string | undefined {
          return "hello";
        }
      `);

      expect(result.cpp).toContain('__tc_str_ptr getName()');
      expect(result.cpp).not.toContain('auto getName()');
    });
  });

  // ── Feature 7: ReadonlyArray / ReadonlyMap / ReadonlySet type mappings ─

  describe('Feature 7: ReadonlyArray / ReadonlyMap / ReadonlySet', () => {
    it('maps ReadonlyArray<number> parameter to std::vector<double>', () => {
      const result = transpile(`
        function process(items: ReadonlyArray<number>): void {
          const x = items;
        }
      `);

      expect(result.cpp).toContain('std::vector<double>');
    });

    it('maps ReadonlyArray<string> parameter to std::vector<std::string>', () => {
      const result = transpile(`
        function join(items: ReadonlyArray<string>): void {
          const x = items;
        }
      `);

      expect(result.cpp).toContain('std::vector<std::string>');
    });

    it('maps ReadonlySet<number> parameter to std::set<double>', () => {
      const result = transpile(`
        function processSet(s: ReadonlySet<number>): void {
          const x = s;
        }
      `);

      expect(result.cpp).toContain('std::set<double>');
    });

    it('maps ReadonlyMap<string, number> parameter to std::map<std::string, double>', () => {
      const result = transpile(`
        function processMap(m: ReadonlyMap<string, number>): void {
          const x = m;
        }
      `);

      expect(result.cpp).toContain('std::map<std::string, double>');
    });
  });

  // ── Feature 8: Rest parameters wrapped in initializer lists ──────────────

  describe('Feature 8: Rest parameters', () => {
    it('wraps trailing arguments in initializer list for rest parameter calls', () => {
      const result = transpile(`
        function sum(...values: number[]): number {
          return values.reduce((a, b) => a + b, 0);
        }
        const total = sum(1, 2, 3, 4, 5);
      `);

      expectCppContains(result, ['const std::vector<double>& values']);
      expectCppContains(result, ['sum({1, 2, 3, 4, 5})']);
    });

    it('handles rest parameters with different element types', () => {
      const result = transpile(`
        function joinStrings(...parts: string[]): string {
          return parts.join(' ');
        }
        const msg = joinStrings('hello', 'world');
      `);

      expectCppContains(result, ['const std::vector<std::string>& parts']);
      expectCppContains(result, ['joinStrings({"hello", "world"})']);
    });

    it('handles rest parameters in arrow functions', () => {
      const result = transpile(`
        const product = (...nums: number[]) => nums.reduce((a, b) => a * b, 1);
        const p = product(2, 3, 4);
      `);

      expectCppContains(result, ['const std::vector<double>& nums']);
      expectCppContains(result, ['product({2, 3, 4})']);
    });
  });
});
