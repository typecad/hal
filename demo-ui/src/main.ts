// ---------------------------------------------------------------------------
// main.ts — ESP32 DevKit blinky skeleton (cuttlefish, Arduino ESP32 core)
//
// Bare scaffold for upcoming UI-graphics work. No UI content yet — just a
// transpile-clean ESP32 skeleton that confirms the board/framework packages
// resolve and code generation targets the right architecture.
// ---------------------------------------------------------------------------

import { LED } from '@typecad/board-esp32-devkit';

// On-board LED on GPIO2 (the `LED` board alias).
const led = LED.asOutput();

function main(): void {
  console.log('--- demo-ui: ESP32 DevKit skeleton ---');
  led.high();
  console.log('led on');
  led.low();
  console.log('led off');
  console.log('done');
}

main();
