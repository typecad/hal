// ---------------------------------------------------------------------------
// main.ts — BME688 Weather Station demo (mocked sensor)
//
// Exports sensor-reading signals that the UI template binds to. The sensor is
// mocked: values drift slowly around realistic baselines on a 2s timer. Swap
// the setInterval body for real I2C reads (see examples/05-i2c-sensor.ts) when
// hardware is connected.
//
// Values are integers to avoid the transpiler's double+string concatenation
// limitation (Math.floor returns double in the lowered C++; template literals
// with ${double_expr} don't compile).
// ---------------------------------------------------------------------------

import { ui } from '@typecad/ui';
import { screen } from './weather.ui.html';

ui.mount(screen);

// ── Mocked BME688 sensor readings (integer units) ───────────────────────────
export const temperature = ui.signal(22);   // °C
export const humidity = ui.signal(45);      // % RH
export const pressure = ui.signal(1013);    // hPa
export const gas = ui.signal(50);           // kΩ

// Simple PRNG (Math.random is not guaranteed on device).
let _seed = 12345;

// Poll the (mocked) sensor every 2 seconds.
setInterval(() => {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  const r1 = _seed / 0x7fffffff;
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  const r2 = _seed / 0x7fffffff;
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  const r3 = _seed / 0x7fffffff;
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  const r4 = _seed / 0x7fffffff;

  // Drift each value by a small random delta, clamped to realistic ranges.
  const newTemp = temperature() + (r1 > 0.5 ? 1 : -1);
  temperature.set(newTemp < -10 ? -10 : newTemp > 50 ? 50 : newTemp);
  const newHum = humidity() + (r2 > 0.5 ? 1 : -1);
  humidity.set(newHum < 0 ? 0 : newHum > 100 ? 100 : newHum);
  const newPres = pressure() + (r3 > 0.5 ? 1 : -1);
  pressure.set(newPres < 980 ? 980 : newPres > 1040 ? 1040 : newPres);
  const newGas = gas() + (r4 > 0.5 ? 2 : -2);
  gas.set(newGas < 10 ? 10 : newGas > 500 ? 500 : newGas);
}, 2000);

// ── Bindings: push sensor values to the display ─────────────────────────────
// Integer signals → template literals work (int + string is valid in the
// lowered C++, matching the pattern in demo-st/src/showcase.ui).

ui.bind(screen.tempText, 'text', () => `Temp: ${temperature()}`);
ui.bind(screen.tempBar, 'value', () => (temperature() + 10) * 100 / 60);

ui.bind(screen.humText, 'text', () => `Hum: ${humidity()}%`);
ui.bind(screen.humBar, 'value', () => humidity());

ui.bind(screen.presText, 'text', () => `Pres: ${pressure()}`);
ui.bind(screen.presBar, 'value', () => (pressure() - 980) * 100 / 60);

ui.bind(screen.gasText, 'text', () => `Gas: ${gas()}`);
ui.bind(screen.gasBar, 'value', () => (gas() - 10) * 100 / 490);

// ── Canvas gauge: live temperature bar ──────────────────────────────────────
ui.drawCanvas(screen.gauge, (ctx) => {
  ctx.fillScreen('#0d1117');
  // Background bar (dark blue, always — the marker shows the position).
  ctx.fillRect(0, 8, ctx.width, ctx.height - 16, '#1a3a5c');
  // White marker line at the current temperature position (-10..50 range).
  ctx.vline((temperature() + 10) * (ctx.width - 4) / 60 + 2, 4, ctx.height - 8, '#ffffff');
  // Temperature label.
  ctx.text(4, ctx.height - 12, `T:${temperature()}`, '#cccccc');
});
