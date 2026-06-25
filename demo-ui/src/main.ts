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
