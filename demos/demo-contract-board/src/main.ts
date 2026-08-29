// Custom-PCB firmware — contract-narrowed, Zephyr underneath.
//
// Every pin below is one the contract wires (see board.contract.json); the
// import would fail to compile for any pin the PCB left unconnected. Pins
// use the STM32 datasheet port notation, which is what the schematic shows.

import { PA5, PA0, PA1 } from '@typecad/board';
import { GPIO, ADCChannel, Time } from '@typecad/hal';

// PA5 — the contract's LED net (D1 + 1k series resistor).
const led = new GPIO(PA5, GPIO.OUTPUT);

// PA0 — the contract's button net (SW1, external 100k pull-up).
const button = new GPIO(PA0, GPIO.INPUT);

// PA1 — the contract's analog sensor header (raw counts at the chip's
// 12-bit resolution — no 0–1023 normalization).
const sensor = new ADCChannel(PA1);

let beats: number = 0;

while (true) {
  led.toggle();

  if (button.get() === true) {
    // Button pressed: report the sensor reading instead of the heartbeat.
    console.log(`sensor: ${sensor.read()}`);
  } else {
    beats = beats + 1;
    console.log(`beat ${beats}`);
  }

  Time.sleep(1000);
}
