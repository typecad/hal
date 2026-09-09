---
'@typecad/hal': patch
'@typecad/cuttlefish': patch
'@typecad/framework-zephyr': patch
---

HTTPS client review fixes: every per-request fact was being wiped before
each send, plus hardening across the shim.

CRITICAL — fact ordering: `Request.send()` emitted its fact setters
(timeout/body/insecure/caCert) BEFORE `httpBegin`, and the per-request
`__tc_http_reset()` rides begin — so the reset wiped everything the setters
had just staged. Net effect since the 8/28 consolidation: user timeouts
never applied, POST bodies and JSON content-type were silently dropped,
`insecure: true` was lost (HTTPS then failed verify-required with no CA),
and caCert never reached the credential store. The last hardware-verified
suite run predates the consolidation (the factory-op protocol reset before
the setters), so no passing run ever exercised the broken order. send() now
leads with begin (reset + stage), then the fact setters; header() pairs are
recorded on the request instance and re-staged by begin AFTER its reset, so
call-site header emissions and send() loops both survive (the recorded
replay also keeps a second request from inheriting the first's headers).
An order-regression test pins the emitted sequence.

Response headers are real now: the shim wires req.http_cb
(on_header_field/on_header_value parser hooks — the client keeps its own
status/body handling) to capture the raw header block, and
responseHeader(name) scans it case-insensitively; the previous always-empty
stub is gone (hardware test asserts Content-Type + absent-header lookups).

Credential store honesty (http + mqtt shims): Zephyr's tls_credential_add
never REPLACES a tag — the old "most recently added cert wins" comment was
wrong; the first CA stayed active silently. Re-registering the same DER is
now skipped by pointer identity; a different CA arriving at an occupied tag
prints a warning; any other failure leaves the tag list empty with
verification required (fail closed).

Also: header staging buffers are 128 bytes and the CRLF is appended after
the capped format (truncation can no longer swallow the next header line);
the async single-slot is guarded (work item init once, busy check refuses a
second in-flight request, reset waits for the worker before clearing state
— no more delete[] under the workqueue); `maxBody` is a real Request opt
again (the op/shim existed but nothing emitted it; bodies cap at 8 KB
silently otherwise); URL/host/path overflows are refused with a printk
instead of silently truncating (path buffer 256→384); the TLS hostname skip
uses a strict dotted-quad predicate (numeric-only DNS names like "123" no
longer skip the identity check; http + mqtt); caCert PEMs must decode to
DER starting with the ASN.1 SEQUENCE tag (0x30) or the emit fails loudly.

The kconfig KNOWN LIMITATION note (pinned-CA EPERM at connect) now records
that its diagnosis predates the ordering fix and needs a hardware re-run —
the wipe alone reproduced connect failures.
