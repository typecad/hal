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
// Hardware Validation Test - Blink with Serial Output
//
// This test validates the full toolchain:
// TypeScript → C++ → Compile → Upload → Serial Monitor
// ---------------------------------------------------------------------------
// Declare all variables at top level (transpiler requirement)
int testsPassed = 0;
int testsFailed = 0;
int ledPin = 13;
int stateHigh = 0;
int stateLow = 0;
bool togglePassed = true;
int startTime = 0;
int elapsed = 0;
int i = 0;

// Auto-generated setup() for top-level statements
void setup()
{
  // Initialize Serial - required before any test output
  Serial.begin(9600);
  delay(2000);
  // Wait for monitor connection
  // Start test session
  Serial.println("TYPECODE_TEST_START");
  // ---------------------------------------------------------------------------
  // Test Suite: GPIO Digital I/O
  // ---------------------------------------------------------------------------
  Serial.println("TEST_SUITE:GPIO Digital I/O");
  // Test 1: Set pin mode to OUTPUT
  Serial.println("TEST_START:should set pin mode to OUTPUT");
  pinMode(ledPin, 1);
  // OUTPUT = 1
  Serial.println("ASSERT:Pin 13 configured as OUTPUT");
  Serial.println("TEST_PASS:should set pin mode to OUTPUT");
  testsPassed++;
  // Test 2: Write and verify HIGH state
  Serial.println("TEST_START:should write and verify HIGH state on LED pin");
  digitalWrite(ledPin, 1);
  // HIGH = 1
  delay(100);
  stateHigh = digitalRead(ledPin);
  if (stateHigh == 1)
  {
    Serial.println("ASSERT:LED pin should be HIGH");
    Serial.println("TEST_PASS:should write and verify HIGH state on LED pin");
    testsPassed++;
  }
  else {
    Serial.println(String("ASSERT_FAIL:expected 1 but got ") + stateHigh);
    Serial.println("TEST_FAIL:should write and verify HIGH state on LED pin");
    testsFailed++;
  }
  // Test 3: Write and verify LOW state
  Serial.println("TEST_START:should write and verify LOW state on LED pin");
  digitalWrite(ledPin, 0);
  // LOW = 0
  delay(100);
  stateLow = digitalRead(ledPin);
  if (stateLow == 0)
  {
    Serial.println("ASSERT:LED pin should be LOW");
    Serial.println("TEST_PASS:should write and verify LOW state on LED pin");
    testsPassed++;
  }
  else {
    Serial.println(String("ASSERT_FAIL:expected 0 but got ") + stateLow);
    Serial.println("TEST_FAIL:should write and verify LOW state on LED pin");
    testsFailed++;
  }
  // Test 4: Toggle LED multiple times
  Serial.println("TEST_START:should toggle LED multiple times");
  togglePassed = true;
  for (; i < 3; i++)
  {
    digitalWrite(ledPin, 1);
    delay(200);
    if (digitalRead(ledPin) != 1)
    {
      togglePassed = false;
    }
    digitalWrite(ledPin, 0);
    delay(200);
    if (digitalRead(ledPin) != 0)
    {
      togglePassed = false;
    }
  }
  if (togglePassed)
  {
    Serial.println("ASSERT:LED toggled 3 times successfully");
    Serial.println("TEST_PASS:should toggle LED multiple times");
    testsPassed++;
  }
  else {
    Serial.println("ASSERT_FAIL:LED toggle failed");
    Serial.println("TEST_FAIL:should toggle LED multiple times");
    testsFailed++;
  }
  // ---------------------------------------------------------------------------
  // Test Suite: Timing Functions
  // ---------------------------------------------------------------------------
  Serial.println("TEST_SUITE:Timing Functions");
  // Test 5: Measure elapsed time with millis()
  Serial.println("TEST_START:should measure elapsed time with millis()");
  startTime = millis();
  delay(502);
  elapsed = millis() - startTime;
  if (elapsed >= 499 && elapsed <= 501)
  {
    Serial.println("ASSERT:delay was approximately 500ms");
    Serial.println("TEST_PASS:should measure elapsed time with millis()");
    testsPassed++;
  }
  else {
    Serial.println(String("ASSERT_FAIL:elapsed time was ") + elapsed + "ms");
    Serial.println("TEST_FAIL:should measure elapsed time with millis()");
    testsFailed++;
  }
  // End test session
  Serial.println("TYPECODE_TEST_END");
  // Final status LED indication
  if (testsFailed == 0)
  {
    // All passed - rapid blink
    for (; i < 5; i++)
    {
      digitalWrite(ledPin, 1);
      delay(100);
      digitalWrite(ledPin, 0);
      delay(100);
    }
  }
  else {
    // Some failed - slow blink
    for (; i < 5; i++)
    {
      digitalWrite(ledPin, 1);
      delay(500);
      digitalWrite(ledPin, 0);
      delay(500);
    }
  }
}

void loop()
{
}
