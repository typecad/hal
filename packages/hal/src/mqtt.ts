import { callback } from './callback.js';

/**
 * MqttClass — MQTT 3.1.1 pub/sub client (ESP-IDF esp_mqtt).
 *
 * Lowered to native MQTT HAL ops (mqtt.*): ESP-IDF's esp_mqtt_client_* API.
 * Covers the common IoT pub/sub path: connect to a broker, publish, subscribe
 * with an onMessage callback, and disconnect. The runtime shim owns the event
 * loop translation (ESP-IDF's MQTT event handler → the user's TS callback).
 *
 * Requires a network connection (WiFi) before connect().
 */
export class MqttClass {
  static readonly __instance_name = "MQTT";

  /** Connect to a broker URI (e.g. "mqtt://broker.local" or "mqtts://..."). */
  connect(brokerUri: string, clientId: string): boolean {
    mqttConnect(brokerUri, clientId);
    return true;
  }

  /** Set a handler invoked for every received PUBLISH on a subscribed topic.
   *  The handler receives (topic, payload). */
  onMessage(handler: (topic: string, payload: string) => void): void {
    mqttOnMessage(callback(handler));
  }

  /** Subscribe to a topic filter (e.g. "sensors/#"). */
  subscribe(topic: string): void {
    mqttSubscribe(topic);
  }

  /** Publish a message to a topic. */
  publish(topic: string, data: string): void {
    mqttPublish(topic, data);
  }

  /** True if the client is currently connected to the broker. */
  connected(): boolean {
    return mqttConnected();
  }

  /** Disconnect from the broker and free the client. */
  disconnect(): void {
    mqttDisconnect();
  }
}

export const MQTT = new MqttClass();

// ── Semantic primitives (resolved to mqtt.* HAL ops by the transpiler) ──
export function mqttConnect(brokerUri: string, clientId: string): void {}
export function mqttOnMessage(handler: string): void {}
export function mqttSubscribe(topic: string): void {}
export function mqttPublish(topic: string, data: string): void {}
export function mqttConnected(): boolean { return false; }
export function mqttDisconnect(): void {}
