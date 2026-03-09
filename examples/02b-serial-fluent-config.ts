// ---------------------------------------------------------------------------
// Example 2b — Serial Fluent Configuration
//
// Demonstrates the fluent chainable configuration API for UART/Serial.
// Shows: Serial.config.baudRate().parity().dataBits().begin()
// ---------------------------------------------------------------------------

import { UART0 } from '@typecode';
import { UARTStopBits, UARTFlowControl, UARTParity } from '@typecode/core';

// Fluent configuration with all options
UART0.config
  .baudRate(115200)
  .dataBits(8)
  .parity(UARTParity.NONE)
  .stopBits(UARTStopBits.ONE)
  .flowControl(UARTFlowControl.NONE)
  .defaultTimeout(5000)  // 5 second default timeout for reads
  .begin();

// Simple configuration (just baud rate)
UART0.config
  .baudRate(9600)
  .begin();

UART0.println("Serial Fluent Config Example");
