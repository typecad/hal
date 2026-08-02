import { describe, it, expect } from 'vitest';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';

// A program IR carrying a wifi.connect op (the shape profileDiagnostics walks).
const programWithWifi = {
  functions: [{
    statements: [{
      kind: 'hal-op',
      operation: { operation: 'wifi.connect', ssid: '"n"', password: '"p"', timeoutMs: 1000 },
    }],
  }],
} as any;

describe('ZephyrStrategy WiFi wiring', () => {
  const s = new ZephyrStrategy();

  it('forcedIncludes adds net_mgmt + conn_mgr headers when usesWifi', () => {
    const inc = s.forcedIncludes(undefined, { analysis: { usesWifi: true } } as any);
    expect(inc).toContain('<zephyr/net/conn_mgr_connectivity.h>');
    expect(inc).toContain('<zephyr/net/wifi_mgmt.h>');
    // No <esp_wifi.h>: txPower is not lowered (driver owns the radio), so the
    // ESP-IDF HAL header isn't pulled in.
    expect(inc).not.toContain('<esp_wifi.h>');
  });

  it('shimLines emits the WiFi runtime when usesWifi', () => {
    const lines = s.shimLines(undefined, { frameworkData: {}, analysis: { usesWifi: true } } as any);
    const joined = lines.join('\n');
    expect(joined).toContain('CUTTLEFISH_WIFI_BEGIN');
    expect(joined).toContain('__tc_wifi');
  });

  it('profileDiagnostics flags wifi usage on a radioless chip (xiao_ble)', () => {
    const diags = s.profileDiagnostics(programWithWifi, { frameworkData: { target: 'xiao_ble' } } as any);
    const codes = diags.map((d) => d.code);
    expect(codes).toContain('zephyr-wifi-unavailable-on-target');
  });

  it('profileDiagnostics does NOT flag wifi usage on ESP32-S3', () => {
    const diags = s.profileDiagnostics(programWithWifi, { frameworkData: { target: 'esp32s3_devkitc' } } as any);
    const codes = diags.map((d) => d.code);
    expect(codes).not.toContain('zephyr-wifi-unavailable-on-target');
  });

  it('profileDiagnostics does NOT flag wifi usage on plain ESP32', () => {
    const diags = s.profileDiagnostics(programWithWifi, { frameworkData: { target: 'esp32_devkitc' } } as any);
    const codes = diags.map((d) => d.code);
    expect(codes).not.toContain('zephyr-wifi-unavailable-on-target');
  });
});
