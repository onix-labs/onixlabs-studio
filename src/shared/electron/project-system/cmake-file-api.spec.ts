import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  cmakeFromCache,
  CmakeTarget,
  codeModelFile,
  parseTarget,
  readTargets,
  targetFiles,
} from './cmake-file-api';

describe('cmake-file-api (#882 follow-up)', () => {
  it('codeModelFile_readsTheVersion2CodeModelFromAnIndex', () => {
    expect(
      codeModelFile({
        objects: [
          { kind: 'cache', version: { major: 2 }, jsonFile: 'cache.json' },
          { kind: 'codemodel', version: { major: 2 }, jsonFile: 'codemodel-v2-abc.json' },
        ],
      }),
    ).toBe('codemodel-v2-abc.json');
    expect(codeModelFile({ objects: [] })).toBeNull();
    expect(codeModelFile(null)).toBeNull();
  });

  it('targetFiles_readsTheFirstConfigurationsTargets', () => {
    expect(
      targetFiles({
        configurations: [
          {
            name: 'Debug',
            targets: [{ jsonFile: 'target-a.json' }, { jsonFile: 'target-b.json' }],
          },
          { name: 'Release', targets: [{ jsonFile: 'target-c.json' }] },
        ],
      }),
    ).toEqual(['target-a.json', 'target-b.json']);
    expect(targetFiles({ configurations: [] })).toEqual([]);
  });

  it('parseTarget_keepsTheUsersSources_andLeavesGeneratedOnesOut', () => {
    expect(
      parseTarget({
        name: 'app',
        type: 'EXECUTABLE',
        sources: [{ path: 'src/main.c' }, { path: 'build/generated.c', isGenerated: true }],
      }),
    ).toEqual({ name: 'app', type: 'EXECUTABLE', sources: ['src/main.c'] });
    expect(parseTarget({ type: 'EXECUTABLE' })).toBeNull();
  });

  it('cmakeFromCache_readsTheCommandThatConfiguredTheTree', () => {
    expect(
      cmakeFromCache(
        'CMAKE_BUILD_TYPE:STRING=Release\nCMAKE_COMMAND:INTERNAL=/usr/local/bin/cmake\n',
      ),
    ).toBe('/usr/local/bin/cmake');
    expect(cmakeFromCache('CMAKE_BUILD_TYPE:STRING=Release\n')).toBeNull();
  });

  describe('readTargets', () => {
    let build: string;

    beforeEach(() => {
      build = mkdtempSync(path.join(realpathSync(tmpdir()), 'cmake-reply-'));
    });

    afterEach(() => {
      rmSync(build, { recursive: true, force: true });
    });

    /**
     * Writes a reply file.
     * @param name The file name.
     * @param value The JSON content.
     */
    function reply(name: string, value: unknown): void {
      const folder: string = path.join(build, '.cmake', 'api', 'v1', 'reply');
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, name), JSON.stringify(value));
    }

    it('isNull_beforeAnyConfigureHasAnswered', async () => {
      expect(await readTargets(build)).toBeNull();
    });

    it('readsEveryTarget_fromTheNewestIndex', async () => {
      reply('index-2026-01-01T00-00-00-0000.json', { objects: [] });
      reply('index-2026-10-10T00-00-00-0000.json', {
        objects: [{ kind: 'codemodel', version: { major: 2 }, jsonFile: 'codemodel.json' }],
      });
      reply('codemodel.json', { configurations: [{ targets: [{ jsonFile: 'target-app.json' }] }] });
      reply('target-app.json', { name: 'app', type: 'EXECUTABLE', sources: [{ path: 'main.c' }] });

      const targets: readonly CmakeTarget[] | null = await readTargets(build);

      expect(targets).toEqual([{ name: 'app', type: 'EXECUTABLE', sources: ['main.c'] }]);
    });
  });
});
