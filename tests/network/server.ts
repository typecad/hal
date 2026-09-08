// Local HTTP/HTTPS test server for the @typecad/hal HTTP client hardware tests.
//
// Serves the same routes over both plain HTTP and HTTPS (TLS) on the local
// network, so the firmware test client can exercise both transports:
//   /echo            GET/POST/PUT/DELETE/PATCH/HEAD/OPTIONS — echoes method + body
//   /status/[code]   GET — returns the requested HTTP status code
//   /headers         GET — echoes request headers
//   /items           GET/POST/PUT/DELETE/PATCH — stateful CRUD (in-memory store)
//
// The HTTPS listener uses the self-signed cert in ./certs (signed by ca.crt,
// which the firmware pins via Http...caCert()). No auth: this is a LAN-only
// server for testing your own firmware. Don't expose it to the internet.
// start-server.ts launches both listeners on 0.0.0.0 so the ESP32 can reach
// them from elsewhere on the network.
//
// This file is importable: `import { createTestServer, createHttpsTestServer } from './server'`.
// Run directly with `npm run test:http` (which calls start-server.ts).

import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { connect as netConnect } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Aedes } from 'aedes';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CERTS_DIR = resolvePath(__dirname, 'certs');

export interface TestServer {
	port: number;
	close(): Promise<void>;
}

/** Maximum request body size. Embedded test payloads are tiny. */
const MAX_BODY_BYTES = 4096;

const JSON_HEADERS = {
	'content-type': 'application/json',
	'cache-control': 'no-store',
	'access-control-allow-origin': '*',
} as const;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
	const text = JSON.stringify(body);
	res.writeHead(status, { ...JSON_HEADERS, 'content-length': Buffer.byteLength(text) });
	res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let received = 0;
		const chunks: Buffer[] = [];
		req.on('data', (chunk: Buffer) => {
			received += chunk.length;
			if (received > MAX_BODY_BYTES) {
				// Stop reading; truncate. The test payloads never hit this.
				req.destroy();
				resolve(Buffer.concat(chunks).toString('utf8'));
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', () => resolve(''));
	});
}

async function handleEcho(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const method = req.method ?? 'GET';
	// HEAD per RFC 7231: same status as GET, no body.
	if (method === 'HEAD') {
		res.writeHead(200, JSON_HEADERS);
		res.end();
		return;
	}
	if (method === 'OPTIONS') {
		res.writeHead(204, { 'access-control-allow-origin': '*' });
		res.end();
		return;
	}
	const body = await readBody(req);
	sendJson(res, 200, { method, body });
}

function handleStatus(req: IncomingMessage, res: ServerResponse, segments: string[]): void {
	const raw = segments[0];
	const code = parseInt(raw ?? '', 10);
	if (!Number.isInteger(code) || code < 100 || code > 599) {
		sendJson(res, 400, { error: 'status code must be an integer 100-599' });
		return;
	}
	sendJson(res, code, { status: code });
}

async function handleHeaders(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const echoed: Record<string, string> = {};
	// Echo a fixed safe set plus all X-* custom headers.
	const safe = ['content-type', 'user-agent', 'x-custom', 'accept'];
	for (const name of safe) {
		const value = req.headers[name];
		if (value !== undefined) echoed[name] = Array.isArray(value) ? value.join(', ') : value;
	}
	for (const [key, value] of Object.entries(req.headers)) {
		if (key.startsWith('x-') && !(key in echoed) && value !== undefined) {
			echoed[key] = Array.isArray(value) ? value.join(', ') : value;
		}
	}
	sendJson(res, 200, { headers: echoed });
}

// ── Stateful /items resource ─────────────────────────────────────────
// A simple in-memory key-value store for CRUD testing. The firmware test
// POSTs to create, GETs to read, PUTs to update, DELETEs to remove —
// verifying that each verb actually mutates server-side state, not just
// that it returns 200.

interface Item {
	value: string;
}

const items: Map<string, Item> = new Map();

/** Parse a JSON body into an object, tolerating non-JSON input. */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	const raw = await readBody(req);
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === 'object' && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}

async function handleItems(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const method = req.method ?? 'GET';
	const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
	// Optional ?key=foo query param selects a single item.
	const key = url.searchParams.get('key') ?? 'default';

	if (method === 'GET') {
		const item = items.get(key);
		if (item) {
			sendJson(res, 200, { key, value: item.value });
		} else {
			sendJson(res, 404, { error: 'not found', key });
		}
		return;
	}

	if (method === 'POST') {
		const body = await readJsonBody(req);
		const value = String(body.value ?? '');
		items.set(key, { value });
		sendJson(res, 201, { key, value });
		return;
	}

	if (method === 'PUT') {
		const body = await readJsonBody(req);
		const value = String(body.value ?? '');
		const existed = items.has(key);
		items.set(key, { value });
		sendJson(res, existed ? 200 : 201, { key, value });
		return;
	}

	if (method === 'DELETE') {
		if (items.delete(key)) {
			sendJson(res, 200, { key, deleted: true });
		} else {
			sendJson(res, 404, { error: 'not found', key });
		}
		return;
	}

	if (method === 'PATCH') {
		const body = await readJsonBody(req);
		const item = items.get(key);
		if (!item) {
			sendJson(res, 404, { error: 'not found', key });
			return;
		}
		// PATCH merges — only updates fields that are present.
		if (typeof body.value === 'string') item.value = body.value;
		sendJson(res, 200, { key, value: item.value });
		return;
	}

	sendJson(res, 405, { error: 'method not allowed' });
}

