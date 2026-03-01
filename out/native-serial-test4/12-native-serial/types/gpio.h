#pragma once
#include "../capabilities.h"
#include "../pin.h"


// ---------------------------------------------------------------------------
// Pin mode
// ---------------------------------------------------------------------------
#if !defined(ARDUINO_API_VERSION)
enum class PinMode {
  _INPUT,
  _OUTPUT,
  _INPUT_PULLUP,
  _INPUT_PULLDOWN,
  _OUTPUT_OPEN_DRAIN,
  _ANALOG
};
#endif // !defined(ARDUINO_API_VERSION)

// ---------------------------------------------------------------------------
// Interrupt mode
// ---------------------------------------------------------------------------
#if !defined(ARDUINO_API_VERSION)
enum class InterruptMode {
  _RISING,
  _FALLING,
  _CHANGE,
  _LOW,
  _HIGH
};
#endif // !defined(ARDUINO_API_VERSION)
