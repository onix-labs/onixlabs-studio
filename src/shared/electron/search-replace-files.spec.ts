import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ReplaceRequest, ReplaceResponse } from '@shared/api/search-channels';
import { isReplaceRequest, replaceInFiles } from './search-replace-files';
import { WorkspaceContext } from './workspace-context';

describe('replaceInFiles (#882)', () => {
  let scratch: string;
  let root: string;
  let outside: string;
  let workspace: WorkspaceContext;

  beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'studio-replace-'));
    root = path.join(scratch, 'ws');
    outside = path.join(scratch, 'elsewhere');
    mkdirSync(path.join(root, 'src'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(root, 'src', 'a.ts'), 'name = name;\n');
    writeFileSync(path.join(root, 'src', 'b.ts'), 'const name = 1;\n');
    writeFileSync(path.join(outside, 'secret.ts'), 'name\n');
    workspace = new WorkspaceContext();
    workspace.addRoot(root);
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * Builds a request to replace "name" with "id" in the given files.
   * @param files The files.
   * @param overrides Any field to change.
   * @returns Returns the request.
   */
  function request(
    files: readonly string[],
    overrides: Partial<ReplaceRequest> = {},
  ): ReplaceRequest {
    return {
      query: 'name',
      root,
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
      replacement: 'id',
      files,
      ...overrides,
    };
  }

  /**
   * Reads a file under the workspace.
   * @param relative The path relative to the root.
   * @returns Returns the file's text.
   */
  function read(relative: string): string {
    return readFileSync(path.join(root, relative), 'utf8');
  }

  it('replaceAll_rewritesEveryMatchInEachFile_andReportsTheCounts', async () => {
    const response: ReplaceResponse = await replaceInFiles(
      request([path.join(root, 'src', 'a.ts'), path.join(root, 'src', 'b.ts')]),
      workspace,
    );

    expect(response).toEqual({ replaced: 3, files: 2, failed: [] });
    expect(read('src/a.ts')).toBe('id = id;\n');
    expect(read('src/b.ts')).toBe('const id = 1;\n');
  });

  it('replace_changesOnlyTheTargetedMatch', async () => {
    const response: ReplaceResponse = await replaceInFiles(
      request([], { target: { path: path.join(root, 'src', 'a.ts'), line: 1, column: 8 } }),
      workspace,
    );

    expect(response).toEqual({ replaced: 1, files: 1, failed: [] });
    expect(read('src/a.ts')).toBe('name = id;\n');
  });

  it('replace_whereTheMatchHasGone_writesNothing_andSaysSo', async () => {
    const response: ReplaceResponse = await replaceInFiles(
      request([], { target: { path: path.join(root, 'src', 'b.ts'), line: 1, column: 1 } }),
      workspace,
    );

    expect(response.replaced).toBe(0);
    expect(response.failed).toEqual([
      { path: path.join(root, 'src', 'b.ts'), reason: 'The match is no longer there.' },
    ]);
    expect(read('src/b.ts')).toBe('const name = 1;\n');
  });

  it('refusesAFileOutsideTheRoot_includingByTraversal', async () => {
    // ⛔ The renderer names the files; one outside the workspace is never written.
    const secret: string = path.join(outside, 'secret.ts');
    const response: ReplaceResponse = await replaceInFiles(
      request([secret, [root, '..', 'elsewhere', 'secret.ts'].join(path.sep)]),
      workspace,
    );

    expect(response.replaced).toBe(0);
    expect(response.failed.map((failure) => failure.reason)).toEqual([
      'It is outside the workspace.',
      'It is outside the workspace.',
    ]);
    expect(readFileSync(secret, 'utf8')).toBe('name\n');
  });

  it('refusesASymlinkInsideTheRootThatLeadsOutOfIt', async () => {
    const secret: string = path.join(outside, 'secret.ts');
    symlinkSync(secret, path.join(root, 'src', 'link.ts'));

    const response: ReplaceResponse = await replaceInFiles(
      request([path.join(root, 'src', 'link.ts')]),
      workspace,
    );

    expect(response.failed).toEqual([
      {
        path: path.join(root, 'src', 'link.ts'),
        reason: 'It links to somewhere outside the workspace.',
      },
    ]);
    expect(readFileSync(secret, 'utf8')).toBe('name\n');
  });

  it('refusesARootThatIsNotOpen', async () => {
    const response: ReplaceResponse = await replaceInFiles(
      request([path.join(outside, 'secret.ts')], { root: outside }),
      workspace,
    );

    expect(response).toEqual({ replaced: 0, files: 0, failed: [] });
    expect(readFileSync(path.join(outside, 'secret.ts'), 'utf8')).toBe('name\n');
  });

  it('isReplaceRequest_rejectsAMalformedRequest', () => {
    expect(isReplaceRequest(request(['/ws/a.ts']))).toBe(true);
    expect(isReplaceRequest({ ...request(['/ws/a.ts']), replacement: 3 })).toBe(false);
    expect(
      isReplaceRequest({ ...request([]), target: { path: '/a', line: 'one', column: 1 } }),
    ).toBe(false);
    expect(isReplaceRequest(null)).toBe(false);
  });
});
