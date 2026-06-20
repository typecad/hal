// ---------------------------------------------------------------------------
// main.ts — TypeHAL UI demo (red hello world, green bg, animated button)
//
// The canonical spec §4 trace, made runnable on an ESP32 + ILI9341 TFT over
// SPI. Mounts the .ui.html tree; the runtime header, static node table
// (green bg 0x0400, red fg 0xf800, greeting text), transition table (80ms
// button background), and the per-loop ui_tick(16) driver are all emitted.
//
// SCOPE NOTE: ui.bind() is recognized by the IR call-lowering but currently
// trips the semantic gate's Function.prototype.bind detector (a known gap to
// fix before bind is usable end-to-end). onPress/onRelease (GPIO edge → press)
// is also deferred (wiring plan Task F). This demo therefore mounts the tree
// and exercises the signal primitive; the transition animation wired to a
// physical press lands with those follow-ups.
// ---------------------------------------------------------------------------

import { ui } from '@typehal/ui';
import { screen } from './hello.ui.html';

// Mount the baked tree to the ILI9341 on SPI0. CS/DC/RST map to ESP32 pins.
// This single call drives: display.init (SPI reset + begin), the static
// __ui_nodes[] / __ui_trans[] tables, and the ui_tick(16) per-loop driver.
ui.mount(screen, {
  display: 'ili9341',
  bus: 'SPI0',
  cs: 15,    // GPIO15 — chip select
  dc: 2,     // GPIO2  — data/command
  rst: 4,    // GPIO4  — reset
});

// A reactive signal — lowers to a plain device variable. Demonstrates the
// signal primitive that ui.bind and onPress/onRelease will drive once their
// semantic-gate integration lands.
const counter = ui.signal(0);

setInterval(() => {
  counter.set(counter() + 1);
}, 1000);
