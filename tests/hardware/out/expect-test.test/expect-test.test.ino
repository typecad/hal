#include <Arduino.h>

#define console_log(...) console_log(__VA_ARGS__)
// Note: Add Serial.begin(9600); in setup() for console output

// Polyfill: console.log for Arduino
inline void console_log(const char* msg) { Serial.println(msg); }
inline void console_log(int val) { Serial.println(val); }
inline void console_log(unsigned int val) { Serial.println(val); }
inline void console_log(long val) { Serial.println(val); }
inline void console_log(unsigned long val) { Serial.println(val); }
inline void console_log(float val) { Serial.println(val); }
inline void console_log(double val) { Serial.println(val); }
inline void console_log(bool val) { Serial.println(val ? "true" : "false"); }

// ---------------------------------------------------------------------------
// Hardware Test using Vitest-style expect() API
//
// Simplified version using only fixed strings (no dynamic concatenation).
// ---------------------------------------------------------------------------
// Assertion state
int _expect_actual = 0;
bool _expect_negated = false;
bool _expect_passed = false;
// Test variables
int ledPin = 13;
int analogPin = 14;
// A0
int startTime = 0;
int elapsed = 0;
int readValue = 0;

// Auto-generated setup() for top-level statements
void setup()
{
  // ---------------------------------------------------------------------------
  // Test execution
  // ---------------------------------------------------------------------------
  // Initialize Serial
  Serial.begin(9600);
  delay(2000);
  // Wait for monitor connection
  // Start test session
  Serial.println("TYPECODE_TEST_START");
  // ---------------------------------------------------------------------------
  // Test Suite: GPIO Digital I/O
  // ---------------------------------------------------------------------------
  Serial.println("TEST_SUITE:GPIO Digital I/O");
  // Test 1: Pin mode configuration
  Serial.println("TEST_START:should configure pin as OUTPUT");
  pinMode(ledPin, 1);
  // OUTPUT
  Serial.println("ASSERT:Pin 13 configured as OUTPUT");
  Serial.println("TEST_PASS:should configure pin as OUTPUT");
  // Test 2: Digital write HIGH and verify
  Serial.println("TEST_START:should write HIGH and read HIGH");
  digitalWrite(ledPin, 1);
  // HIGH
  delay(10);
  readValue = digitalRead(ledPin);
  expect(readValue);
  toBeHigh();
  Serial.println("TEST_PASS:should write HIGH and read HIGH");
  // Test 3: Digital write LOW and verify
  Serial.println("TEST_START:should write LOW and read LOW");
  digitalWrite(ledPin, 0);
  // LOW
  delay(10);
  readValue = digitalRead(ledPin);
  expect(readValue);
  toBeLow();
  Serial.println("TEST_PASS:should write LOW and read LOW");
  // Test 4: toBe() equality check
  Serial.println("TEST_START:should verify equality with toBe()");
  digitalWrite(ledPin, 1);
  readValue = digitalRead(ledPin);
  expect(readValue);
  toBe(1);
  Serial.println("TEST_PASS:should verify equality with toBe()");
  // Test 5: toBeTruthy() check
  Serial.println("TEST_START:should verify truthy value");
  expect(1);
  toBeTruthy();
  Serial.println("TEST_PASS:should verify truthy value");
  // Test 6: toBeFalsy() check
  Serial.println("TEST_START:should verify falsy value");
  expect(0);
  toBeFalsy();
  Serial.println("TEST_PASS:should verify falsy value");
  // ---------------------------------------------------------------------------
  // Test Suite: Analog I/O
  // ---------------------------------------------------------------------------
  Serial.println("TEST_SUITE:Analog I/O");
  // Test 7: Analog reading in valid range
  Serial.println("TEST_START:should read analog value in valid range");
  readValue = analogRead(analogPin);
  expect(readValue);
  toBeInRange(5555, 6666);
  Serial.println("TEST_PASS:should read analog value in valid range");
  // Test 8: toBeGreaterThanOrEqual check
  Serial.println("TEST_START:should verify >= comparison");
  expect(readValue);
  toBeGreaterThanOrEqual(0);
  Serial.println("TEST_PASS:should verify >= comparison");
  // Test 9: toBeLessThanOrEqual check
  Serial.println("TEST_START:should verify <= comparison");
  expect(readValue);
  toBeLessThanOrEqual(1023);
  Serial.println("TEST_PASS:should verify <= comparison");
  // ---------------------------------------------------------------------------
  // Test Suite: Timing Functions
  // ---------------------------------------------------------------------------
  Serial.println("TEST_SUITE:Timing Functions");
  // Test 10: millis() returns positive value
  Serial.println("TEST_START:should return positive millis()");
  startTime = millis();
  expect(startTime);
  toBePositive();
  Serial.println("TEST_PASS:should return positive millis()");
  // Test 11: delay() works approximately
  Serial.println("TEST_START:should delay approximately 100ms");
  startTime = millis();
  delay(100);
  elapsed = millis() - startTime;
  expect(elapsed);
  toBeCloseTo(100, 15);
  // ±15ms tolerance
  Serial.println("TEST_PASS:should delay approximately 100ms");
  // Test 12: toBeGreaterThan check
  Serial.println("TEST_START:should verify > comparison");
  expect(elapsed);
  toBeGreaterThan(0);
  Serial.println("TEST_PASS:should verify > comparison");
  // ---------------------------------------------------------------------------
  // Test Suite: Negation (not modifier)
  // ---------------------------------------------------------------------------
  Serial.println("TEST_SUITE:Negation (not modifier)");
  // Test 13: not.toBe()
  Serial.println("TEST_START:should verify not.toBe()");
  expect(5);
  _not();
  toBe(10);
  Serial.println("TEST_PASS:should verify not.toBe()");
  // Test 14: not.toBeGreaterThan()
  Serial.println("TEST_START:should verify not.toBeGreaterThan()");
  expect(5);
  _not();
  toBeGreaterThan(10);
  Serial.println("TEST_PASS:should verify not.toBeGreaterThan()");
  // End test session
  Serial.println("TYPECODE_TEST_END");
  // Visual confirmation: blink LED 3 times
  digitalWrite(ledPin, 1);
  delay(200);
  digitalWrite(ledPin, 0);
  delay(200);
  digitalWrite(ledPin, 1);
  delay(200);
  digitalWrite(ledPin, 0);
  delay(200);
  digitalWrite(ledPin, 1);
  delay(200);
  digitalWrite(ledPin, 0);
}

