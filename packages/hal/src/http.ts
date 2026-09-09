// ---------------------------------------------------------------------------
// Request — the thin HTTP/S client
//
// The request is CONSTRUCTION facts: method, URL, and the policy opts
// (timeout, body, TLS mode) ride the constructor; headers attach with the
// header() chain; send() lowers the facts into the shim and performs the
// request; the response is read from this request afterwards (the shim
// holds the response until the next request).
//
//   const req = new Request(Request.POST, url, {
//     timeoutMs: 10_000,
//     body: '{"v":1}', json: true,
//     caCert: PEM,            // pin a CA (verified TLS)
//   });
//   req.header('X-Custom', 'v');
//   if (req.send()) { console.log(req.status()); }
//
// Method tokens: Request.GET / POST / PUT / DELETE / HEAD / PATCH (plain
// 'GET' strings also accepted). `insecure: true` skips TLS certificate
// verification (development only). Awaiting send() inside async functions
// still splits into a background request + done-poll (the async machinery
// intercepts the send op; the facts were already lowered at send()).
// ----------------------------------------------------------------------------

import {
  httpBegin,
  httpSetHeader,
  httpSetTimeout,
  httpSetMaxBody,
  httpSetBody,
  httpSetInsecure,
  httpSetCaCert,
  httpSend,
  httpStatus,
  httpOk,
  httpBody,
  httpContentLength,
  httpResponseHeader,
} from './emit.js';

/** Request construction facts beyond method + URL. */
export interface RequestOpts {
  /** Response timeout in ms (default 10_000). */
  timeoutMs?: number;
  /** Response body cap in bytes (default 8_192; larger bodies truncate). */
  maxBody?: number;
  /** Request body (raw). */
  body?: string;
  /** The body is JSON — sets the JSON content type. */
  json?: boolean;
  /** Skip TLS certificate verification (development only). */
  insecure?: boolean;
  /** PEM of a trusted CA — enables verified TLS. */
  caCert?: string;
}

export class Request {
  static readonly GET = 'GET';
  static readonly POST = 'POST';
  static readonly PUT = 'PUT';
  static readonly DELETE = 'DELETE';
  static readonly HEAD = 'HEAD';
  static readonly PATCH = 'PATCH';

  private readonly _method: string;
  private readonly _url: string;
  private readonly _timeoutMs: number;
  private readonly _maxBody: number;
  private readonly _body: string;
  private readonly _json: boolean;
  private readonly _insecure: boolean;
  private readonly _caCert: string;

  constructor(method: string, url: string, opts: RequestOpts = {}) {
    this._method = method.toUpperCase();
    this._url = url;
    this._timeoutMs = opts.timeoutMs ?? 10_000;
    this._maxBody = opts.maxBody ?? 8_192;
    this._body = opts.body ?? '';
    this._json = opts.json === true;
    this._insecure = opts.insecure === true;
    this._caCert = opts.caCert ?? '';
  }

  /** Attach a request header. Chainable — one per header. */
  header(name: string, value: string): this {
    httpSetHeader(name, value);
    return this;
  }

  /** Send the request (blocking). The shim resets its slot and stages the
   *  method/url first, then this request's facts lower in order — the
   *  reset-before-setters protocol the shim is built around.
   *  Awaitable inside async functions — the async machinery splits the
   *  send into a background request + done-poll. */
  send(): boolean {
    httpBegin(this._method, this._url);
    httpSetTimeout(this._timeoutMs);
    httpSetMaxBody(this._maxBody);
    httpSetBody(this._body, this._json);
    httpSetInsecure(this._insecure);
    httpSetCaCert(this._caCert);
    return httpSend();
  }

  /** Response status code (0 before a completed send). */
  status(): number {
    return httpStatus();
  }

  /** True when the response status is 2xx. */
  ok(): boolean {
    return httpOk();
  }

  /** Response body as a C string (valid until the next request). */
  text(): string {
    return httpBody();
  }

  /** Response Content-Length (0 when absent). */
  contentLength(): number {
    return httpContentLength();
  }

  /** One response header value ("" when absent; valid until the next
   *  request). */
  responseHeader(name: string): string {
    return httpResponseHeader(name);
  }
}
