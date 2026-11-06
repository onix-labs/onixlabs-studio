import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock, MockInstance } from 'vitest';
import { PackageChannel } from '@shared/api/package-channels';
import type { PackageManagerModel, PackageSearchResult } from '@shared/api/package-management';
import { ProjectChannel } from '@shared/api/project-channels';
import type { ProjectOperationResult } from '@shared/api/project-system';
import type {
  BinaryChunk,
  DirectoryListing,
  FileOperationResult,
  OpenSelection,
} from '@shared/api/workspace-channels';
import { WorkspaceChannel } from '@shared/api/workspace-channels';
import type { BrowserWindow } from 'electron';
import type { PackagePluginRoute } from './package-managers/package-plugin-route';

/**
 * Describes an IPC handler as the fake `ipcMain` captures it.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Holds what the fake Electron layer saw and answers: the registered handlers, the paths the open
 * dialog will choose, and whether the operating system's trash works.
 */
const electron: {
  handlers: Map<string, Handler>;
  chosen: string[];
  trashed: string[];
  trashWorks: boolean;
} = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  chosen: [],
  trashed: [],
  trashWorks: true,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler): void =>
      void electron.handlers.set(channel, handler),
  },
  BrowserWindow: {
    fromWebContents: (): null => null,
    getFocusedWindow: (): null => null,
  },
  dialog: {
    showOpenDialog: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
      Promise.resolve({ canceled: electron.chosen.length === 0, filePaths: electron.chosen }),
  },
  shell: {
    trashItem: (target: string): Promise<void> => {
      if (!electron.trashWorks) {
        return Promise.reject(new Error('No trash on this volume'));
      }
      electron.trashed.push(target);
      return fs.promises.rm(target, { recursive: true });
    },
  },
}));

const { WorkspaceManager } = await import('./workspace-manager');
const { WorkspaceContext } = await import('./workspace-context');
const { TrustedPaths } = await import('./trusted-paths');
const { projectSystems } = await import('./project-system/default-project-systems');
const { packageManagers } = await import('./package-management/default-package-managers');

/**
 * The size, in bytes, of one megabyte as the Large File Size Limit counts it.
 */
const ONE_MEGABYTE: number = 1024 * 1024;

/**
 * The bytes of the secret every confinement attack is trying to reach.
 */
const SECRET: string = 'the secret';

