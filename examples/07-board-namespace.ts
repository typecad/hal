// ---------------------------------------------------------------------------
// Example 7 — Board Namespace (single import)
//
// Demonstrates the convenience `Board` object that aggregates all pins,
// peripherals, and metadata under one namespace.
// ---------------------------------------------------------------------------

import { Board } from '@typecad';

const serial = Board.UART0.begin(115200);
Board.LED.asOutput(false);

serial.println("Arduino Uno booted");
serial.println(`MCU: ${Board.definition.mcu}`);
serial.println("Flash: " + Board.definition.memory.flash + " bytes");

while (true) {
  const sensor = Board.A0.readAnalog();
  serial.println(sensor);
  Board.LED.toggle();
}
