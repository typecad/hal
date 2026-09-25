import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveKconfigFragments } from '../../../../packages/framework-zephyr/src/dt-config/kconfig';
import { scaffoldZephyrProject } from '../../../../packages/framework-zephyr/src/toolchain/scaffold';

describe('resolveKconfigFragments', () => {
  it('always includes GPIO + core C++ symbols', () => {
    const m = resolveKconfigFragments({}, false);
    expect(m.get('CONFIG_GPIO')).toBe('y');
    expect(m.get('CONFIG_CPP')).toBe('y');
    expect(m.get('CONFIG_NEWLIB_LIBC')).toBe('y');
    expect(m.get('CONFIG_REQUIRES_FULL_LIBCPP')).toBe('y');
    expect(m.get('CONFIG_STD_CPP14')).toBe('y');
  });

  it('gates driver symbols on usage flags', () => {
    const m = resolveKconfigFragments({ usesAdc: true, usesSpi: true }, false);
    expect(m.get('CONFIG_ADC')).toBe('y');
    expect(m.get('CONFIG_SPI')).toBe('y');
    expect(m.has('CONFIG_I2C')).toBe(false);  // not used
  });

  it('gates CONFIG_I2C_TARGET on the responder flag (and only it)', () => {
    const resp = resolveKconfigFragments({ usesI2cTarget: true }, false);
    expect(resp.get('CONFIG_I2C_TARGET')).toBe('y');
    // Master-only I2C must not drag the target subsystem in.
    const master = resolveKconfigFragments({ usesI2c: true }, false);
    expect(master.has('CONFIG_I2C_TARGET')).toBe(false);
    expect(master.get('CONFIG_I2C')).toBe('y');
  });

  it('bumps SYSTEM_WORKQUEUE_STACK_SIZE (workqueue itself is unconditional)', () => {
    const m = resolveKconfigFragments({}, false);
    // CONFIG_SYSTEM_WORKQUEUE is not a real Zephyr symbol (the workqueue is
    // always built); only the stack size is a real knob.
    expect(m.has('CONFIG_SYSTEM_WORKQUEUE')).toBe(false);
    expect(m.get('CONFIG_SYSTEM_WORKQUEUE_STACK_SIZE')).toBe('8192');
  });

  it('enables DISPLAY when usesDisplay', () => {
    const m = resolveKconfigFragments({ usesDisplay: true }, false);
    expect(m.get('CONFIG_DISPLAY')).toBe('y');
  });

  it('force-disables the in-tree display drivers on the direct-spi transport (default)', () => {
    const m = resolveKconfigFragments({ usesDisplay: true }, false);
    expect(m.get('CONFIG_MIPI_DBI_SPI')).toBe('n');
    expect(m.get('CONFIG_ILI9341')).toBe('n');
    expect(m.get('CONFIG_ST7796S')).toBe('n');
  });

  it('binds the in-tree drivers on the zephyr-display transport', () => {
    const m = resolveKconfigFragments(
      { usesDisplay: true, displayTransport: 'zephyr-display', displayController: 'ili9341' },
      false,
    );
    expect(m.get('CONFIG_MIPI_DBI_SPI')).toBe('y');
    expect(m.get('CONFIG_ILI9341')).toBe('y');
    // The =n disables from the direct path must not leak into prj.conf (an
    // explicit =n would override the DT-driven default).
    expect(m.has('CONFIG_ST7796S')).toBe(false);
    // DMA still on — the display overlay pairs it with dma-enabled on the bus.
    expect(m.get('CONFIG_DMA')).toBe('y');
  });

  it('st7796s native keeps the stock bridge off (app-local CS-hold host) + binds the panel driver', () => {
    const m = resolveKconfigFragments(
      { usesDisplay: true, displayTransport: 'zephyr-display', displayController: 'st7796s' },
      false,
    );
    // The panel driver is in-tree; the mipi-dbi host is the adapter-emitted
    // local CS-holding one (the stock bridge scrambles clone panels).
    expect(m.get('CONFIG_ST7796S')).toBe('y');
    expect(m.get('CONFIG_MIPI_DBI_SPI')).toBe('n');
    expect(m.has('CONFIG_ILI9341')).toBe(false);
  });

  it('routes touch to the right bus driver per controller', () => {
    // Default/FT6336U: the input subsystem — the in-tree focaltech driver
    // owns the controller (polling mode); the adapter listens for events.
    const ft = resolveKconfigFragments({ usesTouch: true }, false);
    expect(ft.get('CONFIG_INPUT')).toBe('y');
    expect(ft.get('CONFIG_INPUT_FT5336')).toBe('y');
    expect(ft.get('CONFIG_I2C')).toBe('y');
    // XPT2046 rides the display's SPI bus — the raw adapter owns the chip
    // (the in-tree driver's DT scaling would double-apply calibration).
    const xpt = resolveKconfigFragments({ usesTouch: true, touchController: 'xpt2046' }, false);
    expect(xpt.get('CONFIG_SPI')).toBe('y');
    expect(xpt.has('CONFIG_I2C')).toBe(false);
    expect(xpt.has('CONFIG_INPUT')).toBe(false);
  });

  it('enables the "next" USB device stack when usesUsb', () => {
    const m = resolveKconfigFragments({ usesUsb: true }, false);
    // Zephyr 4.3 symbol names (subsys/usb/device_next/Kconfig): the next
    // stack is USB_DEVICE_STACK_NEXT (USB_DEVICE_STACK is the deprecated
    // legacy one) and the class is USBD_CDC_ACM_CLASS (USBD_ prefix).
    expect(m.get('CONFIG_USB_DEVICE_STACK_NEXT')).toBe('y');
    expect(m.get('CONFIG_USBD_CDC_ACM_CLASS')).toBe('y');
    // usb.connected() polls DTR through line ctrl.
    expect(m.get('CONFIG_UART_LINE_CTRL')).toBe('y');
    expect(m.get('CONFIG_SERIAL')).toBe('y');
    // A program that never touches USB pulls in none of it.
    const off = resolveKconfigFragments({}, false);
    expect(off.has('CONFIG_USB_DEVICE_STACK_NEXT')).toBe(false);
    expect(off.has('CONFIG_USBD_CDC_ACM_CLASS')).toBe(false);
  });

  it('debug adds CONFIG_DEBUG + CONFIG_DEBUG_OPTIMIZATIONS', () => {
    const m = resolveKconfigFragments({}, true);
    expect(m.get('CONFIG_DEBUG')).toBe('y');
    expect(m.get('CONFIG_DEBUG_OPTIMIZATIONS')).toBe('y');
  });

  it('Ble block when usesBle', () => {
    const m = resolveKconfigFragments({ usesBle: true }, false);
    expect(m.get('CONFIG_BT')).toBe('y');
    expect(m.get('CONFIG_BT_PERIPHERAL')).toBe('y');
  });

  it('enables WiFi + networking symbols when usesWifi', () => {
    const m = resolveKconfigFragments({ usesWifi: true }, false);
    expect(m.get('CONFIG_NETWORKING')).toBe('y');   // master switch
    expect(m.get('CONFIG_WIFI')).toBe('y');
    expect(m.get('CONFIG_WIFI_ESP32')).toBe('y');
    expect(m.get('CONFIG_NET_CONNECTION_MANAGER')).toBe('y');
    expect(m.get('CONFIG_NET_MGMT_EVENT')).toBe('y');
    expect(m.get('CONFIG_NET_DHCPV4')).toBe('y');
    // NOT NET_CONFIG_SETTINGS: its boot-time net_config_init blocks ~30s
    // (NET_CONFIG_INIT_TIMEOUT) waiting for an iface the shim brings up itself,
    // and dual-managing that iface crashes the driver.
    expect(m.has('CONFIG_NET_CONFIG_SETTINGS')).toBe(false);
    // No TX power Kconfig symbol: ESP_PHY_MAX_WIFI_TX_POWER lives in the
    // ESP-IDF components/esp_phy/Kconfig, which the Zephyr module integration
    // does not source — assigning it would abort the build. wifi.set_tx_power
    // programs the radio at runtime via esp_wifi_set_max_tx_power instead.
    expect(m.has('CONFIG_ESP_PHY_MAX_WIFI_TX_POWER')).toBe(false);
    expect(m.has('CONFIG_ESP32_PHY_MAX_WIFI_TX_POWER')).toBe(false);
    // Networking stack sizes mirror the official Zephyr WiFi samples
    // (samples/net/wifi/*). The defaults are too small (NET_MGMT_EVENT_STACK_SIZE
    // is 768 on non-x86) and the WiFi connect event handlers run on that stack —
    // overflowing it freezes the chip mid-connect with no panic dump.
    expect(m.get('CONFIG_NET_MGMT_EVENT_STACK_SIZE')).toBe('4096');
    expect(m.get('CONFIG_NET_TX_STACK_SIZE')).toBe('2048');
    expect(m.get('CONFIG_NET_RX_STACK_SIZE')).toBe('2048');
    expect(m.get('CONFIG_MAIN_STACK_SIZE')).toBe('5200');
  });

  it('keeps the default MAIN_STACK_SIZE (4096) when WiFi is not used', () => {
    const m = resolveKconfigFragments({ usesAdc: true }, false);
    expect(m.get('CONFIG_MAIN_STACK_SIZE')).toBe('4096');
    // Non-WiFi builds set no networking stack sizes.
    expect(m.has('CONFIG_NET_MGMT_EVENT_STACK_SIZE')).toBe(false);
  });

  it('enables the random + entropy generators when usesRandom', () => {
    const m = resolveKconfigFragments({ usesRandom: true }, false);
    expect(m.get('CONFIG_ENTROPY_GENERATOR')).toBe('y');
    // No phantom umbrella symbol (assigning CONFIG_RANDOM_GENERATOR —
    // undefined in Zephyr 4.x — aborts the build); RNG-less boards fall back
    // via TEST_RANDOM_GENERATOR.
    expect(m.get('CONFIG_TEST_RANDOM_GENERATOR')).toBe('y');
    expect(m.has('CONFIG_RANDOM_GENERATOR')).toBe(false);
  });

  it('does NOT enable random symbols when usesRandom is absent', () => {
    const m = resolveKconfigFragments({ usesAdc: true }, false);
    expect(m.has('CONFIG_TEST_RANDOM_GENERATOR')).toBe(false);
    expect(m.has('CONFIG_ENTROPY_GENERATOR')).toBe(false);
  });
});

