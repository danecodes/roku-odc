# roku-odc

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Lightweight TypeScript client for Roku [On-Device Components (ODC)](https://github.com/nicholasRutherworksatRoku/odc) — registry access, app UI inspection, and file management for sideloaded channels. Companion library to [@danecodes/roku-ecp](https://www.npmjs.com/package/@danecodes/roku-ecp).

ODC is an HTTP API on port 8061 that provides runtime access to a dev-sideloaded Roku channel. It requires the ODC component to be included in the sideloaded app.

## Install

```bash
npm install @danecodes/roku-odc
```

## Quick start

```typescript
import { OdcClient } from '@danecodes/roku-odc';

const odc = new OdcClient('192.168.0.30');

// Read the channel's registry
const registry = await odc.getRegistry();
console.log(registry);
// { auth: { token: 'abc', userId: '42' }, settings: { theme: 'dark' } }

// Write registry values
await odc.setRegistry({
  settings: { theme: 'light', volume: '80' },
});

// Clear specific sections
await odc.clearRegistry(['cache', 'temp']);

// Clear all registry
await odc.clearRegistry();

// Inspect the app UI tree
const ui = await odc.getAppUi();
```

## API

### `new OdcClient(ip, options?)`

| Option    | Type     | Default | Description                    |
| --------- | -------- | ------- | ------------------------------ |
| `port`    | `number` | `8061`  | ODC server port                |
| `timeout` | `number` | `10000` | Request timeout in milliseconds |

### Registry

#### `getRegistry(): Promise<Record<string, Record<string, string>>>`

Read all registry sections and keys for the running channel.

```typescript
const registry = await odc.getRegistry();
// { sectionName: { key: 'value', ... }, ... }
```

#### `setRegistry(data): Promise<void>`

Write registry values. Merges with existing data (PATCH semantics).

```typescript
await odc.setRegistry({
  auth: { token: 'new-token' },
  prefs: { language: 'en' },
});
```

#### `clearRegistry(sections?): Promise<void>`

Clear specific registry sections, or all sections if none specified.

```typescript
// Clear specific sections
await odc.clearRegistry(['cache', 'temp']);

// Clear entire registry
await odc.clearRegistry();
```

### App UI

#### `getAppUi(fields?): Promise<string>`

Get the current app UI tree. Optionally filter to specific fields per component type.

```typescript
const ui = await odc.getAppUi();

// Only fetch specific fields
const ui = await odc.getAppUi({ Label: ['text', 'color'] });
```

### File operations

#### `pullFile(source): Promise<ArrayBuffer>`

Download a file from the device.

```typescript
const data = await odc.pullFile('tmp:/data.json');
```

#### `pushFile(destination, data): Promise<void>`

Upload a file to the device.

```typescript
const data = new TextEncoder().encode('{"mock": true}');
await odc.pushFile('tmp:/config.json', data);
```

#### `listFiles(path?): Promise<string>`

List files on the device.

```typescript
const files = await odc.listFiles('tmp:/');
```

## Error handling

All errors are typed for easy catch filtering:

```typescript
import { OdcClient, OdcHttpError, OdcTimeoutError } from '@danecodes/roku-odc';

try {
  await odc.getRegistry();
} catch (err) {
  if (err instanceof OdcTimeoutError) {
    console.log(`Timed out after ${err.timeoutMs}ms`);
  } else if (err instanceof OdcHttpError) {
    console.log(`${err.method} ${err.path} → ${err.status} ${err.statusText}`);
  }
}
```

## Requirements

- Node.js >= 22
- A Roku device on the same network with a dev-sideloaded channel that includes the ODC component
- Network access to the device on port 8061

## License

MIT
