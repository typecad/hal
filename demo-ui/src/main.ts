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

// Sparkline: a scrolling history of a noisy value.
const sparkHist: number[] = [];
let sparkValue = 30;
ui.drawCanvas(screen.spark, (ctx) => {
  ctx.fillScreen('#0a0a1a');
  // Plot each sample as a vertical line from the baseline to its height.
  ctx.line(0, ctx.height - 4, ctx.width, ctx.height - 4, '#2a2a4a');
  // 60 samples across the 280px width → 4px per column (precomputed below).
  // The body is a flat sequence of ctx calls (no loops); the per-sample
  // values are read from sparkHist[] which is mutated in the interval below.
  ctx.line(0 * 4, sparkHist[0], 0 * 4, sparkHist[0], '#00e0ff');
  ctx.line(1 * 4, sparkHist[1], 1 * 4, sparkHist[1], '#00e0ff');
  ctx.line(2 * 4, sparkHist[2], 2 * 4, sparkHist[2], '#00e0ff');
  ctx.line(3 * 4, sparkHist[3], 3 * 4, sparkHist[3], '#00e0ff');
  ctx.line(4 * 4, sparkHist[4], 4 * 4, sparkHist[4], '#00e0ff');
  ctx.line(5 * 4, sparkHist[5], 5 * 4, sparkHist[5], '#00e0ff');
  ctx.line(6 * 4, sparkHist[6], 6 * 4, sparkHist[6], '#00e0ff');
  ctx.line(7 * 4, sparkHist[7], 7 * 4, sparkHist[7], '#00e0ff');
  ctx.line(8 * 4, sparkHist[8], 8 * 4, sparkHist[8], '#00e0ff');
  ctx.line(9 * 4, sparkHist[9], 9 * 4, sparkHist[9], '#00e0ff');
});

// Analog gauge: an arc dial with a sweeping needle and a value readout.
let gaugeAngle = 0;
ui.drawCanvas(screen.gauge, (ctx) => {
  ctx.fillScreen('#0a0a1a');
  // Dial rim + tick marks drawn from fixed geometry.
  ctx.circle(ctx.width / 2, ctx.height / 2, 50, '#2a4a6a');
  ctx.fillCircle(ctx.width / 2, ctx.height / 2, 48, '#101030');
  // Needle: a line from center toward the rim, angle set by gaugeAngle.
  ctx.line(60, 60, gaugeAngle, gaugeAngle, '#ff5577');
  // Hub.
  ctx.fillCircle(ctx.width / 2, ctx.height / 2, 4, '#ff5577');
});

// Drive both canvases: push a new sparkline sample and sweep the gauge.
setInterval(() => {
  // Random-ish walk around 30, clamped to the canvas height.
  sparkValue = sparkValue + ((sparkValue * 7 + 13) % 11) - 5;
  if (sparkValue < 6) sparkValue = 6;
  if (sparkValue > 54) sparkValue = 54;
  sparkHist.push(sparkValue);
  if (sparkHist.length > 10) sparkHist.shift();
  // Sweep the gauge needle 0..120 (device coords recompute the tip per frame).
  gaugeAngle = (gaugeAngle + 8) % 120;
}, 200);
