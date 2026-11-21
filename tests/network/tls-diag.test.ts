// TLS diag — one pinned-CA HTTPS GET after setting the wall clock.
// Hypothesis under test: mbedtls X509 verification needs a wall clock past
// the certs' notBefore (2026-08-03); without Clock.set the board boots at
// epoch and every VERIFY_REQUIRED handshake fails (errno=1).
import { describe, done } from '@typecad/hal/testing';
import { WiFi, Request, Clock, Time } from '@typecad/hal';

const WIFI_SSID = "Skynet";
const WIFI_PASSWORD = "justin04";
const URL = "https://192.168.2.184:8443/echo";
const CA_CERT_PEM = "-----BEGIN CERTIFICATE-----\nMIIDMjCCAhqgAwIBAgIUCZy37pHW/M1HbNcRmCp4GuBJpyswDQYJKoZIhvcNAQEL\nBQAwMTEdMBsGA1UEAwwUVHlwZUNBRCBIVFRQIFRlc3QgQ0ExEDAOBgNVBAoMB1R5\ncGVDQUQwHhcNMjQwMTAxMDAwMDAwWhcNMzYwMTAxMDAwMDAwWjAxMR0wGwYDVQQD\nDBRUeXBlQ0FEIEhUVFAgVGVzdCBDQTEQMA4GA1UECgwHVHlwZUNBRDCCASIwDQYJ\nKoZIhvcNAQEBBQADggEPADCCAQoCggEBAI7T7wafITxhRIEopnqBnoxz2tRlg4F2\n/MEzSejMxEOm2lu1n8CUIv9cw3g/UCt8b9Vf5+xJ2SvKneN0BJxjgh7D4zPkA62z\n4c7SkhMLWHYfQsybWP4ebSWqxZmckHhmSVfudEuldY8epq2TC5BPgw7/6e6LSCkB\nMVYYsSKBgUCpQ/XrKXgr+aYIOUIL8apKtaWiMI2Nsb5kO8eoGwwC+/n7l7yE28g0\nBu9IVdg4ESJ0fDR59PY8POB5CJmk6O0tzNkx5252HqM4QojhVM39DaJX2WZ/lXWI\nfvaSMD7kWFOUyOkkmPeAcIOsE+Q0gzZnI7qB8VCD0uTjUq6kXFhiGBcCAwEAAaNC\nMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFD9m\n83zTIuFMNtC2Y/DAnob9XqlyMA0GCSqGSIb3DQEBCwUAA4IBAQBERlvVXrRSoL3R\n0gLSadZbmN7mXi19ZDcAdBX0fvVsHu886kSR+BxY+Kt//IiKA7UfRLl7AHCzL8IP\nMjjkTB8+mGPQXzlAOZg3RQBOpTrvuPwc+Git5NflxJnTYXRITplpG+YNxlnJZF/1\nk/pHkjl3jCol+z8xUSIA9f3sVs5VSvEE/Cq/v7El4UYJETra1AItAsIyPsTeoeVO\niW8Xo1+boRCZKMowOpknca9TtBder1DaTXSsH007q2rnw35SyG2FCGb4nPub7eSL\n+aa8W6/UJkNrkM913rihfXIrYTwLs0xlXZsTsEcyKCDoY0dFSONAjiOX6NE3nGCi\ngsNvfrcp\n-----END CERTIFICATE-----";

const wifi = new WiFi(WIFI_SSID, { psk: WIFI_PASSWORD, timeoutMs: 30000 });
wifi.join();

r.send(); return r.status(); })()).toBe(200);

done();
