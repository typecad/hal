// ---------------------------------------------------------------------------
// HAL HTTP Tests — Zephyr transpilation
//
// End-to-end coverage of the thin Request class through the
// ZephyrStrategy: construction facts (method/url/opts), the header() chain,
// blocking vs async send, and the single-slot __tc_http shim. Uses
// transpileZephyrStrategy() because the http.* ops lower via
// ZephyrStrategy.resolveHALOperation, which the plain transpile() helper does
// not activate.
//
// The contract under test: verb lowering (Request.GET tokens + plain
// strings), facts-at-construction (timeout/body/json/insecure/caCert ride
// the constructor; the shim setters emit from send()), response accessors,
// the cooperative-await split, and clean compile.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { expectCppContains, hasInclude, transpileZephyrStrategy } from '../../setup';

describe('HTTP HAL — Zephyr transpilation', () => {
  describe('GET smoke', () => {
    const snippet = `
      import { Request } from '@typecad/hal';
      new Request(Request.GET, "https://example.com").send();
    `;

    it('begins with HTTP_GET and url (fresh shim state per request)', () => {
      // Zephyr's enum is HTTP_GET (no METHOD_ infix), unlike esp_http_client's
      // HTTP_METHOD_GET.
      const result = transpileZephyrStrategy(snippet);
      expectCppContains(result, ['__tc_http_reset(); __tc_http_begin(HTTP_GET, "https://example.com");']);
    });

    it('emits the blocking __tc_http_send() call', () => {
      const result = transpileZephyrStrategy(snippet);
      expect(result.cpp).toMatch(/__tc_http_send\(\)/);
    });

    it('forces the Zephyr http client + socket headers only when Request is used', () => {
      const result = transpileZephyrStrategy(snippet);
      expect(hasInclude(result.cpp, '<zephyr/net/http/client.h>')).toBe(true);
      expect(hasInclude(result.cpp, '<zephyr/net/socket.h>')).toBe(true);
    });

    it('emits the CUTTLEFISH_HTTP shim block', () => {
      const result = transpileZephyrStrategy(snippet);
      expect(result.cpp).toContain('// CUTTLEFISH_HTTP_BEGIN');
      expect(result.cpp).toContain('// CUTTLEFISH_HTTP_END');
    });
  });

  describe('verb normalization', () => {
    it('Request.POST token → HTTP_POST', () => {
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        new Request(Request.POST, "https://example.com").send();
      `);
      expectCppContains(result, ['__tc_http_begin(HTTP_POST, "https://example.com");']);
    });

    it('Request.DELETE token → HTTP_DELETE', () => {
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        new Request(Request.DELETE, "https://example.com").send();
      `);
      expectCppContains(result, ['__tc_http_begin(HTTP_DELETE, "https://example.com");']);
    });

    it("plain 'put' string also normalizes (tokens are sugar)", () => {
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        new Request('put', "https://example.com").send();
      `);
      expectCppContains(result, ['__tc_http_begin(HTTP_PUT, "https://example.com");']);
    });
  });

  describe('construction facts (opts lower from send())', () => {
    it('header() → __tc_http_set_header (declaration chain)', () => {
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        new Request(Request.GET, "https://example.com").header("X-Device", "typecad-hal").send();
      `);
      expectCppContains(result, ['__tc_http_set_header("X-Device", "typecad-hal");']);
    });

    it('body + json: true → __tc_http_set_body with json=true', () => {
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        new Request(Request.POST, "https://example.com", { body: '{"temp":21.5}', json: true }).send();
      `);
      expect(result.cpp).toMatch(/__tc_http_set_body\([^,]+,\s*true\)/);
    });

    it('body without json → __tc_http_set_body with json=false', () => {
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        new Request(Request.POST, "https://example.com", { body: "raw=1" }).send();
      `);
      expect(result.cpp).toMatch(/__tc_http_set_body\([^,]+,\s*false\)/);
    });

    it('absent body elides the setter call entirely', () => {
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        new Request(Request.GET, "https://example.com").send();
      `);
      const withoutShim = result.cpp.replace(
        /\/\/ CUTTLEFISH_HTTP_BEGIN[\s\S]*?\/\/ CUTTLEFISH_HTTP_END/g, '',
      );
      expect(withoutShim).not.toMatch(/__tc_http_set_body/);
    });

    it('timeoutMs → __tc_http_set_timeout', () => {
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        new Request(Request.GET, "https://example.com", { timeoutMs: 10000 }).send();
      `);
      expectCppContains(result, ['__tc_http_set_timeout(10000);']);
    });

    it('absent timeout still carries the class default', () => {
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        new Request(Request.GET, "https://example.com").send();
      `);
      expectCppContains(result, ['__tc_http_set_timeout(10000);']);
    });

    it('insecure: true → __tc_http_set_insecure; absent elides', () => {
      const withInsecure = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        new Request(Request.GET, "https://example.com", { insecure: true }).send();
      `);
      expectCppContains(withInsecure, ['__tc_http_set_insecure();']);
      const without = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        new Request(Request.GET, "https://example.com").send();
      `);
      const withoutShim = without.cpp.replace(
        /\/\/ CUTTLEFISH_HTTP_BEGIN[\s\S]*?\/\/ CUTTLEFISH_HTTP_END/g, '',
      );
      expect(withoutShim).not.toMatch(/__tc_http_set_insecure/);
    });

    it('caCert PEM decodes to a DER byte array', () => {
      // Synthetic but well-formed DER head (ASN.1 SEQUENCE, 0x30 0x82) with
      // enough payload to clear the decoder's sanity floor.
      const derB64 = Buffer.concat([Buffer.from([0x30, 0x82, 0x01, 0x0a]), Buffer.alloc(120, 0x41)]).toString('base64');
      const pem = `-----BEGIN CERTIFICATE-----\n${derB64}\n-----END CERTIFICATE-----`;
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        const PEM = "${pem.replace(/\n/g, '\\n')}";
        new Request(Request.GET, "https://example.com", { caCert: PEM }).send();
      `);
      expect(result.cpp).toContain('static const uint8_t __tc_ca_der[] = { 0x30, 0x82');
      expect(result.cpp).toContain('__tc_http_set_ca_cert_der(__tc_ca_der, sizeof(__tc_ca_der));');
    });

    it('caCert payload that is not DER (no 0x30 head) is rejected at emit', () => {
      const derB64 = Buffer.concat([Buffer.from([0x00, 0x01, 0x02]), Buffer.alloc(120, 0x41)]).toString('base64');
      const pem = `-----BEGIN CERTIFICATE-----\n${derB64}\n-----END CERTIFICATE-----`;
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        new Request(Request.GET, "https://example.com", { caCert: "${pem.replace(/\n/g, '\\n')}" }).send();
      `);
      const withoutShim = result.cpp.replace(
        /\/\/ CUTTLEFISH_HTTP_BEGIN[\s\S]*?\/\/ CUTTLEFISH_HTTP_END/g, '',
      );
      expect(withoutShim).toContain('// tc-http: caCert PEM failed to decode');
    });

    it('maxBody opt → __tc_http_set_max_body staged after the reset', () => {
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        new Request(Request.GET, "https://example.com", { maxBody: 16384 }).send();
      `);
      expectCppContains(result, ['__tc_http_set_max_body(16384);']);
      expect(result.cpp.indexOf('__tc_http_set_max_body(16384);'))
        .toBeGreaterThan(result.cpp.indexOf('__tc_http_reset(); __tc_http_begin(HTTP_GET'));
    });
  });

  describe('send() fact ordering (regression: the reset rides begin and must run FIRST)', () => {
    // Until 2026-09 the setters emitted before begin, and the reset inside
    // begin wiped every one of them — timeout/body/insecure/caCert never
    // reached a request. send() now leads with begin (reset+stage), and the
    // fact setters follow.
    it('emits reset+begin BEFORE the fact setters so nothing is wiped', () => {
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        const r = new Request(Request.POST, "https://example.com", { timeoutMs: 12000, body: 'x=1', insecure: true });
        r.send();
      `);
      // Strip the shim block so indexOf matches user code, not helper
      // definitions (the shim defines __tc_http_set_body etc.).
      const user = result.cpp.replace(
        /\/\/ CUTTLEFISH_HTTP_BEGIN[\s\S]*?\/\/ CUTTLEFISH_HTTP_END/g, '',
      );
      const begin = user.indexOf('__tc_http_reset(); __tc_http_begin(HTTP_POST');
      expect(begin).toBeGreaterThanOrEqual(0);
      expect(user.indexOf('__tc_http_set_timeout(12000);')).toBeGreaterThan(begin);
      expect(user.indexOf('__tc_http_set_max_body(8192);')).toBeGreaterThan(begin);
      expect(user.indexOf('__tc_http_set_body("x=1"')).toBeGreaterThan(begin);
      expect(user.indexOf('__tc_http_set_insecure();')).toBeGreaterThan(begin);
    });

    it('header() pairs are re-staged by begin AFTER the reset (call-site emissions precede it)', () => {
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        const r = new Request(Request.GET, "https://example.com");
        r.header("X-Device", "typecad-hal");
        r.send();
      `);
      const restage = result.cpp.indexOf('__tc_http_set_header("X-Device", "typecad-hal"); __tc_http_begin(HTTP_GET');
      expect(restage).toBeGreaterThanOrEqual(0);
      expect(restage).toBeGreaterThan(result.cpp.indexOf('__tc_http_reset();'));
    });

    it('header pairs re-stage inside a send loop too (per-iteration survival)', () => {
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        function poll() {
          const r = new Request(Request.GET, "https://example.com");
          r.header("X-Device", "typecad-hal");
          for (let i = 0; i < 3; i = i + 1) { r.send(); }
        }
      `);
      expect(result.cpp).toContain('__tc_http_set_header("X-Device", "typecad-hal"); __tc_http_begin(HTTP_GET');
    });
  });

  describe('response accessors', () => {
    it('status() and text() lower to expression shims', () => {
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        const req = new Request(Request.GET, "https://example.com");
        req.send();
        const s = req.status();
        const t = req.text();
      `);
      expect(result.cpp).toMatch(/__tc_http_status\(\)/);
      expect(result.cpp).toMatch(/__tc_http_body\(\)/);
    });

    it('responseHeader(name) lowers to the header lookup (captured by the parser hooks)', () => {
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        const req = new Request(Request.GET, "https://example.com");
        req.send();
        const ct = req.responseHeader("Content-Type");
      `);
      expect(result.cpp).toMatch(/__tc_http_response_header\("Content-Type"\)/);
      // The capture path ships in the shim: parser hooks wired via req.http_cb.
      expect(result.cpp).toContain('__tc_http_on_hdr_field');
      expect(result.cpp).toContain('req.http_cb = &__tc_http_parse_settings;');
    });
  });

  describe('cooperative await path', () => {
    // Statement-position await (the form demos/wifi-demo/src/10-http-async.ts
    // uses) lowers to http.send_start (statement) + a poll on http.done
    // (expression). Value-position awaits (`const ok = await ...send()`)
    // intentionally do NOT split — they inline to the blocking shim, since the
    // state machine cannot yield a value mid-suspension. Test the split form.
    const asyncSnippet = `
      import { Request } from '@typecad/hal';
      async function fetch() {
        const req = new Request(Request.GET, "https://example.com");
        await req.send();
      }
    `;

    it('emits the start op (__tc_http_send_start)', () => {
      const result = transpileZephyrStrategy(asyncSnippet);
      expect(result.cpp).toContain('__tc_http_send_start();');
    });

    it('emits the poll predicate (__tc_http_done)', () => {
      const result = transpileZephyrStrategy(asyncSnippet);
      expect(result.cpp).toMatch(/__tc_http_done\(\)/);
    });

    it('does NOT emit a blocking __tc_http_send() call inside the async task', () => {
      const result = transpileZephyrStrategy(asyncSnippet);
      // Strip the CUTTLEFISH_HTTP shim block so the helper definition of
      // __tc_http_send doesn't false-positive.
      const withoutShim = result.cpp.replace(
        /\/\/ CUTTLEFISH_HTTP_BEGIN[\s\S]*?\/\/ CUTTLEFISH_HTTP_END/g,
        '',
      );
      expect(withoutShim).not.toMatch(/__tc_http_send\(\)/);
    });

    it('value-position await falls back to the blocking shim (intentional)', () => {
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        async function fetch() {
          const req = new Request(Request.GET, "https://example.com");
          const ok = await req.send();
        }
      `);
      const withoutShim = result.cpp.replace(
        /\/\/ CUTTLEFISH_HTTP_BEGIN[\s\S]*?\/\/ CUTTLEFISH_HTTP_END/g,
        '',
      );
      expect(withoutShim).toMatch(/__tc_http_send\(\)/);
    });
  });

  describe('compiles cleanly', () => {
    it('no error diagnostics on a basic GET', () => {
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        new Request(Request.GET, "https://example.com").send();
      `);
      expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    });
  });
});
