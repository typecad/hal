import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

/**
 * Native ESP-IDF HTTP/S client runtime shim (`__tc_http_*`) over
 * esp_http_client. One request slot at a time (embedded-friendly):
 * factory/reset → setters → begin (inside send) → perform.
 *
 * Setters may run before begin (e.g. `req.timeout(ms); req.send()`); begin
 * must not wipe them. Options are cleared by `__tc_http_reset` when a new
 * request is created (`Http.get` / post / …).
 *
 * TLS uses the ESP x509 certificate bundle by default; `insecure()` skips
 * verification; `caCert()` pins a PEM. Response body is heap-capped
 * (default 8 KB), NUL-terminated, valid until the next begin/reset.
 */
export function httpInitLines(): string[] {
  return [
    `// CUTTLEFISH_HTTP_BEGIN`,
    `#define __TC_HTTP_DEFAULT_MAX_BODY 8192`,
    `#define __TC_HTTP_MAX_HEADERS 8`,
    `static struct {`,
    `    esp_http_client_handle_t client;`,
    `    char url[512];`,
    `    esp_http_client_method_t method;`,
    `    int timeout_ms;`,
    `    size_t max_body;`,
    `    const char* body;        // request body (user-owned)`,
    `    int body_len;`,
    `    bool insecure;`,
    `    const char* ca_cert;     // PEM, user-owned; NULL = cert bundle`,
    `    const char* hdr_name[__TC_HTTP_MAX_HEADERS];`,
    `    const char* hdr_value[__TC_HTTP_MAX_HEADERS];`,
    `    int hdr_count;`,
    `    // response`,
    `    volatile int status;`,
    `    volatile bool done;`,
    `    volatile bool ok;`,
    `    char* resp;`,
    `    size_t resp_len;`,
    `    int64_t content_length;`,
    `    char resp_header[128];`,
    `} __tc_http = { NULL, {0}, HTTP_METHOD_GET, 15000, __TC_HTTP_DEFAULT_MAX_BODY, NULL, 0, false, NULL, {0}, {0}, 0, 0, false, false, NULL, 0, -1, {0} };`,
    ``,
    `static esp_err_t __tc_http_event_cb(esp_http_client_event_t* evt) {`,
    `    switch (evt->event_id) {`,
    `    case HTTP_EVENT_ON_DATA:`,
    `        if (__tc_http.resp && evt->data_len > 0) {`,
    `            size_t room = __tc_http.max_body - __tc_http.resp_len;`,
    `            size_t n = (size_t)evt->data_len < room ? (size_t)evt->data_len : room;`,
    `            memcpy(__tc_http.resp + __tc_http.resp_len, evt->data, n);`,
    `            __tc_http.resp_len += n;`,
    `        }`,
    `        break;`,
    `    default: break;`,
    `    }`,
    `    return ESP_OK;`,
    `}`,
    ``,
    `/** Clear request options + response; called when Http.get/post/… starts a new request. */`,
    `static inline void __tc_http_reset(void) {`,
    `    if (__tc_http.client) {`,
    `        esp_http_client_cleanup(__tc_http.client);`,
    `        __tc_http.client = NULL;`,
    `    }`,
    `    __tc_http.timeout_ms = 15000;`,
    `    __tc_http.max_body = __TC_HTTP_DEFAULT_MAX_BODY;`,
    `    __tc_http.body = NULL;`,
    `    __tc_http.body_len = 0;`,
    `    __tc_http.insecure = false;`,
    `    __tc_http.ca_cert = NULL;`,
    `    __tc_http.hdr_count = 0;`,
    `    __tc_http.status = 0;`,
    `    __tc_http.done = false;`,
    `    __tc_http.ok = false;`,
    `    __tc_http.resp_len = 0;`,
    `    __tc_http.content_length = -1;`,
    `    __tc_http.resp_header[0] = 0;`,
    `}`,
    ``,
    `static inline void __tc_http_apply_headers(void) {`,
    `    if (!__tc_http.client) return;`,
    `    for (int i = 0; i < __tc_http.hdr_count; i++) {`,
    `        esp_http_client_set_header(__tc_http.client, __tc_http.hdr_name[i], __tc_http.hdr_value[i]);`,
    `    }`,
    `}`,
    ``,
    `static inline void __tc_http_begin(esp_http_client_method_t method, const char* url) {`,
    `    if (__tc_http.client) {`,
    `        esp_http_client_cleanup(__tc_http.client);`,
    `        __tc_http.client = NULL;`,
    `    }`,
    `    strlcpy(__tc_http.url, url, sizeof(__tc_http.url));`,
    `    __tc_http.method = method;`,
    `    // Keep timeout/max_body/body/tls/headers already set by setters before send().`,
    `    __tc_http.status = 0;`,
    `    __tc_http.done = false;`,
    `    __tc_http.ok = false;`,
    `    __tc_http.resp_len = 0;`,
    `    __tc_http.content_length = -1;`,
    `    __tc_http.resp_header[0] = 0;`,
    ``,
    `    esp_http_client_config_t cfg = {};`,
    `    cfg.url = __tc_http.url;`,
    `    cfg.method = method;`,
    `    cfg.timeout_ms = __tc_http.timeout_ms;`,
    `    cfg.event_handler = &__tc_http_event_cb;`,
    `    if (__tc_http.insecure) {`,
    `        cfg.skip_cert_common_name_check = true;`,
    `    } else if (__tc_http.ca_cert) {`,
    `        cfg.cert_pem = __tc_http.ca_cert;`,
    `    } else {`,
    `        cfg.crt_bundle_attach = esp_crt_bundle_attach;`,
    `    }`,
    `    __tc_http.client = esp_http_client_init(&cfg);`,
    `    __tc_http_apply_headers();`,
    `}`,
    ``,
    `static inline void __tc_http_set_header(const char* name, const char* value) {`,
    `    if (__tc_http.hdr_count < __TC_HTTP_MAX_HEADERS) {`,
    `        __tc_http.hdr_name[__tc_http.hdr_count] = name;`,
    `        __tc_http.hdr_value[__tc_http.hdr_count] = value;`,
    `        __tc_http.hdr_count++;`,
    `    }`,
    `    if (__tc_http.client) esp_http_client_set_header(__tc_http.client, name, value);`,
    `}`,
    ``,
    `static inline void __tc_http_set_timeout(int ms) {`,
    `    __tc_http.timeout_ms = ms;`,
    `    if (__tc_http.client) esp_http_client_set_timeout_ms(__tc_http.client, ms);`,
    `}`,
    ``,
    `static inline void __tc_http_set_max_body(size_t bytes) { __tc_http.max_body = bytes; }`,
    ``,
    `static inline void __tc_http_set_body(const char* data, bool json) {`,
    `    __tc_http.body = data;`,
    `    __tc_http.body_len = (int)strlen(data);`,
    `    if (json) __tc_http_set_header("Content-Type", "application/json");`,
    `}`,
    ``,
    `// insecure()/caCert() need a client re-init: TLS config is set at init time.`,
    `static inline void __tc_http_reinit_tls(void) {`,
    `    if (!__tc_http.url[0]) return; // no begin yet — flag is kept for begin()`,
    `    if (__tc_http.client) {`,
    `        esp_http_client_cleanup(__tc_http.client);`,
    `        __tc_http.client = NULL;`,
    `    }`,
    `    esp_http_client_config_t cfg = {};`,
    `    cfg.url = __tc_http.url;`,
    `    cfg.method = __tc_http.method;`,
    `    cfg.timeout_ms = __tc_http.timeout_ms;`,
    `    cfg.event_handler = &__tc_http_event_cb;`,
    `    if (__tc_http.insecure) {`,
    `        cfg.crt_bundle_attach = NULL;`,
    `        cfg.cert_pem = NULL;`,
    `        cfg.skip_cert_common_name_check = true;`,
    `    } else if (__tc_http.ca_cert) {`,
    `        cfg.cert_pem = __tc_http.ca_cert;`,
    `    } else {`,
    `        cfg.crt_bundle_attach = esp_crt_bundle_attach;`,
    `    }`,
    `    __tc_http.client = esp_http_client_init(&cfg);`,
    `    __tc_http_apply_headers();`,
    `}`,
    ``,
    `static inline void __tc_http_set_insecure(void) {`,
    `    __tc_http.insecure = true;`,
    `    __tc_http_reinit_tls();`,
    `}`,
    ``,
    `static inline void __tc_http_set_ca_cert(const char* pem) {`,
    `    __tc_http.ca_cert = pem;`,
    `    __tc_http_reinit_tls();`,
    `}`,
    ``,
    `static inline bool __tc_http_send(void) {`,
    `    if (!__tc_http.client) return false;`,
    `    if (__tc_http.resp) { free(__tc_http.resp); __tc_http.resp = NULL; }`,
    `    __tc_http.resp = (char*)malloc(__tc_http.max_body + 1);`,
    `    if (!__tc_http.resp) {`,
    `        __tc_http.ok = false;`,
    `        __tc_http.done = true;`,
    `        return false;`,
    `    }`,
    `    __tc_http.resp_len = 0;`,
    `    if (__tc_http.body) {`,
    `        esp_http_client_set_post_field(__tc_http.client, __tc_http.body, __tc_http.body_len);`,
    `    }`,
    `    esp_err_t err = esp_http_client_perform(__tc_http.client);`,
    `    __tc_http.resp[__tc_http.resp_len < __tc_http.max_body ? __tc_http.resp_len : __tc_http.max_body] = 0;`,
    `    __tc_http.status = esp_http_client_get_status_code(__tc_http.client);`,
    `    __tc_http.content_length = esp_http_client_get_content_length(__tc_http.client);`,
    `    __tc_http.ok = (err == ESP_OK) && __tc_http.status >= 200 && __tc_http.status < 300;`,
    `    __tc_http.done = true;`,
    `    return __tc_http.ok;`,
    `}`,
    ``,
    `// Async send: perform on a worker task; poll __tc_http.done.`,
    `// 16 KB stack — TLS client hello / cert verify overflows the prior 8 KB.`,
    `static void __tc_http_send_task(void* arg) {`,
    `    (void)arg;`,
    `    __tc_http_send();`,
    `    vTaskDelete(NULL);`,
    `}`,
    ``,
    `static inline void __tc_http_send_start(void) {`,
    `    __tc_http.done = false;`,
    `    xTaskCreate(__tc_http_send_task, "tc_http", 16384, NULL, 5, NULL);`,
    `}`,
    ``,
    `static inline bool __tc_http_done(void) { return __tc_http.done; }`,
    `static inline int __tc_http_status(void) { return __tc_http.status; }`,
    `static inline bool __tc_http_ok(void) { return __tc_http.ok; }`,
    `static inline const char* __tc_http_body(void) { return __tc_http.resp ? __tc_http.resp : ""; }`,
    `static inline long __tc_http_content_length(void) { return (long)__tc_http.content_length; }`,
    ``,
    `static inline const char* __tc_http_response_header(const char* name) {`,
    `    char* value = NULL;`,
    `    __tc_http.resp_header[0] = 0;`,
    `    if (__tc_http.client && esp_http_client_get_header(__tc_http.client, name, &value) == ESP_OK && value) {`,
    `        strlcpy(__tc_http.resp_header, value, sizeof(__tc_http.resp_header));`,
    `    }`,
    `    return __tc_http.resp_header;`,
    `}`,
    `// CUTTLEFISH_HTTP_END`,
    ``,
  ];
}

