// ---------------------------------------------------------------------------
// main.ts — TypeHAL UI demo (flexbox + composed checkbox)
//
// The checkbox is built from primitives: <view id="ledBox"> (the square) +
// <text id="ledLabel"> (the label). The ledBox's .value tracks checked state.
// Bindings drive the visual appearance from .value — no special <check> element.
//
// GPIO4: increments counter   GPIO5: toggles checkbox
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

// Counter state + display bindings
screen.counter.value = 0;
ui.bind(screen.counter, 'color', () => (screen.counter.value % 2 === 0 ? 'limegreen' : 'orange'));
ui.bind(screen.counter, 'text', () => String(screen.counter.value));

// Button background driven by its pressed .value
ui.bind(screen.btn, 'background', () => (screen.btn.value > 0 ? 'limegreen' : 'darkgreen'));

// ── Composed checkbox ──────────────────────────────────────────────────────
// ledBox is the visual square. Its .value (0/1) is the checked state.
// Bindings drive background, border color, and the label text.
ui.bind(screen.ledBox, 'background', () => (screen.ledBox.value ? 'limegreen' : 'transparent'));
ui.bind(screen.ledBox, 'borderColor', () => (screen.ledBox.value ? 'limegreen' : '#808080'));

// GPIO5 toggles ledBox.value (auto-flips 0↔1)
screen.ledBox.onToggle(4);

// ── Inputs ─────────────────────────────────────────────────────────────────
// ui.watchPin(4, () => { screen.counter.value = screen.counter.value + 1; });

setInterval(() => {
  screen.counter.value = screen.counter.value + 1;
}, 2000);
