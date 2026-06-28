// ---------------------------------------------------------------------------
// main.ts — TypeHAL UI demo (built-in elements)
//
// <check> and <select> are self-contained: onClick auto-toggles/cycles .value
// and the visual updates automatically. The author only reads .value.
// ---------------------------------------------------------------------------

import { ui } from '@typecad/ui';
import { screen } from './hello.ui.html';
import { Adafruit_ILI9341 } from '../lib/Adafruit_ILI9341/Adafruit_ILI9341';

ui.mount(screen, {
  display: 'ili9341',
  bus: 'SPI',
  cs: 5,
  dc: 21,
  rst: 22,
});

// Counter
screen.counter.value = 0;
ui.bind(screen.counter, 'color', () => (screen.counter.value % 2 === 0 ? 'limegreen' : 'orange'));
ui.bind(screen.counter, 'text', () => String(screen.counter.value));
ui.bind(screen.evenBranch, 'visible', () => screen.counter.value % 2 === 0);
ui.bind(screen.oddBranch, 'visible', () => screen.counter.value % 2 !== 0);

// Button: :pressed CSS handles the momentary visual; tap increments counter.
screen.btn.onClick(() => {
  screen.counter.value = screen.counter.value + 1;
});

// <check> and <select> are auto-wired — no onClick/bindings needed.
// The author can read .value:
//   const isOn = screen.led.value;     // 0 or 1
//   const mode = screen.mode.value;    // 0, 1, or 2

// Progress bar: animate 0-100 in a loop
screen.progress.value = 0;
setInterval(() => {
  screen.progress.value = (screen.progress.value + 5) % 105;
}, 500);

// <range> is drag-driven: dragging the thumb (or writing .value) updates it.
// Read .value to get the current slider position (between min and max).
screen.points.onClick(() => {
  console.log('points:', screen.points.value);
});

// <input>: tap to open the on-screen keyboard. Read .text for the value.
// onChange fires after the keyboard commits (OK key).
screen.ssid.onChange(() => {
  console.log('ssid:', screen.ssid.text);
});
screen.port.onChange(() => {
  console.log('port:', screen.port.text);
});

// <list>: virtualized scrollable list bound to callbacks.
ui.bindList(screen.deviceList,
  () => 50,                    // 50 items
  (i: number) => `Device ${i + 1}`,  // item text
  (i: number) => { console.log('tapped:', i); }  // tap callback
);

// <canvas>: user-drawn graphics via the display shim primitives.
// ui.drawCanvas runs every frame; mutate state and the canvas follows.
// Coordinates are canvas-relative ((0,0) = element top-left); colors are CSS
// strings resolved to RGB565 at build time.
//
// Live state is stored on the canvas elements' own .value (read inside the
// callback as runtime node state, the same pattern onClick handlers use), so
// the draw callbacks don't reference author variables directly.

// A bouncing bar: .value holds the current X position (0..250).
screen.spark.value = 0;
ui.drawCanvas(screen.spark, (ctx) => {
  ctx.fillScreen('#0a0a1a');
  // Baseline.
  ctx.line(0, ctx.height - 4, ctx.width, ctx.height - 4, '#2a2a4a');
  // A vertical bar whose X comes from the canvas node's own .value.
  ctx.fillRect(screen.spark.value, 4, 20, ctx.height - 12, '#00e0ff');
});

// Analog gauge: .value holds the needle height (0..40).
screen.gauge.value = 0;
ui.drawCanvas(screen.gauge, (ctx) => {
  ctx.fillScreen('#0a0a1a');
  // Dial rim + face, centered (canvas is 120×120 → center 60,60).
  ctx.circle(60, 60, 50, '#2a4a6a');
  ctx.fillCircle(60, 60, 48, '#101030');
  // Needle: from center up to (60, 60 - .value). As .value grows 0..40 the
  // needle rises from center toward the top of the dial.
  ctx.line(60, 60, 60, 60 - screen.gauge.value, '#ff5577');
  // Hub over the pivot.
  ctx.fillCircle(60, 60, 4, '#ff5577');
});

// Drive both canvases by writing their .value. The draw callbacks re-read it.
let sparkDir = 1;
setInterval(() => {
  // Bounce the bar back and forth across the 280px width.
  screen.spark.value = screen.spark.value + sparkDir * 4;
  if (screen.spark.value > 250) { screen.spark.value = 250; sparkDir = -1; }
  if (screen.spark.value < 0) { screen.spark.value = 0; sparkDir = 1; }
  // Sweep the gauge needle 0..40.
  screen.gauge.value = (screen.gauge.value + 2) % 41;
}, 120);
