#!/usr/bin/env node

import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inject, injectDir } from './inject.js';

const args = process.argv.slice(2);
const command = args[0];

if (command === 'inject') {
  const target = args[1];
  if (!target) {
    console.error('Usage: roku-odc inject <path>');
    console.error('  <path>  Channel zip file or directory');
    process.exit(1);
  }

  const fullPath = resolve(target);
  const info = await stat(fullPath);

  if (info.isDirectory()) {
    await injectDir(fullPath);
    console.log(`Injected ODC into ${fullPath}`);
  } else {
    const zip = await readFile(fullPath);
    const injected = await inject(zip);
    await writeFile(fullPath, injected);
    console.log(`Injected ODC into ${fullPath}`);
  }
} else {
  console.log('roku-odc — On-Device Components for Roku');
  console.log('');
  console.log('Commands:');
  console.log('  inject <path>   Inject ODC into a channel zip or directory');
  console.log('');
  console.log('Examples:');
  console.log('  roku-odc inject build.zip');
  console.log('  roku-odc inject ./my-channel');
  if (command && command !== '--help' && command !== '-h') {
    console.error(`\nUnknown command: ${command}`);
    process.exit(1);
  }
}
