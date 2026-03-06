// ---------------------------------------------------------------------------
// Example 7 — Board Namespace (single import)
//
// Demonstrates the convenience `Board` object that aggregates all pins,
// peripherals, and metadata under one namespace.
// ---------------------------------------------------------------------------

import { Board, LOW } from '@typecode';

Board.Serial.initialize({ baudRate: 115200 });
Board.LED.config.output.initial(LOW);

Board.Serial.println("Arduino Uno booted");
Board.Serial.println("MCU: " + Board.definition.mcu);
Board.Serial.println("Flash: " + Board.definition.memory.flash + " bytes");

while (true) {
  const sensor = Board.A0.read();
  Board.Serial.println(sensor);
  Board.LED.toggle();
}