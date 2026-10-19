import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DiskTextEdit, TextEditsResponse } from '@shared/api/search-channels';
import {
  applyEditsToText,
  applyTextEdits,
  isTextEditsRequest,
  MAX_EDIT_FILE_BYTES,
} from './apply-text-edits';
import { WorkspaceContext } from './workspace-context';

/**
 * Builds an edit on one line.
 * @param line The one-based line.
 * @param start The one-based start column.
 * @param end The one-based end column.
 * @param text The replacement.
 * @returns Returns the edit.
 */
function edit(line: number, start: number, end: number, text: string): DiskTextEdit {
  return { startLineNumber: line, startColumn: start, endLineNumber: line, endColumn: end, text };
}

describe('applyEditsToText (#1015)', () => {
  it('appliesEditsLastToFirst_soNoneMovesAnother_whateverOrderTheyCameIn', () => {
    const text: string = 'name = name;\nuse(name);\n';

    const result: string | null = applyEditsToText(text, [
      edit(1, 1, 5, 'identifier'),
      edit(2, 5, 9, 'identifier'),
      edit(1, 8, 12, 'identifier'),
    ]);

    expect(result).toBe('identifier = identifier;\nuse(identifier);\n');
  });

  it('keepsWindowsLineBreaks_andClampsAColumnPastTheLineEndToBeforeTheBreak', () => {
    expect(applyEditsToText('ab\r\ncd\r\n', [edit(1, 3, 99, '!')])).toBe('ab!\r\ncd\r\n');
    expect(applyEditsToText('ab\r\ncd', [edit(2, 1, 3, 'xy')])).toBe('ab\r\nxy');
  });

  it('readsALinePastTheLastAsTheEndOfTheText', () => {
    expect(applyEditsToText('one\n', [edit(9, 1, 1, 'two')])).toBe('one\ntwo');
  });

  it('appliesTwoInsertsAtOnePlaceInTheOrderGiven_andRefusesOverlappingEdits', () => {
    expect(applyEditsToText('x', [edit(1, 1, 1, 'a'), edit(1, 1, 1, 'b')])).toBe('abx');
    expect(applyEditsToText('abcdef', [edit(1, 1, 4, 'x'), edit(1, 3, 5, 'y')])).toBeNull();
  });

  it('spansLines', () => {
    expect(
      applyEditsToText('one\ntwo\nthree', [
        { startLineNumber: 1, startColumn: 2, endLineNumber: 3, endColumn: 3, text: '-' },
      ]),
    ).toBe('o-ree');
  });
});

