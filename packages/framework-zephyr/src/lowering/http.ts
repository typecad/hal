// ---------------------------------------------------------------------------
// HTTP/S client lowering — Zephyr socket + http_client_req
//
// Unlike ESP-IDF's esp_http_client (which folds URL parse + DNS + connect +
// TLS into one perform call), Zephyr's <zephyr/net/http/client.h> runs
// http_client_req() over a *pre-connected* socket. The shim therefore owns the
// full connect path: parse scheme://host[:port]/path → getaddrinfo → socket
// (IPPROTO_TCP or IPPROTO_TLS_1_2 for https) → setsockopt TLS sec tags /
// hostname / peer-verify → connect() → http_client_req → accumulate body.
//
// One request slot at a time (embedded-friendly): factory/reset → setters →
// begin (inside send) → perform. Setters may run before begin and must survive
// it (req.timeout(ms); req.send()); options are cleared by __tc_http_reset
// when a new request starts (Http.get/post/…). Response body is heap-capped
// (default 8 KB), NUL-terminated, valid until the next begin/perform/reset.
//
// TLS: https selects IPPROTO_TLS_1_2 + NET_SOCKETS_SOCKOPT_TLS (which selects
// mbedTLS in Kconfig). insecure() sets TLS_PEER_VERIFY_NONE; caCert(pem)
// registers the PEM via tls_credential_add as a CA_CERTIFICATE sec tag and
// keeps verification required. No cert bundle attach (Zephyr has no ESP-IDF
// crt_bundle equivalent); https without caCert/insecure still requires the
// caller to have registered a CA, otherwise the handshake fails — that is the
// safe default.
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
 * The HTTP runtime shim. All helpers are `static`/`inline` so unused ones
 * don't trip -Wunused-function in the single generated TU (mirrors wifi.ts).
 *
 * The connect/perform path runs on the calling thread for the blocking send,
 * and on the system workqueue for the async send_start/done split. Completion
 * of the async path is signaled with a k_sem (give/take) which issues a full
 * memory barrier, so the consumer observes the resp/status/ok writes the
 * worker made before signaling — the same handoff guarantee ESP32's
 * xTaskNotifyGive provides.
 */
