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
    expect(shim).toContain('const char* ca_cert');
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

  it('heap-allocates the body buffer with new (std::nothrow) (AUTOSAR: no malloc)', () => {
    expect(shim).toContain('new (std::nothrow) char[__tc_http.max_body');
    expect(shim).not.toContain('malloc(');
  });

  it('delete[]s the body buffer on reset/begin/perform (no leak across requests)', () => {
    expect(shim).toContain('delete[] __tc_http.resp');
  });
});

describe('http lowering — request/response ops', () => {
  it('reset → __tc_http_reset()', () => {
    expect(lowerHttp({ operation: 'http.reset' } as any))
      .toEqual({ code: '__tc_http_reset();' });
  });

  it('begin GET → __tc_http_begin(HTTP_GET, url)', () => {
    // Zephyr's enum is HTTP_GET (no METHOD_ infix), unlike esp_http_client's
    // HTTP_METHOD_GET.
    expect(lowerHttp({ operation: 'http.begin', method: '"GET"', url: '"https://x"' } as any))
      .toEqual({ code: '__tc_http_begin(HTTP_GET, "https://x");' });
  });

  it('begin normalizes a bare/quoted method string to the Zephyr enum', () => {
    // The resolver may pass the verb with or without quotes; both must map.
    expect(lowerHttp({ operation: 'http.begin', method: 'GET', url: '"http://x"' } as any))
      .toEqual({ code: '__tc_http_begin(HTTP_GET, "http://x");' });
  });

  it('begin POST/PUT/DELETE/HEAD/PATCH → the matching HTTP_*', () => {
    expect(lowerHttp({ operation: 'http.begin', method: '"POST"', url: '"u"' } as any))
      .toEqual({ code: '__tc_http_begin(HTTP_POST, "u");' });
    expect(lowerHttp({ operation: 'http.begin', method: '"PUT"', url: '"u"' } as any))
      .toEqual({ code: '__tc_http_begin(HTTP_PUT, "u");' });
    expect(lowerHttp({ operation: 'http.begin', method: '"DELETE"', url: '"u"' } as any))
      .toEqual({ code: '__tc_http_begin(HTTP_DELETE, "u");' });
    expect(lowerHttp({ operation: 'http.begin', method: '"HEAD"', url: '"u"' } as any))
      .toEqual({ code: '__tc_http_begin(HTTP_HEAD, "u");' });
    expect(lowerHttp({ operation: 'http.begin', method: '"PATCH"', url: '"u"' } as any))
      .toEqual({ code: '__tc_http_begin(HTTP_PATCH, "u");' });
  });

  it('begin with an unknown verb falls back to HTTP_GET', () => {
    expect(lowerHttp({ operation: 'http.begin', method: '"BOGUS"', url: '"u"' } as any))
      .toEqual({ code: '__tc_http_begin(HTTP_GET, "u");' });
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
    expect(lowerHttp({ operation: 'http.set_insecure' } as any))
      .toEqual({ code: '__tc_http_set_insecure();' });
    expect(lowerHttp({ operation: 'http.set_ca_cert', pem: '"-----BEGIN CERT-----"' } as any))
      .toEqual({ code: '__tc_http_set_ca_cert("-----BEGIN CERT-----");' });
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
