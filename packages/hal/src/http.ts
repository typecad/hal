import {
  httpBegin,
  httpReset,
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

export enum HttpMethod {
  GET = 0,
  POST = 1,
  PUT = 2,
  DELETE = 3,
  HEAD = 4,
  PATCH = 5,
}

/**
 * Fluent HTTP/S request builder, lowered to native ESP-IDF
 * `esp_http_client` by framework-esp32 (TLS via esp-tls / mbedTLS bundle).
 * Response fields are read from this object after send() — mirrors
 * `await WiFi.connect(); WiFi.localIP()`.
 *
 * No `include()` calls here — ESP-IDF headers are framework-owned and added
 * via forcedIncludes when the program uses http.* ops.
 */
export class HttpRequest {
  private _method: string;
  private _url: string;

  constructor(method: string, url: string) {
    this._method = method;
    this._url = url;
  }

  header(name: string, value: string): this {
    httpSetHeader(name, value);
    return this;
  }

  timeout(ms: number): this {
    httpSetTimeout(ms);
    return this;
  }

  maxBody(bytes: number): this {
    httpSetMaxBody(bytes);
    return this;
  }

  body(data: string): this {
    httpSetBody(data, false);
    return this;
  }

  jsonBody(json: string): this {
    httpSetBody(json, true);
    return this;
  }

  /** Skip TLS certificate verification (development only). */
  insecure(): this {
    httpSetInsecure();
    return this;
  }

  caCert(pem: string): this {
    httpSetCaCert(pem);
    return this;
  }

  /** Blocking at top level; cooperatively awaitable inside async functions. */
  send(): Promise<boolean> {
    httpBegin(this._method, this._url);
    httpSend();
    return Promise.resolve(false);
  }

  status(): number {
    return httpStatus();
  }

  ok(): boolean {
    return httpOk();
  }

  /** Response body as a C string (valid until the next request). */
  text(): string {
    return httpBody();
  }

  contentLength(): number {
    return httpContentLength();
  }

  responseHeader(name: string): string {
    return httpResponseHeader(name);
  }
}

export class HttpClass {
  static readonly __instance_name = "Http";

  get(url: string): HttpRequest {
    httpReset();
    return new HttpRequest("GET", url);
  }

  post(url: string): HttpRequest {
    httpReset();
    return new HttpRequest("POST", url);
  }

  put(url: string): HttpRequest {
    httpReset();
    return new HttpRequest("PUT", url);
  }

  del(url: string): HttpRequest {
    httpReset();
    return new HttpRequest("DELETE", url);
  }

  head(url: string): HttpRequest {
    httpReset();
    return new HttpRequest("HEAD", url);
  }

  patch(url: string): HttpRequest {
    httpReset();
    return new HttpRequest("PATCH", url);
  }
}

export const Http = new HttpClass();
