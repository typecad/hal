// ---------------------------------------------------------------------------
// main.ts — cuttlefish UI capability showcase
//
// Wires the interactive elements in showcase.ui.html. Static elements (the
// typography/box/flex/layout showcase screens) need no TS — they render from
// HTML+CSS alone. Only stateful/interactive elements are wired here.
// ---------------------------------------------------------------------------

import { ui } from '@typecad/ui';
import { screen } from './showcase.ui.html';
import { Adafruit_ILI9341 } from '../lib/Adafruit_ILI9341/Adafruit_ILI9341';

ui.mount(screen, {
  display: 'ili9341',
  bus: 'SPI',
  cs: 5,
  dc: 21,
  rst: 22,
});

// ── Forms screen: button counter + dynamic label ───────────────────────────
// The count lives in element state (screen.formBtnCount.value), the same
// pattern as the original demo's counter — element .value is mutable device
// state, so this avoids a local `let` the ownership analyzer flags as const.
// The label text is authored in the HTML as `taps: {count}` — the {count}
// interpolation compiles to an implicit text binding (both runtime + preview),
// so this TS only owns the signal state. (Svelte-like markup-driven authoring;
// compare to the older ui.bind(screen.formBtnCount, 'text', ...) form.)
export const count = ui.signal(0);
screen.formBtn.onClick(() => {
  count.set(count() + 1);
});

// ── Forms screen: progress 0→100 loop ──────────────────────────────────────
screen.formProg.value = 0;
setInterval(() => {
  screen.formProg.value = (screen.formProg.value + 5) % 105;
}, 400);

// ── Forms screen: range + inputs log on change ─────────────────────────────
screen.formRange1.onChange(() => {
  console.log('volume:', screen.formRange1.value);
});
screen.formName.onChange(() => {
  console.log('name:', screen.formName.text);
});
screen.formAge.onChange(() => {
  console.log('age:', screen.formAge.text);
});

// ── Lists screen: virtualized list ─────────────────────────────────────────
ui.bindList(
  screen.demoList,
  () => 40,
  (i: number) => `Item ${i + 1}`,
  (i: number) => { console.log('tapped:', i); },
);

// ── Media screen: canvas drawing every primitive once ─────────────────────
// A flat sequence of ctx calls (no trig/locals) so it lowers cleanly.
ui.drawCanvas(screen.demoCanvas, (ctx) => {
  ctx.fillScreen('#0a0a1a');
  // filled + outlined rectangles (fillRect / rect)
  ctx.fillRect(8, 8, 40, 24, '#1a3a5c');
  ctx.rect(8, 8, 40, 24, '#3399ff');
  // rounded rects (filled + outlined)
  ctx.fillRoundRect(56, 8, 40, 24, 6, '#1a6b3c');
  ctx.roundRect(56, 8, 40, 24, 6, '#4ade80');
  // circles (filled + outlined)
  ctx.fillCircle(120, 20, 14, '#5c1a1a');
  ctx.circle(120, 20, 14, '#ff5577');
  // lines: diagonal + horizontal + vertical
  ctx.line(150, 6, 190, 40, '#ffff33');
  ctx.hline(8, 48, 180, '#2a4a6a');
  ctx.vline(196, 8, 40, '#2a4a6a');
  // pixel scatter
  ctx.drawPixel(10, 70, '#ffffff');
  ctx.drawPixel(14, 72, '#ffffff');
  ctx.drawPixel(18, 70, '#ffffff');
  ctx.drawPixel(22, 74, '#ffffff');
  ctx.drawPixel(26, 70, '#ffffff');
  // text
  ctx.text(8, 100, 'canvas primitives', '#cccccc');
});

// ── Keyboard screen: input opens the custom keyboard ───────────────────────
// The default alpha keyboard is used; the <keyboard id="kbAlpha"> template in
// the HTML is parsed and registered automatically. Reading .text after commit.
screen.kbInput.onChange(() => {
  console.log('message:', screen.kbInput.text);
});