export function httpInitLines(): string[] {
  return [
    `// CUTTLEFISH_HTTP_BEGIN`,
    `#define __TC_HTTP_DEFAULT_MAX_BODY 8192`,
    `#define __TC_HTTP_MAX_HEADERS 8`,
    `#define __TC_HTTP_SEC_TAG 1`,
    ``,
    `// Single-slot request/response state. scheme/host/port/path are parsed`,
    `// from the url at perform time and drive the socket family + TLS choice.`,
    `// ca_cert is user-owned PEM; insecure skips peer verification entirely.`,
    `static struct {`,
    `    char url[512];`,
    `    char scheme[8];          // "http" or "https"`,
    `    char host[128];`,
    `    uint16_t port;           // 80 / 443 unless overridden in the url`,
    `    char path[256];          // resource path beginning with '/'`,
    `    enum http_method method;`,
    `    int32_t timeout_ms;`,
    `    size_t max_body;`,
    `    const char* body;        // request body (user-owned)`,
    `    int32_t body_len;`,
    `    bool insecure;`,
    `    const uint8_t* ca_der;    // DER, user-owned; nullptr = no pinned CA`,
    `    size_t ca_der_len;`,
    `    const char* hdr_name[__TC_HTTP_MAX_HEADERS];`,
    `    const char* hdr_value[__TC_HTTP_MAX_HEADERS];`,
    `    int32_t hdr_count;`,
    `    // response`,
    `    int32_t status;          // HTTP status code (0 = none/error)`,
    `    volatile bool done;      // set when a perform completes (ok or fail)`,
    `    bool ok;                 // transport ok AND 2xx`,
    `    char* resp;              // heap body buffer (max_body + 1, NUL-terminated)`,
    `    size_t resp_len;`,
    `    // Dedicated recv buffer for http_client_req. MUST be separate from resp:`,
    `    // http_client_req writes the raw response (headers + body) into recv_buf`,
    `    // and the parser walks it; the body callback then memcpy's body_frag into`,
    `    // resp. Sharing the two means the callback clobbers the buffer the parser`,
    `    // is still reading → EBADMSG (-77) on chunked/larger responses.`,
    `    uint8_t recvbuf[1024];`,
    `    int64_t content_length;  // -1 = unknown`,
    `    char resp_header[128];   // scratch for response_header()`,
    `    // staged header fields for http_client_req: a NULL-terminated list of`,
    `    // "Name: Value\\r\\n" strings built from hdr_name/hdr_value at perform.`,
    `    const char* hdr_fields[__TC_HTTP_MAX_HEADERS + 1];`,
    `    char hdr_field_buf[__TC_HTTP_MAX_HEADERS][64];`,
    `    // async completion signal (memory barrier between worker and poller)`,
    `    struct k_sem done_sem;`,
    `    bool sem_inited;`,
    `    struct k_work perform_work;`,
    `} __tc_http;`,
    ``,
    `// ── URL parser ──────────────────────────────────────────────────────────`,
    `// Splits "scheme://host[:port]/path" into the struct fields. http→80,`,
    `// https→443. Missing path becomes "/". Returns false on an unparseable url.`,
    `static bool __tc_http_parse_url(const char* url) {`,
    `    const char* p = url;`,
    `    // scheme up to "://"`,
    `    const char* sep = strstr(p, "://");`,
    `    if (sep == nullptr) return false;`,
    `    size_t scheme_len = static_cast<size_t>(sep - p);`,
    `    if (scheme_len >= sizeof(__tc_http.scheme)) scheme_len = sizeof(__tc_http.scheme) - 1U;`,
    `    for (size_t i = 0U; i < scheme_len; i++) {`,
    `        char c = p[i];`,
    `        __tc_http.scheme[i] = (c >= 'A' && c <= 'Z') ? static_cast<char>(c + 32) : c;`,
    `    }`,
    `    __tc_http.scheme[scheme_len] = '\\0';`,
    `    p = sep + 3; // past "://"`,
    `    // host up to ':' (port), '/' (path), or end`,
    `    size_t host_len = 0U;`,
    `    bool is_https = (strcmp(__tc_http.scheme, "https") == 0);`,
    `    __tc_http.port = is_https ? 443U : 80U;`,
    `    while (*p != '\\0' && *p != ':' && *p != '/' && host_len < (sizeof(__tc_http.host) - 1U)) {`,
    `        __tc_http.host[host_len++] = *p++;`,
    `    }`,
    `    __tc_http.host[host_len] = '\\0';`,
    `    // optional :port`,
    `    if (*p == ':') {`,
    `        p++;`,
    `        uint32_t portval = 0U;`,
    `        while (*p >= '0' && *p <= '9') {`,
    `            portval = (portval * 10U) + static_cast<uint32_t>(*p - '0');`,
    `            p++;`,
    `            if (portval > 65535U) { portval = 65535U; }`,
    `        }`,
    `        if (portval > 0U) __tc_http.port = static_cast<uint16_t>(portval);`,
    `    }`,
    `    // path (defaults to "/")`,
    `    if (*p == '/') {`,
    `        size_t path_len = 0U;`,
    `        while (*p != '\\0' && path_len < (sizeof(__tc_http.path) - 1U)) {`,
    `            __tc_http.path[path_len++] = *p++;`,
    `        }`,
    `        __tc_http.path[path_len] = '\\0';`,
    `    } else {`,
    `        __tc_http.path[0] = '/';`,
    `        __tc_http.path[1] = '\\0';`,
    `    }`,
    `    return host_len > 0U;`,
    `}`,
    ``,
    `// ── response callback ───────────────────────────────────────────────────`,
    `// http_response_cb_t: accumulate each body fragment into resp up to max_body,`,
    `// and capture the status code + content length from the first response.`,
    `static int __tc_http_resp_cb(struct http_response* rsp,`,
    `                             enum http_final_call final_data,`,
    `                             void* user_data) {`,
    `    (void)final_data;`,
    `    (void)user_data;`,
    `    if (rsp->http_status_code != 0U && __tc_http.status == 0) {`,
    `        __tc_http.status = static_cast<int32_t>(rsp->http_status_code);`,
    `    }`,
    `    if (rsp->cl_present != 0 && __tc_http.content_length < 0) {`,
    `        __tc_http.content_length = static_cast<int64_t>(rsp->content_length);`,
    `    }`,
    `    if (__tc_http.resp != nullptr && rsp->body_frag_start != nullptr && rsp->body_frag_len > 0U) {`,
    `        size_t room = __tc_http.max_body - __tc_http.resp_len;`,
    `        size_t n = (rsp->body_frag_len < room) ? rsp->body_frag_len : room;`,
    `        (void)memcpy(__tc_http.resp + __tc_http.resp_len, rsp->body_frag_start, n);`,
    `        __tc_http.resp_len += n;`,
    `    }`,
    `    return 0;`,
    `}`,
    ``,
    `// ── socket connect ──────────────────────────────────────────────────────`,
    `// zsock_getaddrinfo → zsock_socket(TCP | TLS_1_2) → TLS sockopts →`,
    `// zsock_connect. Uses the zsock_* (native Zephyr socket) API directly rather`,
    `// than the bare POSIX aliases: the POSIX socket() dispatcher (under`,
    `// CONFIG_POSIX_API) returns ENOENT when the net backend isn't registered as`,
    `// a POSIX socket family, whereas zsock_socket talks straight to the net`,
    `// socket service registered by NET_SOCKETS. zsock_* calls return negative`,
    `// errno on failure (not -1 + errno). For https, a pinned CA (ca_cert) is`,
    `// registered as a sec tag and verification kept required; insecure()`,
    `// relaxes it to NONE. Returns the connected fd or -1.`,
    `static int __tc_http_open_socket(void) {`,
    `    bool is_https = (strcmp(__tc_http.scheme, "https") == 0);`,
    `    char port_str[8];`,
    `    (void)snprintk(port_str, sizeof(port_str), "%u", static_cast<unsigned int>(__tc_http.port));`,
    `    struct zsock_addrinfo hints = { 0 };`,
    `    hints.ai_family = AF_INET;`,
    `    hints.ai_socktype = SOCK_STREAM;`,
    `    struct zsock_addrinfo* res = nullptr;`,
    `    int gai = zsock_getaddrinfo(__tc_http.host, port_str, &hints, &res);`,
    `    if (gai != 0 || res == nullptr) {`,
    `        printk("tc-http: DNS failed for %s (gai=%d)\\n", __tc_http.host, gai);`,
    `        return -1;`,
    `    }`,
    `    // IPPROTO_TLS_1_2 + the SOL_TLS sockopts are gated on`,
    `    // CONFIG_NET_SOCKETS_SOCKOPT_TLS (which selects mbedTLS). A plain-HTTP`,
    `    // build (the default — TLS isn't in the kconfig block because mbedTLS`,
    `    // needs a full user-config symbol matrix to link) compiles the TLS branch`,
    `    // out entirely, so it never references the unlinked tls_credential_add /`,
    `    // mbedtls symbols. HTTPS targets opt in via a per-program kconfig override.`,
    `    int sock = -1;`,
    `    if (is_https) {`,
    `#if defined(CONFIG_NET_SOCKETS_SOCKOPT_TLS)`,
    `        int sock_tls = zsock_socket(res->ai_family, res->ai_socktype, IPPROTO_TLS_1_2);`,
    `        if (sock_tls >= 0) {`,
            `            // Register the pinned CA as the active sec tag. tls_credential_add`,
    `            // is idempotent-enough for the single-slot model: a duplicate tag`,
    `            // is an error we ignore, and the most recently added cert wins.`,
    `            if (__tc_http.ca_der != nullptr) {`,
    `                int cred_rc = tls_credential_add(__TC_HTTP_SEC_TAG,`,
    `                                         TLS_CREDENTIAL_CA_CERTIFICATE,`,
    `                                         __tc_http.ca_der, __tc_http.ca_der_len);`,
    `                sec_tag_t tags[1] = { __TC_HTTP_SEC_TAG };`,
    `                (void)zsock_setsockopt(sock_tls, SOL_TLS, TLS_SEC_TAG_LIST, tags, sizeof(tags));`,
    `                (void)cred_rc;`,
    `            }`,
    `            // Hostname SNI + verification. insecure() disables verification;`,
    `            // the default (no caCert, no insecure) leaves verification required`,
    `            // with no sec tag, so the handshake fails safely until a CA is set.`,
    `            // mbedtls does not match IP literals against SAN entries —`,
    `            // skip the hostname check for IP hosts (chain-only verify).`,
    `            bool host_is_ip = true; for (const char* p3 = __tc_http.host; *p3 != 0; p3++) { if (!((*p3 >= '0' && *p3 <= '9') || *p3 == '.')) { host_is_ip = false; break; } }`,
    `            if (!host_is_ip) {`,
    `                (void)zsock_setsockopt(sock_tls, SOL_TLS, TLS_HOSTNAME, __tc_http.host, strlen(__tc_http.host) + 1U);`,
    `            }`,
    `            int32_t verify = __tc_http.insecure ? TLS_PEER_VERIFY_NONE : TLS_PEER_VERIFY_REQUIRED;`,
    `            (void)zsock_setsockopt(sock_tls, SOL_TLS, TLS_PEER_VERIFY, &verify, sizeof(verify));`,
    `        }`,
    `        sock = sock_tls;`,
    `#else`,
    `        printk("tc-http: https requested but CONFIG_NET_SOCKETS_SOCKOPT_TLS is off\\n");`,
    `        sock = -1;`,
    `#endif`,
    `    } else {`,
    `        sock = zsock_socket(res->ai_family, res->ai_socktype, IPPROTO_TCP);`,
    `    }`,
    `    if (sock < 0) {`,
    `        printk("tc-http: socket() failed (errno=%d)\\n", -sock);`,
    `        zsock_freeaddrinfo(res);`,
    `        return -1;`,
    `    }`,
    `    int cret = zsock_connect(sock, res->ai_addr, res->ai_addrlen);`,
    `    zsock_freeaddrinfo(res);`,
    `    if (cret < 0) {`,
    `        printk("tc-http: connect(%s:%u) failed (errno=%d)\\n", __tc_http.host,`,
    `               static_cast<unsigned int>(__tc_http.port), -cret);`,
    `        zsock_close(sock);`,
    `        return -1;`,
    `    }`,
    `    return sock;`,
    `}`,
    ``,
    `/** Clear request options + response; called when Http.get/post/… starts a new request. */`,
    `static inline void __tc_http_reset(void) {`,
    `    if (__tc_http.resp != nullptr) { delete[] __tc_http.resp; __tc_http.resp = nullptr; }`,
    `    __tc_http.timeout_ms = 15000;`,
    `    __tc_http.max_body = __TC_HTTP_DEFAULT_MAX_BODY;`,
    `    __tc_http.body = nullptr;`,
    `    __tc_http.body_len = 0;`,
    `    __tc_http.insecure = false;`,
    `    __tc_http.ca_der = nullptr;`,
    `    __tc_http.ca_der_len = 0;`,
    `    __tc_http.hdr_count = 0;`,
    `    __tc_http.status = 0;`,
    `    __tc_http.done = false;`,
    `    __tc_http.ok = false;`,
    `    __tc_http.resp_len = 0;`,
    `    __tc_http.content_length = -1;`,
    `    __tc_http.resp_header[0] = '\\0';`,
    `    __tc_http.url[0] = '\\0';`,
    `}`,
    ``,
    `/** Stage the request. Setters (timeout/max_body/body/tls/headers) survive begin. */`,
    `static inline void __tc_http_begin(enum http_method method, const char* url) {`,
    `    (void)strncpy(__tc_http.url, url, sizeof(__tc_http.url) - 1U);`,
    `    __tc_http.url[sizeof(__tc_http.url) - 1U] = '\\0';`,
    `    __tc_http.method = method;`,
    `    // Clear only the per-request response state — keep options set before send().`,
    `    if (__tc_http.resp != nullptr) { delete[] __tc_http.resp; __tc_http.resp = nullptr; }`,
    `    __tc_http.status = 0;`,
    `    __tc_http.done = false;`,
    `    __tc_http.ok = false;`,
    `    __tc_http.resp_len = 0;`,
    `    __tc_http.content_length = -1;`,
    `    __tc_http.resp_header[0] = '\\0';`,
    `}`,
    ``,
    `static inline void __tc_http_set_header(const char* name, const char* value) {`,
    `    if (__tc_http.hdr_count < __TC_HTTP_MAX_HEADERS) {`,
    `        __tc_http.hdr_name[__tc_http.hdr_count] = name;`,
    `        __tc_http.hdr_value[__tc_http.hdr_count] = value;`,
    `        __tc_http.hdr_count++;`,
    `    }`,
    `}`,
    ``,
    `static inline void __tc_http_set_timeout(int32_t ms) { __tc_http.timeout_ms = ms; }`,
    ``,
    `static inline void __tc_http_set_max_body(size_t bytes) { __tc_http.max_body = bytes; }`,
    ``,
    `// json=true stages Content-Type: application/json as an extra header so the`,
    `// server treats the body as JSON. The body itself is the caller's string.`,
    `static inline void __tc_http_set_body(const char* data, bool json) {`,
    `    __tc_http.body = data;`,
    `    __tc_http.body_len = (data != nullptr) ? static_cast<int32_t>(strlen(data)) : 0;`,
    `    if (json) __tc_http_set_header("Content-Type", "application/json");`,
    `}`,
    ``,
    `static inline void __tc_http_set_insecure(void) { __tc_http.insecure = true; }`,
    ``,
    `static inline void __tc_http_set_ca_cert_der(const uint8_t* der, size_t len) { __tc_http.ca_der = der; __tc_http.ca_der_len = len; }`,
    ``,
    `// ── perform (the shared blocking core) ──────────────────────────────────`,
    `// Parse url → open socket → build http_request → http_client_req → close.`,
    `// Sets status/ok/done. On a fresh resp buffer (heap, max_body+1, NUL-terminated).`,
    `static void __tc_http_perform(void) {`,
    `    __tc_http.ok = false;`,
    `    __tc_http.done = false;`,
    `    if (!__tc_http_parse_url(__tc_http.url)) {`,
    `        printk("tc-http: bad url\\n");`,
    `        __tc_http.done = true;`,
    `        return;`,
    `    }`,
    `    if (__tc_http.resp != nullptr) { delete[] __tc_http.resp; __tc_http.resp = nullptr; }`,
    `    __tc_http.resp_len = 0;`,
    `    __tc_http.resp = new (std::nothrow) char[__tc_http.max_body + 1U];`,
    `    if (__tc_http.resp == nullptr) {`,
    `        printk("tc-http: out of memory for %u-byte body\\n",`,
    `               static_cast<unsigned int>(__tc_http.max_body));`,
    `        __tc_http.done = true;`,
    `        return;`,
    `    }`,
    `    __tc_http.resp[0] = '\\0';`,
    `    int sock = __tc_http_open_socket();`,
    `    if (sock < 0) { __tc_http.done = true; return; }`,
    `    // Build the NULL-terminated header-fields list from staged headers.`,
    `    for (int32_t i = 0; i < __tc_http.hdr_count && i < __TC_HTTP_MAX_HEADERS; i++) {`,
    `        (void)snprintk(__tc_http.hdr_field_buf[i], sizeof(__tc_http.hdr_field_buf[i]),`,
    `                       "%s: %s\\r\\n", __tc_http.hdr_name[i], __tc_http.hdr_value[i]);`,
    `        __tc_http.hdr_fields[i] = __tc_http.hdr_field_buf[i];`,
    `    }`,
    `    __tc_http.hdr_fields[(__tc_http.hdr_count < __TC_HTTP_MAX_HEADERS)`,
    `                         ? __tc_http.hdr_count : __TC_HTTP_MAX_HEADERS] = nullptr;`,
    `    struct http_request req = { 0 };`,
    `    req.method = __tc_http.method;`,
    `    req.url = __tc_http.path;`,
    `    req.host = __tc_http.host;`,
    `    req.protocol = "HTTP/1.1";`,
    `    req.response = __tc_http_resp_cb;`,
    `    req.recv_buf = __tc_http.recvbuf;`,
    `    req.recv_buf_len = sizeof(__tc_http.recvbuf);`,
    `    req.header_fields = (__tc_http.hdr_count > 0) ? __tc_http.hdr_fields : nullptr;`,
    `    if (__tc_http.body != nullptr) {`,
    `        req.payload = __tc_http.body;`,
    `        req.payload_len = static_cast<size_t>(__tc_http.body_len);`,
    `    }`,
    `    int sent = http_client_req(sock, &req, __tc_http.timeout_ms, nullptr);`,
    `    // The response callback (__tc_http_resp_cb) captures the status, but Zephyr's`,
    `    // parser aborts on 5xx responses (on_headers_complete returns 1 for status`,
    `    // >= 500, which http_parser treats as an error → http_client_req returns`,
    `    // -EBADMSG and the response callback may not fire). The on_status parser`,
    `    // hook still runs first and sets http_status_code, so read it back directly`,
    `    // from the response struct when the callback path didn't capture it.`,
    `    if (__tc_http.status == 0 && req.internal.response.http_status_code != 0U) {`,
    `        __tc_http.status = static_cast<int32_t>(req.internal.response.http_status_code);`,
    `    }`,
    `    // Full shutdown before close so the net_context is reclaimed promptly: a`,
    `    // bare zsock_close on Zephyr leaves the TCP context in a deferred-release`,
    `    // state, and rapid sequential requests exhaust NET_MAX_CONTEXTS (socket/`,
    `    // connect then return -EPERM). SHUT_RDWR triggers an immediate FIN exchange.`,
    `    (void)zsock_shutdown(sock, SHUT_RDWR);`,
    `    (void)zsock_close(sock);`,
    `    // NUL-terminate the accumulated body at the cap.`,
    `    size_t end = (__tc_http.resp_len < __tc_http.max_body) ? __tc_http.resp_len : __tc_http.max_body;`,
    `    __tc_http.resp[end] = '\\0';`,
    `    __tc_http.ok = (sent >= 0) && __tc_http.status >= 200 && __tc_http.status < 300;`,
    `    __tc_http.done = true;`,
    `}`,
    ``,
    `/** Blocking send: perform on the calling thread, return ok. */`,
    `static inline bool __tc_http_send(void) {`,
    `    __tc_http_perform();`,
    `    return __tc_http.ok;`,
    `}`,
    ``,
    `// ── async split (workqueue + k_sem) ──────────────────────────────────────`,
    `// perform on the system workqueue; poll __tc_http_done. k_sem_give issues a`,
    `// full memory barrier on completion, so the poller observes resp/status/ok`,
    `// before done flips — the same handoff ESP32's xTaskNotifyGive provides.`,
    `static void __tc_http_perform_work(struct k_work* w) {`,
    `    (void)w;`,
    `    __tc_http_perform();`,
    `    k_sem_give(&__tc_http.done_sem);`,
    `}`,
    ``,
    `static inline void __tc_http_send_start(void) {`,
    `    if (!__tc_http.sem_inited) {`,
    `        k_sem_init(&__tc_http.done_sem, 0, 1);`,
    `        __tc_http.sem_inited = true;`,
    `    }`,
    `    __tc_http.done = false;`,
    `    // Drain any completion signal left from a previous request (e.g. the`,
    `    // prior done() saw the volatile flag before taking the sem), so the first`,
    `    // poll of this request doesn't fire on a stale signal.`,
    `    (void)k_sem_take(&__tc_http.done_sem, K_NO_WAIT);`,
    `    k_work_init(&__tc_http.perform_work, __tc_http_perform_work);`,
    `    (void)k_work_submit(&__tc_http.perform_work);`,
    `}`,
    ``,
    `// Poll predicate: true once the worker has signaled completion. The`,
    `// k_sem_take(K_NO_WAIT) is non-blocking and consumes the signal on the first`,
    `// observed completion — its barrier makes resp/status/ok safe to read.`,
    `static inline bool __tc_http_done(void) {`,
    `    if (__tc_http.done) return true;`,
    `    if (k_sem_take(&__tc_http.done_sem, K_NO_WAIT) == 0) { __tc_http.done = true; return true; }`,
    `    return false;`,
    `}`,
    ``,
    `// ── response readers ────────────────────────────────────────────────────`,
    `static inline int32_t __tc_http_status(void) { return __tc_http.status; }`,
    `static inline bool __tc_http_ok(void) { return __tc_http.ok; }`,
    `static inline const char* __tc_http_body(void) {`,
    `    return (__tc_http.resp != nullptr) ? __tc_http.resp : "";`,
    `}`,
    `static inline int32_t __tc_http_content_length(void) {`,
    `    return static_cast<int32_t>(__tc_http.content_length);`,
    `}`,
    ``,
    `// Response-header lookup. The Zephyr http_client_req surface does not expose`,
    `// arbitrary response headers via the recv buffer; this returns the last`,
    `// header captured by the response callback path. With no per-header hook`,
    `// it returns "" until a richer parser setting is wired (http_cb).`,
    `static inline const char* __tc_http_response_header(const char* name) {`,
    `    (void)name;`,
    `    __tc_http.resp_header[0] = '\\0';`,
    `    return __tc_http.resp_header;`,
    `}`,
    `// CUTTLEFISH_HTTP_END`,
    ``,
  ];
}

