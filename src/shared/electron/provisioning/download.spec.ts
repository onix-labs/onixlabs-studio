import { execFile } from 'node:child_process';
import { createGzip } from 'node:zlib';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { extractArchive } from './download';

/**
 * Runs a command, for building the archives the extraction is tested against.
 */
const run: (file: string, args: readonly string[]) => Promise<unknown> = promisify(execFile);

describe('extractArchive', () => {
  let root: string;
  let archive: string;
  let destination: string;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'studio-extract-'));
    destination = path.join(root, 'out');
    mkdirSync(destination, { recursive: true });
    // An archive shaped like Docker's static package on Linux: the wanted client beside a daemon and
    // its runtime, all under one directory.
    const source: string = path.join(root, 'src', 'docker');
    mkdirSync(source, { recursive: true });
    for (const name of ['docker', 'dockerd', 'containerd', 'runc']) {
      writeFileSync(path.join(source, name), name, 'utf8');
    }
    archive = path.join(root, 'docker.tgz');
    await run('tar', ['-czf', archive, '-C', path.join(root, 'src'), 'docker']);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('decompressesASingleGzippedFileToWhereTheCallerAsked', async () => {
    // Not an archive: rust-analyzer publishes its Unix builds as a bare gzipped binary rather than a
    // one-entry tarball, so there is nothing inside to name and the caller says where it lands.
    const plain: string = path.join(root, 'server');
    writeFileSync(plain, 'binary-contents', 'utf8');
    const gzipped: string = path.join(root, 'server.gz');
    await pipeline(createReadStream(plain), createGzip(), createWriteStream(gzipped));
    const target: string = path.join(destination, 'nested', 'rust-analyzer');

    await extractArchive(gzipped, destination, 'gz', 0, [], target);

    expect(readFileSync(target, 'utf8')).toBe('binary-contents');
  });

  it('extractsEverythingWhenNoMembersAreNamed', async () => {
    await extractArchive(archive, destination, 'tar.gz');

    expect(existsSync(path.join(destination, 'docker', 'docker'))).toBe(true);
    expect(existsSync(path.join(destination, 'docker', 'dockerd'))).toBe(true);
  });

  it('extractsOnlyTheNamedMembers', async () => {
    // The case this exists for: Docker publishes one archive holding the whole engine, and extracting
    // all of it would put a second container daemon on a machine already running one.
    await extractArchive(archive, destination, 'tar.gz', 0, ['docker/docker']);

    expect(existsSync(path.join(destination, 'docker', 'docker'))).toBe(true);
    expect(existsSync(path.join(destination, 'docker', 'dockerd'))).toBe(false);
    expect(existsSync(path.join(destination, 'docker', 'containerd'))).toBe(false);
    expect(existsSync(path.join(destination, 'docker', 'runc'))).toBe(false);
  });

  it('extractsSeveralNamedMembers', async () => {
    await extractArchive(archive, destination, 'tar.gz', 0, ['docker/docker', 'docker/runc']);

    expect(existsSync(path.join(destination, 'docker', 'docker'))).toBe(true);
    expect(existsSync(path.join(destination, 'docker', 'runc'))).toBe(true);
    expect(existsSync(path.join(destination, 'docker', 'dockerd'))).toBe(false);
  });
});
