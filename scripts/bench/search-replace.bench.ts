import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReplaceResponse } from '../../src/shared/api/search-channels';
import { replaceInFiles } from '../../src/shared/electron/search-replace-files';
import { WorkspaceContext } from '../../src/shared/electron/workspace-context';
import { BenchCase } from './bench-case';

/**
 * Holds the generated workspace.
 */
let root: string = '';

/**
 * Holds what the last run answered, for the note.
 */
let answer: string = '';

/**
 * The cases.
 */
export const cases: readonly BenchCase[] = [
  {
    name: 'replace across a 300 MB file',
    setup: (): void => {
      root = mkdtempSync(join(tmpdir(), 'studio-bench-replace-'));
      writeFileSync(join(root, 'dump.sql'), 'insert into t values (1);\n'.repeat(12_000_000));
    },
    run: async (): Promise<ReplaceResponse> => {
      const workspace: WorkspaceContext = new WorkspaceContext();
      workspace.addRoot(root);
      const response: ReplaceResponse = await replaceInFiles(
        {
          query: 'nothing matches this',
          root,
          caseSensitive: false,
          wholeWord: false,
          regexp: false,
          replacement: 'x',
          files: [join(root, 'dump.sql')],
        },
        workspace,
      );
      answer = `${response.replaced} replaced, ${response.failed.length} refused`;
      return response;
    },
    maxIterations: 3,
    note: (): string => answer,
    teardown: (): void => {
      rmSync(root, { recursive: true, force: true });
    },
  },
];
