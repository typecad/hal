#pragma once

// ---------------------------------------------------------------------------
// @typecode/core — Memory placement decorators
//
// These are compile-time markers.  At runtime they are no-ops that attach
// metadata via Reflect; the transpiler reads the metadata when emitting C++.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Memory region enum
// ---------------------------------------------------------------------------
enum class MemoryRegion {
  SRAM,
  FLASH,
  EEPROM,
  _RTC,
  DMA,
  _EXTERNAL
};
