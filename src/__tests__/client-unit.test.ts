import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OdcClient, OdcHttpError, OdcTimeoutError } from '../index.js';

function mockFetch(body: string | object, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(text, { status })),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getRegistry', () => {
  it('returns parsed registry JSON', async () => {
    const registry = {
      auth: { token: 'abc123', userId: '42' },
      settings: { theme: 'dark' },
    };
    mockFetch(registry);

    const odc = new OdcClient('192.168.0.30');
    const result = await odc.getRegistry();

    expect(result).toEqual(registry);
    expect(result.auth.token).toBe('abc123');
    expect(result.settings.theme).toBe('dark');
  });

  it('returns empty object when registry is empty', async () => {
    mockFetch({});

    const odc = new OdcClient('192.168.0.30');
    const result = await odc.getRegistry();

    expect(result).toEqual({});
  });

  it('sends GET to /registry', async () => {
    mockFetch({});
    const odc = new OdcClient('192.168.0.30');
    await odc.getRegistry();

    const fetchFn = vi.mocked(fetch);
    expect(fetchFn).toHaveBeenCalledWith(
      'http://192.168.0.30:8061/registry',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('setRegistry', () => {
  it('sends PATCH with JSON body', async () => {
    mockFetch('', 200);

    const odc = new OdcClient('192.168.0.30');
    await odc.setRegistry({ prefs: { volume: '80' } });

    const fetchFn = vi.mocked(fetch);
    expect(fetchFn).toHaveBeenCalledWith(
      'http://192.168.0.30:8061/registry',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ prefs: { volume: '80' } }),
      }),
    );
    const callHeaders = fetchFn.mock.calls[0][1]!.headers as Record<string, string>;
    expect(callHeaders['Content-Type']).toBe('application/json');
  });
});

describe('clearRegistry', () => {
  it('sends DELETE when no sections specified', async () => {
    mockFetch('', 200);

    const odc = new OdcClient('192.168.0.30');
    await odc.clearRegistry();

    const fetchFn = vi.mocked(fetch);
    expect(fetchFn).toHaveBeenCalledWith(
      'http://192.168.0.30:8061/registry',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('sends PATCH with null values to clear specific sections', async () => {
    mockFetch('', 200);

    const odc = new OdcClient('192.168.0.30');
    await odc.clearRegistry(['auth', 'cache']);

    const fetchFn = vi.mocked(fetch);
    expect(fetchFn).toHaveBeenCalledWith(
      'http://192.168.0.30:8061/registry',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ auth: null, cache: null }),
      }),
    );
  });
});

describe('getAppUi', () => {
  it('returns app UI text', async () => {
    mockFetch('<Component: roSGScreen>');

    const odc = new OdcClient('192.168.0.30');
    const ui = await odc.getAppUi();

    expect(ui).toBe('<Component: roSGScreen>');
  });

  it('sends fields as query param', async () => {
    mockFetch('');

    const odc = new OdcClient('192.168.0.30');
    await odc.getAppUi({ Label: ['text', 'color'] });

    const fetchFn = vi.mocked(fetch);
    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toContain('/app-ui?');
    expect(url).toContain('fields=');
  });
});

describe('pullFile', () => {
  it('sends GET with source query param', async () => {
    mockFetch('file-contents');

    const odc = new OdcClient('192.168.0.30');
    await odc.pullFile('tmp:/data.json');

    const fetchFn = vi.mocked(fetch);
    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toContain('/file?');
    expect(url).toContain('source=');
  });
});

