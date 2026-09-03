// Builds the native decoder plugin into the layout its manifest names.
//
// `disassembler` is left external rather than bundled: it is WebAssembly-backed, and its `.wasm` must
// sit beside the JavaScript that loads it. So the payload is a small bundle plus the dependency tree,
// which is also exactly what the release archive contains.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const repo = join(root, '..', '..');
const out = join(root, 'dist', 'native-decoder');

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, 'src', 'main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: join(out, 'main.js'),
  external: ['disassembler'],
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
