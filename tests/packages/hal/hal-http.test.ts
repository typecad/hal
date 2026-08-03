// ---------------------------------------------------------------------------
// HAL HTTP Tests — Zephyr transpilation
//
// Revived from the deleted framework-esp32 harness (git: 38bd7248^, originally
// tests/packages/hal/hal-http.test.ts). End-to-end coverage of the HTTP HAL
// through the ZephyrStrategy: factory chain (Http.get/post/...), builder
// setters, blocking vs async send, and the single-slot __tc_http shim. Uses
// transpileZephyrStrategy() because the http.* ops lower via
// ZephyrStrategy.resolveHALOperation, which the plain transpile() helper does
// not activate.
//
// The esp32 harness asserted against esp_http_client; this Zephyr port asserts
// the socket-based __tc_http shim (http_client_req over a pre-connected
// socket). The contract under test is the same — verb lowering, builder chain,
// blocking vs cooperative-await split, response accessors, clean compile.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { expectCppContains, hasInclude, transpileZephyrStrategy } from '../../setup';

describe('HTTP HAL — Zephyr transpilation', () => {
  describe('GET smoke', () => {
    const snippet = `
      import { Http } from '@typecad/hal';
      Http.get("https://example.com").send();
    `;

    it('begins with HTTP_GET and url', () => {
      // Zephyr's enum is HTTP_GET (no METHOD_ infix), unlike esp_http_client's
      // HTTP_METHOD_GET.
      const result = transpileZephyrStrategy(snippet);
      expectCppContains(result, ['__tc_http_begin(HTTP_GET, "https://example.com");']);
    });

    it('emits the blocking __tc_http_send() call', () => {
      const result = transpileZephyrStrategy(snippet);
      expect(result.cpp).toMatch(/__tc_http_send\(\)/);
    });

    it('forces the Zephyr http client + socket headers only when Http is used', () => {
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
    it('Http.post → HTTP_POST', () => {
      const result = transpileZephyrStrategy(`
        import { Http } from '@typecad/hal';
        Http.post("https://example.com").send();
      `);
      expectCppContains(result, ['__tc_http_begin(HTTP_POST, "https://example.com");']);
    });

    it('Http.del → HTTP_DELETE', () => {
      const result = transpileZephyrStrategy(`
        import { Http } from '@typecad/hal';
        Http.del("https://example.com").send();
      `);
      expectCppContains(result, ['__tc_http_begin(HTTP_DELETE, "https://example.com");']);
    });
  });

  describe('builder chain', () => {
    it('header() → __tc_http_set_header', () => {
      const result = transpileZephyrStrategy(`
        import { Http } from '@typecad/hal';
        Http.get("https://example.com").header("X-Device", "cuttlefish").send();
      `);
      expectCppContains(result, ['__tc_http_set_header("X-Device", "cuttlefish");']);
    });

    it('jsonBody() → __tc_http_set_body with json=true', () => {
      const result = transpileZephyrStrategy(`
        import { Http } from '@typecad/hal';
        Http.post("https://example.com").jsonBody('{"temp":21.5}').send();
      `);
      // The json flag is the second arg to __tc_http_set_body and must be true.
      expect(result.cpp).toMatch(/__tc_http_set_body\([^,]+,\s*true\)/);
    });

    it('plain body() → __tc_http_set_body with json=false', () => {
      const result = transpileZephyrStrategy(`
        import { Http } from '@typecad/hal';
        Http.post("https://example.com").body("raw=1").send();
      `);
      expect(result.cpp).toMatch(/__tc_http_set_body\([^,]+,\s*false\)/);
    });

    it('timeout(ms) → __tc_http_set_timeout', () => {
      const result = transpileZephyrStrategy(`
        import { Http } from '@typecad/hal';
        Http.get("https://example.com").timeout(10000).send();
      `);
      expectCppContains(result, ['__tc_http_set_timeout(10000);']);
    });

    it('insecure() → __tc_http_set_insecure', () => {
      const result = transpileZephyrStrategy(`
        import { Http } from '@typecad/hal';
        Http.get("https://example.com").insecure().send();
      `);
      expectCppContains(result, ['__tc_http_set_insecure();']);
    });
  });

  describe('response accessors', () => {
    it('status() and text() lower to expression shims', () => {
      const result = transpileZephyrStrategy(`
        import { Http } from '@typecad/hal';
        const req = Http.get("https://example.com");
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
      import { Http } from '@typecad/hal';
      async function fetch() {
        const req = Http.get("https://example.com");
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
      // `const ok = await ...send()` cannot yield a value mid-suspension, so
      // the state machine inlines the blocking __tc_http_send() call. This
      // locks in that contract — if it ever silently changes to a split, the
      // returned value would be wrong.
      const result = transpileZephyrStrategy(`
        import { Http } from '@typecad/hal';
        async function fetch() {
          const ok = await Http.get("https://example.com").send();
        }
      `);
      // Strip the shim block first so we only look at the task body.
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
        import { Http } from '@typecad/hal';
        Http.get("https://example.com").send();
      `);
      expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    });
  });
});
