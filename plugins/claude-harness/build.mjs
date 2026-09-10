// Builds the Claude agent harness into the layout its manifest names.
//
// The SDK is left EXTERNAL rather than bundled. It ships its own Claude Code CLI as a binary asset and
// resolves it relative to its own module path, so inlining the JavaScript would produce a bundle that
// cannot find the program it exists to drive. The manifest therefore provisions an npm dependency tree
// rather than a single archived file, which is the shape `provision.kind: 'npm'` exists for.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(join(root, 'dist', 'claude-harness'), { recursive: true });

await build({
  entryPoints: [join(root, 'src', 'main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['@anthropic-ai/claude-agent-sdk'],
  outfile: join(root, 'dist', 'claude-harness', 'main.js'),
});

cpSync(join(root, 'plugin.json'), join(root, 'dist', 'plugin.json'));
console.log('built plugins/claude-harness/dist');
