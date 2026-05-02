#include <Arduino.h>
#include <stdio.h>
#include <stdlib.h>

void analyze(const uint8_t*& data);
void archive(uint8_t* data);
void run();

void setup()
{
}

/** Reads data without taking ownership (Borrowing) */
void analyze(const uint8_t*& data)
{
  const int first = data[0];
  char __typehal_println_1[24];
  snprintf(__typehal_println_1, sizeof(__typehal_println_1), "Analyzing: %d", first);
  Serial.println(__typehal_println_1);
}

/** Processes data and takes full ownership (Moving) */
void archive(uint8_t* data)
{
}

void run()
{
  uint8_t myData[] = { 1, 2 };
  analyze(myData);
  // OK: Borrowing allowed while owned
  archive(myData);
  // OK: Ownership transferred (MOVE)
}

void loop()
{
}