describe('WorkspaceManager', () => {
  let sandbox: string;
  let workspaceRoot: string;
  let outside: string;
  let secret: string;
  let workspace: InstanceType<typeof WorkspaceContext>;
  let trusted: InstanceType<typeof TrustedPaths>;
  let temporaryDirectory: string | undefined;

  /**
   * Invokes a captured IPC handler as the renderer would.
   * @param channel The channel to invoke.
   * @param args The renderer-supplied arguments.
   * @returns Returns what the handler answered.
   */
  async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    const handler: Handler | undefined = electron.handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`Nothing registered ${channel}`);
    }
    return (await handler({ sender: {} }, ...args)) as T;
  }

  /**
   * Writes a file inside the workspace.
   * @param name The file's name.
   * @param content The file's content.
   * @returns Returns the file's absolute path.
   */
  function inWorkspace(name: string, content: string | Buffer = 'hello'): string {
    const file: string = path.join(workspaceRoot, name);
    fs.writeFileSync(file, content);
    return file;
  }

  beforeEach(() => {
    // Real paths, so a macOS `/var` → `/private/var` link cannot blur what a confinement test proves.
    sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-manager-')));
    workspaceRoot = path.join(sandbox, 'ws');
    outside = path.join(sandbox, 'outside');
    fs.mkdirSync(workspaceRoot);
    fs.mkdirSync(outside);
    secret = path.join(outside, 'secret.txt');
    fs.writeFileSync(secret, SECRET);

    // os.tmpdir() reads this on every call, so decompiled sources resolve inside the sandbox.
    temporaryDirectory = process.env['TMPDIR'];
    process.env['TMPDIR'] = sandbox;

    electron.handlers.clear();
    electron.chosen = [];
    electron.trashed = [];
    electron.trashWorks = true;

    workspace = new WorkspaceContext();
    workspace.addRoot(workspaceRoot);
    trusted = new TrustedPaths(path.join(sandbox, 'trusted.json'));
    new WorkspaceManager((): BrowserWindow | null => null, workspace, trusted).register();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (temporaryDirectory === undefined) {
      delete process.env['TMPDIR'];
    } else {
      process.env['TMPDIR'] = temporaryDirectory;
    }
    fs.chmodSync(sandbox, 0o700);
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  describe('path confinement', () => {
    /**
     * Builds the paths a hostile renderer names to escape the workspace. Each is checked against
     * every path-taking channel, because each channel makes its own confinement call.
     * @returns Returns the attack paths with their labels.
     */
    function attacks(): readonly (readonly [string, unknown])[] {
      return [
        ['an absolute path outside', secret],
        ['a traversal out of the root', path.join(workspaceRoot, '..', 'outside', 'secret.txt')],
        ['an unnormalised traversal', `${workspaceRoot}/x/../../outside/secret.txt`],
        ['a sibling sharing the root as a prefix', `${workspaceRoot}-evil/secret.txt`],
        ['a relative path', 'outside/secret.txt'],
        ['an empty string', ''],
        ['null', null],
        ['undefined', undefined],
        ['a number', 42],
        ['an object with a toString', { toString: (): string => secret }],
        ['an array holding the path', [secret]],
      ];
    }

    it('everyPathChannel_refusesEveryEscape_andLeavesTheSecretAlone', async () => {
      for (const [label, target] of attacks()) {
        expect(await invoke(WorkspaceChannel.OpenFile, target), label).toBeNull();
        expect(await invoke(WorkspaceChannel.ReopenFile, target), label).toBeNull();
        expect(await invoke(WorkspaceChannel.ReadBytes, target, 0, 16), label).toBeNull();
        expect(await invoke(WorkspaceChannel.ReadDirectory, target), label).toBeNull();
        expect(await invoke(WorkspaceChannel.ReopenFolder, target), label).toBeNull();
        expect(await invoke(ProjectChannel.ItemsLoad, target), label).toBeNull();
        expect(await invoke(ProjectChannel.ArtifactResolve, target, 'Debug'), label).toBeNull();
        expect(
          await invoke(WorkspaceChannel.WriteBytes, target, [{ offset: 0, bytes: [0x58] }]),
          label,
        ).toBe(false);
        expect(
          await invoke(
            WorkspaceChannel.WritePieces,
            target,
            [{ source: 'added', start: 0, length: 1 }],
            new Uint8Array([0x58]),
          ),
          label,
        ).toBe(false);
        for (const channel of [
          WorkspaceChannel.CreateFile,
          WorkspaceChannel.CreateFolder,
          WorkspaceChannel.Rename,
        ]) {
          expect(
            await invoke<FileOperationResult>(channel, target, 'planted'),
            `${channel}: ${label}`,
          ).toEqual({ success: false, error: 'Target is outside the workspace' });
        }
        expect(await invoke<FileOperationResult>(WorkspaceChannel.Delete, target), label).toEqual({
          success: false,
          error: 'Target is outside the workspace',
        });
      }

      expect(fs.readFileSync(secret, 'utf8')).toBe(SECRET);
      expect(fs.readdirSync(outside)).toEqual(['secret.txt']);
      expect(electron.trashed).toEqual([]);
    });

    it('closeFolder_endsAccessToEverythingBeneathTheRoot', async () => {
      const file: string = inWorkspace('a.txt');
      expect(await invoke(WorkspaceChannel.ReadBytes, file, 0, 1)).not.toBeNull();

      await invoke(WorkspaceChannel.CloseFolder, workspaceRoot);

      expect(await invoke(WorkspaceChannel.ReadBytes, file, 0, 1)).toBeNull();
      expect(await invoke(WorkspaceChannel.OpenFile, file)).toBeNull();
      expect(await invoke(WorkspaceChannel.ReadDirectory, workspaceRoot)).toBeNull();
      expect((await invoke<FileOperationResult>(WorkspaceChannel.Delete, file)).success).toBe(
        false,
      );
      expect(fs.existsSync(file)).toBe(true);
    });

    it.each([[undefined], [null], [''], [42], [{}]])(
      'closeFolder_withAnUnusableRoot_closesNothing %#',
      async (root: unknown) => {
        await invoke(WorkspaceChannel.CloseFolder, root);

        expect(workspace.isRoot(workspaceRoot)).toBe(true);
      },
    );

    it('closeFolder_ofANestedRoot_leavesItReachableThroughItsParent', async () => {
      const inner: string = path.join(workspaceRoot, 'inner');
      fs.mkdirSync(inner);
      workspace.addRoot(inner);

      await invoke(WorkspaceChannel.CloseFolder, inner);

      expect(await invoke<DirectoryListing>(WorkspaceChannel.ReadDirectory, inner)).toMatchObject({
        path: inner,
      });
    });

    it.each([
      ['a traversal', '../escaped'],
      ['a nested path', 'a/b'],
      ['an absolute path', '/escaped'],
      ['the current directory', '.'],
      ['the parent directory', '..'],
      ['nothing', ''],
      ['a number', 42],
      ['null', null],
    ])('createAndRename_refuse %s as a name', async (_label: string, name: unknown) => {
      const file: string = inWorkspace('a.txt');

      for (const channel of [WorkspaceChannel.CreateFile, WorkspaceChannel.CreateFolder]) {
        expect(await invoke(channel, workspaceRoot, name)).toEqual({
          success: false,
          error: 'Invalid name',
        });
      }
      expect(await invoke(WorkspaceChannel.Rename, file, name)).toEqual({
        success: false,
        error: 'Invalid name',
      });

      expect(fs.readdirSync(workspaceRoot)).toEqual(['a.txt']);
      expect(fs.readdirSync(sandbox).sort()).toEqual(['outside', 'ws']);
    });

    it('create_withANulInTheName_failsCleanly', async () => {
      const result: FileOperationResult = await invoke(
        WorkspaceChannel.CreateFile,
        workspaceRoot,
        'a\0b',
      );

      expect(result.success).toBe(false);
      expect(fs.readdirSync(workspaceRoot)).toEqual([]);
    });

    it.each([
      [WorkspaceChannel.OpenFile],
      [WorkspaceChannel.ReopenFile],
      [WorkspaceChannel.ReadDirectory],
    ])('%s_withANulInThePath_answersNull', async (channel: string) => {
      expect(await invoke(channel, `${workspaceRoot}/a\0b`)).toBeNull();
    });

    // ⚠️ Confinement here is textual, so a link inside a root reaches through it. Agent writes have
    // real-path confinement (write-confinement.ts) and search refuses to follow links out of a root;
    // the renderer's file channels have neither. Whether opening a link that leaves the workspace
    // should stop working is a product decision, so these record the gap rather than close it.
    describe('symbolic links leaving the workspace', () => {
      it.fails('openFile_throughALink_doesNotReadTheFileOutside', async () => {
        const link: string = path.join(workspaceRoot, 'link.txt');
        fs.symlinkSync(secret, link);

        expect(await invoke(WorkspaceChannel.OpenFile, link)).toBeNull();
      });

      it.fails('writeBytes_throughALink_doesNotWriteTheFileOutside', async () => {
        const link: string = path.join(workspaceRoot, 'link.txt');
        fs.symlinkSync(secret, link);

        await invoke(WorkspaceChannel.WriteBytes, link, [{ offset: 0, bytes: [0x58] }]);

        expect(fs.readFileSync(secret, 'utf8')).toBe(SECRET);
      });

      it.fails('createFile_throughALinkedDirectory_doesNotCreateOutside', async () => {
        const link: string = path.join(workspaceRoot, 'out');
        fs.symlinkSync(outside, link);

        await invoke(WorkspaceChannel.CreateFile, link, 'planted.txt');

        expect(fs.existsSync(path.join(outside, 'planted.txt'))).toBe(false);
      });

      it.fails('readDirectory_throughALinkedDirectory_doesNotListOutside', async () => {
        const link: string = path.join(workspaceRoot, 'out');
        fs.symlinkSync(outside, link);

        expect(await invoke(WorkspaceChannel.ReadDirectory, link)).toBeNull();
      });

      it('delete_ofALink_removesTheLinkAndNotWhatItNames', async () => {
        const link: string = path.join(workspaceRoot, 'out');
        fs.symlinkSync(outside, link);
        electron.trashWorks = false;

        const result: FileOperationResult = await invoke(WorkspaceChannel.Delete, link);

        expect(result).toEqual({ success: true, path: link, trashed: false });
        expect(fs.existsSync(link)).toBe(false);
        expect(fs.readFileSync(secret, 'utf8')).toBe(SECRET);
      });
    });
  });

  describe('trust gate', () => {
    it('reopenFolder_ofAPathNeverOpened_isRefused_andRegistersNoRoot', async () => {
      expect(await invoke(WorkspaceChannel.ReopenFolder, outside)).toBeNull();

      expect(workspace.isWithin(secret)).toBe(false);
    });

    it('reopenFolder_ofATrustedPath_opensItAsARoot', async () => {
      trusted.remember(outside);

      const listing: DirectoryListing = await invoke(WorkspaceChannel.ReopenFolder, outside);

      expect(listing.entries.map((entry) => entry.name)).toEqual(['secret.txt']);
      expect(workspace.isRoot(outside)).toBe(true);
    });

    it('reopenFolder_ofATrustedFolderThatIsGone_leavesNoRootBehind', async () => {
      const gone: string = path.join(sandbox, 'gone');
      trusted.remember(gone);

      expect(await invoke(WorkspaceChannel.ReopenFolder, gone)).toBeNull();

      expect(workspace.isRoot(gone)).toBe(false);
    });

    it('reopenFolder_ofATrustedFile_leavesNoRootBehind', async () => {
      trusted.remember(secret);

      expect(await invoke(WorkspaceChannel.ReopenFolder, secret)).toBeNull();

      expect(workspace.isRoot(secret)).toBe(false);
    });

    it('trustInAFolder_doesNotExtendToItsFiles', async () => {
      trusted.remember(outside);

      expect(await invoke(WorkspaceChannel.ReadBytes, secret, 0, 16)).toBeNull();
      expect(await invoke(WorkspaceChannel.ReopenFile, secret)).toBeNull();
    });

    it('reopenFile_ofATrustedFileOutside_opens', async () => {
      trusted.remember(secret);

      const selection: OpenSelection = await invoke(WorkspaceChannel.ReopenFile, secret);

      expect(selection).toMatchObject({ kind: 'file', file: { content: SECRET } });
    });

    it('forgettingAPath_endsItsAccess', async () => {
      trusted.remember(secret);
      trusted.forget(secret);

      expect(await invoke(WorkspaceChannel.ReopenFile, secret)).toBeNull();
      expect(await invoke(WorkspaceChannel.ReadBytes, secret, 0, 16)).toBeNull();
    });

    it('openFile_doesNotHonourTrust_soARememberedFileIsStillOutsideTheWorkspace', async () => {
      trusted.remember(secret);

      expect(await invoke(WorkspaceChannel.OpenFile, secret)).toBeNull();
    });

    it('trust_survivesARestart_onlyForWhatWasRemembered', () => {
      trusted.remember(secret);
      const restarted: InstanceType<typeof TrustedPaths> = new TrustedPaths(
        path.join(sandbox, 'trusted.json'),
      );

      expect(restarted.has(secret)).toBe(true);
      expect(restarted.has(outside)).toBe(false);
    });

    it('openFile_withinTheWorkspace_remembersItForReopeningAfterTheWorkspaceCloses', async () => {
      const file: string = inWorkspace('a.txt');

      await invoke(WorkspaceChannel.OpenFile, file);
      await invoke(WorkspaceChannel.CloseFolder, workspaceRoot);

      expect(await invoke(WorkspaceChannel.ReopenFile, file)).toMatchObject({ kind: 'file' });
    });

    it('openFile_thatFailsToRead_isNotRemembered', async () => {
      const missing: string = path.join(workspaceRoot, 'missing.txt');

      expect(await invoke(WorkspaceChannel.OpenFile, missing)).toBeNull();

      expect(trusted.has(missing)).toBe(false);
    });
  });

  describe('open dialogs', () => {
    it('open_whenCancelled_changesNothing', async () => {
      expect(await invoke(WorkspaceChannel.Open)).toBeNull();
      expect(await invoke(WorkspaceChannel.OpenFolder)).toBeNull();

      expect(trusted.list()).toEqual([]);
    });

    it('open_ofADirectory_addsARootAndTrustsIt', async () => {
      electron.chosen = [outside];

      const selection: OpenSelection = await invoke(WorkspaceChannel.Open);

      expect(selection).toMatchObject({ kind: 'directory', directory: { path: outside } });
      expect(workspace.isRoot(outside)).toBe(true);
      expect(trusted.has(outside)).toBe(true);
    });

    it('open_ofAFile_trustsItButOpensNoWorkspace', async () => {
      electron.chosen = [secret];

      const selection: OpenSelection = await invoke(WorkspaceChannel.Open);

      expect(selection).toMatchObject({ kind: 'file', file: { content: SECRET } });
      expect(trusted.has(secret)).toBe(true);
      expect(workspace.isWithin(secret)).toBe(false);
    });

    it('open_ofSomethingThatVanished_answersNull_andTrustsNothing', async () => {
      const gone: string = path.join(sandbox, 'gone');
      electron.chosen = [gone];

      expect(await invoke(WorkspaceChannel.Open)).toBeNull();

      expect(trusted.has(gone)).toBe(false);
    });

    it('openFolder_ofAFolderItCannotRead_leavesNoRootBehind', async () => {
      const gone: string = path.join(sandbox, 'gone');
      electron.chosen = [gone];

      expect(await invoke(WorkspaceChannel.OpenFolder)).toBeNull();

      expect(workspace.isRoot(gone)).toBe(false);
    });

    it('openFolder_normalisesTheChosenPath', async () => {
      electron.chosen = [path.join(outside, '..', 'outside')];

      const listing: DirectoryListing = await invoke(WorkspaceChannel.OpenFolder);

      expect(listing.path).toBe(outside);
      expect(trusted.has(outside)).toBe(true);
    });
  });

  describe('read policy', () => {
    it('readFile_atExactlyTheLimit_opensAsText', async () => {
      const file: string = inWorkspace('at.log', Buffer.alloc(ONE_MEGABYTE, 0x61));

      const selection: OpenSelection = await invoke(WorkspaceChannel.OpenFile, file, 1);

      expect(selection.kind).toBe('file');
    });

    it('readFile_oneByteOverTheLimit_opensAsBinary', async () => {
      const file: string = inWorkspace('over.log', Buffer.alloc(ONE_MEGABYTE + 1, 0x61));

      const selection: OpenSelection = await invoke(WorkspaceChannel.OpenFile, file, 1);

      expect(selection).toEqual({ kind: 'binary', path: file });
    });

    it.each([[0], [-5], [Number.NaN], ['1'], [null]])(
      'readFile_withAnUnusableLimit_usesTheDefault %#',
      async (limit: unknown) => {
        const file: string = inWorkspace('big.log', Buffer.alloc(2 * ONE_MEGABYTE, 0x61));

        const selection: OpenSelection = await invoke(WorkspaceChannel.OpenFile, file, limit);

        expect(selection.kind).toBe('file');
      },
    );

    it('readFile_withANulInTheSniffedHeader_opensAsBinary', async () => {
      const content: Buffer = Buffer.alloc(8000, 0x61);
      content[7999] = 0;
      const file: string = inWorkspace('nul.dat', content);

      expect(await invoke(WorkspaceChannel.OpenFile, file)).toEqual({ kind: 'binary', path: file });
    });

    it('readFile_withANulPastTheSniffedHeader_opensAsText', async () => {
      const content: Buffer = Buffer.alloc(8001, 0x61);
      content[8000] = 0;
      const file: string = inWorkspace('late.dat', content);

      const selection: OpenSelection = await invoke(WorkspaceChannel.OpenFile, file);

      expect(selection.kind).toBe('file');
    });

    it('readFile_inUtf16_isTextDespiteItsNuls', async () => {
      const file: string = inWorkspace(
        'wide.txt',
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hi', 'utf16le')]),
      );

      const selection: OpenSelection = await invoke(WorkspaceChannel.OpenFile, file);

      expect(selection).toMatchObject({
        kind: 'file',
        file: { content: 'hi', encoding: 'utf16le', hasBom: true },
      });
    });

    it('readFile_thatIsEmpty_opensAsText', async () => {
      const file: string = inWorkspace('empty.txt', '');

      const selection: OpenSelection = await invoke(WorkspaceChannel.OpenFile, file);

      expect(selection).toMatchObject({ kind: 'file', file: { content: '' } });
    });

    it.each([['picture.png'], ['vector.SVG']])(
      'readFile_ofAnImage_isClassifiedByExtensionWithoutDecoding %s',
      async (name: string) => {
        const file: string = inWorkspace(name, Buffer.from([0, 1, 2]));

        expect(await invoke(WorkspaceChannel.OpenFile, file)).toEqual({
          kind: 'image',
          path: file,
        });
      },
    );

    it('readFile_ofADirectory_answersNull', async () => {
      const directory: string = path.join(workspaceRoot, 'folder');
      fs.mkdirSync(directory);

      expect(await invoke(WorkspaceChannel.OpenFile, directory)).toBeNull();
    });

    it('readFile_ofAFifo_answersNull_ratherThanWaitingForAWriterForever', async () => {
      const pipe: string = path.join(workspaceRoot, 'README.md');
      execFileSync('mkfifo', [pipe]);

      expect(await invoke(WorkspaceChannel.OpenFile, pipe)).toBeNull();
    });
  });

  describe('decompiled sources', () => {
    let decompiled: string;

    beforeEach(() => {
      const folder: string = path.join(sandbox, 'MetadataAsSource', 'hash');
      fs.mkdirSync(folder, { recursive: true });
      decompiled = path.join(folder, 'IList.cs');
      fs.writeFileSync(decompiled, 'interface IList {}');
    });

    it('openFile_ofADecompiledSource_opensReadOnly_andIsNotRemembered', async () => {
      const selection: OpenSelection = await invoke(WorkspaceChannel.OpenFile, decompiled);

      expect(selection).toMatchObject({
        kind: 'file',
        file: { path: decompiled, readOnly: true, content: 'interface IList {}' },
      });
      expect(trusted.has(decompiled)).toBe(false);
    });

    it('openFile_ofALinkPlantedAmongDecompiledSources_isRefused', async () => {
      const link: string = path.join(path.dirname(decompiled), 'Planted.cs');
      fs.symlinkSync(secret, link);

      expect(await invoke(WorkspaceChannel.OpenFile, link)).toBeNull();
    });

    it('openFile_traversingOutOfTheDecompiledFolder_isRefused', async () => {
      const traversal: string = `${path.dirname(decompiled)}/../../outside/secret.txt`;

      expect(await invoke(WorkspaceChannel.OpenFile, traversal)).toBeNull();
    });

    it('openFile_inAFolderOnlyPrefixedLikeTheDecompiledOne_isRefused', async () => {
      const imposter: string = path.join(sandbox, 'MetadataAsSourceEvil');
      fs.mkdirSync(imposter);
      const file: string = path.join(imposter, 'Evil.cs');
      fs.writeFileSync(file, SECRET);

      expect(await invoke(WorkspaceChannel.OpenFile, file)).toBeNull();
    });

    it('openFile_ofABinaryDecompiledSource_answersNull', async () => {
      fs.writeFileSync(decompiled, Buffer.from([0, 1, 2]));

      expect(await invoke(WorkspaceChannel.OpenFile, decompiled)).toBeNull();
    });

    it('decompiledSources_stayOutsideEveryOtherChannel', async () => {
      expect(await invoke(WorkspaceChannel.ReadBytes, decompiled, 0, 4)).toBeNull();
      expect(await invoke(WorkspaceChannel.ReopenFile, decompiled)).toBeNull();
      expect(
        await invoke(WorkspaceChannel.WriteBytes, decompiled, [{ offset: 0, bytes: [0x58] }]),
      ).toBe(false);
    });
  });

  describe('readBytes', () => {
    it('readBytes_clampsTheWindowToTheFile_andReportsItsSize', async () => {
      const file: string = inWorkspace('a.bin', 'abcdef');

      const chunk: BinaryChunk = await invoke(WorkspaceChannel.ReadBytes, file, 4, 100);

      expect(chunk.size).toBe(6);
      expect(chunk.offset).toBe(4);
      expect(Buffer.from(chunk.bytes).toString()).toBe('ef');
    });

    it('readBytes_pastTheEnd_answersAnEmptyWindowAtTheEnd', async () => {
      const file: string = inWorkspace('a.bin', 'abc');

      const chunk: BinaryChunk = await invoke(
        WorkspaceChannel.ReadBytes,
        file,
        Number.MAX_SAFE_INTEGER,
        16,
      );

      expect(chunk).toMatchObject({ size: 3, offset: 3 });
      expect(chunk.bytes.length).toBe(0);
    });

    it('readBytes_neverAnswersMoreThanTheIpcBound', async () => {
      const file: string = inWorkspace('big.bin', Buffer.alloc(ONE_MEGABYTE + 10, 0x61));

      const chunk: BinaryChunk = await invoke(
        WorkspaceChannel.ReadBytes,
        file,
        0,
        Number.MAX_SAFE_INTEGER,
      );

      expect(chunk.bytes.length).toBe(ONE_MEGABYTE);
      expect(chunk.size).toBe(ONE_MEGABYTE + 10);
    });

    it('readBytes_ofAnEmptyFile_answersAnEmptyWindow', async () => {
      const file: string = inWorkspace('empty.bin', '');

      const chunk: BinaryChunk = await invoke(WorkspaceChannel.ReadBytes, file, 0, 16);

      expect(chunk).toMatchObject({ size: 0, offset: 0 });
    });

    it.each([
      [-1, 16],
      [1.5, 16],
      [Number.NaN, 16],
      ['0', 16],
      [0, 0],
      [0, -1],
      [0, 1.5],
      [0, Number.POSITIVE_INFINITY],
      [0, '16'],
    ])('readBytes_refusesTheWindow %s, %s', async (offset: unknown, length: unknown) => {
      const file: string = inWorkspace('a.bin', 'abc');

      expect(await invoke(WorkspaceChannel.ReadBytes, file, offset, length)).toBeNull();
    });

    it('readBytes_ofAMissingFile_answersNull', async () => {
      const missing: string = path.join(workspaceRoot, 'missing.bin');

      expect(await invoke(WorkspaceChannel.ReadBytes, missing, 0, 16)).toBeNull();
    });

    it('readBytes_ofADirectory_answersNull', async () => {
      expect(await invoke(WorkspaceChannel.ReadBytes, workspaceRoot, 0, 16)).toBeNull();
    });
  });

  describe('writeBytes', () => {
    it('writeBytes_overwritesInPlace_withoutChangingTheLength', async () => {
      const file: string = inWorkspace('a.bin', 'abcdef');

      const written: boolean = await invoke(WorkspaceChannel.WriteBytes, file, [
        { offset: 0, bytes: [0x58] },
        { offset: 5, bytes: [0x59] },
      ]);

      expect(written).toBe(true);
      expect(fs.readFileSync(file, 'utf8')).toBe('XbcdeY');
    });

    it.each([
      ['past the end', { offset: 5, bytes: [1, 2] }],
      ['at a negative offset', { offset: -1, bytes: [1] }],
      ['at a fractional offset', { offset: 0.5, bytes: [1] }],
      ['with a string offset', { offset: '0', bytes: [1] }],
      ['without an array of bytes', { offset: 0, bytes: 'abc' }],
      ['that is null', null],
    ])('writeBytes_withAPatch %s_changesNothingAtAll', async (_label: string, bad: unknown) => {
      const file: string = inWorkspace('a.bin', 'abcdef');

      const written: boolean = await invoke(WorkspaceChannel.WriteBytes, file, [
        { offset: 0, bytes: [0x58] },
        bad,
      ]);

      expect(written).toBe(false);
      expect(fs.readFileSync(file, 'utf8')).toBe('abcdef');
    });

    it.each([[undefined], [null], ['patches'], [{ length: 1 }]])(
      'writeBytes_withoutAPatchList_isRefused %#',
      async (patches: unknown) => {
        const file: string = inWorkspace('a.bin', 'abc');

        expect(await invoke(WorkspaceChannel.WriteBytes, file, patches)).toBe(false);
      },
    );

    it('writeBytes_toAMissingFile_failsWithoutCreatingIt', async () => {
      const missing: string = path.join(workspaceRoot, 'missing.bin');

      expect(await invoke(WorkspaceChannel.WriteBytes, missing, [])).toBe(false);

      expect(fs.existsSync(missing)).toBe(false);
    });

    it('writeBytes_toAReadOnlyFile_failsAndLeavesIt', async () => {
      const file: string = inWorkspace('locked.bin', 'abc');
      fs.chmodSync(file, 0o444);

      const written: boolean = await invoke(WorkspaceChannel.WriteBytes, file, [
        { offset: 0, bytes: [0x58] },
      ]);

      expect(written).toBe(false);
      expect(fs.readFileSync(file, 'utf8')).toBe('abc');
    });
  });

  describe('writePieces', () => {
    /**
     * Lists the files in the workspace, which exposes any temporary file a save left behind.
     * @returns Returns the names, sorted.
     */
    function workspaceFiles(): readonly string[] {
      return fs.readdirSync(workspaceRoot).sort();
    }

    it('writePieces_splicesOriginalAndAddedSpans', async () => {
      const file: string = inWorkspace('a.bin', 'hello world');

      const written: boolean = await invoke(
        WorkspaceChannel.WritePieces,
        file,
        [
          { source: 'original', start: 0, length: 6 },
          { source: 'added', start: 0, length: 3 },
          { source: 'original', start: 6, length: 5 },
        ],
        new Uint8Array(Buffer.from('big')),
      );

      expect(written).toBe(true);
      expect(fs.readFileSync(file, 'utf8')).toBe('hello bigworld');
      expect(workspaceFiles()).toEqual(['a.bin']);
    });

    it('writePieces_copiesASpanLargerThanItsChunkIntact', async () => {
      const content: Buffer = Buffer.alloc(200 * 1024);
      for (let index: number = 0; index < content.length; index += 1) {
        content[index] = index % 251;
      }
      const file: string = inWorkspace('big.bin', content);

      await invoke(
        WorkspaceChannel.WritePieces,
        file,
        [{ source: 'original', start: 1, length: content.length - 1 }],
        new Uint8Array(0),
      );

      expect(fs.readFileSync(file).equals(content.subarray(1))).toBe(true);
    });

    it('writePieces_ofOnlyAddedBytes_mayCreateANewFile', async () => {
      const file: string = path.join(workspaceRoot, 'exported.png');

      const written: boolean = await invoke(
        WorkspaceChannel.WritePieces,
        file,
        [{ source: 'added', start: 0, length: 2 }],
        new Uint8Array([1, 2]),
      );

      expect(written).toBe(true);
      expect([...fs.readFileSync(file)]).toEqual([1, 2]);
    });

    it('writePieces_withNoSpans_emptiesTheFile', async () => {
      const file: string = inWorkspace('a.bin', 'abc');

      expect(await invoke(WorkspaceChannel.WritePieces, file, [], new Uint8Array(0))).toBe(true);

      expect(fs.readFileSync(file).length).toBe(0);
    });

    it.each([
      ['an unknown source', { source: 'elsewhere', start: 0, length: 1 }],
      ['a negative start', { source: 'original', start: -1, length: 1 }],
      ['a fractional length', { source: 'original', start: 0, length: 0.5 }],
      ['a negative length', { source: 'added', start: 0, length: -1 }],
      ['an added span past the buffer', { source: 'added', start: 0, length: 99 }],
      ['an original span past the end', { source: 'original', start: 0, length: 99 }],
      ['a null span', null],
    ])('writePieces_with %s_leavesTheOriginalAndNoTemporary', async (_l: string, bad: unknown) => {
      const file: string = inWorkspace('a.bin', 'abc');

      const written: boolean = await invoke(
        WorkspaceChannel.WritePieces,
        file,
        [{ source: 'original', start: 0, length: 1 }, bad],
        new Uint8Array(1),
      );

      expect(written).toBe(false);
      expect(fs.readFileSync(file, 'utf8')).toBe('abc');
      expect(workspaceFiles()).toEqual(['a.bin']);
    });

    it.each([[undefined], [[1, 2]], ['bytes'], [{ length: 2 }]])(
      'writePieces_withoutARealAddedBuffer_isRefused %#',
      async (added: unknown) => {
        const file: string = inWorkspace('a.bin', 'abc');

        expect(await invoke(WorkspaceChannel.WritePieces, file, [], added)).toBe(false);

        expect(fs.readFileSync(file, 'utf8')).toBe('abc');
      },
    );

    it('writePieces_readingAMissingOriginal_failsAndLeavesNoTemporary', async () => {
      const missing: string = path.join(workspaceRoot, 'missing.bin');

      const written: boolean = await invoke(
        WorkspaceChannel.WritePieces,
        missing,
        [{ source: 'original', start: 0, length: 1 }],
        new Uint8Array(0),
      );

      expect(written).toBe(false);
      expect(workspaceFiles()).toEqual([]);
    });

    it('writePieces_overADirectory_failsAndLeavesNoTemporary', async () => {
      const directory: string = path.join(workspaceRoot, 'folder');
      fs.mkdirSync(directory);

      const written: boolean = await invoke(
        WorkspaceChannel.WritePieces,
        directory,
        [{ source: 'added', start: 0, length: 1 }],
        new Uint8Array(1),
      );

      expect(written).toBe(false);
      expect(workspaceFiles()).toEqual(['folder']);
    });

    it('writePieces_keepsTheFilesPermissions', async () => {
      const file: string = inWorkspace('run.sh', '#!/bin/sh\n');
      fs.chmodSync(file, 0o755);

      await invoke(
        WorkspaceChannel.WritePieces,
        file,
        [{ source: 'original', start: 0, length: 10 }],
        new Uint8Array(0),
      );

      expect(fs.statSync(file).mode & 0o777).toBe(0o755);
    });

    it('writePieces_leavesASiblingWithTheTemporarysNameAlone', async () => {
      const file: string = inWorkspace('a.bin', 'abc');
      const sibling: string = inWorkspace('a.bin.onix-save', 'mine');

      await invoke(
        WorkspaceChannel.WritePieces,
        file,
        [{ source: 'added', start: 0, length: 1 }],
        new Uint8Array([0x58]),
      );

      expect(fs.readFileSync(sibling, 'utf8')).toBe('mine');
    });

    it('writePieces_doesNotWriteThroughALinkAtTheTemporarysName', async () => {
      const file: string = inWorkspace('a.bin', 'abc');
      fs.symlinkSync(secret, `${file}.onix-save`);

      await invoke(
        WorkspaceChannel.WritePieces,
        file,
        [{ source: 'added', start: 0, length: 1 }],
        new Uint8Array([0x58]),
      );

      expect(fs.readFileSync(secret, 'utf8')).toBe(SECRET);
    });

    it('writePieces_concurrently_everySaveSucceeds_andOneWholePayloadWins', async () => {
      const file: string = inWorkspace('a.bin', 'abc');
      const payloads: readonly Uint8Array[] = [0x41, 0x42, 0x43, 0x44, 0x45, 0x46].map(
        (byte: number): Uint8Array => new Uint8Array(2 * ONE_MEGABYTE).fill(byte),
      );

      const results: readonly boolean[] = await Promise.all(
        payloads.map((added: Uint8Array): Promise<boolean> =>
          invoke(
            WorkspaceChannel.WritePieces,
            file,
            [{ source: 'added', start: 0, length: added.length }],
            added,
          ),
        ),
      );

      expect(results).toEqual(payloads.map((): boolean => true));
      const saved: Buffer = fs.readFileSync(file);
      expect(saved.length).toBe(2 * ONE_MEGABYTE);
      expect(new Set<number>(saved).size).toBe(1);
      expect(workspaceFiles()).toEqual(['a.bin']);
    });
  });

  describe('directory listing', () => {
    it('readDirectory_ordersDirectoriesFirst_thenByNameIgnoringCase', async () => {
      inWorkspace('b.txt');
      inWorkspace('A.txt');
      fs.mkdirSync(path.join(workspaceRoot, 'zeta'));

      const listing: DirectoryListing = await invoke(WorkspaceChannel.ReadDirectory, workspaceRoot);

      expect(listing.entries.map((entry) => entry.name)).toEqual(['zeta', 'A.txt', 'b.txt']);
      expect(listing.entries[0]).toMatchObject({ type: 'directory' });
    });

    it('readDirectory_ofAFile_answersNull', async () => {
      const file: string = inWorkspace('a.txt');

      expect(await invoke(WorkspaceChannel.ReadDirectory, file)).toBeNull();
    });

    it('readDirectory_thatVanished_answersNull', async () => {
      expect(
        await invoke(WorkspaceChannel.ReadDirectory, path.join(workspaceRoot, 'gone')),
      ).toBeNull();
    });
  });

  describe('create, rename and delete', () => {
    it('createFile_makesAnEmptyFile', async () => {
      const result: FileOperationResult = await invoke(
        WorkspaceChannel.CreateFile,
        workspaceRoot,
        'new.txt',
      );

      expect(result).toEqual({ success: true, path: path.join(workspaceRoot, 'new.txt') });
      expect(fs.readFileSync(path.join(workspaceRoot, 'new.txt'), 'utf8')).toBe('');
    });

    it('createFile_overAnExistingFile_failsAndKeepsItsContent', async () => {
      const file: string = inWorkspace('a.txt', 'precious');

      const result: FileOperationResult = await invoke(
        WorkspaceChannel.CreateFile,
        workspaceRoot,
        'a.txt',
      );

      expect(result.success).toBe(false);
      expect(fs.readFileSync(file, 'utf8')).toBe('precious');
    });

    it('createFolder_overAnExistingFolder_fails', async () => {
      fs.mkdirSync(path.join(workspaceRoot, 'folder'));

      const result: FileOperationResult = await invoke(
        WorkspaceChannel.CreateFolder,
        workspaceRoot,
        'folder',
      );

      expect(result.success).toBe(false);
    });

    it('createFile_inAMissingDirectory_failsCleanly', async () => {
      const result: FileOperationResult = await invoke(
        WorkspaceChannel.CreateFile,
        path.join(workspaceRoot, 'gone'),
        'a.txt',
      );

      expect(result.success).toBe(false);
    });

    it('rename_movesWithinTheSameDirectory', async () => {
      const file: string = inWorkspace('a.txt');

      const result: FileOperationResult = await invoke(WorkspaceChannel.Rename, file, 'b.txt');

      expect(result).toEqual({ success: true, path: path.join(workspaceRoot, 'b.txt') });
      expect(fs.existsSync(file)).toBe(false);
    });

    it('rename_ofTheWorkspaceRoot_isRefused', async () => {
      expect(await invoke(WorkspaceChannel.Rename, workspaceRoot, 'moved')).toEqual({
        success: false,
        error: 'Cannot rename the workspace root',
      });
    });

    it('rename_ofSomethingMissing_failsCleanly', async () => {
      const result: FileOperationResult = await invoke(
        WorkspaceChannel.Rename,
        path.join(workspaceRoot, 'gone.txt'),
        'b.txt',
      );

      expect(result.success).toBe(false);
    });

    it('rename_ontoAnExistingFile_failsAndKeepsThatFile', async () => {
      const file: string = inWorkspace('a.txt', 'mine');
      const existing: string = inWorkspace('b.txt', 'precious');

      const result: FileOperationResult = await invoke(WorkspaceChannel.Rename, file, 'b.txt');

      expect(result.success).toBe(false);
      expect(fs.readFileSync(existing, 'utf8')).toBe('precious');
      expect(fs.readFileSync(file, 'utf8')).toBe('mine');
    });

    it('rename_changingOnlyCase_succeedsOnACaseInsensitiveVolume', async () => {
      const file: string = inWorkspace('readme.txt', 'text');

      const result: FileOperationResult = await invoke(WorkspaceChannel.Rename, file, 'README.txt');

      expect(result).toEqual({ success: true, path: path.join(workspaceRoot, 'README.txt') });
      expect(fs.readdirSync(workspaceRoot)).toEqual(['README.txt']);
    });

    it('delete_ofTheWorkspaceRoot_isRefused', async () => {
      expect(await invoke(WorkspaceChannel.Delete, workspaceRoot, true)).toEqual({
        success: false,
        error: 'Cannot delete the workspace root',
      });

      expect(fs.existsSync(workspaceRoot)).toBe(true);
    });

    it('delete_ofARootNamedThroughTraversal_isStillRefused', async () => {
      const result: FileOperationResult = await invoke(
        WorkspaceChannel.Delete,
        `${workspaceRoot}/sub/..`,
        true,
      );

      expect(result.error).toBe('Cannot delete the workspace root');
      expect(fs.existsSync(workspaceRoot)).toBe(true);
    });

    it('delete_goesToTheTrashByDefault', async () => {
      const file: string = inWorkspace('a.txt');

      const result: FileOperationResult = await invoke(WorkspaceChannel.Delete, file);

      expect(result).toEqual({ success: true, path: file, trashed: true });
      expect(electron.trashed).toEqual([file]);
    });

    it('delete_withNoTrashAvailable_removesAndSaysSo', async () => {
      const folder: string = path.join(workspaceRoot, 'folder');
      fs.mkdirSync(path.join(folder, 'deep'), { recursive: true });
      electron.trashWorks = false;

      const result: FileOperationResult = await invoke(WorkspaceChannel.Delete, folder);

      expect(result).toEqual({ success: true, path: folder, trashed: false });
      expect(fs.existsSync(folder)).toBe(false);
    });

    it('delete_permanently_neverTouchesTheTrash', async () => {
      const file: string = inWorkspace('a.txt');

      const result: FileOperationResult = await invoke(WorkspaceChannel.Delete, file, true);

      expect(result).toEqual({ success: true, path: file, trashed: false });
      expect(electron.trashed).toEqual([]);
    });

    it('delete_treatsOnlyAStrictTrueAsPermanent', async () => {
      const file: string = inWorkspace('a.txt');

      await invoke(WorkspaceChannel.Delete, file, 'true');

      expect(electron.trashed).toEqual([file]);
    });

    it('delete_ofSomethingMissing_failsCleanly', async () => {
      electron.trashWorks = false;

      const result: FileOperationResult = await invoke(
        WorkspaceChannel.Delete,
        path.join(workspaceRoot, 'gone.txt'),
      );

      expect(result.success).toBe(false);
    });
  });

  describe('project and package requests', () => {
    it.each([[undefined], [null], [''], [42]])(
      'loads_withAnUnusableRoot_touchNothing %#',
      async (root: unknown) => {
        const match: MockInstance = vi.spyOn(projectSystems, 'match');
        const packages: MockInstance = vi.spyOn(packageManagers, 'match');

        expect(await invoke(ProjectChannel.ModelLoad, root)).toBeNull();
        expect(await invoke(PackageChannel.ModelLoad, root)).toBeNull();
        expect(await invoke(PackageChannel.Sources, root)).toEqual([]);

        expect(match).not.toHaveBeenCalled();
        expect(packages).not.toHaveBeenCalled();
      },
    );

    it('loads_requireAnOpenRoot_notMerelyAPathInsideOne', async () => {
      const match: MockInstance = vi.spyOn(projectSystems, 'match');
      const folder: string = path.join(workspaceRoot, 'folder');
      fs.mkdirSync(folder);

      expect(await invoke(ProjectChannel.ModelLoad, folder)).toBeNull();
      expect(await invoke(ProjectChannel.ModelLoad, outside)).toBeNull();

      expect(match).not.toHaveBeenCalled();
    });

    it('loads_inAnOpenRootNoSystemClaims_answerNothing', async () => {
      expect(await invoke(ProjectChannel.ModelLoad, workspaceRoot)).toBeNull();
      expect(await invoke(PackageChannel.ModelLoad, workspaceRoot)).toBeNull();
      expect(await invoke(PackageChannel.Sources, workspaceRoot)).toEqual([]);
      expect(await invoke(ProjectChannel.ArtifactResolve, inWorkspace('a.c'), 7)).toBeNull();
    });

    it('search_refusesAClosedRootAndNonStringTerms', async () => {
      const empty: unknown = { items: [], total: 0, hasMore: false };

      expect(await invoke(PackageChannel.Search, outside, 'nuget', 'x')).toEqual(empty);
      expect(await invoke(PackageChannel.Search, workspaceRoot, 42, 'x')).toEqual(empty);
      expect(await invoke(PackageChannel.Search, workspaceRoot, 'nuget', null)).toEqual(empty);
      expect(await invoke(PackageChannel.Search, workspaceRoot, 'nuget', 'x')).toEqual(empty);
    });

    it.each([
      [
        { skip: -5, take: 0 },
        { skip: 0, take: 50, prerelease: false },
      ],
      [
        { skip: 2.9, take: 1e9, prerelease: true },
        { skip: 2, take: 100, prerelease: true },
      ],
      [
        { skip: Number.NaN, take: Number.NaN, prerelease: 'yes' },
        { skip: 0, take: 50, prerelease: false },
      ],
      [{ skip: Number.POSITIVE_INFINITY }, { skip: 0, take: 50, prerelease: false }],
      [null, { skip: 0, take: 50, prerelease: false }],
      ['options', { skip: 0, take: 50, prerelease: false }],
    ])('search_clampsTheOptions %#', async (options: unknown, expected: unknown) => {
      const search: Mock = vi.fn().mockResolvedValue({ items: [], total: 0, hasMore: false });
      vi.spyOn(packageManagers, 'match').mockResolvedValue({
        search,
      } as never);

      await invoke(PackageChannel.Search, workspaceRoot, 'nuget', 'x', options);

      expect(search.mock.calls[0]?.[3]).toEqual(expected);
    });

    describe('with a package-manager plugin route', () => {
      const empty: PackageSearchResult = { items: [], total: 0, hasMore: false };
      const model: PackageManagerModel = { ecosystem: 'npm', root: '/ws', projects: [] };

      /**
       * Registers a manager whose plugin route answers as given.
       * @param route The route's answers.
       */
      function registerWith(route: Partial<PackagePluginRoute>): void {
        electron.handlers.clear();
        new WorkspaceManager(
          (): BrowserWindow | null => null,
          workspace,
          trusted,
          route as PackagePluginRoute,
        ).register();
      }

      it('packages_comeFromThePlugin_andCoreIsNotAsked', async () => {
        const match: MockInstance = vi.spyOn(packageManagers, 'match');
        registerWith({
          load: () => Promise.resolve(model),
          sources: () => Promise.resolve([{ name: 'npm' }]),
          search: () => Promise.resolve({ ...empty, total: 3 }),
        });

        expect(await invoke(PackageChannel.ModelLoad, workspaceRoot)).toEqual(model);
        expect(await invoke(PackageChannel.Sources, workspaceRoot)).toEqual([{ name: 'npm' }]);
        expect(await invoke(PackageChannel.Search, workspaceRoot, 'npm', 'x')).toEqual({
          ...empty,
          total: 3,
        });
        expect(match).not.toHaveBeenCalled();
      });

      it('packages_fallToCore_whenThePluginDeclines', async () => {
        const match: MockInstance = vi.spyOn(packageManagers, 'match').mockResolvedValue(null);
        registerWith({
          load: () => Promise.resolve(null),
          sources: () => Promise.resolve(null),
          search: () => Promise.resolve(null),
        });

        await invoke(PackageChannel.ModelLoad, workspaceRoot);
        await invoke(PackageChannel.Sources, workspaceRoot);
        await invoke(PackageChannel.Search, workspaceRoot, 'npm', 'x');

        expect(match).toHaveBeenCalledTimes(3);
      });

      it('thePlugin_isNotAskedAboutAFolderThatIsNotOpen', async () => {
        const load: Mock = vi.fn();
        registerWith({ load, sources: load, search: load });

        await invoke(PackageChannel.ModelLoad, outside);
        await invoke(PackageChannel.Sources, outside);
        await invoke(PackageChannel.Search, outside, 'npm', 'x');

        expect(load).not.toHaveBeenCalled();
      });

      it('search_clampsTheOptionsBeforeThePluginSeesThem', async () => {
        const search: Mock = vi.fn().mockResolvedValue(empty);
        registerWith({ search });

        await invoke(PackageChannel.Search, workspaceRoot, 'npm', 'x', { skip: -5, take: 1e9 });

        expect(search).toHaveBeenCalledWith(workspaceRoot, 'npm', 'x', {
          skip: 0,
          take: 100,
          prerelease: false,
        });
      });
    });

    it('renameSolutionFolder_refusesAClosedRootAndNonStringArguments', async () => {
      expect(await invoke(ProjectChannel.SolutionFolderRename, outside, 'a', 'b')).toEqual({
        success: false,
        error: 'That workspace is not open.',
      });
      expect(await invoke(ProjectChannel.SolutionFolderRename, workspaceRoot, 1, 'b')).toEqual({
        success: false,
        error: 'The folder could not be identified.',
      });
      expect(await invoke(ProjectChannel.SolutionFolderRename, workspaceRoot, 'a', null)).toEqual({
        success: false,
        error: 'The folder could not be identified.',
      });
    });

    it('renameSolutionFolder_withNoSystemThatCan_saysSo', async () => {
      const result: ProjectOperationResult = await invoke(
        ProjectChannel.SolutionFolderRename,
        workspaceRoot,
        'a',
        'b',
      );

      expect(result).toEqual({
        success: false,
        error: 'This workspace has no renameable solution folders.',
      });
    });

    it('resolveArtifact_asksEachSystemInTurn_andIgnoresANonStringConfiguration', async () => {
      const file: string = inWorkspace('a.c');
      const artifact: unknown = { path: '/bin/a' };
      const declines: Mock = vi.fn().mockResolvedValue(null);
      const answers: Mock = vi.fn().mockResolvedValue(artifact);
      vi.spyOn(projectSystems, 'all').mockReturnValue([
        {},
        { resolveArtifact: declines },
        { resolveArtifact: answers },
      ] as never);

      expect(await invoke(ProjectChannel.ArtifactResolve, file, 7)).toBe(artifact);

      expect(declines).toHaveBeenCalledWith(file, undefined);
      expect(answers).toHaveBeenCalledWith(file, undefined);
    });
  });
});
