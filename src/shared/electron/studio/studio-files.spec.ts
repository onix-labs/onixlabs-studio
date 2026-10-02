import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readStudioJson, seedStudioGitignore, writeStudioFile } from './studio-files';

describe('studio-files', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'studio-files-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Reads the root's `.gitignore`.
   * @returns Returns its contents.
   */
  function gitignore(): string {
    return readFileSync(join(root, '.gitignore'), 'utf8');
  }

  it('writeStudioFile_createsTheFolder_writesTheFile_andLeavesNoTemporary', async () => {
    await writeStudioFile(root, 'x.json', '{"a":1}\n');

    expect(readFileSync(join(root, '.studio', 'x.json'), 'utf8')).toBe('{"a":1}\n');
    expect(readdirSync(join(root, '.studio'))).toEqual(['x.json']);
  });

  it('readStudioJson_readsBackWhatWasWritten_andNullForAnythingElse', async () => {
    await writeStudioFile(root, 'x.json', '{"a":1}');
    mkdirSync(join(root, '.studio'), { recursive: true });
    writeFileSync(join(root, '.studio', 'bad.json'), '{');

    expect(await readStudioJson(root, 'x.json')).toEqual({ a: 1 });
    expect(await readStudioJson(root, 'bad.json')).toBeNull();
    expect(await readStudioJson(root, 'missing.json')).toBeNull();
  });

  it('seedStudioGitignore_createsAMissingGitignore', async () => {
    await seedStudioGitignore(root);

    expect(gitignore()).toBe('.studio/*.user.json\n');
  });

  it('seedStudioGitignore_appendsOnANewLine_whenTheFileDoesNotEndInOne', async () => {
    writeFileSync(join(root, '.gitignore'), 'node_modules');

    await seedStudioGitignore(root);

    expect(gitignore()).toBe('node_modules\n.studio/*.user.json\n');
  });

  it('seedStudioGitignore_leavesAFileThatAlreadyIgnoresUserFilesAlone', async () => {
    writeFileSync(join(root, '.gitignore'), 'dist\n  .studio/*.user.json  \n');

    await seedStudioGitignore(root);
    await seedStudioGitignore(root);

    expect(gitignore()).toBe('dist\n  .studio/*.user.json  \n');
  });
});
