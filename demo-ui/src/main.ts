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
// Hemisphere gauge: a needle pivoting at the bottom-center sweeps from left to
// right across the dome. The needle is a CONSTANT-LENGTH line — it rotates, it
// does not stretch — so both tip coordinates are needed. The draw callback is a
// flat sequence of ctx calls (no trig, no locals), so the tip point is computed
// in the setInterval with real Math.sin/cos and stored as runtime node state:
//   screen.gauge.value     = tip X
//   screen.gaugeTip.value  = tip Y
// The callback reads both and draws the needle between the pivot and the tip.

// Hemisphere gauge: the dome is the TOP HALF of a circle whose center sits on
// the bottom edge of the 160×100 canvas (y=100). The bottom half is outside the
// buffer, so it is naturally clipped — no manual cropping, no wraparound.
// Needle pivot is that same bottom-center point; length 78 sweeps the dome.
let gaugeAngle = 180;        // degrees, sweeps 180 (left) → 270 (up) → 360 (right)

ui.drawCanvas(screen.gauge, (ctx) => {
  ctx.fillScreen('#0a0a1a');
  // Dome: full circle centered on the bottom edge → only the top half shows.
  ctx.fillCircle(80, 100, 80, '#101030');
  ctx.circle(80, 100, 80, '#2a4a6a');
  // Flat base line across the bottom (the hemisphere's diameter).
  ctx.line(0, 99, 160, 99, '#2a4a6a');
  // Needle: constant-length line from the pivot (80,100) to the tip (.value).
  ctx.line(80, 100, screen.gauge.value, screen.gaugeTip.value, '#ff5577');
  // Hub over the pivot.
  ctx.fillCircle(80, 100, 4, '#ff5577');
});

// Drive the needle: advance the angle, compute the tip on the circle, write
// both coordinates into node .value for the draw callback to read next frame.
setInterval(() => {
  gaugeAngle = gaugeAngle + 3;
  if (gaugeAngle > 360) gaugeAngle = 180;
  const rad = gaugeAngle * 3.14 / 180;
  screen.gauge.value = 80 + Math.round(78 * Math.cos(rad));
  screen.gaugeTip.value = 100 + Math.round(78 * Math.sin(rad));
}, 60);