/** Route a request. Returns true if handled. */
async function route(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
	const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
	const path = url.pathname.replace(/\/+$/, ''); // strip trailing slashes
	const segments = path.split('/').filter(Boolean); // ['test','http','echo']

	// Accept both /echo and /test/http/echo for flexibility.
	const last = segments[segments.length - 1] ?? '';

	if (last === 'echo' || path === '/echo') {
		await handleEcho(req, res);
		return true;
	}
	if (last === 'headers' || path === '/headers') {
		await handleHeaders(req, res);
		return true;
	}
	if (last === 'items' || path === '/items') {
		await handleItems(req, res);
		return true;
	}
	// /status/[code] — the code is the segment after 'status'
	const statusIdx = segments.lastIndexOf('status');
	if (statusIdx !== -1 && statusIdx + 1 < segments.length) {
		handleStatus(req, res, segments.slice(statusIdx + 1));
		return true;
	}
	return false;
}

/**
 * Shared request handler for the HTTP and HTTPS listeners. Routes the request,
 * logs each one, and returns a 404/500 on miss/error. Identical behavior over
 * both transports — only the TLS handshake differs.
 */
function requestHandler(req: IncomingMessage, res: ServerResponse): void {
	const started = Date.now();
	const method = req.method ?? 'GET';
	const url = req.url ?? '/';
	(async () => {
		try {
			const handled = await route(req, res);
			if (!handled) {
				sendJson(res, 404, { error: 'not found', path: url });
			}
		} catch (err) {
			sendJson(res, 500, { error: String(err) });
		}
		console.log(`${method} ${url} ${res.statusCode} ${Date.now() - started}ms`);
	})();
}

/**
 * Create and start the plaintext HTTP test server. Resolves once listening.
 */
export function createTestServer(port = 8080): Promise<TestServer> {
	return new Promise((resolve, reject) => {
		const server = createHttpServer(requestHandler);
		server.on('error', reject);
		server.listen(port, '0.0.0.0', () => {
			resolve({
				port,
				close: () => new Promise<void>((r) => server.close(() => r())),
			});
		});
	});
}

/**
 * Create and start the HTTPS (TLS) test server, serving the same routes over a
 * TLS 1.2+ listener. Uses the self-signed cert pair in ./certs (signed by
 * ca.crt, which the firmware pins). Resolves once listening.
 */
export function createHttpsTestServer(port = 8443): Promise<TestServer> {
	return new Promise((resolve, reject) => {
		const key = readFileSync(resolvePath(CERTS_DIR, 'server.key'));
		const cert = readFileSync(resolvePath(CERTS_DIR, 'server.crt'));
		const server = createHttpsServer({ key, cert }, requestHandler);
		server.on('error', reject);
		server.listen(port, '0.0.0.0', () => {
			resolve({
				port,
				close: () => new Promise<void>((r) => server.close(() => r())),
			});
		});
	});
}

// ── MQTT broker ─────────────────────────────────────────────────────────
// A pure-JS MQTT broker (aedes) the on-metal mqtt-client test connects to,
// over plain MQTT (1883) and MQTT-over-TLS (8883, same cert pair as the HTTPS
// server). Like the HTTP server, aedes is a LAN-only test fixture — no auth.
// Both listeners share one aedes instance so a plain client and a TLS client
// can exchange messages on the same topic.

/** A shared aedes broker instance backing both the plain and TLS listeners.
 *  aedes ≥1.x starts `closed` — listen() initializes it (persistence,
 *  connected-clients bookkeeping). Both listener factories await it. */
let _aedes: Aedes | undefined;
let _aedesReady: Promise<Aedes> | undefined;
function aedesBroker(): Aedes {
	if (!_aedes) {
		_aedes = new Aedes({ id: 'typecad-test-broker' });
		_aedes.on('client', (c: { id?: string }) => console.log(`mqtt: client connected ${c.id}`));
		_aedes.on('clientDisconnect', (c: { id?: string }) => console.log(`mqtt: client disconnected ${c.id}`));
		_aedes.on('subscribe', (subs: unknown, client: { id?: string }) =>
			console.log(`mqtt: subscribe from ${client?.id}`));
		_aedes.on('publish', (pkt: { topic?: string }) => console.log(`mqtt: publish to ${pkt.topic}`));
	}
	return _aedes;
}

async function aedesBrokerReady(): Promise<Aedes> {
	const broker = aedesBroker();
	if (!_aedesReady) {
		_aedesReady = broker.listen();
	}
	await _aedesReady;
	return broker;
}

/**
 * Start the plain MQTT broker (mqtt://) on the given port. Resolves once
 * listening.
 */
export function createMqttBroker(port = 1883): Promise<TestServer> {
	return aedesBrokerReady().then((broker) => new Promise((resolve, reject) => {
		const server = createNetServer(broker.handle.bind(broker));
		server.on('error', reject);
		server.listen(port, '0.0.0.0', () => {
			resolve({
				port,
				close: () => new Promise<void>((r) => server.close(() => r())),
			});
		});
	}));
}

/**
 * Start the MQTT-over-TLS broker (mqtts://) on the given port, using the same
 * self-signed cert pair as the HTTPS server (ca.crt signs server.crt, which
 * the firmware pins). Resolves once listening.
 */
export function createMqttTlsBroker(port = 8883): Promise<TestServer> {
	return aedesBrokerReady().then((broker) => new Promise((resolve, reject) => {
		const key = readFileSync(resolvePath(CERTS_DIR, 'server.key'));
		const cert = readFileSync(resolvePath(CERTS_DIR, 'server.crt'));
		const server = createTlsServer({ key, cert }, broker.handle.bind(broker));
		server.on('error', reject);
		server.listen(port, '0.0.0.0', () => {
			resolve({
				port,
				close: () => new Promise<void>((r) => server.close(() => r())),
			});
		});
	}));
}
