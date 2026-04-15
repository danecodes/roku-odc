import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { inject, injectDir } from '../index.js';
import { COMPONENT_FILES } from '../component.js';
import { ZipFile } from 'yazl';
import yauzl from 'yauzl';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/* ---- helpers ---- */

function createTestZip(files: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    for (const [name, content] of Object.entries(files)) {
      zip.addBuffer(Buffer.from(content, 'utf-8'), name);
    }
    zip.end();
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
  });
}

function readZip(buf: Buffer): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err);
      const entries = new Map<string, string>();
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (err, stream) => {
          if (err || !stream) return reject(err);
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks).toString('utf-8'));
            zipfile.readEntry();
          });
        });
      });
      zipfile.on('end', () => resolve(entries));
    });
  });
}

const MAIN_BRS = `sub Main(args as dynamic)
  screen = CreateObject("roSGScreen")
  scene = screen.CreateScene("MainScene")
  port = CreateObject("roMessagePort")
  screen.setMessagePort(port)
  screen.show()
  while true
    msg = wait(0, port)
  end while
end sub
`;

const SCENE_XML = `<?xml version="1.0" encoding="utf-8" ?>
<component name="MainScene" extends="Scene">
  <script type="text/brightscript" uri="MainScene.brs" />
  <children>
    <Label id="title" text="Hello" />
  </children>
</component>
`;

/* ---- inject() tests ---- */

describe('inject (zip)', () => {
  it('adds ODC component files to the zip', async () => {
    const input = await createTestZip({
      'manifest': 'title=Test\nmajor_version=1\n',
      'source/main.brs': MAIN_BRS,
      'components/MainScene.xml': SCENE_XML,
    });

    const output = await inject(input);
    const entries = await readZip(output);

    expect(entries.has('components/roku-odc/RokuODC.xml')).toBe(true);
    expect(entries.has('components/roku-odc/RokuODC.brs')).toBe(true);
    expect(entries.has('source/roku-odc/odcMain.brs')).toBe(true);
  });

  it('patches main.brs to call odcMain', async () => {
    const input = await createTestZip({
      'manifest': 'title=Test\n',
      'source/main.brs': MAIN_BRS,
      'components/MainScene.xml': SCENE_XML,
    });

    const output = await inject(input);
    const entries = await readZip(output);
    const mainBrs = entries.get('source/main.brs')!;

    expect(mainBrs).toContain('odcMain(args)');
  });

  it('patches main.brs to create RokuODC node after screen.show()', async () => {
    const input = await createTestZip({
      'manifest': 'title=Test\n',
      'source/main.brs': MAIN_BRS,
      'components/MainScene.xml': SCENE_XML,
    });

    const output = await inject(input);
    const entries = await readZip(output);
    const mainBrs = entries.get('source/main.brs')!;

    expect(mainBrs).toContain('createObject("roSGNode", "RokuODC")');
  });

  it('preserves existing zip entries', async () => {
    const input = await createTestZip({
      'manifest': 'title=Test\n',
      'source/main.brs': MAIN_BRS,
      'source/utils.brs': 'function helper()\nend function\n',
      'components/MainScene.xml': SCENE_XML,
      'images/icon.png': 'fake-png-data',
    });

    const output = await inject(input);
    const entries = await readZip(output);

    expect(entries.has('manifest')).toBe(true);
    expect(entries.get('images/icon.png')).toBe('fake-png-data');
    expect(entries.get('source/utils.brs')).toContain('function helper()');
  });

  it('does not patch non-entry-point brs files', async () => {
    const input = await createTestZip({
      'manifest': 'title=Test\n',
      'source/main.brs': MAIN_BRS,
      'source/utils.brs': 'function helper()\nend function\n',
      'components/MainScene.xml': SCENE_XML,
    });

    const output = await inject(input);
    const entries = await readZip(output);

    expect(entries.get('source/utils.brs')).toBe('function helper()\nend function\n');
  });

  it('handles RunUserInterface entry point', async () => {
    const altMain = `sub RunUserInterface(args as dynamic)
  screen = CreateObject("roSGScreen")
  scene = screen.CreateScene("MainScene")
  screen.show()
  while true
    msg = wait(0, CreateObject("roMessagePort"))
  end while
end sub
`;
    const input = await createTestZip({
      'manifest': 'title=Test\n',
      'source/main.brs': altMain,
      'components/MainScene.xml': SCENE_XML,
    });

    const output = await inject(input);
    const entries = await readZip(output);
    const mainBrs = entries.get('source/main.brs')!;

    expect(mainBrs).toContain('odcMain(args)');
    expect(mainBrs).toContain('createObject("roSGNode", "RokuODC")');
  });

  it('does not modify scene or other component XMLs', async () => {
    const input = await createTestZip({
      'manifest': 'title=Test\n',
      'source/main.brs': MAIN_BRS,
      'components/MainScene.xml': SCENE_XML,
    });

    const output = await inject(input);
    const entries = await readZip(output);

    expect(entries.get('components/MainScene.xml')).toBe(SCENE_XML);
  });
});

/* ---- injectDir() tests ---- */

describe('injectDir', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'roku-odc-test-'));
    await mkdir(join(tmpDir, 'source'), { recursive: true });
    await mkdir(join(tmpDir, 'components'), { recursive: true });
    await writeFile(join(tmpDir, 'manifest'), 'title=Test\n');
    await writeFile(join(tmpDir, 'source/main.brs'), MAIN_BRS);
    await writeFile(join(tmpDir, 'components/MainScene.xml'), SCENE_XML);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes ODC component files', async () => {
    await injectDir(tmpDir);

    const xml = await readFile(join(tmpDir, 'components/roku-odc/RokuODC.xml'), 'utf-8');
    const brs = await readFile(join(tmpDir, 'components/roku-odc/RokuODC.brs'), 'utf-8');
    const mainOdc = await readFile(join(tmpDir, 'source/roku-odc/odcMain.brs'), 'utf-8');

    expect(xml).toContain('RokuODC');
    expect(brs).toContain('odcStartServer');
    expect(mainOdc).toContain('odcMain');
  });

  it('patches source/main.brs', async () => {
    await injectDir(tmpDir);

    const mainBrs = await readFile(join(tmpDir, 'source/main.brs'), 'utf-8');
    expect(mainBrs).toContain('odcMain(args)');
    expect(mainBrs).toContain('createObject("roSGNode", "RokuODC")');
  });

  it('does not modify scene XML', async () => {
    await injectDir(tmpDir);

    const sceneXml = await readFile(join(tmpDir, 'components/MainScene.xml'), 'utf-8');
    expect(sceneXml).toBe(SCENE_XML);
  });
});
