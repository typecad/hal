// ---------------------------------------------------------------------------
// WiFi lowering — Zephyr Connection Manager (connect) + net_mgmt (scan/radio)
//
// Hybrid: conn_mgr_if_connect/disconnect for the portable connectivity path
// (auto-brings the iface admin-up, signals IP connectivity via NET_EVENT_L4_*),
// and the lower-level net_mgmt + wifi_mgmt.h request/event API for scanning
// and radio queries (conn_mgr has no scan surface). Two net_mgmt event
// handlers feed a single __tc_wifi state struct that the poll ops read.
//
// EMIT BOUNDARY: emitted bytes land in user firmware. Covered by the TypeCAD
// Runtime Exception (RUNTIME_EXCEPTION.md at the repo root).
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

/** Render a HAL field: pass through (already rendered by the resolver). */
function s(v: unknown): string {
  return String(v);
}

/**
 * The WiFi runtime shim. All helpers are `static` so unused ones don't trip
 * -Wunused-function in the single generated TU (mirrors ble.ts).
 *
 * State is driven by two net_mgmt event handlers:
 *  - L4 connectivity (NET_EVENT_L4_CONNECTED/DISCONNECTED) → connected flag.
 *    This reflects IP connectivity (post-DHCP), not just the WiFi link — the
 *    portability win of routing connect through conn_mgr.
 *  - WiFi scan (NET_EVENT_WIFI_SCAN_RESULT/SCAN_DONE) → scan_results pool.
 */
