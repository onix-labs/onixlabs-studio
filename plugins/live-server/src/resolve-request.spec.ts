import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isInside, pathOf, resolveRequest, ResolvedRequest, segmentsOf } from './resolve-request';

describe('resolveRequest (#1062)', () => {
  let scratch: string = '';
  let root: string = '';

  beforeAll(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'live-server-resolve-')));
    root = path.join(scratch, 'site');
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'empty'));
    fs.mkdirSync(path.join(root, '.git'));
    fs.mkdirSync(path.join(scratch, 'secret'));
    fs.writeFileSync(path.join(root, 'index.html'), '<p>home</p>');
    fs.writeFileSync(path.join(root, 'docs', 'index.html'), '<p>docs</p>');
    fs.writeFileSync(path.join(root, 'a b.css'), 'p {}');
    fs.writeFileSync(path.join(root, '.env'), 'TOKEN=1');
    fs.writeFileSync(path.join(root, '.git', 'config'), '[core]');
    fs.writeFileSync(path.join(scratch, 'secret', 'passwd'), 'root');
    fs.writeFileSync(path.join(scratch, 'site-other.txt'), 'sibling');
    fs.symlinkSync(path.join(scratch, 'secret'), path.join(root, 'out'));
    fs.symlinkSync(path.join(scratch, 'secret', 'passwd'), path.join(root, 'linked.txt'));
    fs.symlinkSync(path.join(root, 'index.html'), path.join(root, 'alias.html'));
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('serves_aFile_atItsPath', async () => {
    expect(await resolveRequest(root, '/a%20b.css?v=1#x')).toEqual({
      kind: 'file',
      file: path.join(root, 'a b.css'),
    });
  });

  it('serves_theFolder_asItsIndexPage', async () => {
    expect(await resolveRequest(root, '/')).toEqual({
      kind: 'file',
      file: path.join(root, 'index.html'),
    });
    expect(await resolveRequest(root, '/docs/')).toEqual({
      kind: 'file',
      file: path.join(root, 'docs', 'index.html'),
    });
  });

  it('redirects_aFolderAskedForWithoutItsSlash', async () => {
    expect(await resolveRequest(root, '/docs')).toEqual({ kind: 'redirect', location: '/docs/' });
  });

  it('redirects_onlyWithinTheSite_whateverTheSlashesAskedFor', async () => {
    // A folder named like a host, asked for as `//example.com`, must not redirect off-site.
    fs.mkdirSync(path.join(root, 'example.com', 'a b'), { recursive: true });
    expect(await resolveRequest(root, '//example.com')).toEqual({
      kind: 'redirect',
      location: '/example.com/',
    });
    expect(await resolveRequest(root, '//example.com//a%20b')).toEqual({
      kind: 'redirect',
      location: '/example.com/a%20b/',
    });
  });

  it('lists_noFolder_withoutAnIndexPage', async () => {
    expect(await resolveRequest(root, '/empty/')).toEqual({ kind: 'not-found' });
  });

  it('serves_aLinkThatStaysInside', async () => {
    expect(await resolveRequest(root, '/alias.html')).toEqual({
      kind: 'file',
      file: path.join(root, 'index.html'),
    });
  });

  it.each<string>(['/.env', '/.git/config', '/missing.html'])(
    'serves_nothing_for %s',
    async (target: string) => {
      expect(await resolveRequest(root, target)).toEqual({ kind: 'not-found' });
    },
  );

  it.each<string>([
    '/../secret/passwd',
    '/..%2fsecret%2fpasswd',
    '/%2e%2e/secret/passwd',
    '/%252e%252e/secret/passwd',
    '/docs/../../secret/passwd',
    '/....//secret/passwd',
    '/..\\secret\\passwd',
    '/%5c..%5csecret%5cpasswd',
    '/index.html%00.png',
    '/%E0%A4%A',
    '/out/passwd',
    '/linked.txt',
    'secret/passwd',
  ])('refuses %s', async (target: string) => {
    const resolved: ResolvedRequest = await resolveRequest(root, target);

    expect(resolved.kind === 'forbidden' || resolved.kind === 'not-found').toBe(true);
    expect(resolved.kind).not.toBe('file');
  });

  it('refuses_aTraversal_asForbidden', async () => {
    expect(await resolveRequest(root, '/../secret/passwd')).toEqual({ kind: 'forbidden' });
    expect(await resolveRequest(root, '/out/passwd')).toEqual({ kind: 'forbidden' });
  });

  it('splits_theQueryAndFragment_offThePath', () => {
    expect(pathOf('/a.html?x=1#top')).toBe('/a.html');
    expect(pathOf('/a.html#top?x')).toBe('/a.html');
  });

  it('decodes_onceAndRefusesWhatIsNotAPlainPath', () => {
    expect(segmentsOf('/a/%2e/b')).toBeNull();
    expect(segmentsOf('/a//b/')).toEqual(['a', 'b']);
    expect(segmentsOf('relative')).toBeNull();
  });

  it('compares_wholeSegments_notPrefixes', () => {
    expect(isInside(root, path.join(scratch, 'site-other.txt'))).toBe(false);
    expect(isInside(root, root)).toBe(true);
    expect(isInside(root, path.join(root, 'x'))).toBe(true);
  });
});
