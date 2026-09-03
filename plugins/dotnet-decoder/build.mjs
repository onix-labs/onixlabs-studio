// Builds the .NET decoder plugin into the layout its manifest names.
//
// Published self-contained: the decoder must run on a machine with no .NET installed, which is most
// of them. That makes the payload large, which is exactly why this is a plugin rather than something
// every Studio install carries.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const runtime = process.argv[2] ?? 'osx-x64';
const publish = join(root, 'obj', 'publish', runtime);

rmSync(join(root, 'dist'), { recursive: true, force: true });
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
    'true',
    '-p:PublishSingleFile=false',
    '-o',
    publish,
  ],
  { stdio: 'inherit' },
);

cpSync(publish, join(root, 'dist', 'dotnet-decoder'), { recursive: true });
cpSync(join(root, 'plugin.json'), join(root, 'dist', 'plugin.json'));
console.log('built plugins/dotnet-decoder/dist');
