import { describe, it, expect } from 'vitest';
import { lowerMqtt, mqttInitLines } from '../../../../packages/framework-esp32/src/lowering/mqtt';

describe('mqtt init block', () => {
  it('emits CUTTLEFISH_MQTT markers and the esp_mqtt wrappers', () => {
    const lines = mqttInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_MQTT_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_MQTT_END');
    expect(lines).toContain('esp_mqtt_client_init');
    expect(lines).toContain('esp_mqtt_client_register_event');
    expect(lines).toContain('MQTT_EVENT_DATA');
    expect(lines).toContain('esp_mqtt_client_publish');
    expect(lines).toContain('esp_mqtt_client_subscribe');
    expect(lines).toContain('esp_mqtt_client_destroy');
  });
});

describe('mqtt lowering', () => {
  it('mqtt.connect → __tc_mqtt_connect(uri, id) statement', () => {
    const out = lowerMqtt({ operation: 'mqtt.connect', brokerUri: '"mqtt://b"', clientId: '"c"' } as any);
    expect(out.code).toBe('__tc_mqtt_connect("mqtt://b", "c");');
  });
  it('mqtt.on_message → __tc_mqtt_on_message(handler) statement', () => {
    const out = lowerMqtt({ operation: 'mqtt.on_message', handler: 'onMsg' } as any);
    expect(out.code).toBe('__tc_mqtt_on_message(onMsg);');
  });
  it('mqtt.subscribe → statement', () => {
    const out = lowerMqtt({ operation: 'mqtt.subscribe', topic: '"t/#"' } as any);
    expect(out.code).toBe('__tc_mqtt_subscribe("t/#");');
  });
  it('mqtt.publish → statement', () => {
    const out = lowerMqtt({ operation: 'mqtt.publish', topic: '"t"', data: '"d"' } as any);
    expect(out.code).toBe('__tc_mqtt_publish("t", "d");');
  });
  it('mqtt.connected → boolean expression', () => {
    const out = lowerMqtt({ operation: 'mqtt.connected' } as any);
    expect(out.expression).toBe('__tc_mqtt_connected()');
  });
  it('mqtt.disconnect → statement', () => {
    const out = lowerMqtt({ operation: 'mqtt.disconnect' } as any);
    expect(out.code).toBe('__tc_mqtt_disconnect();');
  });
  it('unknown mqtt.* op throws', () => {
    expect(() => lowerMqtt({ operation: 'mqtt.bogus' } as any)).toThrow();
  });
});