describe('applyTextEdits (#1015)', () => {
  let scratch: string;
  let root: string;
  let outside: string;
  let workspace: WorkspaceContext;

  beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'studio-text-edits-'));
    root = path.join(scratch, 'ws');
    outside = path.join(scratch, 'elsewhere');
    mkdirSync(path.join(root, 'src'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(root, 'src', 'a.ts'), 'const name = 1;\nuse(name);\n');
    writeFileSync(path.join(outside, 'secret.ts'), 'const name = 1;\n');
    workspace = new WorkspaceContext();
    workspace.addRoot(root);
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * Reads a file under the workspace.
   * @param relative The path relative to the root.
   * @returns Returns the file's text.
   */
  function read(relative: string): string {
    return readFileSync(path.join(root, relative), 'utf8');
  }

  it('writesTheEditsToAFileInsideTheWorkspace_andLeavesNoTemporaryFileBehind', async () => {
    const file: string = path.join(root, 'src', 'a.ts');

    const response: TextEditsResponse = await applyTextEdits(
      { files: [{ path: file, edits: [edit(1, 7, 11, 'id'), edit(2, 5, 9, 'id')] }] },
      workspace,
    );

    expect(response).toEqual({ written: [{ path: file, edits: 2 }], failed: [] });
    expect(read('src/a.ts')).toBe('const id = 1;\nuse(id);\n');
    expect(readdirSync(path.join(root, 'src'))).toEqual(['a.ts']);
  });

  it('keepsTheFilesPermissions', async () => {
    const file: string = path.join(root, 'src', 'run.sh');
    writeFileSync(file, 'echo name\n', { mode: 0o755 });

    await applyTextEdits({ files: [{ path: file, edits: [edit(1, 6, 10, 'id')] }] }, workspace);

    expect(statSync(file).mode & 0o777).toBe(0o755);
    expect(read('src/run.sh')).toBe('echo id\n');
  });

  it('refusesAFileOutsideTheWorkspace_namedOrThroughATraversal', async () => {
    const secret: string = path.join(outside, 'secret.ts');

    const response: TextEditsResponse = await applyTextEdits(
      {
        files: [
          { path: secret, edits: [edit(1, 7, 11, 'id')] },
          { path: path.join(root, '..', 'elsewhere', 'other.ts'), edits: [edit(1, 7, 11, 'id')] },
        ],
      },
      workspace,
    );

    expect(response.written).toEqual([]);
    expect(response.failed.map((failure: { reason: string }): string => failure.reason)).toEqual([
      'It is outside the workspace.',
      'It is outside the workspace.',
    ]);
    expect(readFileSync(secret, 'utf8')).toBe('const name = 1;\n');
  });

  it('refusesASymlinkInsideTheWorkspaceThatEscapesIt', async () => {
    const link: string = path.join(root, 'src', 'link.ts');
    symlinkSync(path.join(outside, 'secret.ts'), link);

    const response: TextEditsResponse = await applyTextEdits(
      { files: [{ path: link, edits: [edit(1, 7, 11, 'id')] }] },
      workspace,
    );

    expect(response.failed).toEqual([
      { path: link, reason: 'It links to somewhere outside the workspace.' },
    ]);
    expect(readFileSync(path.join(outside, 'secret.ts'), 'utf8')).toBe('const name = 1;\n');
  });

  it('refusesABinaryFile_aHugeFile_overlappingEdits_andAMissingFile_namingEach', async () => {
    const binary: string = path.join(root, 'src', 'image.bin');
    writeFileSync(binary, Buffer.from([0x6e, 0x00, 0x61]));
    const huge: string = path.join(root, 'src', 'huge.ts');
    writeFileSync(huge, Buffer.alloc(MAX_EDIT_FILE_BYTES + 1, 0x61));
    const overlapping: string = path.join(root, 'src', 'a.ts');
    const missing: string = path.join(root, 'src', 'gone.ts');

    const response: TextEditsResponse = await applyTextEdits(
      {
        files: [
          { path: binary, edits: [edit(1, 1, 2, 'x')] },
          { path: huge, edits: [edit(1, 1, 2, 'x')] },
          { path: overlapping, edits: [edit(1, 1, 5, 'x'), edit(1, 3, 6, 'y')] },
          { path: missing, edits: [edit(1, 1, 2, 'x')] },
        ],
      },
      workspace,
    );

    expect(response.written).toEqual([]);
    expect(response.failed).toEqual([
      { path: binary, reason: 'It looks like a binary file.' },
      { path: huge, reason: 'It is too large to change on disk.' },
      { path: overlapping, reason: 'Its edits overlap.' },
      { path: missing, reason: 'It could not be found.' },
    ]);
    expect(read('src/a.ts')).toBe('const name = 1;\nuse(name);\n');
  });

  it('keepsAByteOrderMark_outsideTheColumnsTheEditsCount', async () => {
    const file: string = path.join(root, 'src', 'bom.ts');
    writeFileSync(file, '﻿name\n');

    await applyTextEdits({ files: [{ path: file, edits: [edit(1, 1, 5, 'id')] }] }, workspace);

    expect(read('src/bom.ts')).toBe('﻿id\n');
  });

  it('isTextEditsRequest_rejectsAMalformedRequest', () => {
    expect(isTextEditsRequest({ files: [{ path: '/ws/a.ts', edits: [edit(1, 1, 2, 'x')] }] })).toBe(
      true,
    );
    expect(isTextEditsRequest({ files: [{ path: '/ws/a.ts', edits: [edit(0, 1, 2, 'x')] }] })).toBe(
      false,
    );
    expect(isTextEditsRequest({ files: [{ path: '', edits: [] }] })).toBe(false);
    expect(isTextEditsRequest({ files: [{ path: '/a', edits: [{ text: 3 }] }] })).toBe(false);
    expect(isTextEditsRequest(null)).toBe(false);
  });
});
