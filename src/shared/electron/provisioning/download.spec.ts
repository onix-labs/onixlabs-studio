import { execFile } from 'node:child_process';
import { createGzip } from 'node:zlib';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { downloadTo, extractArchive } from './download';

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

describe('extractArchive with a zip', () => {
  let root: string;
  let destination: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'studio-extract-zip-'));
    destination = path.join(root, 'out');
    mkdirSync(path.join(root, 'src'), { recursive: true });
    mkdirSync(destination, { recursive: true });
    writeFileSync(path.join(root, 'src', 'tool'), 'tool', 'utf8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Zips the staging directory, storing symlinks as links rather than following them.
   * @returns Returns the archive's path.
   */
  async function zip(): Promise<string> {
    const archive: string = path.join(root, 'tool.zip');
    await run('sh', ['-c', `cd "${path.join(root, 'src')}" && zip -q -y -r "${archive}" .`]);
    return archive;
  }

  it.skipIf(process.platform === 'win32')(
    'refusesASymlinkPointingOutOfTheDestination_andRemovesIt',
    async () => {
      // #980 S14: Info-ZIP restores links verbatim; one pointing out would lead whatever follows it
      // outside the install.
      symlinkSync('../../../etc', path.join(root, 'src', 'escape'));

      await expect(extractArchive(await zip(), destination, 'zip')).rejects.toThrow(
        /symlink escape points outside/,
      );
      expect(existsSync(path.join(destination, 'tool'))).toBe(true);
      expect((): string => readlinkSync(path.join(destination, 'escape'))).toThrow();
    },
  );

  it.skipIf(process.platform === 'win32')('keepsASymlinkThatStaysInside', async () => {
    // A framework bundle's `Current -> A` is ordinary and must survive.
    symlinkSync('tool', path.join(root, 'src', 'alias'));

    await extractArchive(await zip(), destination, 'zip');

    expect(readlinkSync(path.join(destination, 'alias'))).toBe('tool');
  });
});

describe('downloadTo', () => {
  let root: string;
  let requested: string[];

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'studio-download-'));
    requested = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Stubs fetch with a fixed set of answers, recording every URL asked for.
   * @param answers URL to the response it gets.
   */
  function serve(answers: Readonly<Record<string, () => Response>>): void {
    vi.stubGlobal('fetch', (url: string): Promise<Response> => {
      requested.push(url);
      const answer: (() => Response) | undefined = answers[url];
      return Promise.resolve(answer === undefined ? new Response(null, { status: 404 }) : answer());
    });
  }

  /**
   * Builds a redirect response.
   * @param location Where it points.
   * @returns Returns the response.
   */
  function redirect(location: string): Response {
    return new Response(null, { status: 302, headers: { location } });
  }

  it('followsAnHttpsToHttpsRedirect_asGitHubReleaseAssetsDo', async () => {
    serve({
      'https://github.com/o/r/releases/download/v1/a.tgz': (): Response =>
        redirect('https://objects.githubusercontent.com/a.tgz'),
      'https://objects.githubusercontent.com/a.tgz': (): Response => new Response('payload'),
    });
    const file: string = path.join(root, 'a.tgz');

    await downloadTo('https://github.com/o/r/releases/download/v1/a.tgz', file);

    expect(readFileSync(file, 'utf8')).toBe('payload');
  });

  it('refusesARedirectToPlainHttp_withoutRequestingIt', async () => {
    // #980 S14: a downgrade is refused before the insecure request is ever made.
    serve({
      'https://example.invalid/a.tgz': (): Response => redirect('http://example.invalid/a.tgz'),
      'http://example.invalid/a.tgz': (): Response => new Response('swapped'),
    });

    await expect(downloadTo('https://example.invalid/a.tgz', path.join(root, 'a'))).rejects.toThrow(
      /non-https/,
    );
    expect(requested).toEqual(['https://example.invalid/a.tgz']);
  });

  it('givesUpOnARedirectLoop', async () => {
    serve({
      'https://example.invalid/a': (): Response => redirect('/a'),
    });

    await expect(downloadTo('https://example.invalid/a', path.join(root, 'a'))).rejects.toThrow(
      /redirects/,
    );
  });
});
