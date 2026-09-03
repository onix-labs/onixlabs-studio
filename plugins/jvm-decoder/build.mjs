// Builds the jvm decoder plugin into the layout its manifest names.
// Pure TypeScript with no runtime dependencies, so the payload is one bundled file.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(join(root, 'dist', 'jvm-decoder'), { recursive: true });

await build({
  entryPoints: [join(root, 'src', 'main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: join(root, 'dist', 'jvm-decoder', 'main.js'),
});

cpSync(join(root, 'plugin.json'), join(root, 'dist', 'plugin.json'));
console.log('built plugins/jvm-decoder/dist');