const METHOD_MAP: Record<string, string> = {
  GET: 'HTTP_GET',
  POST: 'HTTP_POST',
  PUT: 'HTTP_PUT',
  DELETE: 'HTTP_DELETE',
  HEAD: 'HTTP_HEAD',
  PATCH: 'HTTP_PATCH',
};

/**
 * Resolve a HAL http.* op to Zephyr C++ via the __tc_http_* shim. Returns
 * `{ code }` for statement ops, `{ expression }` for value-returning ops.
 * The method string on http.begin may arrive quoted ("GET"); strip quotes and
 * normalize to the Zephyr enum constant (GET→HTTP_GET, etc.).
 */
export function lowerHttp(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'http.begin': {
      const methodName = String(o.method).replace(/^["']|["']$/g, '').toUpperCase();
      const method = METHOD_MAP[methodName] ?? 'HTTP_GET';
      // Fresh shim state per request — the reset used to ride the deleted
      // factory op (http.reset); construction now owns it.
      return { code: `__tc_http_reset(); __tc_http_begin(${method}, ${s(o.url)});` };
    }
    case 'http.set_header':
      return { code: `__tc_http_set_header(${s(o.name)}, ${s(o.value)});` };
    case 'http.set_timeout':
      return { code: `__tc_http_set_timeout(${s(o.ms)});` };
    case 'http.set_max_body':
      return { code: `__tc_http_set_max_body(${s(o.bytes)});` };
    case 'http.set_body':
      // '' is the no-body sentinel — the op always emits from send(); elide.
      return { code: o.data === '""' || o.data === '' ? '' : `__tc_http_set_body(${s(o.data)}, ${o.json ? 'true' : 'false'});` };
    case 'http.set_insecure':
      return { code: o.insecure ? `__tc_http_set_insecure();` : '' };
    case 'http.set_ca_cert': {
      // This tree's tf-psa-crypto mbedTLS has no PEM parser (MBEDTLS_PEM_C is
      // not settable) — decode the PEM literal to DER here and emit a static
      // byte array. tls_credential_add takes the DER directly (crt_is_pem is
      // false → mbedtls_x509_crt_parse_der_nocopy on the verify path).
      const pem = String(o.pem).replace(/^"|"$/g, '').replace(/\\n/g, '\n');
      if (pem.replace(/\s+/g, '') === '') {
        // No-CA sentinel (Request always emits the op; opts.caCert defaults
        // to '') — elide silently so plain-HTTP requests carry no comment.
        return { code: '' };
      }
      const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
      const der = Buffer.from(b64, 'base64');
      if (der.length < 100) return { code: `// tc-http: caCert PEM failed to decode` };
      const hex = [...der].map((b) => `0x${b.toString(16).padStart(2, '0')}`).join(', ');
      return { code: `{ static const uint8_t __tc_ca_der[] = { ${hex} }; __tc_http_set_ca_cert_der(__tc_ca_der, sizeof(__tc_ca_der)); }` };
    }
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
      throw new Error(`framework-zephyr does not yet support HAL op \`${op.operation}\`.`);
  }
}
