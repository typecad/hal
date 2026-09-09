import { describe, it, expect } from 'vitest';
import { lowerHttp, httpInitLines } from '../../../../packages/framework-zephyr/src/lowering/http';

describe('http init shim', () => {
  const shim = httpInitLines().join('\n');

  it('emits CUTTLEFISH_HTTP markers + the __tc_http state struct', () => {
    expect(shim).toContain('// CUTTLEFISH_HTTP_BEGIN');
    expect(shim).toContain('// CUTTLEFISH_HTTP_END');
    expect(shim).toContain('static struct');
    expect(shim).toContain('__tc_http');
    // Core request/response fields.
    expect(shim).toContain('char url[512]');
    expect(shim).toContain('enum http_method method');
    expect(shim).toContain('bool insecure');
    expect(shim).toContain('const uint8_t* ca_der');   // DER since the tf-psa-crypto tree dropped PEM
    expect(shim).toContain('hdr_name');
    expect(shim).toContain('volatile bool done');
  });

  it('drives the request over Zephyr sockets (http_client_req + getaddrinfo)', () => {
    // Unlike esp_http_client, Zephyr's http_client_req runs over a pre-connected
    // socket — the shim must do DNS + connect itself.
    expect(shim).toContain('http_client_req');
    expect(shim).toContain('getaddrinfo');
    expect(shim).toContain('freeaddrinfo');
    expect(shim).toContain('socket(');
    expect(shim).toContain('connect(');
  });

  it('parses the url into scheme/host/port/path', () => {
    expect(shim).toContain('__tc_http_parse_url');
    expect(shim).toContain('"://"');
    // http→80, https→443 drives the TLS choice.
    expect(shim).toContain('443U');
    expect(shim).toContain('80U');
  });

  it('accumulates the response body via the http_response_cb_t', () => {
    expect(shim).toContain('__tc_http_resp_cb');
    expect(shim).toContain('body_frag_start');
    expect(shim).toContain('body_frag_len');
    expect(shim).toContain('http_status_code');
  });

  it('wires HTTPS via IPPROTO_TLS_1_2 + TLS sockopts (mbedTLS)', () => {
    expect(shim).toContain('IPPROTO_TLS_1_2');
    expect(shim).toContain('IPPROTO_TCP');
    expect(shim).toContain('TLS_SEC_TAG_LIST');
    expect(shim).toContain('TLS_HOSTNAME');
    expect(shim).toContain('tls_credential_add');
    // insecure() → verify none; default → required.
    expect(shim).toContain('TLS_PEER_VERIFY_NONE');
    expect(shim).toContain('TLS_PEER_VERIFY_REQUIRED');
  });

  it('uses the system workqueue + k_sem for the async split', () => {
    expect(shim).toContain('struct k_work perform_work');
    expect(shim).toContain('struct k_sem done_sem');
    expect(shim).toContain('k_work_submit');
    expect(shim).toContain('k_sem_give');
    expect(shim).toContain('k_sem_take');
  });

  it('guards the async single-slot: work init once, busy check, wait-idle before reset', () => {
    // k_work_init on a queued/running item is undefined; reset must not clear
    // state the workqueue is still writing.
    expect(shim).toContain('work_inited');
    expect(shim).toContain('k_work_is_pending(&__tc_http.perform_work)');
    expect(shim).toContain('still in flight');
    expect(shim).toContain('__tc_http_wait_async_idle');
  });

  it('captures response headers via the http_parser hooks (req.http_cb)', () => {
    expect(shim).toContain('__tc_http_on_hdr_field');
    expect(shim).toContain('__tc_http_on_hdr_value');
    expect(shim).toContain('__tc_http_hdr_finish');
    expect(shim).toContain('req.http_cb = &__tc_http_parse_settings;');
    // The lookup scans the captured block — the old "(void)name;" stub is gone.
    expect(shim).toContain('char resp_headers[768]');
    expect(shim).not.toContain('(void)name;');
  });

  it('stages header fields with a guaranteed CRLF (truncation cannot swallow a line)', () => {
    expect(shim).toContain('char hdr_field_buf[__TC_HTTP_MAX_HEADERS][128]');
    expect(shim).toContain('sizeof(__tc_http.hdr_field_buf[i]) - 2U');
  });

  it('uses a strict IPv4 predicate for the TLS hostname skip', () => {
    // A digit-and-dot scan would swallow numeric-only DNS names ("123").
    expect(shim).toContain('__tc_http_host_is_ipv4');
  });

  it('reports credential-store conflicts instead of silently keeping the first CA', () => {
    // Zephyr's tls_credential_add never replaces a tag: duplicates are skipped
    // by pointer identity, a different CA at an occupied tag is printed.
    expect(shim).toContain('ca_added_set');
    expect(shim).toContain('already holds a CA');
  });

  it('refuses overlong urls/hosts/paths instead of silently truncating them', () => {
    expect(shim).toContain('url longer than');
    expect(shim).toContain('host longer than');
    expect(shim).toContain('path longer than');
    expect(shim).toContain('char path[384]');
  });

  it('heap-allocates the body buffer with new (std::nothrow) (AUTOSAR: no malloc)', () => {
    expect(shim).toContain('new (std::nothrow) char[__tc_http.max_body');
    expect(shim).not.toContain('malloc(');
  });

  it('delete[]s the body buffer on reset/begin/perform (no leak across requests)', () => {
    expect(shim).toContain('delete[] __tc_http.resp');
  });
});

