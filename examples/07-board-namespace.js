"use strict";
// ---------------------------------------------------------------------------
// Example 7 — Board Namespace (single import)
//
// Demonstrates the convenience `Board` object that aggregates all pins,
// peripherals, and metadata under one namespace.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
const board_1 = require("../code/board-arduino-uno/board");
board_1.Board.Serial.initialize({ baudRate: 115200 });
board_1.Board.LED.asOutput();
board_1.Board.Serial.println("Arduino Uno booted");
board_1.Board.Serial.println("MCU: " + board_1.Board.definition.mcu);
board_1.Board.Serial.println("Flash: " + board_1.Board.definition.memory.flash + " bytes");
while (true) {
    const sensor = board_1.Board.A0.read();
    board_1.Board.Serial.println(sensor);
    board_1.Board.LED.toggle();
}
