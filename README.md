# roku-odc

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Lightweight TypeScript client and on-device component for Roku ODC — registry access, SceneGraph introspection, and file management for sideloaded channels. Companion library to [@danecodes/roku-ecp](https://www.npmjs.com/package/@danecodes/roku-ecp).

ODC is an HTTP API on port 8061 that provides deep runtime access to a dev-sideloaded Roku channel. This package includes both the TypeScript client and the BrightScript component that runs on the device, with automatic injection into your channel at sideload time.

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

// Read/write SceneGraph node fields
const isLoggedIn = await odc.getField('authManager', 'isLoggedIn');
await odc.setField('featureFlags', 'darkMode', true);

// Call interface functions on nodes
await odc.callFunc('authManager', 'login', ['testuser', 'password']);

// Wait for a field to reach a value
const result = await odc.observeField('authManager', 'isLoggedIn', { match: true, timeout: 5000 });

// Find nodes by properties
const buttons = await odc.findNodes({ subtype: 'Button', text: 'Play' });

// Get the focused node
const focused = await odc.getFocusedNode();

// Registry, files, and app-ui also available
const registry = await odc.getRegistry();
```

## Capability matrix

| Feature | Method | Description |
| ------- | ------ | ----------- |
| **getField** | `odc.getField(nodeId, field)` | Read any field on any node by ID |
| **setField** | `odc.setField(nodeId, field, value)` | Write any field on any node |
| **callFunc** | `odc.callFunc(nodeId, func, params?)` | Call interface functions on nodes |
| **observeField** | `odc.observeField(nodeId, field, opts?)` | Wait for a field to change or match a value |
| **findNodes** | `odc.findNodes(filters)` | Search the SceneGraph tree by subtype/field values |
| **getFocusedNode** | `odc.getFocusedNode()` | Get the currently focused node with all fields |
| **getRegistry** | `odc.getRegistry()` | Read all registry sections and keys |
| **setRegistry** | `odc.setRegistry(data)` | Write registry values (PATCH merge) |
| **clearRegistry** | `odc.clearRegistry(sections?)` | Clear specific or all registry sections |
| **getAppUi** | `odc.getAppUi(fields?)` | Full SceneGraph tree as XML |
| **pullFile** | `odc.pullFile(source)` | Download a file from the device |
| **pushFile** | `odc.pushFile(dest, data)` | Upload a file to the device |
| **listFiles** | `odc.listFiles(path?)` | List directory contents |

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

### Node primitives

#### `getField(nodeId, field): Promise<unknown>`

Read a field value from a node found by ID (recursive search from scene root).

```typescript
const text = await odc.getField('title', 'text');
const visible = await odc.getField('overlay', 'visible');
```

#### `setField(nodeId, field, value): Promise<void>`

Set a field value on a node.

```typescript
await odc.setField('title', 'text', 'Welcome');
await odc.setField('featureFlags', 'darkMode', true);
```

#### `callFunc(nodeId, func, params?): Promise<unknown>`

Call an interface function on a node. Supports up to 5 parameters.

```typescript
// Call with no params
await odc.callFunc('player', 'pause');

// Call with params
const result = await odc.callFunc('authManager', 'login', ['user', 'pass']);
```

#### `findNodes(filters): Promise<NodeInfo[]>`

Search the SceneGraph tree for nodes matching field values.

```typescript
// Find all Buttons
const buttons = await odc.findNodes({ subtype: 'Button' });

// Find a specific label
const labels = await odc.findNodes({ subtype: 'Label', text: 'Hello' });
```

Returns an array of `NodeInfo` objects with `id`, `subtype`, and `fields`.

#### `getFocusedNode(): Promise<NodeInfo | null>`

Get the currently focused node with all its fields.

```typescript
const focused = await odc.getFocusedNode();
if (focused) {
  console.log(focused.subtype, focused.id, focused.fields.text);
}
```

#### `observeField(nodeId, field, options?): Promise<ObserveResult>`

Wait for a field to change or match a specific value. Blocks the ODC server for up to `timeout` ms.

```typescript
// Wait for any change
const result = await odc.observeField('player', 'state');

// Wait for a specific value
const result = await odc.observeField('auth', 'isLoggedIn', {
  match: true,
  timeout: 5000,
});

if (result.matched) {
  console.log('Field matched:', result.value);
}
```

| Option    | Type      | Default         | Description                          |
| --------- | --------- | --------------- | ------------------------------------ |
| `match`   | `unknown` | *(any change)*  | Value to wait for                    |
| `timeout` | `number`  | client timeout  | Max wait in milliseconds             |

### Registry

#### `getRegistry(): Promise<Record<string, Record<string, string>>>`

Read all registry sections and keys for the running channel.

```typescript
const registry = await odc.getRegistry();
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
await odc.clearRegistry(['cache', 'temp']);
await odc.clearRegistry();
```

### App UI

#### `getAppUi(fields?): Promise<string>`

Get the current app UI tree as XML. Optionally filter to specific fields per component type.

```typescript
const ui = await odc.getAppUi();
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
import { OdcHttpError, OdcTimeoutError } from '@danecodes/roku-odc';

try {
  await odc.getField('missing', 'text');
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