describe('http lowering — request/response ops', () => {
  it('reset is folded into begin (fresh shim state per request)', () => {
    expect(lowerHttp({ operation: 'http.begin', method: '"GET"', url: '"https://x"' } as any))
      .toEqual({ code: '__tc_http_reset(); __tc_http_begin(HTTP_GET, "https://x");' });
  });

  it('begin re-stages instance-recorded headers AFTER the reset', () => {
    // header() call sites emit before send(); the reset inside begin wipes
    // them, so the op carries the recorded pairs and replays them post-reset.
    expect(lowerHttp({ operation: 'http.begin', method: '"GET"', url: '"https://x"', headers: [['"X-A"', '"1"'], ['"X-B"', '"2"']] } as any))
      .toEqual({ code: '__tc_http_reset(); __tc_http_set_header("X-A", "1"); __tc_http_set_header("X-B", "2"); __tc_http_begin(HTTP_GET, "https://x");' });
  });

  it('begin GET → __tc_http_begin(HTTP_GET, url)', () => {
    // Zephyr's enum is HTTP_GET (no METHOD_ infix), unlike esp_http_client's
    // HTTP_METHOD_GET.
    expect(lowerHttp({ operation: 'http.begin', method: '"GET"', url: '"https://x"' } as any))
      .toEqual({ code: '__tc_http_reset(); __tc_http_begin(HTTP_GET, "https://x");' });
  });

  it('begin normalizes a bare/quoted method string to the Zephyr enum', () => {
    // The resolver may pass the verb with or without quotes; both must map.
    expect(lowerHttp({ operation: 'http.begin', method: 'GET', url: '"http://x"' } as any))
      .toEqual({ code: '__tc_http_reset(); __tc_http_begin(HTTP_GET, "http://x");' });
  });

  it('begin POST/PUT/DELETE/HEAD/PATCH → the matching HTTP_*', () => {
    expect(lowerHttp({ operation: 'http.begin', method: '"POST"', url: '"u"' } as any))
      .toEqual({ code: '__tc_http_reset(); __tc_http_begin(HTTP_POST, "u");' });
    expect(lowerHttp({ operation: 'http.begin', method: '"PUT"', url: '"u"' } as any))
      .toEqual({ code: '__tc_http_reset(); __tc_http_begin(HTTP_PUT, "u");' });
    expect(lowerHttp({ operation: 'http.begin', method: '"DELETE"', url: '"u"' } as any))
      .toEqual({ code: '__tc_http_reset(); __tc_http_begin(HTTP_DELETE, "u");' });
    expect(lowerHttp({ operation: 'http.begin', method: '"HEAD"', url: '"u"' } as any))
      .toEqual({ code: '__tc_http_reset(); __tc_http_begin(HTTP_HEAD, "u");' });
    expect(lowerHttp({ operation: 'http.begin', method: '"PATCH"', url: '"u"' } as any))
      .toEqual({ code: '__tc_http_reset(); __tc_http_begin(HTTP_PATCH, "u");' });
  });

  it('begin with an unknown verb falls back to HTTP_GET', () => {
    expect(lowerHttp({ operation: 'http.begin', method: '"BOGUS"', url: '"u"' } as any))
      .toEqual({ code: '__tc_http_reset(); __tc_http_begin(HTTP_GET, "u");' });
  });

  it('set_header → shim call', () => {
    expect(lowerHttp({ operation: 'http.set_header', name: '"X-Device"', value: '"cf"' } as any))
      .toEqual({ code: '__tc_http_set_header("X-Device", "cf");' });
  });

  it('set_timeout / set_max_body → shim calls', () => {
    expect(lowerHttp({ operation: 'http.set_timeout', ms: 10000 } as any))
      .toEqual({ code: '__tc_http_set_timeout(10000);' });
    expect(lowerHttp({ operation: 'http.set_max_body', bytes: 4096 } as any))
      .toEqual({ code: '__tc_http_set_max_body(4096);' });
  });

  it('set_body passes the json flag through verbatim', () => {
    // The json flag is the trailing bool arg; the data may contain quotes/braces,
    // so match the call shape loosely (anything up to the flag) rather than the
    // quoted-data payload.
    expect(lowerHttp({ operation: 'http.set_body', data: '"{\"t\":1}"', json: true } as any))
      .toMatchObject({ code: expect.stringMatching(/__tc_http_set_body\(.*,\s*true\);$/) });
    expect(lowerHttp({ operation: 'http.set_body', data: '"raw=1"', json: false } as any))
      .toMatchObject({ code: expect.stringMatching(/__tc_http_set_body\(.*,\s*false\);$/) });
  });

  it('set_insecure / set_ca_cert → shim calls', () => {
    // ca_cert PEM decodes to DER at emit time (this tree has no PEM parser);
    // the DER must start with the ASN.1 SEQUENCE tag (0x30) to pass the
    // sanity check.
    expect(lowerHttp({ operation: 'http.set_insecure', insecure: true } as any))
      .toEqual({ code: '__tc_http_set_insecure();' });
    const derB64 = Buffer.concat([Buffer.from([0x30, 0x82, 0x01, 0x0a]), Buffer.alloc(120, 0x41)]).toString('base64');
    const out = lowerHttp({ operation: 'http.set_ca_cert', pem: `"-----BEGIN CERTIFICATE-----\\n${derB64}\\n-----END CERTIFICATE-----\\n"` } as any);
    expect(out?.code).toContain('static const uint8_t __tc_ca_der[] = { 0x30, 0x82');   // PEM decodes to DER
    expect(out?.code).toContain('__tc_http_set_ca_cert_der(__tc_ca_der, sizeof(__tc_ca_der));');
  });

  it('send → expression (blocking perform)', () => {
    expect(lowerHttp({ operation: 'http.send' } as any))
      .toEqual({ expression: '__tc_http_send()' });
  });

  it('send_start + done form the async split', () => {
    expect(lowerHttp({ operation: 'http.send_start' } as any))
      .toEqual({ code: '__tc_http_send_start();' });
    expect(lowerHttp({ operation: 'http.done' } as any))
      .toEqual({ expression: '__tc_http_done()' });
  });

  it('status / ok / body / content_length → expression readers', () => {
    expect(lowerHttp({ operation: 'http.status' } as any)).toEqual({ expression: '__tc_http_status()' });
    expect(lowerHttp({ operation: 'http.ok' } as any)).toEqual({ expression: '__tc_http_ok()' });
    expect(lowerHttp({ operation: 'http.body' } as any)).toEqual({ expression: '__tc_http_body()' });
    expect(lowerHttp({ operation: 'http.content_length' } as any)).toEqual({ expression: '__tc_http_content_length()' });
  });

  it('response_header → expression with the header name', () => {
    expect(lowerHttp({ operation: 'http.response_header', name: '"Content-Type"' } as any))
      .toEqual({ expression: '__tc_http_response_header("Content-Type")' });
  });
});

describe('http lowering — unknown http.* op throws', () => {
  // All 16 http.* ops are lowered; there are no genuinely-unsupported ones. The
  // default arm throws a clear "unsupported op" error so coverage stays honest
  // (mirrors framework-esp32's lowerHttp).
  it('throws on an unrecognized http.* op', () => {
    expect(() => lowerHttp({ operation: 'http.bogus' } as any)).toThrow(/http\.bogus/);
  });
});
