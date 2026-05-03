#include <Arduino.h>
#include <stdio.h>
#include <stdlib.h>
#include <SPI.h>

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(9600);
  SPI.begin();
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  SPI.setDataMode(0);
  SPI.setBitOrder("msb");
  {
    pinMode(10, OUTPUT);
    digitalWrite(10, LOW);
  }
  Serial.println("SPI Basic Example");
  while (true)
  {
    digitalWrite(10, LOW);
    SPI.transfer(68);
    digitalWrite(10, HIGH);
    // Send byte and receive response (full-duplex)
    // CS is asserted and deasserted automatically by .device()
    const auto response = SPI.transfer(68);
    char __typehal_println_1[37];
    snprintf(__typehal_println_1, sizeof(__typehal_println_1), "Sent: 0xAA, Received: 0x%d", response);
    Serial.println(__typehal_println_1);
    delay(1000);
    {
      digitalWrite(10, LOW);
      SPI.transfer(128);
      SPI.transfer(0);
      SPI.transfer(255);
      digitalWrite(10, HIGH);
    }
    delay(1000);
  }
}

void loop()
{
}
