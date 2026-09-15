import { describe, it, expect } from 'vitest';
import { zephyrDisplayApiAdapter } from '../../../../packages/framework-zephyr/src/display/ui-adapter-native';
import { zephyrDisplayAdapterGenerator } from '../../../../packages/framework-zephyr/src/display/ui-adapter';
import {
  ZEPHYR_DISPLAY_PROFILES,
  profileFromEmittedSource,
  transportFor,
  dbiHostFor,
} from '../../../../packages/framework-zephyr/src/display/profiles';

const NATIVE = ZEPHYR_DISPLAY_PROFILES['ili9341-zephyr-display'];
const NATIVE_ST = ZEPHYR_DISPLAY_PROFILES['st7796-zephyr-display'];

describe('zephyrDisplayApiAdapter (zephyr-display transport)', () => {
  const code = zephyrDisplayApiAdapter(NATIVE);

  it('speaks the display API, not the panel registers', () => {
    expect(code.functions).toContain('display_write(__tc_zd_dev');
    expect(code.functions).toContain('display_get_capabilities(__tc_zd_dev, &__tc_zd_caps)');
    expect(code.functions).toContain('display_blanking_off(__tc_zd_dev)');
    // No direct SPI/GPIO panel transport and no Adafruit init table — the
    // in-tree driver owns those.
    expect(code.functions).not.toContain('spi_write(');
    expect(code.functions).not.toContain('GPIO_DT_SPEC_GET(DT_NODELABEL(spi2), cs_gpios)');
    expect(code.functions).not.toContain('__tc_pnl_init_seq');
    expect(code.functions).not.toContain('__tc_pnl_cmd(');
  });

  it('resolves the panel through the profile DT nodelabel', () => {
    expect(code.declaration).toContain('DEVICE_DT_GET(DT_NODELABEL(display0))');
  });

  it('carries the profile marker for toolchain recovery', () => {
    expect(code.includes).toContain('// typecad-display-profile: ili9341-zephyr-display');
  });

  it('handles panel pixel fixups via the fixup chain', () => {
    // Byte swap is data-driven from display_get_capabilities at init.
    expect(code.functions).toContain('PIXEL_FORMAT_RGB_565X');
    expect(code.functions).toContain('__tc_zd_fixup_run');
    // The ILI9341 profile needs no channel swap — fixup is passthrough
    // unless the panel reports 565X.
    expect(code.declaration).toContain('static const bool __tc_zd_rb = false;');
  });

  it('batches solid fills and pixel streams through the reused block buffer', () => {
    expect(code.declaration).toContain('static uint16_t __tc_zd_block[320 * __TC_FILL_ROWS];');
    expect(code.declaration).toContain('#define __TC_FILL_ROWS 8');
    // The hot fill/write path allocates nothing — it draws from the static
    // block buffer (malloc appears only in the canvas lifecycle section).
    const fillStart = code.functions.indexOf('__tc_op_fillRect');
    const fillEnd = code.functions.indexOf('__tc_op_width');
    const fillBody = code.functions.slice(fillStart, fillEnd);
    expect(fillBody).not.toContain('malloc');
    expect(fillBody).toContain('__tc_zd_block');
  });

  it('keeps the full UI runtime contract (canvas + target surface)', () => {
    expect(code.functions).toContain('display_createCanvas');
    expect(code.functions).toContain('display_createCanvasPsram');
    expect(code.functions).toContain('display_canvasBuffer');
    expect(code.functions).toContain('display_targetDrawRGBBitmap');
    expect(code.functions).toContain('display_targetPrint');
    expect(code.functions).toContain('display_setAddrWindow');
    expect(code.functions).toContain('display_writePixels');
    expect(code.functions).toContain('__tc_display_ops');
  });

  it('reports effective geometry from the profile (not caps) for the pre-main GFX object', () => {
    expect(code.functions).toContain('static int16_t __tc_op_width(void* /*ctx*/) { return 320; }');
    expect(code.functions).toContain('static int16_t __tc_op_height(void* /*ctx*/) { return 240; }');
  });

  it('cross-checks the panel capabilities at init and surfaces mismatches', () => {
    // Compared against the DT node's NATIVE geometry (a MADCTL-rotated panel
    // legitimately reports native portrait dims while the UI renders in the
    // rotated effective space).
    expect(code.functions).toContain('DT node carries 320x240');
    expect(code.functions).toContain('device not ready');
  });
});

