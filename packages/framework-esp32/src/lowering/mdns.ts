import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

/**
 * Native ESP-IDF mDNS runtime shim (`__tc_mdns_*`). Wraps esp_mdns to advertise
 * the device as <hostname>.local and publish services for discovery.
 *
 * mdns_init() is lazy (first start) and idempotent. Requires WiFi to be
 * connected — mDNS rides on the station interface; calling start() before
 * WiFi connects is harmless (the responder starts, just won't resolve until
 * the link is up).
 *
 * Lowered via framework-esp32/src/lowering/mdns.ts. Forced includes
 * (mdns.h) are gated on usesMdns in strategy.ts. esp_mdns is a built-in ESP-IDF
 * component (no managed-component dependency needed).
 */

export function mdnsInitLines(): string[] {
  return [
    `// CUTTLEFISH_MDNS_BEGIN`,
    `static bool __tc_mdns_inited = false;`,
    ``,
    `static inline void __tc_mdns_ensure_init(void) {`,
    `    if (__tc_mdns_inited) return;`,
    `    mdns_init();`,
    `    __tc_mdns_inited = true;`,
    `}`,
    ``,
    `static inline void __tc_mdns_start(const char* hostname) {`,
    `    __tc_mdns_ensure_init();`,
    `    mdns_hostname_set(hostname);`,
    `    mdns_instance_name_set(hostname);`,
    `}`,
    ``,
    `static inline void __tc_mdns_set_hostname(const char* name) {`,
    `    __tc_mdns_ensure_init();`,
    `    mdns_hostname_set(name);`,
    `}`,
    ``,
    `static inline void __tc_mdns_add_service(const char* instance, const char* proto, int port) {`,
    `    __tc_mdns_ensure_init();`,
    `    // esp_mdns derives the service type from the proto suffix; "_tcp"/"_udp".`,
    `    mdns_service_add(instance, proto, proto, port, NULL, 0);`,
    `}`,
    ``,
    `static inline void __tc_mdns_announce(void) {`,
    `    // mdns_dispatcher / announce is implicit on service add; this is a hook`,
    `    // for explicit re-probing. No-op keeps the API honest if ESP-IDF adds it.`,
    `    (void)0;`,
    `}`,
    ``,
    `static inline void __tc_mdns_stop(void) {`,
    `    if (__tc_mdns_inited) { mdns_free(); __tc_mdns_inited = false; }`,
    `}`,
    `// CUTTLEFISH_MDNS_END`,
    ``,
  ];
}

/** Resolve a HAL mdns.* op to ESP-IDF C++. */
export function lowerMdns(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'mdns.start':       return { code: `__tc_mdns_start(${o.hostname});` };
    case 'mdns.set_hostname':return { code: `__tc_mdns_set_hostname(${o.name});` };
    case 'mdns.add_service': return { code: `__tc_mdns_add_service(${o.instance}, ${o.proto}, ${o.port});` };
    case 'mdns.announce':    return { code: `__tc_mdns_announce();` };
    case 'mdns.stop':        return { code: `__tc_mdns_stop();` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
