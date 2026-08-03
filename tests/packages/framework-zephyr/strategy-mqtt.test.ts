import { describe, it, expect } from 'vitest';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';

// A program IR carrying an mqtt.connect op (the shape profileDiagnostics walks).
const programWithMqtt = {
  functions: [{
    statements: [{
      kind: 'hal-op',
      operation: { operation: 'mqtt.connect', brokerUri: '"mqtt://h"', clientId: '"d"' },
    }],
  }],
} as any;

describe('ZephyrStrategy MQTT wiring', () => {
  const s = new ZephyrStrategy();

  it('forcedIncludes adds mqtt + tls headers when usesMqtt', () => {
    const inc = s.forcedIncludes(undefined, { analysis: { usesMqtt: true } } as any);
    expect(inc).toContain('<zephyr/net/mqtt.h>');
    expect(inc).toContain('<zephyr/net/tls_credentials.h>');
  });

  it('forcedIncludes omits mqtt headers when usesMqtt is false', () => {
    const inc = s.forcedIncludes(undefined, { analysis: { usesMqtt: false } } as any);
    expect(inc).not.toContain('<zephyr/net/mqtt.h>');
  });

  it('shimLines emits the MQTT runtime when usesMqtt', () => {
    const lines = s.shimLines(undefined, { frameworkData: {}, analysis: { usesMqtt: true } } as any);
    const joined = lines.join('\n');
    expect(joined).toContain('CUTTLEFISH_MQTT_BEGIN');
    expect(joined).toContain('__tc_mqtt');
  });

  it('profileDiagnostics flags mqtt usage on a radioless chip (xiao_ble)', () => {
    const diags = s.profileDiagnostics(programWithMqtt, { frameworkData: { target: 'xiao_ble' } } as any);
    const codes = diags.map((d) => d.code);
    expect(codes).toContain('zephyr-mqtt-unavailable-on-target');
  });

  it('profileDiagnostics does NOT flag mqtt usage on ESP32-S3', () => {
    const diags = s.profileDiagnostics(programWithMqtt, { frameworkData: { target: 'esp32s3_devkitc' } } as any);
    const codes = diags.map((d) => d.code);
    expect(codes).not.toContain('zephyr-mqtt-unavailable-on-target');
  });

  it('profileDiagnostics does NOT flag mqtt usage on plain ESP32', () => {
    const diags = s.profileDiagnostics(programWithMqtt, { frameworkData: { target: 'esp32_devkitc' } } as any);
    const codes = diags.map((d) => d.code);
    expect(codes).not.toContain('zephyr-mqtt-unavailable-on-target');
  });
});
