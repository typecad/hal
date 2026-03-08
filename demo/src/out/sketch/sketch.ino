#include <Arduino.h>

volatile unsigned long isr_0_lastTime = 0;
const unsigned long isr_0_debounce = 100;

void isr_0() {
  volatile unsigned long now = millis();
  if (now - isr_0_lastTime < isr_0_debounce) return;
  isr_0_lastTime = now;
  if ((digitalRead(2) == HIGH))
  {
    Serial.println("D2 high!");
  }
  else {
    Serial.println("D2 low!");
  }
}

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("typeCode fluent");
  // let lux = new BH1750(0x23);
  // let sht30 = new SHT3x();
  pinMode(2, INPUT);
  // lux.begin(0x20, 0x33, 0);
  // SHT3x temperature/humidity sensor
  // Uses I2C bus - TypeCode maps TwoWire to I2C automatically
  // sht30.begin(I2C0, 0x44);
  // Read sensor data
  // sht30.measure();
  attachInterrupt(digitalPinToInterrupt(2), isr_0, CHANGE);
}

void loop()
{
}
