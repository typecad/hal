// ---------------------------------------------------------------------------
// HAL HTTP Tests — ESP32 transpilation
//
// End-to-end coverage of the HTTP HAL through the Esp32Strategy: factory
// chain (Http.get/post/...), builder setters, blocking vs async send, and
// the single-slot __tc_http shim. Uses transpileEsp32Strategy() because the
// http.* ops lower via Esp32Strategy.resolveHALOperation, which the plain
// transpileESP32() helper does not activate.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { expectCppContains, hasInclude, transpileEsp32Strategy } from '../../setup';

describe('HTTP HAL — ESP32 transpilation', () => {
  describe('GET smoke', () => {
    const snippet = `
      import { Http } from '@typecad/hal';
      Http.get("https://example.com").send();
    `;

    it('begins with HTTP_METHOD_GET and url', () => {
      const result = transpileEsp32Strategy(snippet);
      expectCppContains(result, ['__tc_http_begin(HTTP_METHOD_GET, "https://example.com");']);
    });

    it('emits the blocking __tc_http_send() call', () => {
      const result = transpileEsp32Strategy(snippet);
      expect(result.cpp).toMatch(/__tc_http_send\(\)/);
    });

    it('forces esp_http_client.h include only when Http is used', () => {
      const result = transpileEsp32Strategy(snippet);
      expect(hasInclude(result.cpp, '"esp_http_client.h"')).toBe(true);
    });

    it('emits the CUTTLEFISH_HTTP shim block', () => {
      const result = transpileEsp32Strategy(snippet);
      expect(result.cpp).toContain('// CUTTLEFISH_HTTP_BEGIN');
      expect(result.cpp).toContain('// CUTTLEFISH_HTTP_END');
    });
  });

  describe('verb normalization', () => {
    it('Http.post → HTTP_METHOD_POST', () => {
      const result = transpileEsp32Strategy(`
        import { Http } from '@typecad/hal';
        Http.post("https://example.com").send();
      `);
      expectCppContains(result, ['__tc_http_begin(HTTP_METHOD_POST, "https://example.com");']);
    });

    it('Http.del → HTTP_METHOD_DELETE', () => {
      const result = transpileEsp32Strategy(`
        import { Http } from '@typecad/hal';
        Http.del("https://example.com").send();
      `);
      expectCppContains(result, ['__tc_http_begin(HTTP_METHOD_DELETE, "https://example.com");']);
    });
  });

  describe('builder chain', () => {
    it('header() → __tc_http_set_header', () => {
      const result = transpileEsp32Strategy(`
        import { Http } from '@typecad/hal';
        Http.get("https://example.com").header("X-Device", "cuttlefish").send();
      `);
      expectCppContains(result, ['__tc_http_set_header("X-Device", "cuttlefish");']);
    });

    it('jsonBody() → __tc_http_set_body with json=true', () => {
      const result = transpileEsp32Strategy(`
        import { Http } from '@typecad/hal';
        Http.post("https://example.com").jsonBody('{"temp":21.5}').send();
      `);
      // The json flag is the second arg to __tc_http_set_body and must be true.
      expect(result.cpp).toMatch(/__tc_http_set_body\([^,]+,\s*true\)/);
    });

    it('plain body() → __tc_http_set_body with json=false', () => {
      const result = transpileEsp32Strategy(`
        import { Http } from '@typecad/hal';
        Http.post("https://example.com").body("raw=1").send();
      `);
      expect(result.cpp).toMatch(/__tc_http_set_body\([^,]+,\s*false\)/);
    });

    it('timeout(ms) → __tc_http_set_timeout', () => {
      const result = transpileEsp32Strategy(`
        import { Http } from '@typecad/hal';
        Http.get("https://example.com").timeout(10000).send();
      `);
      expectCppContains(result, ['__tc_http_set_timeout(10000);']);
    });

    it('insecure() → __tc_http_set_insecure', () => {
      const result = transpileEsp32Strategy(`
        import { Http } from '@typecad/hal';
        Http.get("https://example.com").insecure().send();
      `);
      expectCppContains(result, ['__tc_http_set_insecure();']);
    });
  });

  describe('response accessors', () => {
    it('status() and text() lower to expression shims', () => {
      const result = transpileEsp32Strategy(`
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
      const result = transpileEsp32Strategy(asyncSnippet);
      expect(result.cpp).toContain('__tc_http_send_start();');
    });

    it('emits the poll predicate (__tc_http_done)', () => {
      const result = transpileEsp32Strategy(asyncSnippet);
      expect(result.cpp).toMatch(/__tc_http_done\(\)/);
    });

    it('does NOT emit a blocking __tc_http_send() call inside the async task', () => {
      const result = transpileEsp32Strategy(asyncSnippet);
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
      const result = transpileEsp32Strategy(`
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
      const result = transpileEsp32Strategy(`
        import { Http } from '@typecad/hal';
        Http.get("https://example.com").send();
      `);
      expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    });
  });
});
