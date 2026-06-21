// ---------------------------------------------------------------------------
// main.ts — TypeHAL UI demo (red hello world, green bg, animated button)
//
// The canonical spec §4 trace, runnable on an ESP32 + ILI9341 TFT over SPI.
// Mounts the .ui.html tree, binds the button's background to a signal, and
// toggles the signal every second to exercise the 80ms transition animation.
// ---------------------------------------------------------------------------

import { ui } from '@typecad/ui';
import { screen } from './hello.ui.html';
import { Adafruit_ILI9341 } from '../lib/Adafruit_ILI9341/Adafruit_ILI9341';

// Mount the baked tree to the ILI9341 on SPI0. CS/DC/RST map to ESP32 pins.
// This single call drives: display.init (SPI reset + begin), the static
// __ui_nodes[] / __ui_trans[] tables, and the ui_tick(16) per-loop driver.
ui.mount(screen, {
  display: 'ili9341',
  bus: 'SPI',   // ESP32 default SPI instance
  cs: 5,    // GPIO15 — chip select
  dc: 21,     // GPIO2  — data/command
  rst: 22,    // GPIO4  — reset
});

// A reactive signal whose value toggles 0↔1 each second. When it changes,
// the ui.bind below marks the button's background dirty and arms the 80ms
// transition — the button lerps between dark gray (#404040) and light gray
// (#808080). This is the same reactive runtime + transition engine that a
// physical button press (onPress) will drive once that wiring lands.
const pressed = ui.signal(0);

ui.bind(screen.btn, 'background', () => (pressed() > 0 ? '#d9ff00' : '#00ff6a'));

// Physical button: GPIO4 drives the button's :pressed state. GPIO4 is a
// general-purpose input with interrupt support (unlike GPIO0 which is the
// strapping/BOOT pin). A 10k pullup to 3V3 + button to GND is the standard
// wiring. On falling edge (press), ui_on_press arms the background
// transition; on rising edge (release), ui_on_release re-arms it back.
screen.btn.onPress(4);
screen.btn.onRelease(4);

// Toggle the signal every 1000ms. setInterval lowers to the embedded async
// pump; each change re-triggers the transition.
let state = 0;
// setInterval(() => {
//   state = state === 0 ? 1 : 0;
//   pressed.set(state);
//   console.log(`${state}`);
// }, 1000);
