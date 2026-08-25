# Test certificates for the HTTPS hardware test

Self-signed CA + server cert/key used by the local HTTPS test server
(`server.ts`) and the on-metal HTTP client test
(`http-client.test.ts`). The firmware pins `ca.crt` via
`Http...caCert(CA_CERT_PEM)` so mbedTLS verifies the server cert the local
HTTPS listener presents.

These are **throwaway test credentials, safe to publish** — they are NOT
production secrets. Anyone can regenerate an equivalent set; they only
authorize access to this throwaway LAN test server.

## Files

| File | Purpose |
|---|---|
| `ca.crt` / `ca.key` | self-signed root CA |
| `server.crt` / `server.key` | server cert (signed by the CA) + key |

The CA PEM is also embedded inline as the `CA_CERT_PEM` constant in
`../http-client.test.ts` (pinned by the firmware via `Http...caCert()`). It is
inlined rather than imported because the transpiler hoists a single string-
literal const to file scope, while an imported const becomes a separate
translation unit whose symbol the consuming test functions can't see. **After
regenerating the certs below, also update the inline `CA_CERT_PEM` in
`http-client.test.ts` to match the new `ca.crt`.**

The server cert's SAN includes the LAN IP `192.168.2.184`, `127.0.0.1`, and
`localhost` (mbedTLS verifies the hostname/IP the firmware connects to against
the SAN). **If your LAN IP differs, regenerate the certs** so the SAN matches,
or the `caCert()` verify tests will fail hostname verification.

## Regenerating

If the LAN IP changed (or you just want a fresh pair):

```sh
cd packages/hal/tests/network/certs
export MSYS_NO_PATHCONV=1   # Git Bash: stop it mangling -subj "/CN=..."

# CA
cat > ca.cnf <<'EOF'
[req]
distinguished_name = dn
prompt = no
x509_extensions = v3_ca
[dn]
CN = TypeCAD HTTP Test CA
O = TypeCAD
[v3_ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
EOF
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 3650 -config ca.cnf

# Server cert (replace 192.168.2.184 with YOUR LAN IP)
cat > server.cnf <<'EOF'
[req]
distinguished_name = dn
req_extensions = v3_req
prompt = no
[dn]
CN = 192.168.2.184
O = TypeCAD
[v3_req]
subjectAltName = @alt_names
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
[alt_names]
IP.1 = 192.168.2.184
IP.2 = 127.0.0.1
DNS.1 = localhost
EOF
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -config server.cnf
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 3650 -extfile server.cnf -extensions v3_req
rm server.csr ca.srl ca.cnf server.cnf

# Refresh the inline CA_CERT_PEM in http-client.test.ts from the new ca.crt:
node -e 'const fs=require("fs");const p=fs.readFileSync("ca.crt","utf8").trim();console.log("const CA_CERT_PEM = "+JSON.stringify(p)+";")'
# (copy the output into the const CA_CERT_PEM = ... line in ../http-client.test.ts)
```
