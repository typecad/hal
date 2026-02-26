#pragma once

// ---------------------------------------------------------------------------
// @typecode/core — SPI bus interface
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
enum class SPIClockPolarity {
  _LOW = 0,
  _HIGH = 1
};

enum class SPIClockPhase {
  LEADING = 0,
  TRAILING = 1
};

enum class SPIBitOrder {
  MSB = 0,
  LSB = 1
};

enum class SPIMode {
  MODE_0 = 0,
  MODE_1 = 1,
  MODE_2 = 2,
  MODE_3 = 3
};
