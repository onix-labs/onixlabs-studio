import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchChannel, SearchRequest, SearchResponse } from '@shared/api/search-channels';

/**
 * Holds what the mocked process and IPC layers saw: each ripgrep spawn's arguments and working
 * directory, the output the next spawn prints, and the registered IPC handlers.
 */
const captured: {
  spawns: { args: readonly string[]; cwd: string }[];
  output: string;
  chunks: readonly Buffer[] | null;
  handlers: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
} = vi.hoisted(() => ({
  spawns: [],
  output: '',
  chunks: null,
  handlers: new Map<string, (event: unknown, request: unknown) => Promise<unknown>>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, request: unknown) => Promise<unknown>,
    ): void => void captured.handlers.set(channel, handler),
  },
}));

vi.mock('@vscode/ripgrep', () => ({ rgPath: '/fake/rg' }));

vi.mock('node:child_process', () => {
  const spawn: (command: string, args: readonly string[], options: { cwd: string }) => unknown = (
    _command: string,
    args: readonly string[],
    options: { cwd: string },
  ): unknown => {
    captured.spawns.push({ args, cwd: options.cwd });
    let onData: ((chunk: Buffer) => void) | null = null;
    const listeners: Map<string, () => void> = new Map<string, () => void>();
    const chunks: readonly Buffer[] = captured.chunks ?? [Buffer.from(captured.output)];
    setTimeout((): void => {
      for (const chunk of chunks) {
        onData?.(chunk);
      }
      listeners.get('close')?.();
    }, 0);
    return {
      stdout: {
        on: (event: string, listener: (chunk: Buffer) => void): void => {
          if (event === 'data') {
            onData = listener;
          }
        },
      },
      on: (event: string, listener: () => void): void => void listeners.set(event, listener),
      kill: (): void => undefined,
    };
  };
  return { spawn, default: { spawn } };
});

const { SearchManager } = await import('./search-manager');
const { WorkspaceContext } = await import('./workspace-context');