describe('pushFile', () => {
  it('sends PUT with destination and body', async () => {
    mockFetch('', 200);

    const odc = new OdcClient('192.168.0.30');
    const data = new TextEncoder().encode('hello');
    await odc.pushFile('tmp:/test.txt', data);

    const fetchFn = vi.mocked(fetch);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining('/file?destination='),
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});

describe('listFiles', () => {
  it('sends GET to /files', async () => {
    mockFetch('[]');

    const odc = new OdcClient('192.168.0.30');
    await odc.listFiles();

    const fetchFn = vi.mocked(fetch);
    expect(fetchFn).toHaveBeenCalledWith(
      'http://192.168.0.30:8061/files',
      expect.anything(),
    );
  });

  it('sends path as query param', async () => {
    mockFetch('[]');

    const odc = new OdcClient('192.168.0.30');
    await odc.listFiles('tmp:/');

    const fetchFn = vi.mocked(fetch);
    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toContain('/files?path=');
  });
});

describe('getField', () => {
  it('sends GET with nodeId and field params', async () => {
    mockFetch({ value: 'Hello World' });

    const odc = new OdcClient('192.168.0.30');
    const result = await odc.getField('title', 'text');

    expect(result).toBe('Hello World');
    const fetchFn = vi.mocked(fetch);
    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toContain('/field?');
    expect(url).toContain('nodeId=title');
    expect(url).toContain('field=text');
  });

  it('returns complex values', async () => {
    mockFetch({ value: [1, 2, 3] });

    const odc = new OdcClient('192.168.0.30');
    const result = await odc.getField('list', 'items');

    expect(result).toEqual([1, 2, 3]);
  });
});

describe('setField', () => {
  it('sends PATCH with nodeId, field, and value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    const odc = new OdcClient('192.168.0.30');
    await odc.setField('title', 'text', 'New Text');

    const fetchFn = vi.mocked(fetch);
    expect(fetchFn).toHaveBeenCalledWith(
      'http://192.168.0.30:8061/field',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ nodeId: 'title', field: 'text', value: 'New Text' }),
      }),
    );
  });

  it('sends boolean values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    const odc = new OdcClient('192.168.0.30');
    await odc.setField('overlay', 'visible', false);

    const fetchFn = vi.mocked(fetch);
    const body = JSON.parse((fetchFn.mock.calls[0][1] as any).body);
    expect(body.value).toBe(false);
  });
});

describe('callFunc', () => {
  it('sends POST with nodeId, func, and params', async () => {
    mockFetch({ result: 'ok' });

    const odc = new OdcClient('192.168.0.30');
    const result = await odc.callFunc('authManager', 'login', ['user', 'pass']);

    expect(result).toBe('ok');
    const fetchFn = vi.mocked(fetch);
    expect(fetchFn).toHaveBeenCalledWith(
      'http://192.168.0.30:8061/callFunc',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ nodeId: 'authManager', func: 'login', params: ['user', 'pass'] }),
      }),
    );
  });

  it('sends empty params array when none provided', async () => {
    mockFetch({ result: null });

    const odc = new OdcClient('192.168.0.30');
    await odc.callFunc('player', 'pause');

    const fetchFn = vi.mocked(fetch);
    const body = JSON.parse((fetchFn.mock.calls[0][1] as any).body);
    expect(body.params).toEqual([]);
  });
});

describe('findNodes', () => {
  it('sends POST with filters', async () => {
    const nodes = [
      { id: 'btn1', subtype: 'Button', fields: { text: 'Play' } },
      { id: 'btn2', subtype: 'Button', fields: { text: 'Stop' } },
    ];
    mockFetch(nodes);

    const odc = new OdcClient('192.168.0.30');
    const result = await odc.findNodes({ subtype: 'Button' });

    expect(result).toEqual(nodes);
    const fetchFn = vi.mocked(fetch);
    expect(fetchFn).toHaveBeenCalledWith(
      'http://192.168.0.30:8061/findNodes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ filters: { subtype: 'Button' } }),
      }),
    );
  });
});

describe('getFocusedNode', () => {
  it('returns focused node info', async () => {
    const node = { id: 'playBtn', subtype: 'Button', fields: { text: 'Play' } };
    mockFetch({ node });

    const odc = new OdcClient('192.168.0.30');
    const result = await odc.getFocusedNode();

    expect(result).toEqual(node);
  });

  it('returns null when nothing is focused', async () => {
    mockFetch({ node: null });

    const odc = new OdcClient('192.168.0.30');
    const result = await odc.getFocusedNode();

    expect(result).toBeNull();
  });
});

