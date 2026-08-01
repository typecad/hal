import { describe, it, expect } from 'vitest';
import { resolveKconfigFragments } from '../../../../packages/framework-zephyr/src/dt-config/kconfig';

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

  it('enables SYSTEM_WORKQUEUE + bumps stack', () => {
    const m = resolveKconfigFragments({}, false);
    expect(m.get('CONFIG_SYSTEM_WORKQUEUE')).toBe('y');
    expect(m.get('CONFIG_SYSTEM_WORKQUEUE_STACK_SIZE')).toBe('8192');
  });

  it('enables DISPLAY when usesDisplay', () => {
    const m = resolveKconfigFragments({ usesDisplay: true }, false);
    expect(m.get('CONFIG_DISPLAY')).toBe('y');
  });

  it('enables PM when usesPower (deep_sleep_pin wake needs it)', () => {
    const m = resolveKconfigFragments({ usesPower: true }, false);
    expect(m.get('CONFIG_PM')).toBe('y');
    expect(m.get('CONFIG_PM_DEVICE')).toBe('y');
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
    expect(m.get('CONFIG_WIFI')).toBe('y');
    expect(m.get('CONFIG_WIFI_ESP32')).toBe('y');
    expect(m.get('CONFIG_NET_CONNECTION_MANAGER')).toBe('y');
    expect(m.get('CONFIG_NET_MGMT_EVENT')).toBe('y');
    expect(m.get('CONFIG_NET_DHCPV4')).toBe('y');
  });
});