const METHOD_MAP: Record<string, string> = {
  GET: 'HTTP_METHOD_GET',
  POST: 'HTTP_METHOD_POST',
  PUT: 'HTTP_METHOD_PUT',
  DELETE: 'HTTP_METHOD_DELETE',
  HEAD: 'HTTP_METHOD_HEAD',
  PATCH: 'HTTP_METHOD_PATCH',
};

function s(v: unknown): string {
  return String(v);
}

/** Resolve a HAL http.* op to native ESP-IDF C++ (via the __tc_http shim). */
export function lowerHttp(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'http.reset':
      return { code: `__tc_http_reset();` };
    case 'http.begin': {
      const methodName = String(o.method).replace(/^["']|["']$/g, '').toUpperCase();
      const method = METHOD_MAP[methodName] ?? 'HTTP_METHOD_GET';
      return { code: `__tc_http_begin(${method}, ${s(o.url)});` };
    }
    case 'http.set_header':
      return { code: `__tc_http_set_header(${s(o.name)}, ${s(o.value)});` };
    case 'http.set_timeout':
      return { code: `__tc_http_set_timeout(${s(o.ms)});` };
    case 'http.set_max_body':
      return { code: `__tc_http_set_max_body(${s(o.bytes)});` };
    case 'http.set_body':
      return { code: `__tc_http_set_body(${s(o.data)}, ${o.json ? 'true' : 'false'});` };
    case 'http.set_insecure':
      return { code: `__tc_http_set_insecure();` };
    case 'http.set_ca_cert':
      return { code: `__tc_http_set_ca_cert(${s(o.pem)});` };
    case 'http.send':
      return { expression: `__tc_http_send()` };
    case 'http.send_start':
      return { code: `__tc_http_send_start();` };
    case 'http.done':
      return { expression: `__tc_http_done()` };
    case 'http.status':
      return { expression: `__tc_http_status()` };
    case 'http.ok':
      return { expression: `__tc_http_ok()` };
    case 'http.body':
      return { expression: `__tc_http_body()` };
    case 'http.content_length':
      return { expression: `__tc_http_content_length()` };
    case 'http.response_header':
      return { expression: `__tc_http_response_header(${s(o.name)})` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
