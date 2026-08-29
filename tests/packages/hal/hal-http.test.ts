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
        new Request(Request.GET, "https://example.com").header("X-Device", "cuttlefish").send();
      `);
      expectCppContains(result, ['__tc_http_set_header("X-Device", "cuttlefish");']);
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
      const pem = '-----BEGIN CERTIFICATE-----\nAAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v\nMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5\nfYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3\n-----END CERTIFICATE-----';
      const result = transpileZephyrStrategy(`
        import { Request } from '@typecad/hal';
        const PEM = "${pem.replace(/\n/g, '\\n')}"; 
        new Request(Request.GET, "https://example.com", { caCert: PEM }).send();
      `);
      expect(result.cpp).toContain('static const uint8_t __tc_ca_der[]');
      expect(result.cpp).toContain('__tc_http_set_ca_cert_der(__tc_ca_der, sizeof(__tc_ca_der));');
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