// The power HAL is removed; nothing in the scaffold emits CONFIG_PM anymore
// (a raw k_sleep in user code is Time.sleep's domain, not PM policy).
describe('scaffoldZephyrProject — CONFIG_PM never emitted', () => {
  it('does NOT enable CONFIG_PM even when the source mentions pm_/k_sleep', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zephyr-pm-never-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'main.cpp'),
      'void f(){ k_sleep(0); pm_state_force(0,0); }\n');
    try {
      scaffoldZephyrProject(dir, false);
      const prj = readFileSync(join(dir, 'prj.conf'), 'utf8');
      expect(prj).not.toContain('CONFIG_PM=y');
      expect(prj).not.toContain('CONFIG_PM_DEVICE=y');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('PSRAM (CONFIG_ESP_SPIRAM) emission', () => {
  it('emits CONFIG_ESP_SPIRAM + SPIRAM_MODE_OCT when psram is opi', () => {
    const m = resolveKconfigFragments({ psram: 'opi' }, false);
    expect(m.get('CONFIG_ESP_SPIRAM')).toBe('y');
    expect(m.get('CONFIG_SPIRAM_MODE_OCT')).toBe('y');
    expect(m.get('CONFIG_SPIRAM_MODE_QUAD')).toBeUndefined();
  });

  it('emits CONFIG_ESP_SPIRAM + SPIRAM_MODE_QUAD when psram is quad', () => {
    const m = resolveKconfigFragments({ psram: 'quad' }, false);
    expect(m.get('CONFIG_ESP_SPIRAM')).toBe('y');
    expect(m.get('CONFIG_SPIRAM_MODE_QUAD')).toBe('y');
    expect(m.get('CONFIG_SPIRAM_MODE_OCT')).toBeUndefined();
  });

  it('omits CONFIG_ESP_SPIRAM when psram is unset', () => {
    const m = resolveKconfigFragments({}, false);
    expect(m.get('CONFIG_ESP_SPIRAM')).toBeUndefined();
  });

  it('adds target_compile_definitions(BOARD_HAS_PSRAM) to CMakeLists when psram is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zephyr-psram-'));
    try {
      scaffoldZephyrProject(dir, false, undefined, 'opi');
      const cmake = readFileSync(join(dir, 'CMakeLists.txt'), 'utf8');
      expect(cmake).toContain('target_compile_definitions(app PRIVATE BOARD_HAS_PSRAM)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does NOT add BOARD_HAS_PSRAM when psram is unset', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zephyr-nopsram-'));
    try {
      scaffoldZephyrProject(dir, false);
      const cmake = readFileSync(join(dir, 'CMakeLists.txt'), 'utf8');
      expect(cmake).not.toContain('BOARD_HAS_PSRAM');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
