// ---------------------------------------------------------------------------
// Example 7 — Board Namespace (single import)
//
// Demonstrates the convenience `Board` object that aggregates all pins,
// peripherals, and metadata under one namespace.
// ---------------------------------------------------------------------------

import { Board, LOW } from '@typecode';

Board.UART0.config.baudRate(115200).begin();
Board.LED.config.output.initial(LOW);

Board.UART0.println("Arduino Uno booted");
Board.UART0.println("MCU: " + Board.definition.mcu);
Board.UART0.println("Flash: " + Board.definition.memory.flash + " bytes");

while (true) {
  const sensor = Board.A0.read();
  Board.UART0.println(sensor);
  Board.LED.toggle();
}