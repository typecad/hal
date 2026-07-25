import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

/**
 * Native ESP-IDF MQTT runtime shim (`__tc_mqtt_*`). Wraps esp_mqtt_client_* to
 * provide the pub/sub surface: connect to a broker, publish, subscribe with an
 * onMessage callback, disconnect.
 *
 * The event handler translates ESP-IDF MQTT events (MQTT_EVENT_DATA) into a
 * call to the user's TS callback (`handler(topic, payload)`). The handler name
 * is captured at mqtt.on_message time and stored in __tc_mqtt_msg_cb.
 *
 * Lowered via framework-esp32/src/lowering/mqtt.ts. Forced includes
 * (mqtt_client.h) are gated on usesMqtt in strategy.ts. esp_mqtt is a built-in
 * ESP-IDF component.
 */

export function mqttInitLines(): string[] {
  return [
    `// CUTTLEFISH_MQTT_BEGIN`,
    `#include <string.h>`,
    `static esp_mqtt_client_handle_t __tc_mqtt_client = NULL;`,
    `static bool __tc_mqtt_connected = false;`,
    `// User callback registered via mqtt.on_message: void(const char* topic, const char* payload).`,
    `static void (*__tc_mqtt_msg_cb)(const char*, const char*) = NULL;`,
    ``,
    `static void __tc_mqtt_event_handler(void* handler_args, esp_event_base_t base, int32_t event_id, void* event_data) {`,
    `    (void)handler_args; (void)base;`,
    `    esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t)event_data;`,
    `    switch (event_id) {`,
    `        case MQTT_EVENT_CONNECTED:`,
    `            __tc_mqtt_connected = true;`,
    `            break;`,
    `        case MQTT_EVENT_DISCONNECTED:`,
    `            __tc_mqtt_connected = false;`,
    `            break;`,
    `        case MQTT_EVENT_DATA:`,
    `            if (__tc_mqtt_msg_cb) {`,
    `                // event->topic / event->data are NOT NUL-terminated when`,
    `                // event->total_data_len > event->data_len (fragmented). Build`,
    `                // NUL-terminated copies so the TS callback sees plain C strings.`,
    `                char* topic = (char*)malloc(event->topic_len + 1);`,
    `                char* payload = (char*)malloc(event->data_len + 1);`,
    `                if (topic && payload) {`,
    `                    memcpy(topic, event->topic, event->topic_len); topic[event->topic_len] = '\\0';`,
    `                    memcpy(payload, event->data, event->data_len); payload[event->data_len] = '\\0';`,
    `                    __tc_mqtt_msg_cb(topic, payload);`,
    `                }`,
    `                free(topic); free(payload);`,
    `            }`,
    `            break;`,
    `        default: break;`,
    `    }`,
    `}`,
    ``,
    `static inline void __tc_mqtt_connect(const char* uri, const char* client_id) {`,
    `    esp_mqtt_client_config_t cfg = { .broker.address.uri = uri, .credentials.client_id = client_id };`,
    `    __tc_mqtt_client = esp_mqtt_client_init(&cfg);`,
    `    esp_mqtt_client_register_event(__tc_mqtt_client, (esp_mqtt_event_id_t)ESP_EVENT_ANY_ID, __tc_mqtt_event_handler, NULL);`,
    `    esp_mqtt_client_start(__tc_mqtt_client);`,
    `}`,
    ``,
    `static inline void __tc_mqtt_on_message(void (*cb)(const char*, const char*)) {`,
    `    __tc_mqtt_msg_cb = cb;`,
    `}`,
    ``,
    `static inline void __tc_mqtt_subscribe(const char* topic) {`,
    `    if (__tc_mqtt_client) esp_mqtt_client_subscribe(__tc_mqtt_client, topic, 0);`,
    `}`,
    ``,
    `static inline void __tc_mqtt_publish(const char* topic, const char* data) {`,
    `    if (__tc_mqtt_client) esp_mqtt_client_publish(__tc_mqtt_client, topic, data, 0, 1, 0);`,
    `}`,
    ``,
    `static inline bool __tc_mqtt_connected(void) { return __tc_mqtt_connected; }`,
    ``,
    `static inline void __tc_mqtt_disconnect(void) {`,
    `    if (__tc_mqtt_client) { esp_mqtt_client_destroy(__tc_mqtt_client); __tc_mqtt_client = NULL; }`,
    `    __tc_mqtt_connected = false;`,
    `}`,
    `// CUTTLEFISH_MQTT_END`,
    ``,
  ];
}

/** Resolve a HAL mqtt.* op to ESP-IDF C++. */
export function lowerMqtt(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'mqtt.connect':   return { code: `__tc_mqtt_connect(${o.brokerUri}, ${o.clientId});` };
    case 'mqtt.on_message':return { code: `__tc_mqtt_on_message(${o.handler});` };
    case 'mqtt.subscribe': return { code: `__tc_mqtt_subscribe(${o.topic});` };
    case 'mqtt.publish':   return { code: `__tc_mqtt_publish(${o.topic}, ${o.data});` };
    case 'mqtt.connected': return { expression: `__tc_mqtt_connected()` };
    case 'mqtt.disconnect':return { code: `__tc_mqtt_disconnect();` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
