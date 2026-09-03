// Builds the .NET decoder plugin into the layout its manifest names.
//
// Framework-dependent, with a native apphost per platform. Self-contained would be ~79 MB a platform
// and ~400 MB across the release, to avoid a dependency that anyone decoding .NET assemblies already
// has. The manifest declares `requires: dotnet` instead, so Studio detects its absence and says so
// rather than shipping a runtime nobody needed.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const runtime = process.argv[2] ?? 'osx-x64';
const publish = join(root, 'obj', 'publish', runtime);

rmSync(join(root, 'dist'), { recursive: true, force: true });
// Also the publish tree: a stale self-contained publish would otherwise be copied over a
// framework-dependent one, silently shipping a runtime the manifest says is not included.
rmSync(publish, { recursive: true, force: true });
mkdirSync(join(root, 'dist'), { recursive: true });

execFileSync(
  'dotnet',
  [
    'publish',
    join(root, 'src', 'dotnet-decoder.csproj'),
    '-c',
    'Release',
    '-r',
    runtime,
    '--self-contained',
    'false',
    '-p:PublishSingleFile=false',
    '-o',
    publish,
  ],
  { stdio: 'inherit' },
);

cpSync(publish, join(root, 'dist', 'dotnet-decoder'), { recursive: true });
cpSync(join(root, 'plugin.json'), join(root, 'dist', 'plugin.json'));
console.log('built plugins/dotnet-decoder/dist');
