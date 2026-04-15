# roku-odc

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Lightweight TypeScript client and on-device component for Roku ODC — registry access, app UI inspection, and file management for sideloaded channels. Companion library to [@danecodes/roku-ecp](https://www.npmjs.com/package/@danecodes/roku-ecp).

ODC is an HTTP API on port 8061 that provides runtime access to a dev-sideloaded Roku channel. This package includes both the TypeScript client and the BrightScript component that runs on the device, with automatic injection into your channel at sideload time.

## Install

```bash
npm install @danecodes/roku-odc
```

## Quick start

```typescript
import { inject, OdcClient } from '@danecodes/roku-odc';
import { readFile } from 'node:fs/promises';

// Inject the ODC component into your channel zip before sideloading
const channelZip = await readFile('my-channel.zip');
const injectedZip = await inject(channelZip);
// Now sideload injectedZip to your Roku (e.g. via roku-ecp's sideload())

// Connect to the running channel's ODC server
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

// Inspect the app UI tree
const ui = await odc.getAppUi();
```

## Injection

The ODC component must be running inside your channel for the client to connect. This package provides two ways to inject it:

### `inject(zip): Promise<Buffer>`

Inject into a channel zip buffer. Returns a new zip with the ODC component added.

```typescript
import { inject } from '@danecodes/roku-odc';

const original = await readFile('my-channel.zip');
const injected = await inject(original);
await writeFile('my-channel-odc.zip', injected);
```

This:
- Adds the BrightScript ODC server component to `components/roku-odc/`
- Adds the launch hook to `source/roku-odc/`
- Patches your entry point (`Main` or `RunUserInterface`) to initialize ODC at launch
- Patches your Scene component to load the ODC server
- Creates the ODC task node after `screen.show()`

### `injectDir(dir): Promise<void>`

Inject directly into a channel directory on disk. Useful during development.

```typescript
import { injectDir } from '@danecodes/roku-odc';

await injectDir('./my-channel');
```

### Launch configuration

Once injected, the ODC component supports launch-time configuration via ECP launch params:

```typescript
import { EcpClient } from '@danecodes/roku-ecp';

const ecp = new EcpClient('192.168.0.30');

// Launch with pre-loaded registry state
await ecp.launch('dev', {
  odc_registry: JSON.stringify({ auth: { token: 'test' } }),
});

// Clear registry on launch
await ecp.launch('dev', { odc_clear_registry: 'true' });

// Pass channel data (deeplink-like params)
await ecp.launch('dev', {
  odc_channel_data: JSON.stringify({ contentId: 'abc' }),
});

// Launch to a specific entry point
await ecp.launch('dev', { odc_entry_point: 'screensaver' });
// Options: 'channel', 'screensaver', 'screensaver-settings'
```

## Client API

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

Get the current app UI tree as XML. Optionally filter to specific fields per component type.

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
- A Roku device on the same network
- The channel must be dev-sideloaded with the ODC component injected (via `inject()` or `injectDir()`)
- Network access to the device on port 8061

## License

MIT