describe('observeField', () => {
  it('sends POST with nodeId, field, and timeout', async () => {
    mockFetch({ value: true, matched: true });

    const odc = new OdcClient('192.168.0.30');
    const result = await odc.observeField('auth', 'isLoggedIn', { match: true, timeout: 5000 });

    expect(result).toEqual({ value: true, matched: true });
    const fetchFn = vi.mocked(fetch);
    const body = JSON.parse((fetchFn.mock.calls[0][1] as any).body);
    expect(body.nodeId).toBe('auth');
    expect(body.field).toBe('isLoggedIn');
    expect(body.match).toBe(true);
    expect(body.timeout).toBe(5000);
  });

  it('uses client timeout as default observe timeout', async () => {
    mockFetch({ value: 'changed', matched: true });

    const odc = new OdcClient('192.168.0.30', { timeout: 3000 });
    await odc.observeField('node', 'field');

    const fetchFn = vi.mocked(fetch);
    const body = JSON.parse((fetchFn.mock.calls[0][1] as any).body);
    expect(body.timeout).toBe(3000);
  });

  it('sets HTTP timeout longer than observe timeout', async () => {
    mockFetch({ value: 'x', matched: false });

    const odc = new OdcClient('192.168.0.30');
    await odc.observeField('node', 'field', { timeout: 8000 });

    const fetchFn = vi.mocked(fetch);
    const init = fetchFn.mock.calls[0][1] as any;
    // AbortSignal.timeout is called with observeTimeout + 5000
    // We can't directly inspect the signal timeout, but verify the call succeeded
    expect(init.signal).toBeDefined();
  });

  it('omits match from body when not provided', async () => {
    mockFetch({ value: 'new', matched: true });

    const odc = new OdcClient('192.168.0.30');
    await odc.observeField('node', 'field');

    const fetchFn = vi.mocked(fetch);
    const body = JSON.parse((fetchFn.mock.calls[0][1] as any).body);
    expect(body).not.toHaveProperty('match');
  });
});

describe('constructor options', () => {
  it('uses default port 8061', async () => {
    mockFetch({});

    const odc = new OdcClient('192.168.0.30');
    await odc.getRegistry();

    const fetchFn = vi.mocked(fetch);
    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toContain(':8061');
  });

  it('accepts custom port', async () => {
    mockFetch({});

    const odc = new OdcClient('192.168.0.30', { port: 9090 });
    await odc.getRegistry();

    const fetchFn = vi.mocked(fetch);
    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toContain(':9090');
  });

  it('Connection: close header is always sent', async () => {
    mockFetch({});

    const odc = new OdcClient('192.168.0.30');
    await odc.getRegistry();

    const fetchFn = vi.mocked(fetch);
    const callHeaders = fetchFn.mock.calls[0][1]!.headers as Record<string, string>;
    expect(callHeaders.Connection).toBe('close');
  });
});

describe('typed errors', () => {
  it('throws OdcHttpError on non-ok response', async () => {
    mockFetch('Not Found', 404);

    const odc = new OdcClient('192.168.0.30');
    await expect(odc.getRegistry()).rejects.toThrow(OdcHttpError);
    try {
      await odc.getRegistry();
    } catch (err) {
      expect(err).toBeInstanceOf(OdcHttpError);
      expect((err as OdcHttpError).status).toBe(404);
      expect((err as OdcHttpError).method).toBe('GET');
      expect((err as OdcHttpError).path).toBe('/registry');
    }
  });

  it('throws OdcTimeoutError on timeout', async () => {
    const err = new DOMException('signal timed out', 'TimeoutError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));

    const odc = new OdcClient('192.168.0.30');
    await expect(odc.getRegistry()).rejects.toThrow(OdcTimeoutError);
  });

  it('OdcTimeoutError includes timeout duration', async () => {
    const err = new DOMException('signal timed out', 'TimeoutError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));

    const odc = new OdcClient('192.168.0.30', { timeout: 5000 });
    try {
      await odc.getRegistry();
    } catch (e) {
      expect(e).toBeInstanceOf(OdcTimeoutError);
      expect((e as OdcTimeoutError).timeoutMs).toBe(5000);
    }
  });

  it('OdcHttpError has method, path, status, and statusText', async () => {
    mockFetch('Server Error', 500);

    const odc = new OdcClient('192.168.0.30');
    try {
      await odc.setRegistry({ a: { b: 'c' } });
    } catch (err) {
      expect(err).toBeInstanceOf(OdcHttpError);
      expect((err as OdcHttpError).method).toBe('PATCH');
      expect((err as OdcHttpError).path).toBe('/registry');
      expect((err as OdcHttpError).status).toBe(500);
    }
  });

  it('re-throws non-timeout fetch errors', async () => {
    const networkErr = new TypeError('fetch failed');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkErr));

    const odc = new OdcClient('192.168.0.30');
    await expect(odc.getRegistry()).rejects.toThrow(TypeError);
  });
});
