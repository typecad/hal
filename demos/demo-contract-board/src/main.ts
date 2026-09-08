// Custom-PCB firmware — contract-narrowed, Zephyr underneath.
//
// Every pin below is one the contract wires (see board.contract.json); the
// import would fail to compile for any pin the PCB left unconnected. Pins
// use the STM32 datasheet port notation, which is what the schematic shows.
// The contract wires no UART/USB, so the LED is the report channel.

import { PA5, PA0, PA1, GPIO, Time } from '@typecad/hal';

// PA5 — the contract's LED net (D1 + 1k series resistor).
const led = new GPIO(PA5, GPIO.OUTPUT);

// PA0 — the contract's button net (SW1, external 100k pull-up).
const button = new GPIO(PA0, GPIO.INPUT);

// PA1 — the contract's analog sensor header. ADC lowering needs per-pin
// channel data that devicetree does not carry, so the input reads digitally
// for now (high/low from the sensor's comparator stage).
const sensor = new GPIO(PA1, GPIO.INPUT);

while (true) {
  if (button.get() === true) {
    // Button pressed: report the sensor line — LED latches ON while the
    // comparator stage reads high, OFF while it reads low.
    led.set(sensor.get());
  } else {
    // Heartbeat: the LED toggles every second.
    led.toggle();
  }

  Time.sleep(1000);
}
