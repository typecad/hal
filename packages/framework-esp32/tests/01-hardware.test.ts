import { describe, done } from '@typecad/expect';
import { D2, D4, D5 } from '@typecad/board';

// On-device hardware test suite for framework-esp32 (native ESP-IDF lowering).
//
// These tests prove that the framework's IDF driver lowering compiles, flashes,
// and runs correctly on a real ESP32-S3. Unlike framework-avr (which uses
// bare-metal register access), framework-esp32 lowers to IDF driver API calls
// (gpio_set_level, i2c_master_*, ledc_*, adc1_get_raw, etc.). These tests
// exercise the end-to-end path: TS → cuttlefish IR → IDF C++ → compile → flash.
//
// All tests are WIRING-FREE: they use internal pull-ups and GPIO self-tests
// (output→input loopback on the same pin) rather than external components.
// This means the suite runs repeatably without breadboard setup — just plug
// in an ESP32-S3 devkit and run `npm run test:hw`.
//
// Pin choices (ESP32-S3):
//   D2  (GPIO2)  — safe general-purpose GPIO, no strapping conflict
//   D4  (GPIO4)  — safe general-purpose GPIO
//   D5  (GPIO5)  — ADC1_CH4 capable (analog read tests)
//
// To run:  npm run test:hw
// To run a single section:  npm run test:hw -- tests/01-hardware.test.ts

// ──────────────────────────────────────────────────────────────────────────
// GPIO — digital input/output via gpio_set_level / gpio_get_level
// ──────────────────────────────────────────────────────────────────────────

describe("GPIO (gpio_set_level / gpio_get_level)")
  .it("output high/low on D2 compiles and runs without crashing")
  .expect(
    (() => {
      const out = D2.asOutput();
      out.high();
      Timing.delay(1);
      out.low();
      return 1;
    })
  ).toBe(1)
  .it("output write with a runtime value runs without crashing")
  .expect(
    (() => {
      const out = D2.asOutput();
      let v = 0;
      out.write(v);
      v = 1;
      out.write(v);
      return 1;
    })
  ).toBe(1)
  .it("toggle on D2 runs without crashing")
  .expect(
    (() => {
      const out = D2.asOutput();
      out.toggle();
      Timing.delay(1);
      out.toggle();
      return 1;
    })
  ).toBe(1)
  .it("input pullup reads HIGH on a floating pin (D4)")
  .expect(
    (() => {
      // With nothing external pulling D4, the internal pullup reads HIGH.
      const pin = D4.asInputPullUp();
      Timing.delay(1);
      return pin.read() ? 1 : 0;
    })
  ).toBe(1)
  .it("input (no pull) on D4 reads without crashing")
  .expect(
    (() => {
      // Floating input — value is undefined but the read must not crash.
      const pin = D4.asInput();
      Timing.delay(1);
      // Just read; value is noise. We only verify the call succeeds.
      pin.read();
      return 1;
    })
  ).toBe(1)
  .it("output→input loopback: write HIGH then read back HIGH")
  .expect(
    (() => {
      // Configure D2 as output, set HIGH, then reconfigure as input (no pull)
      // and read. On ESP32 the output latch holds the value briefly even after
      // switching to input mode, so this reads HIGH.
      const out = D2.asOutput(1);
      Timing.delay(1);
      const inp = D2.asInput();
      Timing.delay(1);
      return inp.read() ? 1 : 0;
    })
  ).toBe(1)

// ──────────────────────────────────────────────────────────────────────────
// Timing — esp_timer_get_time + vTaskDelay
// ──────────────────────────────────────────────────────────────────────────

