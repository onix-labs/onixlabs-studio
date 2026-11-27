// Builds the native decoder plugin into the layout its manifest names.
//
// `disassembler` is left external rather than bundled: it is WebAssembly-backed, and its `.wasm` must
// sit beside the JavaScript that loads it. So the payload is a small bundle plus the dependency tree,
// which is also exactly what the release archive contains.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { writePluginLicences } from '../../scripts/licences/plugin.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const repo = join(root, '..', '..');
const out = join(root, 'dist', 'native-decoder');

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const bundled = await build({
  // Read back by writePluginLicences, so the notices list what was actually bundled (#1612).
  metafile: true,
  entryPoints: [join(root, 'src', 'main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: join(out, 'main.js'),
  external: ['disassembler'],
});

// Its licence, and the notices of what it carries from others, travel in the archive (#1612):
// disassembler (and the Capstone engine inside it) ships whole beside the bundle, so it is named
// rather than found in the metafile, whose paths are relative to the working directory here.
writePluginLicences({
  root,
  metafile: bundled.metafile,
  out,
  base: process.cwd(),
  ships: [join(repo, 'node_modules', 'disassembler')],
});

cpSync(
  join(repo, 'node_modules', 'disassembler'),
  join(root, 'dist', 'node_modules', 'disassembler'),
  {
    recursive: true,
  },
);
cpSync(join(root, 'plugin.json'), join(root, 'dist', 'plugin.json'));

console.log('built plugins/native-decoder/dist');