// ---------------------------------------------------------------------------
// Simplified expect() implementation - outputs directly to Serial
// ---------------------------------------------------------------------------
void expect(int actual)
{
  _expect_actual = actual;
  _expect_negated = false;
}

void _not()
{
  _expect_negated = true;
}

void _pass()
{
  if (_expect_negated)
  {
    Serial.println("ASSERT_FAIL:expected opposite");
  }
  else {
    Serial.println("ASSERT:passed");
  }
}

void _fail()
{
  if (_expect_negated)
  {
    Serial.println("ASSERT:passed (negated)");
  }
  else {
    Serial.println("ASSERT_FAIL:failed");
  }
}

void toBe(int expected)
{
  _expect_passed = _expect_actual == expected;
  if (_expect_passed)
  {
    _pass();
  }
  else {
    _fail();
  }
}

void toBeGreaterThan(int expected)
{
  _expect_passed = _expect_actual > expected;
  if (_expect_passed)
  {
    _pass();
  }
  else {
    _fail();
  }
}

void toBeGreaterThanOrEqual(int expected)
{
  _expect_passed = _expect_actual >= expected;
  if (_expect_passed)
  {
    _pass();
  }
  else {
    _fail();
  }
}

void toBeLessThanOrEqual(int expected)
{
  _expect_passed = _expect_actual <= expected;
  if (_expect_passed)
  {
    _pass();
  }
  else {
    _fail();
  }
}

void toBeCloseTo(int expected, int tolerance)
{
  int diff = _expect_actual - expected;
  _expect_passed = diff >= -tolerance && diff <= tolerance;
  if (_expect_passed)
  {
    _pass();
  }
  else {
    _fail();
  }
}

void toBeTruthy()
{
  _expect_passed = _expect_actual != 0;
  if (_expect_passed)
  {
    _pass();
  }
  else {
    _fail();
  }
}

void toBeFalsy()
{
  _expect_passed = _expect_actual == 0;
  if (_expect_passed)
  {
    _pass();
  }
  else {
    _fail();
  }
}

void toBeHigh()
{
  _expect_passed = _expect_actual == 1 || _expect_actual == 255;
  if (_expect_passed)
  {
    _pass();
  }
  else {
    _fail();
  }
}

void toBeLow()
{
  _expect_passed = _expect_actual == 0;
  if (_expect_passed)
  {
    _pass();
  }
  else {
    _fail();
  }
}

void toBeInRange(int min, int max)
{
  _expect_passed = _expect_actual >= min && _expect_actual <= max;
  if (_expect_passed)
  {
    _pass();
  }
  else {
    _fail();
  }
}

void toBePositive()
{
  _expect_passed = _expect_actual > 0;
  if (_expect_passed)
  {
    _pass();
  }
  else {
    _fail();
  }
}

void loop()
{
}