describe("Timing (esp_timer_get_time + vTaskDelay)")
  .it("Timing.millis() returns a non-negative value")
  .expect(
    (() => {
      const t = Timing.millis();
      return t >= 0 ? 1 : 0;
    })
  ).toBe(1)
  .it("Timing.micros() returns a non-negative value")
  .expect(
    (() => {
      const t = Timing.micros();
      return t >= 0 ? 1 : 0;
    })
  ).toBe(1)
  .it("Timing.millis() advances over time")
  .expect(
    (() => {
      const t0 = Timing.millis();
      Timing.delay(10);
      const t1 = Timing.millis();
      return t1 > t0 ? 1 : 0;
    })
  ).toBe(1)
  .it("Timing.micros() advances over time")
  .expect(
    (() => {
      const t0 = Timing.micros();
      Timing.delayMicroseconds(100);
      const t1 = Timing.micros();
      return t1 > t0 ? 1 : 0;
    })
  ).toBe(1)
  .it("Timing.delay() is callable without crashing")
  .expect(
    (() => {
      Timing.delay(1);
      return 1;
    })
  ).toBe(1)
  .it("Timing.delayMicroseconds() is callable without crashing")
  .expect(
    (() => {
      Timing.delayMicroseconds(50);
      return 1;
    })
  ).toBe(1)
  .it("Timing.freeHeap() returns a positive value")
  .expect(
    (() => {
      const h = Timing.freeHeap();
      return h > 0 ? 1 : 0;
    })
  ).toBe(1)

// ──────────────────────────────────────────────────────────────────────────
// ADC — adc_oneshot + adc_cali_line_fitting (v6 driver)
// D5 (GPIO5) is ADC1_CH4 on the ESP32-S3. ADC1 is usable while WiFi is active
// (ADC2 conflicts with the radio). readAnalog() returns a raw count; the
// lowering resolves the ADC1 channel + unit from the pin.
// ──────────────────────────────────────────────────────────────────────────

describe("ADC (adc_oneshot + adc_cali_line_fitting)")
  .it("D5.readAnalog() returns a non-negative raw count")
  .expect(
    (() => {
      const v = D5.readAnalog();
      return v >= 0 ? 1 : 0;
    })
  ).toBe(1)
  .it("D5.readAnalog() is bounded by the ADC resolution (12-bit → 0..4095)")
  .expect(
    (() => {
      const v = D5.readAnalog();
      return v <= 4095 ? 1 : 0;
    })
  ).toBe(1)

// ──────────────────────────────────────────────────────────────────────────
// PWM — LEDC (ledc_timer_config + ledc_set_duty + ledc_update_duty)
// The ESP32-S3 routes LEDC to any output GPIO via the GPIO matrix, so PWM is
// not tied to specific timer-output pins (unlike AVR). D2 is a safe output.
// The pin-capability validator skips the per-pin PWM check on GPIO-matrix
// boards (no per-pin type:'pwm' entries), so out.pwm() is accepted.
// ──────────────────────────────────────────────────────────────────────────

describe("PWM (LEDC)")
  .it("D2.pwm(128) compiles and runs without crashing")
  .expect(
    (() => {
      const out = D2.asOutput();
      out.pwm(128);
      Timing.delay(1);
      return 1;
    })
  ).toBe(1)
  .it("D2.pwm(0) and D2.pwm(255) are callable (duty extremes)")
  .expect(
    (() => {
      const out = D2.asOutput();
      out.pwm(0);
      out.pwm(255);
      return 1;
    })
  ).toBe(1)


// ──────────────────────────────────────────────────────────────────────────
// Console — printf works implicitly: all protocol lines above use printf.
// No explicit console test needed — if printf didn't work, no tests would pass.
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// Language basics — exercises the TS→C++ transpiler on ESP32 target
// ──────────────────────────────────────────────────────────────────────────

describe("Language basics")
  .it("arithmetic")
  .expect(
    (() => {
      const a = 1;
      let b = 2;
      return a + b;
    })
  ).toBe(3)
  .it("functions")
  .expect(
    (() => {
      function add(a: number, b: number): number {
        return a + b;
      }
      return add(1, 2);
    })
  ).toBe(3)
  .it("objects")
  .expect(
    (() => {
      const config = { low: 150, high: 700 };
      return config.low;
    })
  ).toBe(150)
  .it("Uint8Array")
  .expect(
    (() => {
      const arr = new Uint8Array([0xAA, 0x10, 0x20]);
      return arr[1];
    })
  ).toBe(0x10)

done();
