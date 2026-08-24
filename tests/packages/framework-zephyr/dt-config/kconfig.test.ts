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

  it('routes touch to the right bus driver per controller', () => {
    // Default/FT6336U: I2C.
    const ft = resolveKconfigFragments({ usesTouch: true }, false);
    expect(ft.get('CONFIG_I2C')).toBe('y');
    expect(ft.has('CONFIG_SPI')).toBe(false);
    // XPT2046 rides the display's SPI bus — no I2C needed.
    const xpt = resolveKconfigFragments({ usesTouch: true, touchController: 'xpt2046' }, false);
    expect(xpt.get('CONFIG_SPI')).toBe('y');
    expect(xpt.has('CONFIG_I2C')).toBe(false);
    // The adapters drive the controllers directly — the in-tree input drivers
    // must not build against nodes they own.
    expect(xpt.has('CONFIG_INPUT')).toBe(false);
  });

  it('enables PM when usesPower (deep_sleep_pin wake needs it)', () => {
    const m = resolveKconfigFragments({ usesPower: true }, false);
    expect(m.get('CONFIG_PM')).toBe('y');
    expect(m.get('CONFIG_PM_DEVICE')).toBe('y');
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

  it("forces the USB symbols on for console.output 'usb' even without usb.* ops", () => {
    const m = resolveKconfigFragments({ consoleOutput: 'usb' }, false);
    expect(m.get('CONFIG_USB_DEVICE_STACK_NEXT')).toBe('y');
    expect(m.get('CONFIG_USBD_CDC_ACM_CLASS')).toBe('y');
    expect(m.get('CONFIG_UART_LINE_CTRL')).toBe('y');
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

// Regression: the WiFi shim emits a `tx_power_dbm` identifier. The scaffold's
// usage scan must NOT read the `power_` substring inside it as power-HAL usage
// and enable CONFIG_PM — on the ESP32-S3 that spins the PM soft-off retry loop
// forever and freezes a WiFi-only program.
describe('scaffoldZephyrProject — usage-scan boundary', () => {
  it('does NOT enable CONFIG_PM for a WiFi-only program (tx_power_dbm false positive)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zephyr-wifi-power-fp-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    // Mirrors the real WiFi emit: net_mgmt + a tx_power_dbm field, no pm_/k_sleep.
    writeFileSync(join(dir, 'src', 'main.cpp'),
      'int tx_power_dbm = -1; void f(){ net_mgmt(0,0,0,0); }\n');
    try {
      scaffoldZephyrProject(dir, false);
      const prj = readFileSync(join(dir, 'prj.conf'), 'utf8');
      expect(prj).toContain('CONFIG_WIFI=y');     // WiFi IS used
      expect(prj).not.toContain('CONFIG_PM=y');   // power is NOT
      expect(prj).not.toContain('CONFIG_PM_DEVICE=y');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('DOES enable CONFIG_PM when the power HAL (pm_/k_sleep) is actually used', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zephyr-power-real-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'main.cpp'),
      'void f(){ k_sleep(0); pm_state_force(0,0); }\n');
    try {
      scaffoldZephyrProject(dir, false);
      const prj = readFileSync(join(dir, 'prj.conf'), 'utf8');
      expect(prj).toContain('CONFIG_PM=y');
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
