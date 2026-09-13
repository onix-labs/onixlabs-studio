// Builds the AI SDK agent harness into the layout its manifest names.
//
// ## Why this one bundles its SDK when the other two do not
//
// The Claude and Codex harnesses leave their SDKs **external**, because each spawns a per-platform
// native binary that the SDK resolves relative to its own module path — inlining the JavaScript would
// produce a bundle that cannot find the program it exists to drive. Neither reason applies here. The AI
// SDK is pure JavaScript that makes HTTP requests, so the whole of it — `ai` plus the four `@ai-sdk/*`
// clients and their transitive tree — collapses into one 2MB file that runs anywhere Node does.
//
// That is worth taking. A bundled harness is:
//
//   - **one package in the lockfile** instead of thirty-odd, so the pinned tree is a single tarball with
//     a single integrity rather than a graph somebody has to regenerate whenever a transitive dependency
//     moves;
//   - **immune to the `libc` hazard**. `parseLockfile` filters `os` and `cpu` but not npm's `libc`, so a
//     tree containing musl and glibc builds of the same package downloads both on Linux. A tree with no
//     native packages in it cannot hit that;
//   - **two megabytes rather than two hundred**, which is what a user waits through when they install it.
//
// ⚠️ The trade is that a fix in `ai` needs this plugin republished. That is already true of the other
// two: a lockfile pins exact versions, so no harness picks up an upstream release on its own.
//
// ## Why it is still an npm package
//
// A lockfile-provisioned tree may contain nothing but `node_modules/` (`isConfined` in
// `lockfile-provision.ts` refuses any other destination), so the harness cannot be a loose file beside
// the tree — it has to BE one of the packages in it. The alternative provisioning kind, `archive`, is
// keyed by platform, which would mean publishing five identical copies of a platform-independent file.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'dist', 'package');

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, 'src', 'main.ts')],
  bundle: true,
  platform: 'node',
  // Pinned so the output does not depend on where this was run from. esbuild writes each module's path
  // into the bundle as a comment, relative to the working directory — so building from the repository
  // root and building from this directory produce different bytes for identical sources. That matters
  // more here than it looks: the tarball's integrity is pinned in a lockfile, so a bundle that differs
  // by nothing but a comment is an install that fails verification on every user's machine.
  absWorkingDir: root,
  // Studio runs this under its own runtime — Electron's Node — so the floor is met by the host rather
  // than by whatever the user happens to have installed.
  target: 'node22',
  format: 'cjs',
  outfile: join(out, 'main.js'),
});

// The package manifest ships inside the tarball: it is what puts `main.js` at the path the plugin
// manifest's entry point points to.
cpSync(join(root, 'package.json'), join(out, 'package.json'));
cpSync(join(root, 'plugin.json'), join(root, 'dist', 'plugin.json'));

console.log('built plugins/ai-sdk-harness/dist');
