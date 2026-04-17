import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { COMPONENT_FILES } from './component.js';

/**
 * Inject the ODC component into a channel zip buffer.
 * Returns a new zip with the ODC BrightScript files added and
 * the channel's entry point patched to start the ODC server.
 */
export async function inject(zip: Buffer): Promise<Buffer> {
  // Dynamic imports to keep them optional for users who only use the client
  const { default: yauzl } = await import('yauzl');
  const { ZipFile } = await import('yazl');

  const entries = await readZipEntries(yauzl, zip);

  // Patch source .brs files to hook ODC into the channel
  patchSourceFiles(entries);

  // Add ODC component files
  for (const [path, content] of Object.entries(COMPONENT_FILES)) {
    entries.set(path, Buffer.from(content, 'utf-8'));
  }

  return createZip(ZipFile, entries);
}

/**
 * Inject the ODC component into a channel directory on disk.
 * Writes the ODC BrightScript files and patches the channel's entry point.
 */
export async function injectDir(dir: string): Promise<void> {
  // Read existing source files
  const entries = new Map<string, Buffer>();
  await readDirRecursive(dir, dir, entries);

  // Patch source files
  patchSourceFiles(entries);

  // Write patched files back
  for (const [path, content] of entries) {
    const fullPath = join(dir, path);
    await writeFile(fullPath, content);
  }

  // Write ODC component files
  for (const [path, content] of Object.entries(COMPONENT_FILES)) {
    const fullPath = join(dir, path);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content);
  }
}

// ---- Entry point patching ----

const ENTRY_POINT_RE = /^(\s*(?:sub|function)\s+(?:main|runuserinterface)\s*\()(\s*(\w+))?([^)]*\)[^\r\n]*)/gim;
const SCREEN_SHOW_RE = /(\.show\(\))(?=\s*(?:$|'))/gim;

function patchSourceFiles(entries: Map<string, Buffer>): void {
  for (const [path, content] of entries) {
    if (!/^source\/.*\.brs$/i.test(path)) continue;

    let source = content.toString('utf-8');
    let changed = false;

    // Patch entry point functions to call odcMain
    source = source.replace(ENTRY_POINT_RE, (...groups: string[]) => {
      changed = true;
      const param = groups[3] || 'args';
      const decl = groups[3]
        ? groups[0]
        : groups[1] + param + groups[4];
      return decl + ` : odcMain(${param})`;
    });

    // After screen.show(), create the ODC node
    source = source.replace(SCREEN_SHOW_RE, (...groups: string[]) => {
      changed = true;
      return groups[1] + ' : createObject("roSGNode", "RokuODC")';
    });

    if (changed) {
      entries.set(path, Buffer.from(source, 'utf-8'));
    }
  }
}

// ---- Zip helpers ----

function readZipEntries(
  yauzl: typeof import('yauzl'),
  zip: Buffer,
): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zip, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('Failed to open zip'));

      const entries = new Map<string, Buffer>();
      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (err, stream) => {
          if (err || !stream) return reject(err ?? new Error('Failed to read entry'));
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zipfile.readEntry();
          });
        });
      });

      zipfile.on('end', () => resolve(entries));
      zipfile.on('error', reject);
    });
  });
}

function createZip(
  ZipFile: typeof import('yazl').ZipFile,
  entries: Map<string, Buffer>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    for (const [name, data] of entries) {
      zip.addBuffer(data, name);
    }
    zip.end();

    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
  });
}

async function readDirRecursive(
  base: string,
  dir: string,
  entries: Map<string, Buffer>,
): Promise<void> {
  const items = await readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = join(dir, item.name);
    if (item.isDirectory()) {
      await readDirRecursive(base, fullPath, entries);
    } else {
      const relPath = relative(base, fullPath);
      entries.set(relPath, await readFile(fullPath));
    }
  }
}
