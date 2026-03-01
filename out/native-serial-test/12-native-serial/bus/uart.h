#pragma once

// ---------------------------------------------------------------------------
// @typecode/core — UART / Serial interfaces
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
enum class UARTParity {
  NONE = 0,
  EVEN = 1,
  ODD = 2
};

enum class UARTStopBits {
  ONE = 1,
  ONE_POINT_FIVE = 1.5,
  TWO = 2
};

enum class UARTFlowControl {
  NONE = 0,
  HARDWARE = 1,
  SOFTWARE = 2
};
