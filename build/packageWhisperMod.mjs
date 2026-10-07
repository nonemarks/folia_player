// build/packageWhisperMod.mjs
// Validates and packages the Whisper alignment mod for installation through Folium.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modDir = join(root, 'mods', 'whisper-align');
const manifestPath = join(modDir, 'mod.json');
const outputDir = join(root, 'release', 'mods');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const outputPath = join(outputDir, `${manifest.id}-${manifest.version}.zip`);
if (manifest.folium !== 1 || manifest.id !== 'whisper-align' || manifest.main !== 'index.cjs') {
  throw new Error('Invalid whisper-align Folium manifest');
}

const entries = {};
const addFiles = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'folium.sig.json' || entry.name === '.DS_Store' || entry.name === 'Thumbs.db' || entry.name === 'desktop.ini') continue;
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await addFiles(filePath);
    } else if (entry.isFile()) {
      const archivePath = relative(modDir, filePath).split(sep).join('/');
      entries[archivePath] = new Uint8Array(await readFile(filePath));
    }
  }
};
await addFiles(modDir);
if (!entries['mod.json'] || !entries['index.cjs']) throw new Error('Whisper mod entry files are missing');

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, zipSync(entries, { level: 9 }));
console.log(`Packaged ${manifest.id} ${manifest.version}: ${outputPath}`);
