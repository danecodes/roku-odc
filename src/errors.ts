export class OdcHttpError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly status: number,
    public readonly statusText: string,
  ) {
    super(`ODC ${method} ${path} failed: ${status} ${statusText}`);
    this.name = 'OdcHttpError';
  }
}

export class OdcTimeoutError extends Error {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = 'OdcTimeoutError';
  }
}
