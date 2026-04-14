import { OdcHttpError, OdcTimeoutError } from './errors.js';

export interface OdcClientOptions {
  port?: number;
  timeout?: number;
}

export class OdcClient {
  readonly baseUrl: string;
  private timeout: number;

  constructor(readonly deviceIp: string, options?: OdcClientOptions) {
    const port = options?.port ?? 8061;
    this.baseUrl = `http://${deviceIp}:${port}`;
    this.timeout = options?.timeout ?? 10_000;
  }

  /* ---- Registry ---- */

  async getRegistry(): Promise<Record<string, Record<string, string>>> {
    const res = await this.request('GET', '/registry');
    return res.json() as Promise<Record<string, Record<string, string>>>;
  }

  async setRegistry(data: Record<string, Record<string, string>>): Promise<void> {
    await this.request('PATCH', '/registry', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  async clearRegistry(sections?: string[]): Promise<void> {
    if (sections) {
      const payload: Record<string, null> = {};
      for (const section of sections) {
        payload[section] = null;
      }
      await this.request('PATCH', '/registry', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      await this.request('DELETE', '/registry');
    }
  }

  /* ---- App UI ---- */

  async getAppUi(fields?: Record<string, string[]>): Promise<string> {
    const params = fields
      ? '?' + new URLSearchParams({ fields: JSON.stringify(fields) })
      : '';
    const res = await this.request('GET', `/app-ui${params}`);
    return res.text();
  }

  /* ---- File operations ---- */

  async pullFile(source: string): Promise<ArrayBuffer> {
    const params = new URLSearchParams({ source });
    const res = await this.request('GET', `/file?${params}`);
    return res.arrayBuffer();
  }

  async pushFile(destination: string, data: Blob | BufferSource): Promise<void> {
    const body = data instanceof Blob ? data : new Blob([data]);
    await this.request('PUT', `/file?${new URLSearchParams({ destination })}`, {
      headers: { 'Content-Type': 'application/octet-stream' },
      body,
    });
  }

  async listFiles(path?: string): Promise<string> {
    const params = path ? '?' + new URLSearchParams({ path }) : '';
    const res = await this.request('GET', `/files${params}`);
    return res.text();
  }

  /* ---- HTTP helpers ---- */

  private async request(
    method: string,
    path: string,
    init?: { headers?: Record<string, string>; body?: BodyInit },
  ): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Connection: 'close', ...init?.headers },
        body: init?.body,
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new OdcTimeoutError(
          `ODC ${method} ${path} timed out after ${this.timeout}ms`,
          this.timeout,
        );
      }
      throw err;
    }
    if (!res.ok) {
      throw new OdcHttpError(method, path, res.status, res.statusText);
    }
    return res;
  }
}
