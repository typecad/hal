import { describe, it, expect } from 'vitest';
import { lowerMqtt, mqttInitLines } from '../../../../packages/framework-zephyr/src/lowering/mqtt';

describe('mqtt init shim', () => {
  const shim = mqttInitLines().join('\n');

  it('emits CUTTLEFISH_MQTT markers + the __tc_mqtt state struct', () => {
    expect(shim).toContain('// CUTTLEFISH_MQTT_BEGIN');
    expect(shim).toContain('// CUTTLEFISH_MQTT_END');
    expect(shim).toContain('static struct');
    expect(shim).toContain('__tc_mqtt');
    expect(shim).toContain('struct mqtt_client client');
    expect(shim).toContain('volatile bool connected');
    expect(shim).toContain('on_message');
  });

  it('drives the Zephyr mqtt client API', () => {
    expect(shim).toContain('mqtt_client_init');
    expect(shim).toContain('mqtt_connect');
    expect(shim).toContain('mqtt_subscribe');
    expect(shim).toContain('mqtt_publish');
    expect(shim).toContain('mqtt_disconnect');
    // The poll loop + keepalive the managed-client model needs.
    expect(shim).toContain('mqtt_input');
    expect(shim).toContain('mqtt_live');
    expect(shim).toContain('mqtt_keepalive_time_left');
  });

  it('parses the broker URI + resolves the broker via getaddrinfo', () => {
    expect(shim).toContain('__tc_mqtt_parse_uri');
    expect(shim).toContain('zsock_getaddrinfo');
    expect(shim).toContain('8883U');   // mqtts:// default
    expect(shim).toContain('1883U');   // mqtt:// default
  });

  it('runs the poll loop on a dedicated k_thread', () => {
    expect(shim).toContain('K_THREAD_STACK_DEFINE');
    expect(shim).toContain('__tc_mqtt_poll_thread');
    expect(shim).toContain('k_thread_create');
    expect(shim).toContain('zsock_poll');
  });

  it('dispatches incoming PUBLISHes to the onMessage callback', () => {
    expect(shim).toContain('MQTT_EVT_PUBLISH');
    expect(shim).toContain('mqtt_read_publish_payload');
    // QoS1 ack so the broker does not resend.
    expect(shim).toContain('mqtt_publish_qos1_ack');
    expect(shim).toContain('__tc_mqtt.on_message');
  });

  it('wires mqtts:// TLS via MQTT_TRANSPORT_SECURE + mqtt_sec_config (guarded)', () => {
    expect(shim).toContain('MQTT_TRANSPORT_SECURE');
    expect(shim).toContain('CONFIG_MQTT_LIB_TLS');
    expect(shim).toContain('mqtt_sec_config');
    // The HAL MQTT surface has no CA-pinning op, so TLS skips identity verify
    // (encryption only) until a mqtt.set_ca_cert op is added.
    expect(shim).toContain('TLS_PEER_VERIFY_NONE');
  });
});

describe('mqtt lowering — each op', () => {
  it('connect → __tc_mqtt_connect(uri, clientId)', () => {
    expect(lowerMqtt({ operation: 'mqtt.connect', brokerUri: '"mqtt://h"', clientId: '"dev"' } as any))
      .toEqual({ code: '__tc_mqtt_connect("mqtt://h", "dev");' });
  });

  it('on_message → __tc_mqtt_set_on_message(handler)', () => {
    expect(lowerMqtt({ operation: 'mqtt.on_message', handler: 'onMsg' } as any))
      .toEqual({ code: '__tc_mqtt_set_on_message(onMsg);' });
  });

  it('subscribe → __tc_mqtt_subscribe(topic)', () => {
    expect(lowerMqtt({ operation: 'mqtt.subscribe', topic: '"sensors/#"' } as any))
      .toEqual({ code: '__tc_mqtt_subscribe("sensors/#");' });
  });

  it('publish → __tc_mqtt_publish(topic, data)', () => {
    expect(lowerMqtt({ operation: 'mqtt.publish', topic: '"t"', data: '"hi"' } as any))
      .toEqual({ code: '__tc_mqtt_publish("t", "hi");' });
  });

  it('connected → expression (the volatile flag)', () => {
    expect(lowerMqtt({ operation: 'mqtt.connected' } as any))
      .toEqual({ expression: '(__tc_mqtt.connected)' });
  });

  it('disconnect → __tc_mqtt_disconnect()', () => {
    expect(lowerMqtt({ operation: 'mqtt.disconnect' } as any))
      .toEqual({ code: '__tc_mqtt_disconnect();' });
  });
});

describe('mqtt lowering — unknown mqtt.* op throws', () => {
  // All 6 mqtt.* ops are lowered; the default arm throws so coverage stays honest.
  it('throws on an unrecognized mqtt.* op', () => {
    expect(() => lowerMqtt({ operation: 'mqtt.bogus' } as any)).toThrow(/mqtt\.bogus/);
  });
});
