// ---------------------------------------------------------------------------
// Example 2b — Serial Fluent Configuration
//
// Demonstrates the fluent chainable configuration API for UART/Serial.
// Shows: Serial.config.baudRate().parity().dataBits().begin()
// ---------------------------------------------------------------------------

import { Serial } from '@typecode/board-arduino-uno';
import { UARTParity, UARTStopBits, UARTFlowControl } from '@typecode/core';

// Fluent configuration with all options
Serial.config
  .baudRate(115200)
  .dataBits(8)
  .parity(UARTParity.NONE)
  .stopBits(UARTStopBits.ONE)
  .flowControl(UARTFlowControl.NONE)
  .defaultTimeout(5000)  // 5 second default timeout for reads
  .begin();

// Simple configuration (just baud rate)
Serial.config
  .baudRate(9600)
  .begin();

Serial.println("Serial Fluent Config Example");