export function wifiInitLines(): string[] {
  return [
    `// CUTTLEFISH_WIFI_BEGIN`,
    `#define __TC_WIFI_MAX_SCAN 16`,
    ``,
    `// WiFi state. connected reflects IP connectivity (L4), not just link —`,
    `// conn_mgr_if_connect auto-brings the iface up and the L4 handler fires`,
    `// once DHCP completes. is_connected polls this flag.`,
    `static struct {`,
    `    bool inited;              // net_mgmt handlers registered + iface resolved`,
    `    bool connected;           // set by NET_EVENT_L4_CONNECTED/DISCONNECTED`,
    `    bool scanning;            // scan kicked, awaiting NET_EVENT_WIFI_SCAN_DONE`,
    `    int32_t scan_count;       // filled by SCAN_DONE`,
    `    struct wifi_scan_result scan_results[__TC_WIFI_MAX_SCAN];`,
    `    char ssid_buf[__TC_WIFI_MAX_SCAN][33];   // SSIDs ≤32 chars + NUL`,
    `    uint8_t mac[6];           // filled lazily by wifi.mac`,
    `    struct net_if* iface;     // resolved WiFi iface`,
    `} __tc_wifi = { false, false, false, 0, {}, {}, {}, nullptr };`,
    ``,
    `// ── net_mgmt event handler ──────────────────────────────────────────────`,
    `// One callback for both event families. L4 events drive \`connected\`; WiFi`,
    `// scan events fill the scan pool. Registered once at first use.`,
    `static void __tc_wifi_mgmt_cb(struct net_mgmt_event_callback* cbb, uint64_t mgmt_event,`,
    `                              struct net_if* iface) {`,
    `    (void)cbb;`,
    `    (void)iface;`,
    `    if (mgmt_event == NET_EVENT_L4_CONNECTED) {`,
    `        __tc_wifi.connected = true;`,
    `    } else if (mgmt_event == NET_EVENT_L4_DISCONNECTED) {`,
    `        __tc_wifi.connected = false;`,
    `    } else if (mgmt_event == NET_EVENT_WIFI_SCAN_RESULT) {`,
    `        // Per-result during a scan. Bounds-check against the pool cap.`,
    `        const struct wifi_scan_result* res = static_cast<const struct wifi_scan_result*>(cbb->info);`,
    `        if (res != nullptr && __tc_wifi.scan_count < __TC_WIFI_MAX_SCAN) {`,
    `            int32_t i = __tc_wifi.scan_count;`,
    `            __tc_wifi.scan_results[i] = *res;`,
    `            // Copy the SSID into the flat ssid_buf (≤32 chars + NUL).`,
    `            uint32_t len = (res->ssid_length < 32U) ? res->ssid_length : 32U;`,
    `            for (uint32_t b = 0; b < len; b++) { __tc_wifi.ssid_buf[i][b] = static_cast<char>(res->ssid[b]); }`,
    `            __tc_wifi.ssid_buf[i][len] = '\\0';`,
    `            __tc_wifi.scan_count = i + 1;`,
    `        }`,
    `    } else if (mgmt_event == NET_EVENT_WIFI_SCAN_DONE) {`,
    `        __tc_wifi.scanning = false;`,
    `    }`,
    `}`,
    ``,
    `static struct net_mgmt_event_callback __tc_wifi_l4_cb;`,
    `static struct net_mgmt_event_callback __tc_wifi_scan_cb;`,
    ``,
    `// Register both handlers + resolve the WiFi iface. Idempotent (inited guard).`,
    `static void __tc_wifi_ensure_init(void) {`,
    `    if (__tc_wifi.inited) return;`,
    `    __tc_wifi.iface = net_if_get_default();`,
    `    net_mgmt_init_event_callback(&__tc_wifi_l4_cb, __tc_wifi_mgmt_cb,`,
    `        NET_EVENT_L4_CONNECTED | NET_EVENT_L4_DISCONNECTED);`,
    `    net_mgmt_add_event_callback(&__tc_wifi_l4_cb);`,
    `    net_mgmt_init_event_callback(&__tc_wifi_scan_cb, __tc_wifi_mgmt_cb,`,
    `        NET_EVENT_WIFI_SCAN_RESULT | NET_EVENT_WIFI_SCAN_DONE);`,
    `    net_mgmt_add_event_callback(&__tc_wifi_scan_cb);`,
    `    __tc_wifi.inited = true;`,
    `}`,
    ``,
    `// ── connect / disconnect (conn_mgr — the portability layer) ─────────────`,
    `// SSID/PSK are staged into static buffers (wifi_connect_req_params.ssid/psk`,
    `// are const uint8_t* — they point at caller-owned storage that must outlive`,
    `// the request), then the WiFi connect request is issued. conn_mgr brings the`,
    `// iface up; the L4 handler signals end-to-end connectivity.`,
    `static struct wifi_connect_req_params __tc_wifi_conn_params;`,
    `static uint8_t __tc_wifi_ssid_buf[33];    // SSID ≤32 + slack`,
    `static uint8_t __tc_wifi_psk_buf[64];     // PSK ≤63 + slack`,
    ``,
    `static void __tc_wifi_stage_creds(const char* ssid, const char* password) {`,
    `    __tc_wifi_ensure_init();`,
    `    uint32_t ssid_len = strlen(ssid);`,
    `    if (ssid_len > 32U) ssid_len = 32U;`,
    `    for (uint32_t b = 0; b < ssid_len; b++) { __tc_wifi_ssid_buf[b] = static_cast<uint8_t>(ssid[b]); }`,
    `    __tc_wifi_conn_params.ssid = __tc_wifi_ssid_buf;`,
    `    __tc_wifi_conn_params.ssid_length = static_cast<uint8_t>(ssid_len);`,
    `    if (password != nullptr) {`,
    `        uint32_t pw_len = strlen(password);`,
    `        if (pw_len > 63U) pw_len = 63U;`,
    `        for (uint32_t b = 0; b < pw_len; b++) { __tc_wifi_psk_buf[b] = static_cast<uint8_t>(password[b]); }`,
    `        __tc_wifi_conn_params.psk = __tc_wifi_psk_buf;`,
    `        __tc_wifi_conn_params.psk_length = static_cast<uint8_t>(pw_len);`,
    `    } else {`,
    `        __tc_wifi_conn_params.psk_length = 0U;`,
    `    }`,
    `    __tc_wifi_conn_params.security = WIFI_SECURITY_TYPE_PSK;`,
    `    __tc_wifi_conn_params.channel = WIFI_CHANNEL_ANY;`,
    `    __tc_wifi_conn_params.band = WIFI_FREQ_BAND_2_4_GHZ;`,
    `    // Stage the connection request (wifi_connect). conn_mgr_if_connect below`,
    `    // brings the iface up; the L4 handler sets \`connected\` post-DHCP.`,
    `    (void)net_mgmt(NET_REQUEST_WIFI_CONNECT, __tc_wifi.iface,`,
    `                   &__tc_wifi_conn_params, sizeof(__tc_wifi_conn_params));`,
    `}`,
    ``,
    `static void __tc_wifi_connect_start(const char* ssid, const char* password) {`,
    `    __tc_wifi_ensure_init();`,
    `    __tc_wifi_stage_creds(ssid, password);`,
    `    __tc_wifi.connected = false;`,
    `    // conn_mgr_if_connect is non-blocking and auto-takes the iface admin-up.`,
    `    (void)conn_mgr_if_connect(__tc_wifi.iface);`,
    `}`,
    ``,
    `static void __tc_wifi_connect(const char* ssid, const char* password, int32_t timeout_ms) {`,
    `    __tc_wifi_connect_start(ssid, password);`,
    `    // Block until the L4 handler signals connectivity or the deadline passes.`,
    `    int32_t waited = 0;`,
    `    while (!__tc_wifi.connected && waited < timeout_ms) { k_msleep(100); waited += 100; }`,
    `}`,
    ``,
    `static void __tc_wifi_disconnect(void) {`,
    `    __tc_wifi_ensure_init();`,
    `    __tc_wifi.connected = false;`,
    `    (void)conn_mgr_if_disconnect(__tc_wifi.iface);`,
    `}`,
    ``,
    `// ── status / radio queries ───────────────────────────────────────────────`,
    `static int32_t __tc_wifi_status(void) {`,
    `    return __tc_wifi.connected ? 3 : 0;   // 3=Connected in the HAL status enum`,
    `}`,
    ``,
    `static const char* __tc_wifi_local_ip(void) {`,
    `    __tc_wifi_ensure_init();`,
    `    static char ipbuf[16];   // "255.255.255.255" + NUL`,
    `    struct in_addr* addr = &__tc_wifi.iface->config.ip.ipv4->unicast[0].ipv4.address.in_addr;`,
    `    (void)net_addr_ntop(AF_INET, addr, ipbuf, sizeof(ipbuf));`,
    `    return ipbuf;`,
    `}`,
    ``,
    `static int32_t __tc_wifi_rssi(void) {`,
    `    __tc_wifi_ensure_init();`,
    `    struct wifi_iface_status status = { 0 };`,
    `    // RSSI is a field on the iface-status struct, fetched via the status`,
    `    // request (there is no standalone NET_REQUEST_WIFI_RSSI constant).`,
    `    int32_t ret = net_mgmt(NET_REQUEST_WIFI_IFACE_STATUS, __tc_wifi.iface,`,
    `                           &status, sizeof(status));`,
    `    if (ret != 0) return 0;`,
    `    return static_cast<int32_t>(status.rssi);`,
    `}`,
    ``,
    `static uint64_t __tc_wifi_mac(void) {`,
    `    __tc_wifi_ensure_init();`,
    `    struct wifi_iface_status status = { 0 };`,
    `    (void)net_mgmt(NET_REQUEST_WIFI_IFACE_STATUS, __tc_wifi.iface,`,
    `                   &status, sizeof(status));`,
    `    // Pack the 6 MAC bytes (status.bssid) into a uint64 (HAL returns a number).`,
    `    uint64_t m = 0;`,
    `    for (int32_t b = 0; b < 6; b++) { m = (m << 8) | static_cast<uint64_t>(status.bssid[b]); }`,
    `    return m;`,
    `}`,
    ``,
    `// ── scan (net_mgmt — conn_mgr has no scan surface) ───────────────────────`,
    `static void __tc_wifi_scan_start(void) {`,
    `    __tc_wifi_ensure_init();`,
    `    __tc_wifi.scanning = true;`,
    `    __tc_wifi.scan_count = 0;`,
    `    (void)net_mgmt(NET_REQUEST_WIFI_SCAN, __tc_wifi.iface, nullptr, 0);`,
    `}`,
    ``,
    `static void __tc_wifi_scan_blocking(void) {`,
    `    __tc_wifi_scan_start();`,
    `    while (__tc_wifi.scanning) { k_msleep(100); }`,
    `}`,
    ``,
    `static const char* __tc_wifi_scan_ssid(int32_t i) {`,
    `    if (i < 0 || i >= __tc_wifi.scan_count || i >= __TC_WIFI_MAX_SCAN) return "";`,
    `    return __tc_wifi.ssid_buf[i];`,
    `}`,
    `static int32_t __tc_wifi_scan_rssi(int32_t i) {`,
    `    if (i < 0 || i >= __tc_wifi.scan_count || i >= __TC_WIFI_MAX_SCAN) return 0;`,
    `    return static_cast<int32_t>(__tc_wifi.scan_results[i].rssi);`,
    `}`,
    `static const char* __tc_wifi_scan_enc(int32_t i) {`,
    `    if (i < 0 || i >= __tc_wifi.scan_count || i >= __TC_WIFI_MAX_SCAN) return "open";`,
    `    switch (__tc_wifi.scan_results[i].security) {`,
    `        case WIFI_SECURITY_TYPE_PSK: return "wpa";`,
    `        case WIFI_SECURITY_TYPE_PSK_SHA256: return "wpa2";`,
    `        case WIFI_SECURITY_TYPE_SAE: return "wpa3";`,
    `        default: return "open";`,
    `    }`,
    `}`,
    `static int32_t __tc_wifi_scan_channel(int32_t i) {`,
    `    if (i < 0 || i >= __tc_wifi.scan_count || i >= __TC_WIFI_MAX_SCAN) return 0;`,
    `    return static_cast<int32_t>(__tc_wifi.scan_results[i].channel);`,
    `}`,
    ``,
    `// ── config ───────────────────────────────────────────────────────────────`,
    `static void __tc_wifi_set_hostname(const char* name) {`,
    `    // Best-effort: Zephyr has no net_if_set_hostname; the system hostname`,
    `    // comes from the hostname subsystem (net_hostname.h) + CONFIG_NET_HOSTNAME.`,
    `    // The interface name is set via net_if_set_name, which is not the same as`,
    `    // a DHCP hostname. No-op until the hostname subsystem is wired.`,
    `    (void)name;`,
    `    (void)__tc_wifi;`,
    `}`,
    ``,
    `// CUTTLEFISH_WIFI_END`,
  ];
}

