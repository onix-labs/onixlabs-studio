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
  handlers: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
} = vi.hoisted(() => ({
  spawns: [],
  output: '',
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
    const output: string = captured.output;
    setTimeout((): void => {
      onData?.(Buffer.from(output));
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

  it('run_withoutPaths_searchesTheWholeRoot', async () => {
    await search();

    expect(captured.spawns).toHaveLength(1);
    expect(captured.spawns[0].cwd).toBe(root);
    expect(captured.spawns[0].args.slice(-3)).toEqual(['--', 'name', '.']);
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
