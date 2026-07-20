import { describe, it, expect } from 'vitest';
import { lowerHttp, httpInitLines } from '../../../../packages/framework-esp32/src/lowering/http';

describe('http init block', () => {
  it('emits CUTTLEFISH_HTTP markers', () => {
    const lines = httpInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_HTTP_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_HTTP_END');
  });

  it('registers the IDF HTTP event handler', () => {
    expect(httpInitLines().join('\n')).toMatch(/__tc_http_event_cb/);
  });

  it('uses a 16 KB worker task stack (brownout-fix regression guard)', () => {
    // TLS client hello / cert verification overflows the Arduino-classic 8 KB
    // stack and reboots with no useful panic line. Lock the 16 KB value in.
    expect(httpInitLines().join('\n')).toMatch(/xTaskCreate\(__tc_http_send_task,\s*"tc_http",\s*16384,/);
  });
});

describe('http lowering — factory / lifecycle', () => {
  it('reset → __tc_http_reset();', () => {
    expect(lowerHttp({ operation: 'http.reset' })).toEqual({ code: '__tc_http_reset();' });
  });

  it('begin with GET method normalizes verb (already-uppercase)', () => {
    expect(lowerHttp({ operation: 'http.begin', method: '"GET"', url: '"https://example.com"' }))
      .toEqual({ code: '__tc_http_begin(HTTP_METHOD_GET, "https://example.com");' });
  });

  it('begin with quoted lowercase "post" → HTTP_METHOD_POST (confirms verb normalization)', () => {
    expect(lowerHttp({ operation: 'http.begin', method: '"post"', url: '"https://example.com"' }))
      .toEqual({ code: '__tc_http_begin(HTTP_METHOD_POST, "https://example.com");' });
  });

  it('begin with bare-uppercase PUT → HTTP_METHOD_PUT', () => {
    expect(lowerHttp({ operation: 'http.begin', method: 'PUT', url: '"https://example.com"' }))
      .toEqual({ code: '__tc_http_begin(HTTP_METHOD_PUT, "https://example.com");' });
  });

  it('begin with unknown method falls back to HTTP_METHOD_GET', () => {
    expect(lowerHttp({ operation: 'http.begin', method: '"CONNECT"', url: '"https://example.com"' }))
      .toEqual({ code: '__tc_http_begin(HTTP_METHOD_GET, "https://example.com");' });
  });
});

describe('http lowering — request setters', () => {
  it('set_header → __tc_http_set_header(name, value);', () => {
    expect(lowerHttp({ operation: 'http.set_header', name: '"X-Device"', value: '"cuttlefish"' }))
      .toEqual({ code: '__tc_http_set_header("X-Device", "cuttlefish");' });
  });
  it('set_timeout → __tc_http_set_timeout(ms);', () => {
    expect(lowerHttp({ operation: 'http.set_timeout', ms: 10000 }))
      .toEqual({ code: '__tc_http_set_timeout(10000);' });
  });
  it('set_max_body → __tc_http_set_max_body(bytes);', () => {
    expect(lowerHttp({ operation: 'http.set_max_body', bytes: 32768 }))
      .toEqual({ code: '__tc_http_set_max_body(32768);' });
  });
  it('set_body plain → __tc_http_set_body(data, false);', () => {
    expect(lowerHttp({ operation: 'http.set_body', data: '"raw=body"' }))
      .toEqual({ code: '__tc_http_set_body("raw=body", false);' });
  });
  it('set_body with json flag → __tc_http_set_body(data, true);', () => {
    expect(lowerHttp({ operation: 'http.set_body', data: '"{\\"x\\":1}"', json: true }))
      .toEqual({ code: '__tc_http_set_body("{\\"x\\":1}", true);' });
  });
  it('set_insecure → __tc_http_set_insecure();', () => {
    expect(lowerHttp({ operation: 'http.set_insecure' })).toEqual({ code: '__tc_http_set_insecure();' });
  });
  it('set_ca_cert → __tc_http_set_ca_cert(pem);', () => {
    expect(lowerHttp({ operation: 'http.set_ca_cert', pem: '"-----BEGIN CERTIFICATE-----"' }))
      .toEqual({ code: '__tc_http_set_ca_cert("-----BEGIN CERTIFICATE-----");' });
  });
});

describe('http lowering — send / response', () => {
  it('send (blocking) → __tc_http_send() expression', () => {
    expect(lowerHttp({ operation: 'http.send' })).toEqual({ expression: '__tc_http_send()' });
  });
  it('send_start (cooperative await half) → __tc_http_send_start(); statement', () => {
    expect(lowerHttp({ operation: 'http.send_start' })).toEqual({ code: '__tc_http_send_start();' });
  });
  it('done (poll predicate) → __tc_http_done()', () => {
    expect(lowerHttp({ operation: 'http.done' })).toEqual({ expression: '__tc_http_done()' });
  });
  it('status → __tc_http_status()', () => {
    expect(lowerHttp({ operation: 'http.status' })).toEqual({ expression: '__tc_http_status()' });
  });
  it('ok → __tc_http_ok()', () => {
    expect(lowerHttp({ operation: 'http.ok' })).toEqual({ expression: '__tc_http_ok()' });
  });
  it('body → __tc_http_body()', () => {
    expect(lowerHttp({ operation: 'http.body' })).toEqual({ expression: '__tc_http_body()' });
  });
  it('content_length → __tc_http_content_length()', () => {
    expect(lowerHttp({ operation: 'http.content_length' })).toEqual({ expression: '__tc_http_content_length()' });
  });
  it('response_header(name) → __tc_http_response_header(name)', () => {
    expect(lowerHttp({ operation: 'http.response_header', name: '"Content-Type"' }))
      .toEqual({ expression: '__tc_http_response_header("Content-Type")' });
  });
});

describe('http lowering — error handling', () => {
  it('unknown http.* op throws', () => {
    expect(() => lowerHttp({ operation: 'http.unknown' } as any)).toThrow(/does not yet support/);
  });
});