/**
 * Resolve a HAL wifi.* op to Zephyr C++ via the __tc_wifi_* shim. Returns
 * `{ code }` for statement ops, `{ expression }` for value-returning ops,
 * `undefined` for out-of-scope ops (the manifest declares those unsupported).
 */
export function lowerWifi(op: HALOpIR): { code?: string; expression?: string } | undefined {
  const o = op as any;
  switch (op.operation) {
    // ── Connection ──
    case 'wifi.connect':
      return { code: `__tc_wifi_connect(${s(o.ssid)}, ${s(o.password ?? 'nullptr')}, ${s(o.timeoutMs ?? 15000)});` };
    case 'wifi.connect_start':
      return { code: `__tc_wifi_connect_start(${s(o.ssid)}, ${s(o.password ?? 'nullptr')});` };
    case 'wifi.disconnect':
      return { code: `__tc_wifi_disconnect();` };
    case 'wifi.status':
      return { expression: `__tc_wifi_status()` };
    case 'wifi.is_connected':
      return { expression: `(__tc_wifi.connected)` };
    case 'wifi.local_ip':
      return { expression: `__tc_wifi_local_ip()` };
    case 'wifi.rssi':
      return { expression: `__tc_wifi_rssi()` };
    case 'wifi.mac':
      return { expression: `__tc_wifi_mac()` };
    // ── Scan ──
    case 'wifi.scan':
      return { code: `__tc_wifi_scan_blocking();` };
    case 'wifi.scan_start':
      return { code: `__tc_wifi_scan_start();` };
    case 'wifi.scan_done':
      return { expression: `(!__tc_wifi.scanning)` };
    case 'wifi.scan_count':
      return { expression: `((int32_t)__tc_wifi.scan_count)` };
    case 'wifi.scan_ssid':
    case 'wifi.scan_rssi':
    case 'wifi.scan_encryption':
    case 'wifi.scan_channel': {
      const helper = op.operation === 'wifi.scan_ssid' ? '__tc_wifi_scan_ssid'
        : op.operation === 'wifi.scan_rssi' ? '__tc_wifi_scan_rssi'
        : op.operation === 'wifi.scan_encryption' ? '__tc_wifi_scan_enc'
        : '__tc_wifi_scan_channel';
      return { expression: `${helper}(${s(o.index ?? 0)})` };
    }
    // ── Config ──
    case 'wifi.set_hostname':
      return { code: `__tc_wifi_set_hostname(${s(o.name)});` };
    default:
      // Out-of-scope (AP, credentials, waits, deferred config): return undefined
      // so the resolver falls back and the manifest's 'unsupported' declaration
      // is honest (the validator probes these).
      return undefined;
  }
}