describe('st7796-zephyr-display (clone panel, local CS-hold host)', () => {
  const code = zephyrDisplayApiAdapter(NATIVE_ST);

  it('emits the app-local CS-holding mipi-dbi host', () => {
    // The host device at the bridge node implements the five mipi_dbi API
    // callbacks; the in-tree sitronix,st7796s driver binds on top of it.
    expect(code.includes).toContain('#include <zephyr/drivers/mipi_dbi.h>');
    expect(code.functions).toContain('DEVICE_DT_DEFINE(DT_NODELABEL(mipi_dbi)');
    expect(code.functions).toContain('static DEVICE_API(mipi_dbi, __tc_dbi_api)');
    expect(code.functions).toContain('__tc_dbi_command_write');
    expect(code.functions).toContain('__tc_dbi_write_display');
    // st7796s calls mipi_dbi_reset(host, 100) at init — the host must pulse it.
    expect(code.functions).toContain('__tc_dbi_reset');
  });

  it('holds CS across each command+data burst (GPIO-managed)', () => {
    const start = code.functions.indexOf('__tc_dbi_command_write');
    const end = code.functions.indexOf('__tc_dbi_command_read');
    const body = code.functions.slice(start, end);
    // One assert at burst start, one release at burst end — no CS touch
    // between the command and data writes.
    expect(body).toContain('gpio_pin_set_dt(cs, 1);');
    expect(body).toContain('gpio_pin_set_dt(cs, 0);');
    // The SPI core must not manage CS mid-burst — and in 4.4 the gate is the
    // cs_is_gpio FLAG, not the port pointer (leaving it set with a nulled
    // port crashed the first panel init on hardware).
    expect(body).toContain('sc.cs.cs_is_gpio = false;');
    expect(body).toContain('sc.cs.gpio.port = nullptr;');
  });

  it('stages display writes through the SRAM bounce buffer', () => {
    expect(code.functions).toContain('static uint8_t __tc_dbi_bounce[4096];');
  });

  it('does NOT channel-swap R/B in 16-bit mode (the 18-bit BGR finding does not transfer)', () => {
    // Hardware ladder on the clone: byte swap only. With the channel swap
    // added, blue accents read brown / whites yellow — one R/B swap too many.
    expect(code.declaration).toContain('static const bool __tc_zd_rb = false;');
    expect(code.functions).toContain('__tc_zd_fix_pixel');
  });

  it('drives the panel through the display API, not spi_write directly', () => {
    // The only spi_write calls live inside the host callbacks — the adapter
    // proper never touches the bus.
    expect(code.functions).toContain('display_write(__tc_zd_dev');
    expect(code.functions).not.toContain('__tc_pnl_init_seq');
  });
});

describe('dbiHost routing', () => {
  it("defaults clone-ST77xx (st7796s) to the local CS-hold host, ili9341 to the stock bridge", () => {
    expect(dbiHostFor(NATIVE_ST)).toBe('local-hold-cs');
    expect(dbiHostFor(NATIVE)).toBe('spi-bridge');
    // Explicit override wins.
    expect(dbiHostFor({ ...NATIVE, dbiHost: 'local-hold-cs' })).toBe('local-hold-cs');
  });

  it("the st7796 native profile routes through the adapter generator", () => {
    const code = zephyrDisplayAdapterGenerator({ driver: 'st7796-zephyr-display' } as never);
    expect(code).toBeTruthy();
    expect(code!.functions).toContain('__tc_dbi_api');
    expect(code!.functions).toContain('display_write(__tc_zd_dev');
  });
});

describe('transport routing (zephyrDisplayAdapterGenerator)', () => {
  const resolve = (driver: string) => zephyrDisplayAdapterGenerator({
    driver,
  } as never);

  it("routes 'zephyr-display' profiles to the display-API adapter", () => {
    const code = resolve('ili9341-zephyr-display');
    expect(code).toBeTruthy();
    expect(code!.functions).toContain('display_write(__tc_zd_dev');
    expect(code!.functions).not.toContain('spi_write(');
  });

  it("keeps direct-spi profiles (default) on the hardware-verified path", () => {
    const code = resolve('st7796-zephyr');
    expect(code).toBeTruthy();
    expect(code!.functions).toContain('spi_write(');
    expect(code!.functions).not.toContain('display_write(__tc_zd_dev');
  });

  it('still declines mono and unknown drivers', () => {
    expect(resolve('ssd1306-zephyr')).toBeUndefined();
    expect(resolve('nope-zephyr')).toBeUndefined();
  });
});

describe('transport field plumbing', () => {
  it("defaults profiles without a transport to 'direct-spi'", () => {
    expect(transportFor(ZEPHYR_DISPLAY_PROFILES['st7796-zephyr'])).toBe('direct-spi');
    expect(transportFor(ZEPHYR_DISPLAY_PROFILES['ili9341-zephyr'])).toBe('direct-spi');
    expect(transportFor(NATIVE)).toBe('zephyr-display');
  });

  it('recovers the emitting profile from the source marker', () => {
    // UI adapter marker (includes section) and gfx runtime marker both carry
    // the driver id the toolchain keys on.
    const ui = zephyrDisplayApiAdapter(NATIVE);
    expect(profileFromEmittedSource(`${ui.includes}\nvoid f(){}`)).toBe(NATIVE);
    const gfxSrc = '// typecad-display-profile: st7796-zephyr\nstatic int x;';
    expect(profileFromEmittedSource(gfxSrc)).toBe(ZEPHYR_DISPLAY_PROFILES['st7796-zephyr']);
    expect(profileFromEmittedSource('void f(){}')).toBeUndefined();
  });
});