describe('SearchManager (#1007 paths)', () => {
  let scratch: string;
  let root: string;
  let outside: string;

  // A scratch workspace with a project folder, a folder outside it, and a link out of it, with the
  // manager's handlers registered against it.
  beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'studio-search-'));
    root = path.join(scratch, 'ws');
    outside = path.join(scratch, 'elsewhere');
    mkdirSync(path.join(root, 'app', 'src'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(root, 'app', 'src', 'a.ts'), 'name\n');
    symlinkSync(outside, path.join(root, 'escape'));
    captured.spawns.length = 0;
    captured.handlers.clear();
    captured.output = '';
    captured.chunks = null;
    const workspace: InstanceType<typeof WorkspaceContext> = new WorkspaceContext();
    workspace.addRoot(root);
    new SearchManager(workspace).register();
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * Sends a search through the registered handler.
   * @param overrides Any field to change from a plain search for "name".
   * @returns Returns the response.
   */
  function search(overrides: Partial<SearchRequest> = {}): Promise<SearchResponse> {
    const request: SearchRequest = {
      query: 'name',
      root,
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
      ...overrides,
    };
    const handler: ((event: unknown, request: unknown) => Promise<unknown>) | undefined =
      captured.handlers.get(SearchChannel.Run);
    return handler!(null, request) as Promise<SearchResponse>;
  }

  /**
   * Cuts a text's UTF-8 bytes in two, inside its first occurrence of a multi-byte character.
   * @param text The text.
   * @param character The character to cut through.
   * @returns Returns the two chunks.
   */
  function cutInside(text: string, character: string): readonly Buffer[] {
    const bytes: Buffer = Buffer.from(text);
    const at: number = bytes.indexOf(Buffer.from(character)) + 1;
    return [bytes.subarray(0, at), bytes.subarray(at)];
  }

  it('run_whenAChunkEndsInsideAMultiByteCharacter_keepsTheCharacterWhole', async () => {
    const event: string = JSON.stringify({
      type: 'match',
      data: {
        path: { text: './src/naïve.ts' },
        lines: { text: 'const café = name;\n' },
        line_number: 3,
        submatches: [{ match: { text: 'name' }, start: 14, end: 18 }],
      },
    });
    captured.chunks = cutInside(`${event}\n`, 'é');

    const response: SearchResponse = await search();

    expect(response.files[0].relativePath).toBe('src/naïve.ts');
    expect(response.files[0].matches[0].before).toBe('const café = ');
  });

  it('listFiles_whenAChunkEndsInsideAMultiByteCharacter_keepsThePathWhole', async () => {
    captured.chunks = cutInside('./src/日本語.ts\n./plain file.ts\r\n', '本');

    const handler: ((event: unknown, request: unknown) => Promise<unknown>) | undefined =
      captured.handlers.get(SearchChannel.ListFiles);
    const listed: unknown = await handler!(null, root);

    expect(listed).toEqual(['src/日本語.ts', 'plain file.ts']);
  });

  it('run_withoutPaths_searchesTheWholeRoot', async () => {
    await search();

    expect(captured.spawns).toHaveLength(1);
    expect(captured.spawns[0].cwd).toBe(root);
    expect(captured.spawns[0].args.slice(-3)).toEqual(['--', 'name', '.']);
    expect(captured.spawns[0].args).toContain('--glob=!.git');
  });

  it('run_withTheFindPanelsFilters_narrowsAndWidensTheFilesRead', async () => {
    await search({
      files: { include: ['*.ts'], exclude: ['*.d.ts'], ignored: true, hidden: true },
    });

    const args: readonly string[] = captured.spawns[0].args;
    expect(args).toEqual(
      expect.arrayContaining([
        '--no-ignore',
        '--hidden',
        '--glob=*.ts',
        '--glob=!*.d.ts',
        '--glob=!.git',
      ]),
    );
  });

  it('run_searchingExcludedFiles_readsHiddenFolders_andDropsTheirExclusion', async () => {
    await search({ files: { excluded: true } });

    expect(captured.spawns[0].args).toContain('--hidden');
    expect(captured.spawns[0].args).not.toContain('--glob=!.git');
  });

  it('run_byDefault_leavesIgnoredAndHiddenFilesOut', async () => {
    await search();

    expect(captured.spawns[0].args).not.toContain('--no-ignore');
    expect(captured.spawns[0].args).not.toContain('--hidden');
  });

  it('run_withTheSearchSettings_passesTheirLimitsOn', async () => {
    await search({ limits: { maxFileSizeMegabytes: 50, followSymlinks: true, timeoutSeconds: 0 } });

    expect(captured.spawns[0].args).toEqual(
      expect.arrayContaining(['--max-filesize=50M', '--follow']),
    );
  });

  it('run_cappedAtTheSetMaximum', async () => {
    const match: string = JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'a.ts' },
        line_number: 1,
        lines: { text: 'name\n' },
        submatches: [
          { start: 0, end: 4, match: { text: 'name' } },
          { start: 5, end: 9, match: { text: 'name' } },
        ],
      },
    });
    captured.output = `${match}\n${match}\n${match}\n`;

    const response: SearchResponse = await search({ limits: { maxResults: 2 } });

    expect(response.total).toBe(2);
    expect(response.capped).toBe(true);
    expect(response.files[0].matches[0].occurrences).toBe(2);
  });

  it('run_rejectsLimitsThatCouldNotBeRun', async () => {
    await search({ limits: { maxResults: 0 } });
    await search({ limits: { timeoutSeconds: -1 } });

    expect(captured.spawns).toHaveLength(0);
  });

  it('run_withAPathInsideTheRoot_searchesItRootRelative_andLabelsResultsFromTheRoot', async () => {
    captured.output = `${JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'app/src/a.ts' },
        line_number: 1,
        lines: { text: 'name\n' },
        submatches: [{ start: 0, end: 4, match: { text: 'name' } }],
      },
    })}\n`;

    const response: SearchResponse = await search({ paths: [path.join(root, 'app')] });

    expect(captured.spawns[0].args.slice(-3)).toEqual(['--', 'name', 'app']);
    expect(response.files.map((file) => file.relativePath)).toEqual(['app/src/a.ts']);
    expect(response.files[0].path).toBe(path.join(root, 'app', 'src', 'a.ts'));
  });

  it('run_placesAMatchAfterMultiByteText_atItsCharacterColumn', async () => {
    // "café 🙂 name": ripgrep's byte offset for "name" is 11; the editor column is 9.
    const line: string = 'café 🙂 name';
    const start: number = Buffer.byteLength('café 🙂 ', 'utf8');
    captured.output = `${JSON.stringify({
      type: 'match',
      data: {
        path: { text: './app/src/a.ts' },
        line_number: 1,
        lines: { text: `${line}\n` },
        submatches: [{ start, end: start + 4, match: { text: 'name' } }],
      },
    })}\n`;

    const response: SearchResponse = await search();

    expect(response.files[0].matches[0].column).toBe('café 🙂 '.length + 1);
    expect(response.files[0].matches[0].before).toBe('café 🙂 ');
  });

  it('run_withTheRootItselfAsAPath_searchesDot', async () => {
    await search({ paths: [root] });

    expect(captured.spawns[0].args.at(-1)).toBe('.');
  });

  it('run_withAPathOutsideTheRoot_isRefusedWithoutSpawning', async () => {
    const response: SearchResponse = await search({
      paths: [path.join(root, 'app'), outside],
    });

    expect(response).toEqual({ files: [], total: 0, capped: false });
    expect(captured.spawns).toHaveLength(0);
  });

  it('run_withAPathClimbingOutOfTheRoot_isRefused', async () => {
    await search({ paths: [path.join(root, '..', 'elsewhere')] });

    expect(captured.spawns).toHaveLength(0);
  });

  it('run_withALinkInsideTheRootPointingOut_isRefused', async () => {
    await search({ paths: [path.join(root, 'escape')] });

    expect(captured.spawns).toHaveLength(0);
  });

  it('run_withAMissingPathOrNoPaths_isRefused', async () => {
    await search({ paths: [path.join(root, 'missing')] });
    await search({ paths: [] });

    expect(captured.spawns).toHaveLength(0);
  });

  it('run_withPathsThatAreNotStrings_isRefusedAsMalformed', async () => {
    await search({ paths: [42 as unknown as string] });

    expect(captured.spawns).toHaveLength(0);
  });
});
